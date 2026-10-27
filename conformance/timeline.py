"""Run artifacts: frame timelines, variable poll logs, and check results.

A run with no artifacts is not evidence (see docs/CONFORMANCE.md §8), so every
scenario appends to the same bundle: ``run.json``, ``timeline-<id>.jsonl``,
``variables-<id>.jsonl``, ``junit.xml`` and ``notes.md``.
"""

from __future__ import annotations

import json
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Check:
	name: str
	ok: bool
	detail: str = ''
	# 'fail' breaks the scenario; 'warn' is recorded evidence that does not.
	level: str = 'fail'

	def __str__(self) -> str:
		label = 'PASS' if self.ok else ('WARN' if self.level == 'warn' else 'FAIL')
		return f'{label} {self.name}' + (f' — {self.detail}' if self.detail else '')


@dataclass
class ScenarioResult:
	id: str
	group: str
	title: str
	checks: list[Check] = field(default_factory=list)
	skipped: str | None = None
	error: str | None = None
	started: float = field(default_factory=time.time)
	duration: float = 0.0

	@property
	def ok(self) -> bool:
		return self.skipped is None and self.error is None and not self.failures

	@property
	def failures(self) -> list[Check]:
		return [c for c in self.checks if not c.ok and c.level == 'fail']

	@property
	def warnings(self) -> list[Check]:
		return [c for c in self.checks if not c.ok and c.level == 'warn']


class Timeline:
	"""Appends frames and variable polls to per-scenario JSONL files."""

	def __init__(self, output_dir: Path) -> None:
		self.dir = output_dir
		self.dir.mkdir(parents=True, exist_ok=True)
		self._frames: dict[str, Any] = {}
		self._vars: dict[str, Any] = {}

	def _handle(self, cache: dict[str, Any], prefix: str, scenario_id: str) -> Any:
		if scenario_id not in cache:
			path = self.dir / f'{prefix}-{scenario_id}.jsonl'
			cache[scenario_id] = path.open('w', encoding='utf-8')
		return cache[scenario_id]

	def record_frame(self, scenario_id: str, frame: dict[str, Any], ts: float | None = None) -> None:
		handle = self._handle(self._frames, 'timeline', scenario_id)
		handle.write(json.dumps({'ts': ts if ts is not None else time.time(), 'frame': frame}) + '\n')
		handle.flush()

	def record_variables(self, scenario_id: str, values: dict[str, str | None]) -> None:
		handle = self._handle(self._vars, 'variables', scenario_id)
		handle.write(json.dumps({'ts': time.time(), 'variables': values}) + '\n')
		handle.flush()

	def close(self) -> None:
		for handle in list(self._frames.values()) + list(self._vars.values()):
			try:
				handle.close()
			except Exception:
				pass
		self._frames.clear()
		self._vars.clear()


def write_run_json(path: Path, payload: dict[str, Any]) -> None:
	path.write_text(json.dumps(payload, indent=2) + '\n', encoding='utf-8')


def write_junit(path: Path, results: list[ScenarioResult], suite_name: str = 'cuetime-conformance') -> None:
	total = len(results)
	failures = sum(1 for r in results if not r.ok and r.skipped is None)
	skipped = sum(1 for r in results if r.skipped is not None)
	suite = ET.Element(
		'testsuite',
		{
			'name': suite_name,
			'tests': str(total),
			'failures': str(failures),
			'skipped': str(skipped),
			'errors': str(sum(1 for r in results if r.error is not None)),
		},
	)
	for result in results:
		case = ET.SubElement(
			suite,
			'testcase',
			{'classname': f'conformance.{result.group}', 'name': f'{result.id} {result.title}', 'time': f'{result.duration:.3f}'},
		)
		if result.skipped is not None:
			ET.SubElement(case, 'skipped', {'message': result.skipped})
			continue
		if result.error is not None:
			ET.SubElement(case, 'error', {'message': result.error})
		for check in result.failures:
			node = ET.SubElement(case, 'failure', {'message': check.name})
			node.text = check.detail
		for check in result.warnings:
			node = ET.SubElement(case, 'system-out', {'name': f'warning: {check.name}'})
			node.text = check.detail
	ET.ElementTree(suite).write(path, encoding='utf-8', xml_declaration=True)


def write_notes(path: Path, lines: list[str]) -> None:
	path.write_text('\n'.join(lines) + '\n', encoding='utf-8')
