"""The T2 integration matrix (the integration test plan §5) as executable scenarios.

Two families:

* **device scenarios** — the harness drives the device directly and asserts the
  documented contract. These are the ones that can run with no Companion
  available, and they are what tells us whether the spec's vc147 semantics hold
  on the build under test.
* **companion scenarios** — Companion's HTTP API drives a button (or the harness
  changes the device directly) and the module's variables are asserted against
  the device's own report.

Every scenario leaves the device as it found it (``restore``), so runs are
repeatable and order-independent.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import time
import uuid
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

import adb
from companion import CompanionClient
from config import Config, Layout
from device import DeviceClient, Frame
from program import restore_program, save_program, summarise
from timeline import Check, Timeline

def _neighbour_name(status: dict[str, Any], direction: str) -> str:
	"""Name of the neighbouring session, or '' when there is none.

	While idle the device reports `is_next_session: true` for a loaded program and
	the module treats sessions[0] as the next session, so that is the expectation.
	"""
	sessions = DeviceClient.sessions(status)
	index = DeviceClient.cc(status).get('current_session_index')
	if not isinstance(index, int) or index < 0:
		return str(sessions[0].get('name') or '') if (direction == 'next' and sessions) else ''
	target = index + 1 if direction == 'next' else index - 1
	return str(sessions[target].get('name') or '') if 0 <= target < len(sessions) else ''


def _session_number(status: dict[str, Any]) -> str:
	"""1-based current session position, or 0 when nothing is current.

	`current_session_index` is 0 for the first session, so it must not be
	coerced with `or -1`: that turns a real index 0 into "no session".
	"""
	index = DeviceClient.cc(status).get('current_session_index')
	return str(index + 1) if isinstance(index, int) else '0'


# Variables that must match a device snapshot exactly (no clock in them).
EXACT_VARIABLES: tuple[tuple[str, Callable[[dict[str, Any]], str]], ...] = (
	('timer_run_state', lambda s: str(DeviceClient.cc(s).get('timer_run_state') or 'idle')),
	('current_session_id', lambda s: str(DeviceClient.cc(s).get('current_session_id') or '')),
	('current_session_name', lambda s: str(DeviceClient.cc(s).get('current_session_name') or '')),
	('current_presenter_name', lambda s: str(DeviceClient.cc(s).get('current_presenter_name') or '')),
	('current_session_number', lambda s: _session_number(s)),
	('total_sessions', lambda s: str(len(DeviceClient.sessions(s)))),
	('total_messages', lambda s: str(len(DeviceClient.message_list(s)))),
	('message_text', lambda s: str(DeviceClient.view(s).get('message_text') or '')),
	('is_playing', lambda s: 'Yes' if DeviceClient.cc(s).get('timer_run_state') == 'running' else 'No'),
	('is_glowing', lambda s: 'Yes' if DeviceClient.cc(s).get('is_glowing') else 'No'),
	('is_blackout', lambda s: 'Yes' if DeviceClient.cc(s).get('is_blackout') else 'No'),
	('next_session_name', lambda s: _neighbour_name(s, 'next')),
	('previous_session_name', lambda s: _neighbour_name(s, 'previous')),
)


class SkipScenario(Exception):
	"""Raised by a scenario that cannot run in this configuration."""


@dataclass
class Ctx:
	cfg: Config
	device: DeviceClient
	companion: CompanionClient | None
	timeline: Timeline
	checks: list[Check] = field(default_factory=list)
	scenario_id: str = ''
	layout: Layout | None = None
	out_dir: Path = Path('.')

	# ---- assertions ----

	def check(self, name: str, ok: bool, detail: str = '') -> bool:
		self.checks.append(Check(name, ok, detail))
		return ok

	def warn(self, name: str, ok: bool, detail: str = '') -> bool:
		"""Record an observation that does not fail the scenario."""
		self.checks.append(Check(name, ok, detail, level='warn'))
		return ok

	def equal(self, name: str, actual: Any, expected: Any) -> bool:
		return self.check(name, actual == expected, f'expected {expected!r}, got {actual!r}')

	def contains(self, name: str, haystack: Any, needle: Any) -> bool:
		return self.check(name, needle in haystack, f'{needle!r} not in {haystack!r}')

	# ---- companions ----

	async def snapshot(self) -> dict[str, Any]:
		status = await self.device.snapshot()
		if self.companion is not None:
			names = [name for name, _ in EXACT_VARIABLES]
			self.timeline.record_variables(self.scenario_id, self.companion.variables(names))
		return status

	async def restore(self) -> None:
		"""Best-effort return to neutral: no message, no effects, paused."""
		try:
			await self.device.command('hide_message')
		except Exception:
			pass
		for command, fields in (('set_flash', {'action': 'disable'}), ('set_blackout', {'action': 'disable'}), ('set_glow', {'enabled': False})):
			try:
				await self.device.command(command, **fields)
			except Exception:
				pass
		try:
			await self.device.command('pause_session')
		except Exception:
			pass


# A soak is long by nature; the release gate raises this via CUETIME_SOAK_SECONDS.
_SOAK_DEFAULT_SECONDS = 60.0

ScenarioFn = Callable[[Ctx], Awaitable[None]]


@dataclass
class Scenario:
	id: str
	group: str
	title: str
	spec: str
	fn: ScenarioFn
	needs_companion: bool = False


SCENARIOS: list[Scenario] = []


def scenario(id_: str, group: str, title: str, spec: str, needs_companion: bool = False) -> Callable[[ScenarioFn], ScenarioFn]:
	def decorator(fn: ScenarioFn) -> ScenarioFn:
		SCENARIOS.append(Scenario(id_, group, title, spec, fn, needs_companion))
		return fn

	return decorator


# ---------------------------------------------------------------- helpers


def _wait(state: dict[str, Any], timeout: float) -> dict[str, Any]:
	return {'timeout': timeout}


async def _pick(ctx: Ctx, mode: str) -> str | None:
	status = await ctx.device.snapshot()
	for session in DeviceClient.sessions(status):
		if session.get('mode') == mode:
			return str(session.get('id'))
	return None


async def _ensure_current(ctx: Ctx) -> str | None:
	"""Return the current session id, selecting the first session when idle.

	Deleting a session that happened to be current leaves the device idle, and a
	scenario that needs a timer must arrange that rather than assert on it.
	"""
	current = await _current_session(ctx)
	if current is not None:
		return current
	sessions = DeviceClient.sessions(await ctx.snapshot())
	if not sessions:
		return None
	first = str(sessions[0].get('id') or '')
	if first and await _show_session(ctx, first):
		return first
	return None


async def _current_session(ctx: Ctx) -> str | None:
	status = await ctx.device.snapshot()
	sid = DeviceClient.cc(status).get('current_session_id')
	return str(sid) if sid else None


async def _show_session(ctx: Ctx, session_id: str) -> bool:
	ok, _ = await ctx.device.command_ok('show_session', session_id=session_id)
	return ok


def _first_message(status: dict[str, Any]) -> dict[str, Any] | None:
	messages = DeviceClient.message_list(status)
	return messages[0] if messages else None


async def _module_var(ctx: Ctx, name: str, expected: str, timeout: float = 2.0, label: str | None = None) -> None:
	"""Assert a module variable, when a Companion is attached to ask."""
	if ctx.companion is None:
		ctx.warn(f'{name} not verified (no Companion attached)', True, 'skipped')
		return
	ok, seen = ctx.companion.wait_variable(name, expected, timeout=timeout)
	ctx.check(label or f'module {name} == {expected!r}', ok, f'polls={seen[-3:]}')


async def _pick_pausable(ctx: Ctx) -> str | None:
	"""A session the timer commands accept (a wall clock rejects most of them)."""
	for session in DeviceClient.sessions(await ctx.snapshot()):
		if session.get('mode') in ('countdown', 'countup'):
			return str(session.get('id'))
	return None


async def _press(ctx: Ctx, preset: str) -> None:
	"""Press a preset button through Companion, skipping if it is not placed."""
	if ctx.companion is None:
		raise SkipScenario('needs Companion')
	if ctx.layout is None:
		raise SkipScenario('no layout configured (see integration/layout.example.json)')
	where = ctx.layout.locate(preset)
	if where is None:
		raise SkipScenario(f'preset {preset!r} is not in the layout')
	row, col = where
	ctx.companion.page = ctx.layout.page
	ctx.companion.press(row, col)
	await asyncio.sleep(0.4)


# ---------------------------------------------------------------- group S


@scenario('S1', 'S', 'Device greeting and full status snapshot', '§1.3, §4')
async def s1_device_sanity(ctx: Ctx) -> None:
	hello = ctx.device.hello or {}
	ctx.check('hello_event has screen_id', bool(hello.get('screen_id')), str(hello.get('screen_id')))
	ctx.check('hello_event has integer version_code', isinstance(hello.get('version_code'), int), str(hello.get('version_code')))
	ctx.check('hello_event has version_name', bool(hello.get('version_name')), str(hello.get('version_name')))
	status = await ctx.snapshot()
	for section in ('control_center', 'view', 'settings', 'sessions', 'messages'):
		ctx.check(f'status_response has {section}', isinstance(status.get(section), dict))
	ctx.check('status carries a request_id echo', status.get('request_id') is not None)


# ---------------------------------------------------------------- group B


@scenario('B1', 'B', 'start_session / pause_session drive the run state', '§3.2')
async def b1_timer_run_state(ctx: Ctx) -> None:
	session_id = await _ensure_current(ctx)
	if session_id is None:
		ctx.check('a current session exists', False, 'device reports no current session')
		return
	await ctx.restore()

	mark = ctx.device.mark
	ok, resp = await ctx.device.command_ok('start_session', session_id=session_id)
	ctx.check('start_session acked', ok, f'type={resp.get("type")} code={resp.get("code")}')
	event = await ctx.device.wait(
		lambda f: f.get('type') == 'control_center_status_event'
		and (f.get('control_center') or {}).get('timer_run_state') == 'running',
		timeout=2.0,
		start=mark,
	)
	ctx.check('running broadcast as control_center_status_event', event is not None)

	status = await ctx.snapshot()
	ctx.equal('timer_run_state is running', DeviceClient.cc(status).get('timer_run_state'), 'running')
	before = DeviceClient.cc(status).get('elapsed_time') or 0
	await asyncio.sleep(1.3)
	after = DeviceClient.cc(await ctx.snapshot()).get('elapsed_time') or 0
	ctx.check('elapsed_time advances while running', after > before, f'{before} -> {after}')

	ok, resp = await ctx.device.command_ok('pause_session')
	ctx.check('pause_session acked', ok, f'type={resp.get("type")} code={resp.get("code")}')
	await asyncio.sleep(0.4)
	status = await ctx.snapshot()
	ctx.equal('timer_run_state is paused', DeviceClient.cc(status).get('timer_run_state'), 'paused')


@scenario('B4', 'B', 'add_time / subtract_time move the timer by the requested amount', '§3.2')
async def b4_add_subtract_time(ctx: Ctx) -> None:
	session_id = await _pick(ctx, 'countdown')
	if session_id is None:
		ctx.check('a countdown session exists', False, 'no countdown session in the program')
		return
	await _show_session(ctx, session_id)
	await ctx.restore()
	await _show_session(ctx, session_id)
	await asyncio.sleep(0.3)

	start = DeviceClient.cc(await ctx.snapshot()).get('timer') or 0
	ok, resp = await ctx.device.command_ok('add_time', seconds=60)
	ctx.check('add_time acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	added = DeviceClient.cc(await ctx.snapshot()).get('timer') or 0
	ctx.check('timer grew by ~60s', abs((added - start) - 60000) <= 2000, f'{start} -> {added}')

	ok, resp = await ctx.device.command_ok('subtract_time', seconds=60)
	ctx.check('subtract_time acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	subtracted = DeviceClient.cc(await ctx.snapshot()).get('timer') or 0
	ctx.check('timer returned to ~start', abs(subtracted - start) <= 2000, f'{start} -> {subtracted}')


@scenario('B6', 'B', 'timer commands against a time_of_day session are refused', '§3.2')
async def b6_time_of_day_refusals(ctx: Ctx) -> None:
	session_id = await _pick(ctx, 'time_of_day')
	if session_id is None:
		ctx.check('a time_of_day session exists', False, 'none in the program')
		return
	previous = await _current_session(ctx)
	await _show_session(ctx, session_id)
	await asyncio.sleep(0.3)
	try:
		for command in ('pause_session', 'add_time', 'subtract_time', 'reset_current_session'):
			resp = await ctx.device.command(command)
			ctx.check(
				f'{command} refused on time_of_day',
				resp.get('type') == 'error_response',
				f'type={resp.get("type")} code={resp.get("code")}',
			)
	finally:
		# A wall clock left current would break every later scenario that needs a
		# pausable timer, so put the previous session back.
		if previous and previous != session_id:
			await _show_session(ctx, previous)


# ---------------------------------------------------------------- group C


@scenario('C1', 'C', 'add_session returns entity_id and delete_session undoes it', '§3.2')
async def c1_session_crud(ctx: Ctx) -> None:
	session_id = f'conf-{uuid.uuid4().hex[:8]}'
	before = len(DeviceClient.sessions(await ctx.snapshot()))
	ok, resp = await ctx.device.command_ok(
		'add_session',
		session_id=session_id,
		name='Integration Session',
		presenter_name='Harness',
		mode='countdown',
		seconds=90,
	)
	ctx.check('add_session acked', ok, f'code={resp.get("code")}')
	ctx.equal('add_session echoes entity_id', resp.get('entity_id'), session_id)
	status = await ctx.snapshot()
	ctx.equal('session count grew by one', len(DeviceClient.sessions(status)), before + 1)
	ctx.contains('new session is in the list', [s.get('id') for s in DeviceClient.sessions(status)], session_id)

	ok, resp = await ctx.device.command_ok('delete_session', session_id=session_id)
	ctx.check('delete_session acked', ok, f'code={resp.get("code")}')
	status = await ctx.snapshot()
	ctx.equal('session count back to baseline', len(DeviceClient.sessions(status)), before)


@scenario('C2', 'C', 'add_message returns entity_id and delete_message undoes it', '§3.2')
async def c2_message_crud(ctx: Ctx) -> None:
	content = f'Integration message {uuid.uuid4().hex[:6]}'
	before = len(DeviceClient.message_list(await ctx.snapshot()))
	ok, resp = await ctx.device.command_ok('add_message', content=content)
	ctx.check('add_message acked', ok, f'code={resp.get("code")}')
	message_id = resp.get('entity_id')
	ctx.check('add_message echoes entity_id', bool(message_id), str(message_id))
	status = await ctx.snapshot()
	ctx.equal('message count grew by one', len(DeviceClient.message_list(status)), before + 1)

	if message_id:
		ok, resp = await ctx.device.command_ok('delete_message', message_id=str(message_id))
		ctx.check('delete_message acked', ok, f'code={resp.get("code")}')
		status = await ctx.snapshot()
		ctx.equal('message count back to baseline', len(DeviceClient.message_list(status)), before)


# ---------------------------------------------------------------- group D


@scenario('D1', 'D', 'show_message by message_id names the stored message', '§3.2, §4.5')
async def d1_show_by_id(ctx: Ctx) -> None:
	await ctx.restore()
	status = await ctx.snapshot()
	message = _first_message(status)
	if message is None:
		ctx.check('a stored message exists', False, 'no messages in the program')
		return
	message_id = str(message.get('id'))
	ok, resp = await ctx.device.command_ok('show_message', message_id=message_id)
	ctx.check('show_message acked', ok, f'code={resp.get("code")}')
	ctx.equal('show_message echoes entity_id', resp.get('entity_id'), message_id)

	await asyncio.sleep(0.4)
	status = await ctx.snapshot()
	view = DeviceClient.view(status)
	ctx.equal('view.message_id is that message', view.get('message_id'), message_id)
	ctx.equal('view.message_text is its content', view.get('message_text'), message.get('text'))
	showing = [m for m in DeviceClient.message_list(status) if m.get('is_showing')]
	ctx.check('exactly that message reports is_showing', [m.get('id') for m in showing] == [message_id], f'is_showing={[m.get("id") for m in showing]}')
	await ctx.restore()


@scenario('D2', 'D', 'show_message by text is ad-hoc: no program change, no entity_id (vc147)', '§3.2')
async def d2_show_adhoc_text(ctx: Ctx) -> None:
	await ctx.restore()
	before_status = await ctx.snapshot()
	before_messages = len(DeviceClient.message_list(before_status))
	text = f'Integration ad-hoc {uuid.uuid4().hex[:6]}'

	mark = ctx.device.mark
	ok, resp = await ctx.device.command_ok('show_message', text=text)
	ctx.check('ad-hoc show_message acked', ok, f'code={resp.get("code")}')
	ctx.check('ad-hoc replies without entity_id', resp.get('entity_id') is None, f'entity_id={resp.get("entity_id")}')

	await asyncio.sleep(1.2)
	ctx.check('no program_changed_event for ad-hoc text', 'program_changed_event' not in ctx.device.event_kinds_since(mark), str(ctx.device.event_kinds_since(mark)))

	status = await ctx.snapshot()
	view = DeviceClient.view(status)
	ctx.equal('view.message_text is the ad-hoc text', view.get('message_text'), text)
	ctx.equal('view.message_id is empty', view.get('message_id') or '', '')
	ctx.equal('message list unchanged', len(DeviceClient.message_list(status)), before_messages)
	showing = [m.get('id') for m in DeviceClient.message_list(status) if m.get('is_showing')]
	ctx.check('no stored message reports is_showing', showing == [], f'is_showing={showing}')
	await ctx.restore()


@scenario('D3', 'D', 'show_message flash is three-state: on, off (stops), omitted (keeps) (vc147)', '§3.2')
async def d3_flash_three_state(ctx: Ctx) -> None:
	await ctx.restore()
	status = await ctx.snapshot()
	message = _first_message(status)
	if message is None:
		ctx.check('a stored message exists', False, 'no messages in the program')
		return
	message_id = str(message.get('id'))

	await ctx.device.command('show_message', message_id=message_id)
	mark = ctx.device.mark
	await ctx.device.command('set_flash', action='enable')
	event = await ctx.device.wait(
		lambda f: f.get('type') == 'view_status_event' and (f.get('view') or {}).get('is_flashing') is True,
		timeout=2.0,
		start=mark,
	)
	ctx.check('flash on is broadcast in view_status_event', event is not None)
	ctx.equal('view.is_flashing after enable', DeviceClient.view(await ctx.snapshot()).get('is_flashing'), True)

	# vc147: an explicit false stops a flash that is already running.
	mark = ctx.device.mark
	await ctx.device.command('show_message', message_id=message_id, flash=False)
	event = await ctx.device.wait(
		lambda f: f.get('type') == 'view_status_event' and (f.get('view') or {}).get('is_flashing') is False,
		timeout=2.0,
		start=mark,
	)
	ctx.check('flash:false stops the flash (vc147)', event is not None, 'still flashing after flash:false')
	ctx.equal('view.is_flashing after flash:false', DeviceClient.view(await ctx.snapshot()).get('is_flashing'), False)

	# Omitted flash leaves the flag alone: turn it on, then show again without flash.
	await ctx.device.command('set_flash', action='enable')
	await asyncio.sleep(0.4)
	ctx.equal('flash re-enabled', DeviceClient.view(await ctx.snapshot()).get('is_flashing'), True)
	await ctx.device.command('show_message', message_id=message_id)
	await asyncio.sleep(0.6)
	ctx.equal('omitted flash keeps flashing on', DeviceClient.view(await ctx.snapshot()).get('is_flashing'), True)
	await ctx.restore()


@scenario('D5', 'D', 'hide_message clears the text and the message flash', '§3.2')
async def d5_hide_message(ctx: Ctx) -> None:
	status = await ctx.snapshot()
	message = _first_message(status)
	if message is None:
		ctx.check('a stored message exists', False, 'no messages in the program')
		return
	await ctx.device.command('show_message', message_id=str(message.get('id')))
	await ctx.device.command('set_flash', action='enable')
	await asyncio.sleep(0.4)
	ok, resp = await ctx.device.command_ok('hide_message')
	ctx.check('hide_message acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	view = DeviceClient.view(await ctx.snapshot())
	ctx.equal('view.message_text cleared', view.get('message_text') or '', '')
	ctx.equal('view.is_flashing off', view.get('is_flashing'), False)


@scenario('D6', 'D', 'session flashing (is_time_up_flashing) never shows up as message flash', '§4.5')
async def d6_flash_separation(ctx: Ctx) -> None:
	# Arrange the precondition rather than assert it: the setting is persisted on the
	# device, so an earlier run (or a reinstall) can leave it off, and a scenario that
	# needs the cue should not depend on what the last session did.
	original_time_up = DeviceClient.settings(await ctx.snapshot()).get('is_time_up_display') is True
	if not original_time_up:
		ok, resp = await ctx.device.command_ok('set_is_time_up_display', enabled=True)
		ctx.check('time-up display enabled for this scenario', ok, f'code={resp.get("code")}')

	session_id = f'conf-{uuid.uuid4().hex[:8]}'
	previous = await _ensure_current(ctx)
	# flash_length_seconds must be <= flash_start_time_seconds ("Flash length must be
	# <= flash start time"), so the window is [duration-start, duration-start+length].
	ok, resp = await ctx.device.command_ok(
		'add_session',
		session_id=session_id,
		name='Integration Time-Up',
		mode='countdown',
		seconds=3,
		flash_start_time_seconds=2,
		flash_length_seconds=2,
	)
	ctx.check('short countdown session created', ok, f'code={resp.get("code")} message={resp.get("message")}')
	if not ok:
		return
	try:
		await _show_session(ctx, session_id)
		await ctx.device.command('start_session', session_id=session_id)
		# Remaining hits 2 s at ~1 s elapsed, which opens the flash window.
		await asyncio.sleep(1.6)
		view = DeviceClient.view(await ctx.snapshot())
		ctx.equal('session side reports is_time_up_flashing', view.get('is_time_up_flashing'), True)
		ctx.equal('message flash stays false during the session window', view.get('is_flashing'), False)

		# A message shown while the session window runs must not borrow it.
		status = await ctx.snapshot()
		message = _first_message(status)
		if message is not None:
			await ctx.device.command('show_message', message_id=str(message.get('id')))
			await asyncio.sleep(0.5)
			view = DeviceClient.view(await ctx.snapshot())
			ctx.equal('shown message does not inherit the session flash', view.get('is_flashing'), False)
			ctx.equal('session flash still reported separately', view.get('is_time_up_flashing'), True)
			await ctx.device.command('set_flash', action='enable')
			await asyncio.sleep(0.5)
			view = DeviceClient.view(await ctx.snapshot())
			ctx.equal('message flash can run alongside the session window', view.get('is_flashing'), True)
			ctx.equal('session flash unaffected by the message flash', view.get('is_time_up_flashing'), True)
	finally:
		await ctx.restore()
		await ctx.device.command_ok('delete_session', session_id=session_id)
		if previous:
			await _show_session(ctx, previous)
		if not original_time_up:
			await ctx.device.command_ok('set_is_time_up_display', enabled=False)


# ---------------------------------------------------------------- group E


@scenario('E1', 'E', 'set_blackout toggles the effect without touching the timer', '§3.2')
async def e1_blackout(ctx: Ctx) -> None:
	await ctx.restore()
	ok, resp = await ctx.device.command_ok('set_blackout', action='enable')
	ctx.check('blackout enable acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	status = await ctx.snapshot()
	ctx.equal('control_center.is_blackout true', DeviceClient.cc(status).get('is_blackout'), True)
	ok, _ = await ctx.device.command_ok('set_blackout', action='disable')
	ctx.check('blackout disable acked', ok)
	await asyncio.sleep(0.4)
	status = await ctx.snapshot()
	ctx.equal('control_center.is_blackout false', DeviceClient.cc(status).get('is_blackout'), False)


@scenario('E2', 'E', 'set_glow toggles the effect and disables blackout', '§3.2')
async def e2_glow(ctx: Ctx) -> None:
	await ctx.restore()
	ok, resp = await ctx.device.command_ok('set_glow', enabled=True)
	ctx.check('glow enable acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	status = await ctx.snapshot()
	ctx.equal('control_center.is_glowing true', DeviceClient.cc(status).get('is_glowing'), True)
	ok, _ = await ctx.device.command_ok('set_glow', enabled=False)
	ctx.check('glow disable acked', ok)
	await asyncio.sleep(0.4)
	ctx.equal('control_center.is_glowing false', DeviceClient.cc(await ctx.snapshot()).get('is_glowing'), False)


# ---------------------------------------------------------------- group G


@scenario('G1', 'G', 'unknown message_id is INVALID_PARAMETER, not a silent success', '§3.2, §3.3')
async def g1_unknown_message_id(ctx: Ctx) -> None:
	resp = await ctx.device.command('show_message', message_id=f'conf-missing-{uuid.uuid4().hex[:6]}')
	ctx.equal('unknown message_id rejected', resp.get('type'), 'error_response')
	ctx.equal('error code is INVALID_PARAMETER', resp.get('code'), 'INVALID_PARAMETER')


@scenario('G2', 'G', 'blank or missing message address is INVALID_PARAMETER', '§3.2')
async def g2_blank_message_text(ctx: Ctx) -> None:
	resp = await ctx.device.command('show_message', text='')
	ctx.equal('blank text rejected', resp.get('type'), 'error_response')
	ctx.equal('blank text code is INVALID_PARAMETER', resp.get('code'), 'INVALID_PARAMETER')
	resp = await ctx.device.command('show_message')
	ctx.equal('missing address rejected', resp.get('type'), 'error_response')
	ctx.equal('missing address code is INVALID_PARAMETER', resp.get('code'), 'INVALID_PARAMETER')


@scenario('G3', 'G', 'a stalled client cannot delay another, and overflow closes it (§5.9)', '§5.9')
async def g3_back_pressure(ctx: Ctx) -> None:
	# Two independent properties, both measured from outside the device:
	#
	# 1. A client that stops reading must not delay a healthy one. The library-based
	#    client below pauses its own reads deliberately (max_queue=1), which is what
	#    makes the device's per-client queue back up.
	# 2. Overflow must end with a closed connection, never a silent stall - the device
	#    says so ("response queue full (depth=32): closing connection"), and a raw
	#    socket with a deliberately tiny receive window forces the condition reliably.
	#
	# Short delivery is *not* a failure: the device also drops inbound requests when
	# its intake queue is full ("Dropped JSON WS request_status: intake queue full or
	# closed"), which is undocumented in the wire spec and only visible in the device
	# log. So this row asserts no coalescing of what did arrive, rather than a count.
	stalled = await asyncio.create_subprocess_exec(
		'python3',
		'-c',
		_STALL_SCRIPT,
		ctx.cfg.device_host,
		str(ctx.cfg.device_port),
		str(_STALL_REQUESTS),
		stdout=asyncio.subprocess.PIPE,
		stderr=asyncio.subprocess.STDOUT,
	)
	assert stalled.stdout is not None
	try:
		await asyncio.sleep(1.5)  # the stalled client is now mid-back-pressure
		started = time.monotonic()
		status = await ctx.device.snapshot()
		latency = time.monotonic() - started
		ctx.check(
			'healthy client is not delayed by the stalled one',
			isinstance(status.get('control_center'), dict) and latency < 1.0,
			f'snapshot in {latency * 1000:.0f} ms',
		)
		raw = await asyncio.wait_for(stalled.stdout.readline(), timeout=60)
	finally:
		if stalled.returncode is None:
			stalled.kill()
			await stalled.wait()

	line = raw.decode().strip().splitlines()[-1] if raw.strip() else '{}'
	try:
		report = json.loads(line)
	except json.JSONDecodeError:
		report = {'outcome': 'unparseable', 'raw': line}

	outcome = report.get('outcome')
	received = report.get('received')
	sent = report.get('sent')
	ctx.check('stalled client finished (not hung)', outcome in ('complete', 'closed'), str(report))
	ctx.check(
		'no reply was coalesced or duplicated',
		report.get('duplicate_ids', 0) == 0,
		f"duplicates={report.get('duplicate_ids')} received={received}/{sent}",
	)
	if outcome == 'timeout':
		# Partial delivery with an open connection: the device dropped inbound requests
		# at intake rather than coalescing answers. Recorded, not failed - the close
		# property is asserted deterministically below.
		ctx.warn(
			'short delivery left the connection open (intake drops, not coalescing)',
			True,
			f'{received}/{sent} answered',
		)

	# Deterministic overflow: a raw client with a tiny receive window.
	raw_client = await asyncio.create_subprocess_exec(
		'python3',
		'-c',
		_RAW_OVERFLOW_SCRIPT,
		ctx.cfg.device_host,
		str(ctx.cfg.device_port),
		str(_RAW_REQUESTS),
		stdout=asyncio.subprocess.PIPE,
		stderr=asyncio.subprocess.STDOUT,
	)
	assert raw_client.stdout is not None
	try:
		raw_line = await asyncio.wait_for(raw_client.stdout.readline(), timeout=120)
	finally:
		if raw_client.returncode is None:
			raw_client.kill()
			await raw_client.wait()
	try:
		raw_report = json.loads(raw_line.decode().strip().splitlines()[-1])
	except (json.JSONDecodeError, IndexError):
		raw_report = {'outcome': 'unparseable'}
	# Complete, closed, or still answering after intake drops: all three are consistent
	# with the documented delivery rules. Only a connection that neither answers nor
	# closes is a stall.
	ctx.check(
		'overflow ends in a close or a usable connection, never a silent stall',
		raw_report.get('outcome') in ('complete', 'closed', 'healthy-after-drops'),
		str(raw_report),
	)


_RAW_REQUESTS = 200

_RAW_OVERFLOW_SCRIPT = r'''
import asyncio, base64, json, os, socket, struct, sys, time

HOST, PORT = sys.argv[1], int(sys.argv[2])
N = int(sys.argv[3])

def client_frame(text):
    payload = text.encode()
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    n = len(payload)
    if n < 126:
        header = bytes([0x81, 0x80 | n])
    elif n < 65536:
        header = bytes([0x81, 0x80 | 126]) + struct.pack(">H", n)
    else:
        header = bytes([0x81, 0x80 | 127]) + struct.pack(">Q", n)
    return header + mask + masked

async def main():
    loop = asyncio.get_running_loop()
    sock = socket.socket()
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4096)  # small window -> real back-pressure
    sock.setblocking(False)
    await loop.sock_connect(sock, (HOST, PORT))
    key = base64.b64encode(os.urandom(16)).decode()
    await loop.sock_sendall(sock, (
        "GET / HTTP/1.1\r\nHost: %s:%d\r\nUpgrade: websocket\r\n"
        "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n"
        % (HOST, PORT, key)
    ).encode())
    head = b""
    while b"\r\n\r\n" not in head:
        chunk = await loop.sock_recv(sock, 4096)
        if not chunk:
            print(json.dumps({"outcome": "handshake-failed"})); return
        head += chunk
    buf = head.split(b"\r\n\r\n", 1)[1]
    for i in range(N):
        await loop.sock_sendall(sock, client_frame(json.dumps({"type": "request_status", "request_id": "raw-%d" % i})))

    await asyncio.sleep(3.0)  # never read during the burst
    replies, closed, close_frame = 0, False, False
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        try:
            chunk = await asyncio.wait_for(loop.sock_recv(sock, 65536), timeout=5)
        except asyncio.TimeoutError:
            break
        except OSError:
            closed = True
            break
        if not chunk:
            closed = True
            break
        buf += chunk
        while True:
            if len(buf) < 2: break
            opcode = buf[0] & 0x0F
            length = buf[1] & 0x7F
            offset = 2
            if length == 126:
                if len(buf) < 4: break
                length = struct.unpack(">H", buf[2:4])[0]; offset = 4
            elif length == 127:
                if len(buf) < 10: break
                length = struct.unpack(">Q", buf[2:10])[0]; offset = 10
            if len(buf) < offset + length: break
            payload = buf[offset:offset + length]
            buf = buf[offset + length:]
            if opcode == 8:
                close_frame = True
            elif opcode in (1, 2):
                try:
                    frame = json.loads(payload)
                except Exception:
                    continue
                if frame.get("type", "").endswith("_response"):
                    replies += 1
        if replies >= N or closed or close_frame:
            break

    # Short delivery is legitimate: the device drops inbound requests when its intake
    # queue is full. The property that matters is that the connection is either closed
    # (outbound overflow, as documented) or still usable - never left stalled.
    probe_replied = False
    if not closed and not close_frame:
        for attempt in range(3):
            probe_id = "raw-probe-%d" % attempt
            try:
                await loop.sock_sendall(sock, client_frame(json.dumps({"type": "request_status", "request_id": probe_id})))
            except OSError:
                closed = True
                break
            probe_deadline = time.monotonic() + 6
            while time.monotonic() < probe_deadline:
                try:
                    chunk = await asyncio.wait_for(loop.sock_recv(sock, 65536), timeout=2)
                except asyncio.TimeoutError:
                    break
                except OSError:
                    closed = True
                    break
                if not chunk:
                    closed = True
                    break
                buf += chunk
                while True:
                    if len(buf) < 2: break
                    opcode = buf[0] & 0x0F
                    length = buf[1] & 0x7F
                    offset = 2
                    if length == 126:
                        if len(buf) < 4: break
                        length = struct.unpack(">H", buf[2:4])[0]; offset = 4
                    elif length == 127:
                        if len(buf) < 10: break
                        length = struct.unpack(">Q", buf[2:10])[0]; offset = 10
                    if len(buf) < offset + length: break
                    payload = buf[offset:offset + length]
                    buf = buf[offset + length:]
                    if opcode == 8:
                        close_frame = True
                    elif opcode in (1, 2):
                        try:
                            frame = json.loads(payload)
                        except Exception:
                            continue
                        if frame.get("request_id") == probe_id:
                            probe_replied = True
                if probe_replied or closed or close_frame:
                    break
            if probe_replied or closed or close_frame:
                break

    if closed or close_frame:
        outcome = "closed"
    elif replies >= N:
        outcome = "complete"
    elif probe_replied:
        outcome = "healthy-after-drops"
    else:
        outcome = "stalled"
    print(json.dumps({"outcome": outcome, "replies": replies, "close_frame": close_frame,
                      "tcp_closed": closed, "probe_replied": probe_replied}))
    sock.close()

asyncio.run(main())
'''


_STALL_REQUESTS = 200

_STALL_SCRIPT = r'''
import asyncio, json, sys
import websockets

async def main():
    host, port, n = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    ids = [f"stall-{i}" for i in range(n)]
    report = {"received": 0, "sent": n, "outcome": "error", "duplicate_ids": 0}
    try:
        async with websockets.connect(f"ws://{host}:{port}", max_queue=1, open_timeout=5) as ws:
            for rid in ids:
                await ws.send(json.dumps({"type": "request_status", "request_id": rid}))
            await asyncio.sleep(3.0)  # never read during the burst
            seen = []
            try:
                while len(seen) < n:
                    frame = json.loads(await asyncio.wait_for(ws.recv(), timeout=10))
                    if frame.get("request_id") in ids:
                        seen.append(frame["request_id"])
                report.update(received=len(seen), duplicate_ids=len(seen) - len(set(seen)), outcome="complete")
            except asyncio.TimeoutError:
                report.update(received=len(seen), duplicate_ids=len(seen) - len(set(seen)), outcome="timeout")
            except websockets.ConnectionClosed:
                report.update(received=len(seen), duplicate_ids=len(seen) - len(set(seen)), outcome="closed")
    except Exception as exc:
        report.update(outcome=f"error:{type(exc).__name__}")
    print(json.dumps(report))

asyncio.run(main())
'''


# ---------------------------------------------------------------- group A


@scenario('A1', 'A', 'module hydrates to exactly what the device reports', '§1.3, §4', needs_companion=True)
async def a1_hydration(ctx: Ctx) -> None:
	assert ctx.companion is not None
	ctx.companion.restart()
	deadline = asyncio.get_running_loop().time() + 20
	category = ''
	while asyncio.get_running_loop().time() < deadline:
		category = ctx.companion.category()
		if category == 'good':
			break
		await asyncio.sleep(0.5)
	ctx.equal('connection reports category good', category, 'good')
	await asyncio.sleep(1.5)

	status = await ctx.snapshot()
	for name, expected_fn in EXACT_VARIABLES:
		expected = expected_fn(status)
		ok, seen = ctx.companion.wait_variable(name, expected, timeout=2.0)
		ctx.check(f'variable {name} matches device', ok, f'expected {expected!r}, polls={seen[-3:]}')

	again = await ctx.snapshot()
	for name, expected_fn in EXACT_VARIABLES:
		expected = expected_fn(again)
		value = ctx.companion.variable(name)
		ctx.check(f'variable {name} still matches after quiesce', value == expected, f'expected {expected!r}, got {value!r}')


@scenario('A5', 'A', 'idle display names the first session as next (matches is_next_session)', '§4.4', needs_companion=True)
async def a5_idle_neighbour(ctx: Ctx) -> None:
	assert ctx.companion is not None
	previous = await _ensure_current(ctx)
	temp = f'conf-{uuid.uuid4().hex[:8]}'
	ok, resp = await ctx.device.command_ok(
		'add_session', session_id=temp, name='Integration Idle', mode='countdown', seconds=60
	)
	if not ok:
		raise SkipScenario(f'could not add a temporary session: {resp.get("code")}')
	try:
		await _show_session(ctx, temp)
		await asyncio.sleep(0.4)
		# Deleting the current session is what leaves the display idle with a program loaded.
		ok, resp = await ctx.device.command_ok('delete_session', session_id=temp)
		ctx.check('deleting the current session succeeds', ok, f'code={resp.get("code")}')
		await asyncio.sleep(0.8)

		status = await ctx.snapshot()
		cc = DeviceClient.cc(status)
		ctx.equal('device reports idle', cc.get('timer_run_state'), 'idle')
		ctx.equal('device still reports is_next_session', cc.get('is_next_session'), True)
		sessions = DeviceClient.sessions(status)
		if not sessions:
			raise SkipScenario('no sessions left after the temporary one was removed')
		expected = str(sessions[0].get('name') or '')
		ok, seen = ctx.companion.wait_variable('next_session_name', expected, timeout=2.0)
		ctx.check('module names the first session as next', ok, f'expected {expected!r}, polls={seen[-3:]}')
		ok, seen = ctx.companion.wait_variable('current_session_number', '0', timeout=2.0)
		ctx.check('module reports no current session', ok, f'polls={seen[-3:]}')
	finally:
		if previous:
			await _show_session(ctx, previous)


@scenario('F1', 'F', 'device-initiated change reaches the module (reverse direction)', '§5', needs_companion=True)
async def f1_reverse_tracking(ctx: Ctx) -> None:
	assert ctx.companion is not None
	session_id = await _ensure_current(ctx)
	if session_id is None:
		ctx.check('a current session exists', False, 'none')
		return
	if not await _show_session(ctx, session_id):
		await _show_session(ctx, session_id)
	await ctx.restore()
	await _show_session(ctx, session_id)
	await asyncio.sleep(0.3)

	await ctx.device.command('start_session', session_id=session_id)
	ok, seen = ctx.companion.wait_variable('timer_run_state', 'running', timeout=2.0)
	ctx.check('module tracks device-initiated start', ok, f'polls={seen[-3:]}')
	ctx.equal('device agrees it is running', DeviceClient.cc(await ctx.snapshot()).get('timer_run_state'), 'running')

	await ctx.device.command('pause_session')
	ok, seen = ctx.companion.wait_variable('timer_run_state', 'paused', timeout=2.0)
	ctx.check('module tracks device-initiated pause', ok, f'polls={seen[-3:]}')


@scenario('F2', 'F', 'a burst of session changes converges on the final session', '§5.9', needs_companion=True)
async def f2_burst_convergence(ctx: Ctx) -> None:
	assert ctx.companion is not None
	sessions = [str(s.get('id')) for s in DeviceClient.sessions(await ctx.snapshot()) if s.get('id')]
	if len(sessions) < 2:
		ctx.check('at least two sessions exist', False, f'have {sessions}')
		return
	for session_id in sessions[:5]:
		await ctx.device.command('show_session', session_id=session_id)
	await asyncio.sleep(1.5)
	status = await ctx.snapshot()
	expected = str(DeviceClient.cc(status).get('current_session_name') or '')
	ok, seen = ctx.companion.wait_variable('current_session_name', expected, timeout=3.0)
	ctx.check('module converges on the final current session', ok, f'expected {expected!r}, polls={seen[-3:]}')


# ---------------------------------------------------------------- group P
#
# Forward direction: an operator presses a Companion preset button, and both the
# device effect and the module's report are asserted. Requires a Companion
# connection (for the button) and a layout file (for the coordinates).


@scenario('P1', 'P', 'press toggle_playback starts then pauses, and the module follows', '§3.2', needs_companion=True)
async def p1_press_toggle_playback(ctx: Ctx) -> None:
	assert ctx.companion is not None
	await ctx.restore()
	await _press(ctx, 'toggle_playback')
	status = await ctx.snapshot()
	ctx.equal('device is running after the press', DeviceClient.cc(status).get('timer_run_state'), 'running')
	ok, seen = ctx.companion.wait_variable('timer_run_state', 'running', timeout=2.0)
	ctx.check('module reports running', ok, f'polls={seen[-3:]}')

	await _press(ctx, 'toggle_playback')
	status = await ctx.snapshot()
	ctx.equal('device is paused after the second press', DeviceClient.cc(status).get('timer_run_state'), 'paused')
	ok, seen = ctx.companion.wait_variable('timer_run_state', 'paused', timeout=2.0)
	ctx.check('module reports paused', ok, f'polls={seen[-3:]}')


@scenario('P2', 'P', 'press navigate_next moves to the next session on both sides', '§3.2', needs_companion=True)
async def p2_press_navigate_next(ctx: Ctx) -> None:
	assert ctx.companion is not None
	await ctx.restore()
	before = str(DeviceClient.cc(await ctx.snapshot()).get('current_session_id') or '')
	await _press(ctx, 'navigate_next')
	status = await ctx.snapshot()
	after = str(DeviceClient.cc(status).get('current_session_id') or '')
	ctx.check('device moved to a different session', after != before, f'{before} -> {after}')
	expected = str(DeviceClient.cc(status).get('current_session_name') or '')
	ok, seen = ctx.companion.wait_variable('current_session_name', expected, timeout=2.0)
	ctx.check('module reports the new session name', ok, f'expected {expected!r}, polls={seen[-3:]}')


@scenario('P3', 'P', 'press add_time moves the device timer and the module variable', '§3.2', needs_companion=True)
async def p3_press_add_time(ctx: Ctx) -> None:
	assert ctx.companion is not None
	session_id = await _pick(ctx, 'countdown')
	if session_id is None:
		raise SkipScenario('no countdown session in the program')
	await ctx.restore()
	await _show_session(ctx, session_id)
	await asyncio.sleep(0.3)
	before = DeviceClient.cc(await ctx.snapshot()).get('timer') or 0
	await _press(ctx, 'add_time')
	status = await ctx.snapshot()
	after = DeviceClient.cc(status).get('timer') or 0
	ctx.check('device timer grew by ~60s', abs((after - before) - 60000) <= 2000, f'{before} -> {after}')
	expected = str(after)
	ok, seen = ctx.companion.wait_variable('timer', expected, timeout=3.0)
	ctx.check('module timer matches the device', ok, f'expected {expected}, polls={seen[-3:]}')


@scenario('P4', 'P', 'press show_message displays the preset text as an ad-hoc message', '§3.2', needs_companion=True)
async def p4_press_show_message(ctx: Ctx) -> None:
	assert ctx.companion is not None
	await ctx.restore()
	await _press(ctx, 'show_message')
	await asyncio.sleep(0.5)
	status = await ctx.snapshot()
	view = DeviceClient.view(status)
	text = str(view.get('message_text') or '')
	ctx.equal('device shows the preset text', text, 'Fill in message')
	ctx.equal('ad-hoc message has no stored id', view.get('message_id') or '', '')
	ok, seen = ctx.companion.wait_variable('message_text', text, timeout=2.0)
	ctx.check('module reports the message text', ok, f'polls={seen[-3:]}')


@scenario('P5', 'P', 'press blackout toggles the effect and the module variable', '§3.2', needs_companion=True)
async def p5_press_blackout(ctx: Ctx) -> None:
	assert ctx.companion is not None
	await ctx.restore()
	await _press(ctx, 'blackout')
	ctx.equal('device blackout on', DeviceClient.cc(await ctx.snapshot()).get('is_blackout'), True)
	ok, seen = ctx.companion.wait_variable('is_blackout', 'Yes', timeout=2.0)
	ctx.check('module reports blackout', ok, f'polls={seen[-3:]}')
	await _press(ctx, 'blackout')
	ctx.equal('device blackout off', DeviceClient.cc(await ctx.snapshot()).get('is_blackout'), False)
	ok, seen = ctx.companion.wait_variable('is_blackout', 'No', timeout=2.0)
	ctx.check('module reports blackout cleared', ok, f'polls={seen[-3:]}')


@scenario('P6', 'P', 'press toggle_glow toggles glow and clears blackout', '§3.2', needs_companion=True)
async def p6_press_toggle_glow(ctx: Ctx) -> None:
	assert ctx.companion is not None
	await ctx.restore()
	await _press(ctx, 'toggle_glow')
	status = await ctx.snapshot()
	ctx.equal('device glow on', DeviceClient.cc(status).get('is_glowing'), True)
	ctx.equal('glow clears blackout', DeviceClient.cc(status).get('is_blackout'), False)
	ok, seen = ctx.companion.wait_variable('is_glowing', 'Yes', timeout=2.0)
	ctx.check('module reports glow', ok, f'polls={seen[-3:]}')
	await _press(ctx, 'toggle_glow')
	ctx.equal('device glow off', DeviceClient.cc(await ctx.snapshot()).get('is_glowing'), False)


# ---------------------------------------------------------------- remaining rows
#
# The program-replacing scenarios come last on purpose: each backs the loaded
# program up into the run bundle and restores it in a `finally`, but a run that
# dies mid-restore must not take the earlier scenarios down with it.


@scenario('A4', 'A', 'the empty-program state left by delete_program', '§3.6, §5')
async def a4_empty_program(ctx: Ctx) -> None:
	await ctx.restore()
	previous = await _current_session(ctx)
	program = await save_program(ctx.device, ctx.out_dir, 'A4')
	try:
		ok, resp = await ctx.device.command_ok('delete_program', program_id=str(program.get('program_id')))
		ctx.check('delete_program acked', ok, f'code={resp.get("code")} {resp.get("message") or ""}'.strip())
		await asyncio.sleep(1.0)

		status = await ctx.snapshot()
		ctx.equal('no sessions remain', len(DeviceClient.sessions(status)), 0)
		ctx.equal('no messages remain', len(DeviceClient.message_list(status)), 0)
		ctx.equal('device is idle', DeviceClient.cc(status).get('timer_run_state'), 'idle')
		ctx.equal('no current session', DeviceClient.cc(status).get('current_session_id') or '', '')

		# vc147: the ad-hoc text form needs no program; the id form looks one up.
		ok, resp = await ctx.device.command_ok('show_message', text='Integration empty program')
		ctx.check('ad-hoc text accepted with an empty program', ok, f'code={resp.get("code")}')
		await asyncio.sleep(0.4)
		ctx.equal(
			'ad-hoc text is on screen',
			DeviceClient.view(await ctx.snapshot()).get('message_text'),
			'Integration empty program',
		)
		await ctx.device.command('hide_message')

		resp = await ctx.device.command('show_message', message_id='integration-not-a-message')
		ctx.equal('id form rejected on an empty program', resp.get('type'), 'error_response')
		ctx.equal('id form code is INVALID_PARAMETER', resp.get('code'), 'INVALID_PARAMETER')

		await _module_var(ctx, 'total_sessions', '0')
		await _module_var(ctx, 'total_messages', '0')
	finally:
		ok, detail = await restore_program(ctx.device, program)
		ctx.check('fixture program restored', ok, detail)
		if previous:
			await _show_session(ctx, previous)
		await asyncio.sleep(0.5)
		ctx.equal(
			'restored session count',
			len(DeviceClient.sessions(await ctx.snapshot())),
			len(program.get('sessions') or []),
		)


@scenario('B5', 'B', 'reset_current_session and reset_program_elapsed_timer zero their clocks', '§3.2')
async def b5_resets(ctx: Ctx) -> None:
	session_id = await _pick_pausable(ctx)
	if session_id is None:
		raise SkipScenario('no countdown/countup session in the program')
	await ctx.restore()
	await _show_session(ctx, session_id)
	await ctx.device.command('start_session', session_id=session_id)
	await asyncio.sleep(1.6)
	before = await ctx.snapshot()
	elapsed_before = DeviceClient.cc(before).get('elapsed_time') or 0
	program_before = DeviceClient.cc(before).get('program_elapsed_time') or 0
	ctx.check('elapsed advanced before the reset', elapsed_before >= 1000, f'{elapsed_before} ms')

	mark = ctx.device.mark
	ok, resp = await ctx.device.command_ok('reset_current_session')
	ctx.check('reset_current_session acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.6)
	after = await ctx.snapshot()
	ctx.equal('session is paused after the reset', DeviceClient.cc(after).get('timer_run_state'), 'paused')
	elapsed_after = DeviceClient.cc(after).get('elapsed_time') or 0
	ctx.check('elapsed_time restarted from zero', elapsed_after < 1000, f'{elapsed_before} -> {elapsed_after} ms')
	ctx.check(
		'program_changed_event pushed for the reset',
		'program_changed_event' in ctx.device.event_kinds_since(mark),
		str(ctx.device.event_kinds_since(mark)),
	)

	ok, resp = await ctx.device.command_ok('reset_program_elapsed_timer')
	ctx.check('reset_program_elapsed_timer acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.5)
	program_after = DeviceClient.cc(await ctx.snapshot()).get('program_elapsed_time') or 0
	ctx.check('program_elapsed_time reset to zero', program_after < 2000, f'{program_before} -> {program_after} ms')
	await ctx.restore()


@scenario('C4', 'C', 'delete_all_messages and delete_all_sessions empty the program', '§3.2')
async def c4_delete_all(ctx: Ctx) -> None:
	await ctx.restore()
	previous = await _current_session(ctx)
	program = await save_program(ctx.device, ctx.out_dir, 'C4')
	try:
		ok, resp = await ctx.device.command_ok('delete_all_messages')
		ctx.check('delete_all_messages acked', ok, f'code={resp.get("code")}')
		await asyncio.sleep(0.6)
		ctx.equal('no messages remain', len(DeviceClient.message_list(await ctx.snapshot())), 0)
		await _module_var(ctx, 'total_messages', '0')

		ok, resp = await ctx.device.command_ok('delete_all_sessions')
		ctx.check('delete_all_sessions acked', ok, f'code={resp.get("code")}')
		await asyncio.sleep(0.8)
		status = await ctx.snapshot()
		ctx.equal('no sessions remain', len(DeviceClient.sessions(status)), 0)
		ctx.equal('device is idle', DeviceClient.cc(status).get('timer_run_state'), 'idle')
		await _module_var(ctx, 'total_sessions', '0')
	finally:
		ok, detail = await restore_program(ctx.device, program)
		ctx.check('fixture program restored', ok, detail)
		if previous:
			await _show_session(ctx, previous)
		await asyncio.sleep(0.5)
		ctx.equal(
			'restored message count',
			len(DeviceClient.message_list(await ctx.snapshot())),
			len(program.get('messages') or []),
		)


@scenario('D7', 'D', 'time-up display off gates the cue but not the session flash window', '§3.2, §4.5')
async def d7_time_up_display_off(ctx: Ctx) -> None:
	original = DeviceClient.settings(await ctx.snapshot()).get('is_time_up_display') is True
	ok, resp = await ctx.device.command_ok('set_is_time_up_display', enabled=False)
	ctx.check('time-up display disabled', ok, f'code={resp.get("code")}')
	session_id = f'integration-{uuid.uuid4().hex[:8]}'
	previous = await _ensure_current(ctx)
	try:
		ok, resp = await ctx.device.command_ok(
			'add_session',
			session_id=session_id,
			name='Integration Time-Up Off',
			mode='countdown',
			seconds=3,
			flash_start_time_seconds=2,
			flash_length_seconds=2,
		)
		ctx.check('short countdown created', ok, f'code={resp.get("code")}')
		if not ok:
			return
		await _show_session(ctx, session_id)
		await ctx.device.command('start_session', session_id=session_id)
		# Remaining hits 2 s at ~1 s elapsed: inside the window, before zero.
		await asyncio.sleep(1.6)
		view = DeviceClient.view(await ctx.snapshot())
		ctx.equal('session flash window still reports', view.get('is_time_up_flashing'), True)
		# Past zero the cue is gated off by the setting.
		await asyncio.sleep(2.9)
		view = DeviceClient.view(await ctx.snapshot())
		ctx.equal('time-up cue is gated off', view.get('is_time_up_flashing'), False)
		ctx.equal('message flash stays false', view.get('is_flashing'), False)
	finally:
		await ctx.restore()
		await ctx.device.command_ok('delete_session', session_id=session_id)
		if previous:
			await _show_session(ctx, previous)
		await ctx.device.command_ok('set_is_time_up_display', enabled=original)
		await asyncio.sleep(0.3)
		ctx.equal(
			'time-up display setting restored',
			DeviceClient.settings(await ctx.snapshot()).get('is_time_up_display'),
			original,
		)


@scenario('E3', 'E', 'show_idle takes a showing message off the glass', '§3.2')
async def e3_show_idle(ctx: Ctx) -> None:
	message = _first_message(await ctx.snapshot())
	if message is None:
		raise SkipScenario('no messages in the program')
	await ctx.restore()
	await ctx.device.command('show_message', message_id=str(message.get('id')))
	await asyncio.sleep(0.4)
	showing = DeviceClient.view(await ctx.snapshot()).get('message_text') or ''
	ctx.check('message is showing first', str(showing) != '', str(showing))

	ok, resp = await ctx.device.command_ok('show_idle')
	ctx.check('show_idle acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.5)
	view = DeviceClient.view(await ctx.snapshot())
	ctx.equal('message text cleared', view.get('message_text') or '', '')
	ctx.equal('message flash off', view.get('is_flashing'), False)
	await _module_var(ctx, 'message_text', '')


@scenario('E4', 'E', 'set_brightness round-trips and rejects out-of-range values', '§4.6')
async def e4_brightness(ctx: Ctx) -> None:
	original = DeviceClient.settings(await ctx.snapshot()).get('brightness')
	ok, resp = await ctx.device.command_ok('set_brightness', brightness=20)
	ctx.check('set_brightness 20 acked', ok, f'code={resp.get("code")}')
	await asyncio.sleep(0.4)
	ctx.equal('brightness is 20', DeviceClient.settings(await ctx.snapshot()).get('brightness'), 20)

	resp = await ctx.device.command('set_brightness', brightness=150)
	ctx.equal('out-of-range brightness rejected', resp.get('code'), 'INVALID_PARAMETER')

	if original is not None:
		ok, _ = await ctx.device.command_ok('set_brightness', brightness=int(original))
		ctx.check('brightness restore acked', ok)
		await asyncio.sleep(0.4)
		ctx.equal('brightness back to the original value', DeviceClient.settings(await ctx.snapshot()).get('brightness'), original)


@scenario('F3', 'F', 'send_program replaces the program and is refused while a timer runs', '§3.6')
async def f3_send_program(ctx: Ctx) -> None:
	await ctx.restore()
	previous = await _current_session(ctx)
	program = await save_program(ctx.device, ctx.out_dir, 'F3')
	try:
		modified = json.loads(json.dumps(program))
		sessions = modified.get('sessions') or []
		if not sessions:
			raise SkipScenario('the loaded program has no sessions to rename')
		renamed = 'Integration Renamed'
		sessions[0]['name'] = renamed

		mark = ctx.device.mark
		ok, resp = await ctx.device.command_ok('send_program', program=modified)
		ctx.check('send_program acked', ok, f'code={resp.get("code")} {resp.get("message") or ""}'.strip())
		event = await ctx.device.wait(
			lambda f: f.get('type') == 'program_changed_event', timeout=3.0, start=mark
		)
		ctx.check('program_changed_event pushed', event is not None)
		status = await ctx.snapshot()
		names = [str(s.get('name')) for s in DeviceClient.sessions(status)]
		ctx.check('renamed session is loaded', renamed in names, str(names))
		await _module_var(ctx, 'total_sessions', str(len(names)))

		# A different program_id while the timer runs is DEVICE_BUSY (the same id
		# would be allowed, which is why the clone gets its own id).
		other = json.loads(json.dumps(modified))
		other['program_id'] = f'{program.get("program_id")}-busy'
		# A reload may have left the display with no current session, and an idle
		# timer is not busy — select and start one first, and prove it is running.
		await _show_session(ctx, str(sessions[0].get('id')))
		await ctx.device.command('start_session')
		await asyncio.sleep(0.6)
		ctx.equal(
			'timer is running before the busy probe',
			DeviceClient.cc(await ctx.snapshot()).get('timer_run_state'),
			'running',
		)
		resp = await ctx.device.command('send_program', program=other)
		ctx.equal('a new program is refused while running', resp.get('code'), 'DEVICE_BUSY')
		await ctx.device.command('pause_session')
	finally:
		ok, detail = await restore_program(ctx.device, program)
		ctx.check('fixture program restored', ok, detail)
		if previous:
			await _show_session(ctx, previous)
		await asyncio.sleep(0.5)
		names = [str(s.get('name')) for s in DeviceClient.sessions(await ctx.snapshot())]
		ctx.check(
			'original session names are back',
			names == [str(s.get('name')) for s in (program.get('sessions') or [])],
			str(names),
		)


@scenario('G4', 'G', 'every reply is correlated and request ids are not reused', '§2, §3.3')
async def g4_request_id_audit(ctx: Ctx) -> None:
	mark = ctx.device.mark
	expected_errors = {'audit-bad-command': 'INVALID_COMMAND', 'audit-bad-brightness': 'INVALID_PARAMETER'}
	probes = [
		({'type': 'request_status'}, 'audit-status'),
		({'type': 'request_view_status'}, 'audit-view'),
		({'type': 'request_settings_status'}, 'audit-settings'),
		({'type': 'request_sessions_status'}, 'audit-sessions'),
		({'type': 'not_a_real_command'}, 'audit-bad-command'),
		({'type': 'set_brightness', 'brightness': 150}, 'audit-bad-brightness'),
	]
	for command, rid in probes:
		resp = await ctx.device.send(command, request_id=rid)
		ctx.equal(f'{rid} echoed its request_id', resp.get('request_id'), rid)
		if rid in expected_errors:
			ctx.equal(f'{rid} code', resp.get('code'), expected_errors[rid])

	# Two frames on the wire carrying the same request_id.
	dup = 'audit-duplicate'
	dup_mark = ctx.device.mark
	await ctx.device.send_nowait({'type': 'request_view_status'}, request_id=dup)
	await ctx.device.send_nowait({'type': 'request_view_status'}, request_id=dup)
	await asyncio.sleep(0.8)
	dup_replies = [f for f in ctx.device.responses_since(dup_mark) if f.get('request_id') == dup]
	# Observation, not a pass/fail: this device answers both frames and does not
	# reject a repeated id, so "duplicate request detection" is not a WS-JSON feature.
	ctx.warn(
		'repeated request_id is answered, not rejected',
		len(dup_replies) >= 1,
		f'{len(dup_replies)} replies for one id: {[f.get("type") for f in dup_replies]}',
	)

	responses = ctx.device.responses_since(mark)
	ids = [str(f.get('request_id')) for f in responses if f.get('request_id')]
	sent = {rid for _, rid in probes} | {dup}
	stray = sorted(set(ids) - sent)
	ctx.check('no reply to an id we did not send', stray == [], str(stray))
	repeated = sorted({rid for rid in ids if ids.count(rid) > 1} - {dup})
	ctx.check('no request_id answered twice', repeated == [], str(repeated))
	ctx.check('every probe got a reply', sent <= set(ids), f'missing: {sorted(sent - set(ids))}')
	errors = [f for f in responses if f.get('type') == 'error_response']
	ctx.check(
		'only the two expected error replies',
		len(errors) == len(expected_errors),
		f'{len(errors)} error replies: {[f.get("code") for f in errors]}',
	)


@scenario('G5', 'G', 'soak: repeated commands keep the device and the module in step', '')
async def g5_soak(ctx: Ctx) -> None:
	seconds = float(os.environ.get('CUETIME_SOAK_SECONDS', _SOAK_DEFAULT_SECONDS))
	session_id = await _pick_pausable(ctx)
	if session_id is None:
		raise SkipScenario('no countdown/countup session in the program')
	await ctx.restore()
	await _show_session(ctx, session_id)
	message = _first_message(await ctx.snapshot())

	errors: list[tuple[int, str]] = []
	unanswered = 0
	iterations = 0
	deadline = time.monotonic() + seconds
	while time.monotonic() < deadline:
		iterations += 1
		command = 'start_session' if iterations % 2 else 'pause_session'
		try:
			resp = await ctx.device.command(command)
		except Exception as exc:  # noqa: BLE001 - a dropped connection is the finding
			unanswered += 1
			errors.append((iterations, type(exc).__name__))
			break
		if resp.get('type') == 'error_response':
			errors.append((iterations, str(resp.get('code'))))
		if iterations % 5 == 0 and message is not None:
			await ctx.device.command('show_message', message_id=str(message.get('id')))
			await ctx.device.command('hide_message')
		if iterations % 10 == 0:
			probe = await ctx.device.snapshot()
			if not isinstance(probe.get('control_center'), dict):
				errors.append((iterations, 'no-snapshot'))
		await asyncio.sleep(1.0)

	ctx.check(f'{iterations} commands over {seconds:.0f}s kept the device answering', unanswered == 0, str(errors[:3]))
	ctx.check('no error_response during the soak', len(errors) == 0, str(errors[:3]))
	ctx.check('the connection stayed open for the whole soak', not ctx.device.closed.is_set())

	await ctx.restore()
	await asyncio.sleep(1.0)
	status = await ctx.snapshot()
	ctx.equal('device is paused at the end', DeviceClient.cc(status).get('timer_run_state'), 'paused')
	if ctx.companion is not None:
		await _module_var(
			ctx,
			'timer_run_state',
			str(DeviceClient.cc(status).get('timer_run_state') or 'idle'),
			timeout=3.0,
			label='module run state matches the device after the soak',
		)


# ---------------------------------------------------------------- adb-backed rows
#
# A2/A3/F4 need a shell on the display itself, so they skip (with a reason) when no
# attached adb device matches the host under test. They run last: an app restart
# wipes the loaded program, so each takes a backup and restores it afterwards.


def _adb_for(ctx: Ctx) -> 'Adb':
	handle, reason = adb.connect(ctx.cfg.device_host)
	if handle is None:
		raise SkipScenario(f'adb unavailable for {ctx.cfg.device_host}: {reason}')
	return handle


async def _wait_for(predicate: Callable[[], bool], timeout: float, interval: float = 0.25) -> bool:
	deadline = time.monotonic() + timeout
	while time.monotonic() < deadline:
		if predicate():
			return True
		await asyncio.sleep(interval)
	return predicate()


async def _wait_ws(host: str, port: int, timeout: float = 90.0) -> Frame | None:
	"""Poll the device until its WebSocket serves a hello_event again."""
	deadline = time.monotonic() + timeout
	while time.monotonic() < deadline:
		probe = DeviceClient(host, port, timeout=3.0)
		try:
			return await probe.connect()
		except Exception:  # noqa: BLE001 - not up yet
			await asyncio.sleep(1.0)
		finally:
			await probe.close()
	return None


async def _wait_category(companion: CompanionClient, wanted: str, timeout: float) -> str:
	deadline = time.monotonic() + timeout
	category = ''
	while time.monotonic() < deadline:
		category = companion.category()
		if category == wanted:
			return category
		await asyncio.sleep(0.5)
	return category


async def _compare_module_to_device(ctx: Ctx, label: str) -> None:
	"""Every exact variable must equal a fresh snapshot of the device."""
	assert ctx.companion is not None
	await asyncio.sleep(1.0)
	for name, expected_fn in EXACT_VARIABLES:
		expected = expected_fn(await ctx.snapshot())
		ok, seen = ctx.companion.wait_variable(name, expected, timeout=3.0)
		ctx.check(f'{label}: {name} matches device', ok, f'expected {expected!r}, polls={seen[-3:]}')


@scenario('A2', 'A', 'a display restart leaves the module reporting the new truth', '§1.3, §4', needs_companion=True)
async def a2_app_restart(ctx: Ctx) -> None:
	assert ctx.companion is not None
	handle = _adb_for(ctx)
	previous = await _current_session(ctx)
	screen_id = (ctx.device.hello or {}).get('screen_id')
	program = await save_program(ctx.device, ctx.out_dir, 'A2')
	started = False
	try:
		handle.restart()
		started = True
		closed = await _wait_for(lambda: ctx.device.closed.is_set(), timeout=20)
		ctx.check('the restart closed our connection', closed)

		hello = await _wait_ws(ctx.cfg.device_host, ctx.cfg.device_port)
		ctx.check('the device WebSocket came back', hello is not None, str(hello))
		if hello is None:
			return
		await ctx.device.reconnect()
		ctx.equal('same screen id after the restart', hello.get('screen_id'), screen_id)
		ctx.equal('module and harness each saw one greeting', ctx.device.hello_count, 2)

		program_now = await ctx.device.command('get_program')
		ctx.equal('the restart left no loaded program', program_now.get('has_program'), False)

		category = await _wait_category(ctx.companion, 'good', timeout=30)
		ctx.equal('the module reconnects', category, 'good')
		# The module must agree with the display, not with what it cached before.
		await _module_var(ctx, 'total_sessions', '0', timeout=5.0)
		await _module_var(ctx, 'total_messages', '0', timeout=5.0)
	finally:
		if not started:
			try:
				handle.start()
			except Exception:
				pass
		ok, detail = await restore_program(ctx.device, program)
		ctx.check('fixture program restored after the restart', ok, detail)
		if previous:
			await _show_session(ctx, previous)
		try:
			await _compare_module_to_device(ctx, 'after restore')
		except Exception as exc:  # noqa: BLE001
			ctx.warn('post-restore comparison ran', False, str(exc))


@scenario('A3', 'A', 'the module notices an outage and recovers when the display returns', '§1.3', needs_companion=True)
async def a3_outage(ctx: Ctx) -> None:
	assert ctx.companion is not None
	handle = _adb_for(ctx)
	previous = await _current_session(ctx)
	program = await save_program(ctx.device, ctx.out_dir, 'A3')
	try:
		handle.force_stop()
		closed = await _wait_for(lambda: ctx.device.closed.is_set(), timeout=20)
		ctx.check('our client saw the display disappear', closed)

		category = ''
		deadline = time.monotonic() + 30
		while time.monotonic() < deadline:
			category = ctx.companion.category()
			if category != 'good':
				break
			await asyncio.sleep(0.5)
		ctx.check('the module stops reporting good during the outage', category != 'good', f'category={category}')

		await asyncio.sleep(3)  # a few reconnect attempts happen in this window
		ctx.check('the module did not reconnect to a dead display', ctx.companion.category() != 'good')

		handle.start()
		hello = await _wait_ws(ctx.cfg.device_host, ctx.cfg.device_port)
		ctx.check('the display came back', hello is not None, str(hello))
		if hello is None:
			return
		await ctx.device.reconnect()
		category = await _wait_category(ctx.companion, 'good', timeout=40)
		ctx.equal('the module recovers after the outage', category, 'good')
	finally:
		try:
			if not handle.pid():
				handle.start()
				await _wait_ws(ctx.cfg.device_host, ctx.cfg.device_port)
		except Exception:
			pass
		ok, detail = await restore_program(ctx.device, program)
		ctx.check('fixture program restored after the outage', ok, detail)
		if previous:
			await _show_session(ctx, previous)


def _close_device_menu(handle: 'Adb', nodes: list['adb.UiNode']) -> bool:
	"""Tap the menu's Close row; falls back to BACK. True when a Close label was found."""
	for label in [n for n in nodes if n.text.strip().lower() == 'close']:
		cx, cy = label.centre
		for candidate in nodes:
			x1, y1, x2, y2 = candidate.bounds
			if candidate.clickable and candidate.enabled and x1 <= cx <= x2 and y1 <= cy <= y2:
				handle.tap(*candidate.centre)
				return True
	handle.key('KEYCODE_BACK')
	return False


@scenario('F4', 'F', 'device-local touch and menu use are protocol-neutral', '§5', needs_companion=True)
async def f4_local_ui(ctx: Ctx) -> None:
	"""Touch the display itself; nothing about the protocol or the module may move.

	The display has no local timer controls - its UI is identity and network
	configuration only (the app source exposes `MenuScreen`/`IdleDisplay` settings,
	and a hierarchy dump on the idle screen shows a single Menu affordance). So the
	device-local action available to an automated run is a touch, which must be
	invisible to the protocol: no state event, no program change, no module drift.
	A human pressing something that starts a timer stays a manual step.
	"""
	assert ctx.companion is not None
	handle = _adb_for(ctx)
	await ctx.restore()
	before = await ctx.snapshot()
	mark = ctx.device.mark

	size = handle.run('shell', 'wm', 'size')
	width, height = 1920, 360
	match = re.search(r'(\d+)x(\d+)', size)
	if match:
		width, height = int(match.group(1)), int(match.group(2))

	# Centre of the display, then the chrome hotspot in the top-right corner.
	handle.tap(width // 2, height // 2)
	await asyncio.sleep(1.0)
	handle.tap(width - 60, 40)
	await asyncio.sleep(1.5)

	# If the menu did open, close it so the device is left as found.
	xml = handle.ui_xml()
	if 'Device Information' in xml:
		ctx.warn('the touch opened the device menu', True, 'closed again below')
		_close_device_menu(handle, handle.ui_nodes(xml))
		await asyncio.sleep(1.5)
		closed = 'Device Information' not in handle.ui_xml()
		ctx.check('the device menu was closed again', closed, 'still open')
	handle.key('KEYCODE_BACK')

	after = await ctx.snapshot()
	ctx.equal('run state unchanged by local touch', DeviceClient.cc(after).get('timer_run_state'), DeviceClient.cc(before).get('timer_run_state'))
	ctx.equal('current session unchanged by local touch', DeviceClient.cc(after).get('current_session_id'), DeviceClient.cc(before).get('current_session_id'))
	ctx.equal('session count unchanged by local touch', len(DeviceClient.sessions(after)), len(DeviceClient.sessions(before)))
	ctx.equal('message count unchanged by local touch', len(DeviceClient.message_list(after)), len(DeviceClient.message_list(before)))
	ctx.equal('brightness unchanged by local touch', DeviceClient.settings(after).get('brightness'), DeviceClient.settings(before).get('brightness'))
	events = ctx.device.event_kinds_since(mark)
	ctx.check(
		'no program or message event from local touch',
		'program_changed_event' not in events and 'messages_status_event' not in events,
		str(events),
	)
	await _module_var(
		ctx,
		'current_session_name',
		str(DeviceClient.cc(after).get('current_session_name') or ''),
		label='module still in step after local touch',
	)
