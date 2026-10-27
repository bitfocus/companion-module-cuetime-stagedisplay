#!/usr/bin/env python3
"""T2 three-way integration runner (the integration test plan §4).

Drives Companion's HTTP API, observes the device on its own WebSocket client, and
compares the module's variables against the device's own report.

Usage:
    python3 integration/run_integration.py                        # device scenarios
    python3 integration/run_integration.py --companion http://host:8000
    python3 integration/run_integration.py --list
    python3 integration/run_integration.py --only D3,G3 -v

Exit code: 0 when every executed scenario passed, 1 otherwise.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent

# Preset ids in the order they appear in src/presets.ts, used for layout templates.
_PRESET_ORDER = [
	'navigate_next',
	'navigate_previous',
	'toggle_playback',
	'pause',
	'add_time',
	'subtract_time',
	'show_message',
	'toggle_flash',
	'toggle_glow',
	'blackout',
	'session_counter',
	'elapsed_time',
	'remaining_time',
	'time_info',
	'previous_session',
	'next_session',
	'next_session_presenter',
	'next_session_name_presenter',
	'previous_session_presenter',
	'previous_session_name_presenter',
]
if str(HERE) not in sys.path:
	sys.path.insert(0, str(HERE))

from companion import CompanionClient  # noqa: E402
from config import Config, Layout  # noqa: E402
from device import DeviceClient  # noqa: E402
from matrix import SCENARIOS, Ctx, Scenario, SkipScenario  # noqa: E402
from timeline import ScenarioResult, Timeline, write_junit, write_notes, write_run_json  # noqa: E402


def select_scenarios(scenarios: list[Scenario], groups: list[str], only: list[str]) -> list[Scenario]:
	chosen = scenarios
	if groups:
		wanted = {g.upper() for g in groups}
		chosen = [s for s in chosen if s.group.upper() in wanted]
	if only:
		wanted_ids = {o.strip().upper() for item in only for o in item.split(',') if o.strip()}
		chosen = [s for s in chosen if s.id.upper() in wanted_ids]
	return chosen


async def run_one(
	scenario: Scenario,
	cfg: Config,
	companion: CompanionClient | None,
	layout: Layout | None,
) -> ScenarioResult:
	result = ScenarioResult(id=scenario.id, group=scenario.group, title=scenario.title)
	started = time.monotonic()

	if scenario.needs_companion and companion is None:
		result.skipped = 'needs Companion (set --companion / COMPANION_URL)'
		result.duration = time.monotonic() - started
		return result

	timeline = Timeline(Path(cfg.output_dir))
	device = DeviceClient(cfg.device_host, cfg.device_port, cfg.timeout)
	ctx = Ctx(
		cfg=cfg,
		device=device,
		companion=companion,
		timeline=timeline,
		scenario_id=scenario.id,
		layout=layout,
	)
	try:
		await device.connect()
		await scenario.fn(ctx)
	except SkipScenario as exc:
		result.skipped = str(exc)
	except Exception as exc:  # noqa: BLE001 - a scenario crash is a result, not a stack trace
		result.error = f'{type(exc).__name__}: {exc}'
		if cfg_verbose:
			traceback.print_exc()
	finally:
		start_index = 0
		try:
			for ts, frame in device.frames[start_index:]:
				timeline.record_frame(scenario.id, frame, ts)
			await ctx.restore()
		except Exception:
			pass
		await device.close()
		timeline.close()
		result.checks = ctx.checks
		result.duration = time.monotonic() - started
	return result


def main() -> int:
	global cfg_verbose
	parser = argparse.ArgumentParser(description='CueTime module three-way integration runner')
	parser.add_argument('--device', help='device host (default: CUETIME_DEVICE or 192.168.1.145)')
	parser.add_argument('--port', type=int, help='device WebSocket port (default 8081)')
	parser.add_argument('--companion', help='Companion base URL, e.g. http://host:8000')
	parser.add_argument('--connection', help='Companion connection id or label')
	parser.add_argument('--page', type=int, help='Companion page holding the integration layout')
	parser.add_argument('--layout', help='JSON file mapping preset id -> [row, col] (COMPANION_LAYOUT)')
	parser.add_argument('--emit-layout', action='store_true', help='print a layout template for the presets and exit')
	parser.add_argument('--groups', help='comma-separated scenario groups (A,B,C,D,E,F,G,S)')
	parser.add_argument('--only', action='append', default=[], help='scenario ids to run (repeatable, comma-separated)')
	parser.add_argument('--out', help='output directory for the evidence bundle')
	parser.add_argument('--timeout', type=float, help='per-request timeout in seconds')
	parser.add_argument('--list', action='store_true', help='list scenarios and exit')
	parser.add_argument('-v', '--verbose', action='store_true')
	args = parser.parse_args()
	cfg_verbose = args.verbose

	cfg = Config.from_env(
		device_host=args.device,
		device_port=args.port,
		companion_url=args.companion,
		companion_connection=args.connection,
		companion_page=args.page,
		timeout=args.timeout,
		output_dir=args.out,
		layout_path=args.layout,
	)
	if args.groups:
		cfg.groups = tuple(args.groups.split(','))
	cfg.only = tuple(args.only)

	if args.emit_layout:
		template = Layout.template(_PRESET_ORDER, columns=5)
		lines = ['{', f'\t"_comment": {json.dumps(template["_comment"])},', f'\t"page": {template["page"]},', '\t"pressed": {']
		entries = list(template['pressed'].items())
		for index, (name, (row, col)) in enumerate(entries):
			comma = ',' if index < len(entries) - 1 else ''
			lines.append(f'\t\t{json.dumps(name)}: [{row}, {col}]{comma}')
		lines += ['\t}', '}']
		print('\n'.join(lines))
		return 0

	if args.list:
		for scenario in SCENARIOS:
			flag = ' (needs Companion)' if scenario.needs_companion else ''
			print(f'{scenario.id:4} [{scenario.group}] {scenario.title}{flag}  {scenario.spec}')
		return 0

	stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
	cfg.output_dir = str(Path(cfg.output_dir) / stamp)
	out_dir = Path(cfg.output_dir)
	out_dir.mkdir(parents=True, exist_ok=True)

	print(f'device    : ws://{cfg.device_url}')
	companion: CompanionClient | None = None
	companion_note = 'not configured'
	if cfg.companion_url:
		companion = CompanionClient(cfg.companion_base, cfg.companion_connection, cfg.companion_page, cfg.timeout)
		reachable, detail = companion.probe()
		if not reachable:
			print(f'companion : UNREACHABLE {cfg.companion_base} ({detail})')
			companion = None
			companion_note = f'unreachable: {detail}'
		else:
			print(f'companion : {cfg.companion_base} ({detail})')
			try:
				conn = companion.resolve()
				print(f'            connection {conn.get("id")} "{conn.get("label")}" status={companion.category()}')
				companion_note = f'{conn.get("id")} / {conn.get("label")}'
			except Exception as exc:  # noqa: BLE001
				print(f'            connection lookup failed: {exc}')
				companion_note = f'lookup failed: {exc}'
				companion = None
	else:
		print('companion : not configured (device scenarios only)')

	layout = Layout.load(cfg.layout_path, cfg.companion_page)
	if cfg.layout_path:
		if layout is None:
			print(f'layout    : {cfg.layout_path} not found (press group P will skip)')
		else:
			print(f'layout    : page {layout.page}, {len(layout.pressed)} preset button(s)')

	scenarios = select_scenarios(SCENARIOS, list(cfg.groups), list(cfg.only))
	if not scenarios:
		print('no scenarios selected')
		return 2

	results: list[ScenarioResult] = []

	async def _baseline() -> dict:
		async with DeviceClient(cfg.device_host, cfg.device_port, cfg.timeout) as client:
			status = await client.snapshot()
			return {
				'hello': client.hello or {},
				'current_session_id': DeviceClient.cc(status).get('current_session_id'),
			}

	baseline = asyncio.run(_baseline())
	print(f'baseline  : current session {baseline.get("current_session_id")!r} (restored at exit)')
	for scenario in scenarios:
		result = asyncio.run(run_one(scenario, cfg, companion, layout))
		results.append(result)
		icon = 'SKIP' if result.skipped else ('PASS' if result.ok else 'FAIL')
		print(f'{icon} {result.id:4} {result.title}  ({result.duration:.1f}s)')
		if result.skipped:
			print(f'     skipped: {result.skipped}')
		if result.error:
			print(f'     error: {result.error}')
		for check in result.failures:
			print(f'     ✗ {check}')
		for check in result.warnings:
			print(f'     ! {check}')

	passed = sum(1 for r in results if r.ok)
	failed = [r for r in results if not r.ok and r.skipped is None]
	skipped = [r for r in results if r.skipped is not None]

	hello = baseline.get('hello') or {}

	# Leave the device as we found it: same current session, paused, no effects.
	async def _restore_baseline() -> None:
		async with DeviceClient(cfg.device_host, cfg.device_port, cfg.timeout) as client:
			session_id = baseline.get('current_session_id')
			if session_id:
				await client.command('show_session', session_id=str(session_id))
			await client.command('pause_session')
			await client.command('hide_message')
			await client.command('set_blackout', action='disable')
			await client.command('set_glow', enabled=False)

	try:
		asyncio.run(_restore_baseline())
	except Exception as exc:  # noqa: BLE001
		print(f'baseline restore failed: {exc}')

	write_run_json(
		out_dir / 'run.json',
		{
			'started': stamp,
			'device': {
				'url': f'ws://{cfg.device_url}',
				'hello': hello,
			},
			'companion': {
				'url': cfg.companion_base if cfg.companion_url else None,
				'connection': companion_note,
			},
			'module': {'name': 'cuetime-stagedisplay'},
			'scenarios': [
				{
					'id': r.id,
					'group': r.group,
					'title': r.title,
					'ok': r.ok,
					'skipped': r.skipped,
					'error': r.error,
					'duration': round(r.duration, 3),
					'checks': [
						{'name': c.name, 'ok': c.ok, 'detail': c.detail, 'level': c.level}
						for c in r.checks
					],
				}
				for r in results
			],
		},
	)
	write_junit(out_dir / 'junit.xml', results)
	write_notes(
		out_dir / 'notes.md',
		[
			f'# Integration run {stamp}',
			'',
			f'- device: `ws://{cfg.device_url}`',
			f'- device build: `{hello.get("version_name")} ({hello.get("version_code")})` screen `{hello.get("screen_id")}`',
			f'- companion: {companion_note}',
			f'- scenarios: {len(results)} ({passed} passed, {len(failed)} failed, {len(skipped)} skipped)',
			'',
			'## Failures',
			*(
				[f'- **{r.id}** {r.title}: ' + '; '.join(str(c) for c in r.failures) for r in failed]
				or ['none']
			),
			'',
			'## Warnings',
			*(
				[
					f'- **{r.id}** {c.name}: {c.detail}'
					for r in results
					for c in r.warnings
				]
				or ['none']
			),
		],
	)

	print()
	print(f'{passed}/{len(results)} passed, {len(failed)} failed, {len(skipped)} skipped')
	print(f'evidence: {out_dir}/run.json')
	return 0 if not failed else 1


cfg_verbose = False

if __name__ == '__main__':
	sys.exit(main())
