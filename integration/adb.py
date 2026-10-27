"""adb access to the display, for the scenarios that need a shell on it.

Three integration rows cannot be driven over the protocol alone — restarting the
app (A2), forcing an outage (A3), and touching the device's own UI (F4) — so they
shell out to adb. Everything here degrades to "skip with a reason" rather than
guessing: restarting the *wrong* display because two are attached would be far
worse than not running the scenario.

Device selection follows the far side's `integration_tests/app_restart.py`: an
explicit serial (`CUETIME_ADB_SERIAL`) wins, otherwise the attached device whose
own IPv4 addresses include the host the run was pointed at.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from dataclasses import dataclass

PACKAGE = 'com.tougtechnologies.cuetimestagedisplay'
ACTIVITY = 'com.tougtechnologies.cuetimedisplay.MainActivity'

_BOUNDS = re.compile(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]')


class AdbError(RuntimeError):
	"""adb was present but the command failed."""


def binary() -> str | None:
	return os.environ.get('CUETIME_ADB_BIN') or shutil.which('adb')


def _run(adb: str, serial: str | None, *args: str, timeout: float = 45.0) -> str:
	command = [adb] + (['-s', serial] if serial else []) + list(args)
	try:
		result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
	except (OSError, subprocess.SubprocessError) as exc:
		raise AdbError(f'{" ".join(command)}: {exc}') from exc
	if result.returncode != 0:
		detail = (result.stderr or result.stdout or '').strip().splitlines()
		raise AdbError(f'{" ".join(command)} -> {detail[-1] if detail else result.returncode}')
	return result.stdout.strip()


def serials(adb: str) -> list[str]:
	out = _run(adb, None, 'devices')
	found = []
	for line in out.splitlines()[1:]:
		parts = line.split()
		if len(parts) >= 2 and parts[1] == 'device':
			found.append(parts[0])
	return found


def addresses(adb: str, serial: str) -> set[str]:
	out = _run(adb, serial, 'shell', 'ip', '-4', 'addr', 'show')
	return set(re.findall(r'inet (\d+\.\d+\.\d+\.\d+)', out))


@dataclass
class UiNode:
	text: str
	description: str
	clickable: bool
	enabled: bool
	bounds: tuple[int, int, int, int]

	@property
	def centre(self) -> tuple[int, int]:
		x1, y1, x2, y2 = self.bounds
		return (x1 + x2) // 2, (y1 + y2) // 2


class Adb:
	def __init__(self, adb: str, serial: str) -> None:
		self.binary = adb
		self.serial = serial

	def run(self, *args: str, timeout: float = 45.0) -> str:
		return _run(self.binary, self.serial, *args, timeout=timeout)

	def pid(self) -> str:
		return self.run('shell', 'pidof', PACKAGE)

	def force_stop(self) -> None:
		self.run('shell', 'am', 'force-stop', PACKAGE)

	def start(self) -> None:
		self.run('shell', 'am', 'start', '-n', f'{PACKAGE}/{ACTIVITY}')

	def restart(self) -> None:
		self.force_stop()
		self.start()

	def tap(self, x: int, y: int) -> None:
		self.run('shell', 'input', 'tap', str(x), str(y))

	def key(self, code: str) -> None:
		self.run('shell', 'input', 'keyevent', code)

	def ui_xml(self) -> str:
		self.run('shell', 'uiautomator', 'dump', '/sdcard/integration-ui.xml', timeout=60)
		return self.run('shell', 'cat', '/sdcard/integration-ui.xml', timeout=60)

	def ui_nodes(self, xml: str | None = None) -> list[UiNode]:
		source = self.ui_xml() if xml is None else xml
		nodes = []
		for match in re.finditer(r'<node[^>]*>', source):
			tag = match.group(0)
			bounds = _BOUNDS.search(tag)
			if not bounds:
				continue
			nodes.append(
				UiNode(
					text=_attr(tag, 'text'),
					description=_attr(tag, 'content-desc'),
					clickable=_attr(tag, 'clickable') == 'true',
					enabled=_attr(tag, 'enabled') == 'true',
					bounds=tuple(int(g) for g in bounds.groups()),  # type: ignore[arg-type]
				)
			)
		return nodes


def _attr(tag: str, name: str) -> str:
	match = re.search(rf'{name}="([^"]*)"', tag)
	return match.group(1) if match else ''


def connect(host: str, explicit: str | None = None) -> tuple[Adb | None, str]:
	"""The adb handle for ``host``, or ``(None, reason)`` when there is none."""
	adb = binary()
	if adb is None:
		return None, 'adb is not installed'
	wanted = explicit or os.environ.get('CUETIME_ADB_SERIAL') or None
	candidates = serials(adb)
	if not candidates:
		return None, 'no adb devices attached'
	if wanted:
		if wanted not in candidates:
			return None, f'{wanted} is not attached (have: {", ".join(candidates)})'
		return Adb(adb, wanted), 'named by CUETIME_ADB_SERIAL'
	# Match on the address so two attached displays cannot be confused.
	for serial in candidates:
		try:
			if host in addresses(adb, serial):
				return Adb(adb, serial), f'matched {host}'
		except AdbError:
			continue
	return None, f'no attached adb device has {host} among its addresses'
