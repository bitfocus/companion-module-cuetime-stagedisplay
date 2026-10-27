"""Program snapshot and restore, for the scenarios that touch the loaded program.

`delete_program`, `delete_all_sessions`, `delete_all_messages` and `send_program`
all replace or empty the display's program. Those scenarios back it up first, write
the backup into the run bundle, and restore it in a `finally`, so a failing scenario
cannot leave the device without its fixture program (and cannot make the next
scenario's failure look like a product bug).

The backup is the `program` object from `get_program` verbatim: `send_program`
accepts that shape (§4.9), including the extra session names it ignores.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from device import DeviceClient, DeviceError

# Fields `send_program` takes on the program object (§3.6). Anything else in a
# `get_program` reply is reply metadata and would be rejected or ignored.
PROGRAM_KEYS = (
	'program_id',
	'program_name',
	'version',
	'user_id',
	'settings',
	'sessions',
	'messages',
)


def payload(program: dict[str, Any]) -> dict[str, Any]:
	return {key: program[key] for key in PROGRAM_KEYS if key in program}


async def save_program(device: DeviceClient, out_dir: Path, tag: str) -> dict[str, Any]:
	"""Read the loaded program and write it into the run bundle as a backup."""
	resp = await device.command('get_program')
	if resp.get('type') != 'program_response':
		raise DeviceError(f'get_program failed: {resp.get("type")} {resp.get("code")}')
	program = resp.get('program') or {}
	if not program.get('program_id'):
		raise DeviceError('get_program returned no program_id')
	out_dir.mkdir(parents=True, exist_ok=True)
	path = out_dir / f'program-backup-{tag}.json'
	path.write_text(json.dumps(program, indent=2) + '\n', encoding='utf-8')
	return program


def summarise(program: dict[str, Any]) -> str:
	return (
		f'id={program.get("program_id")!r} '
		f'sessions={len(program.get("sessions") or [])} '
		f'messages={len(program.get("messages") or [])}'
	)


async def restore_program(device: DeviceClient, program: dict[str, Any]) -> tuple[bool, str]:
	"""Send the backup back and confirm the device holds it again."""
	resp = await device.send({'type': 'send_program', 'program': payload(program)})
	if resp.get('type') != 'ack_response':
		return False, f'send_program -> {resp.get("type")} {resp.get("code")} {resp.get("message") or ""}'.strip()

	check = await device.command('get_program')
	restored = check.get('program') or {}
	if restored.get('program_id') != program.get('program_id'):
		return False, f'restored id {restored.get("program_id")!r} != {program.get("program_id")!r}'
	want_sessions = len(program.get('sessions') or [])
	got_sessions = len(restored.get('sessions') or [])
	if got_sessions != want_sessions:
		return False, f'restored {got_sessions} sessions, expected {want_sessions}'
	want_messages = len(program.get('messages') or [])
	got_messages = len(restored.get('messages') or [])
	if got_messages != want_messages:
		return False, f'restored {got_messages} messages, expected {want_messages}'
	return True, 'restored ' + summarise(restored)
