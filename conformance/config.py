"""Configuration for the T2 three-way conformance harness.

Everything is environment-driven so a run is reproducible from a shell history:
CUETIME_DEVICE, CUETIME_DEVICE_PORT, COMPANION_URL, COMPANION_CONNECTION,
COMPANION_PAGE. CLI flags win over the environment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field, replace

DEFAULT_DEVICE = "192.168.1.145"
DEFAULT_DEVICE_PORT = 8081
DEFAULT_COMPANION = "http://127.0.0.1:8000"


@dataclass
class Config:
	device_host: str = DEFAULT_DEVICE
	device_port: int = DEFAULT_DEVICE_PORT
	companion_url: str | None = None
	companion_connection: str | None = None
	companion_page: int = 1
	timeout: float = 5.0
	output_dir: str = "conformance/results"
	layout_path: str | None = None
	groups: tuple[str, ...] = ()
	only: tuple[str, ...] = field(default_factory=tuple)

	@classmethod
	def from_env(cls, **overrides: object) -> 'Config':
		cfg = cls(
			device_host=os.environ.get('CUETIME_DEVICE', DEFAULT_DEVICE),
			device_port=int(os.environ.get('CUETIME_DEVICE_PORT', DEFAULT_DEVICE_PORT)),
			companion_url=os.environ.get('COMPANION_URL') or None,
			companion_connection=os.environ.get('COMPANION_CONNECTION') or None,
			companion_page=int(os.environ.get('COMPANION_PAGE', 1)),
			layout_path=os.environ.get('COMPANION_LAYOUT') or None,
			timeout=float(os.environ.get('CUETIME_TIMEOUT', 5.0)),
		)
		clean = {k: v for k, v in overrides.items() if v is not None}
		return replace(cfg, **clean) if clean else cfg

	@property
	def device_url(self) -> str:
		return f'{self.device_host}:{self.device_port}'

	@property
	def companion_base(self) -> str:
		return (self.companion_url or DEFAULT_COMPANION).rstrip('/')


class Layout:
	"""Preset id -> (row, column) on the Companion conformance page.

	Press-driven scenarios need to know where the operator put each preset
	button; nothing in the HTTP API can discover a layout. Absent entries are
	skipped rather than guessed, so a partial layout gives partial coverage
	instead of pressing the wrong button.
	"""

	def __init__(self, page: int, pressed: dict[str, tuple[int, int]]) -> None:
		self.page = page
		self.pressed = pressed

	@classmethod
	def load(cls, path: str | None, default_page: int = 1) -> 'Layout | None':
		if not path:
			return None
		import json
		from pathlib import Path as _Path

		file = _Path(path)
		if not file.is_file():
			return None
		data = json.loads(file.read_text(encoding='utf-8'))
		pressed = {
			str(name): (int(row), int(col))
			for name, value in (data.get('pressed') or {}).items()
			for row, col in [value]
		}
		return cls(page=int(data.get('page', default_page)), pressed=pressed)

	def locate(self, preset: str) -> tuple[int, int] | None:
		return self.pressed.get(preset)

	@staticmethod
	def template(presets: list[str], columns: int = 5) -> dict:
		pressed = {name: [index // columns, index % columns] for index, name in enumerate(presets)}
		return {
			'_comment': 'Companion page/row/column of each preset button; page 1-based, row/col 0-based.',
			'page': 1,
			'pressed': pressed,
		}
