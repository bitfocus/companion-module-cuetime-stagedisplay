"""Minimal client for Companion's HTTP API (5.1.x).

Only the endpoints the conformance matrix needs:

  POST /api/location/<page>/<row>/<col>/press|down|up   run a button
  GET  /api/variable/<label>/<name>/value              read a module variable
  GET  /api/connections                                discover the instance
  GET  /api/connections/<id>/status                    connection health
  POST /api/connections/<id>/restart                   rehydrate from scratch

Pages are 1-based, rows and columns are 0-based.
"""

from __future__ import annotations

import time
from typing import Any
from urllib.parse import quote

import requests

MODULE_ID = 'cuetime-stagedisplay'


class CompanionError(RuntimeError):
	pass


class CompanionClient:
	def __init__(
		self,
		base_url: str,
		connection: str | None = None,
		page: int = 1,
		timeout: float = 5.0,
	) -> None:
		self.base = base_url.rstrip('/')
		self.connection_ref = connection
		self.page = page
		self.timeout = timeout
		self._session = requests.Session()
		self._conn: dict[str, Any] | None = None

	# ---- discovery ----

	def probe(self) -> tuple[bool, str]:
		try:
			resp = self._session.get(f'{self.base}/api/connections', timeout=self.timeout)
		except requests.RequestException as exc:
			return False, f'{type(exc).__name__}: {exc}'
		if resp.status_code != 200:
			return False, f'HTTP {resp.status_code} from /api/connections'
		return True, f'{len(resp.json())} connection(s)'

	def connections(self) -> list[dict[str, Any]]:
		resp = self._session.get(f'{self.base}/api/connections', timeout=self.timeout)
		resp.raise_for_status()
		data = resp.json()
		if not isinstance(data, list):
			raise CompanionError(f'unexpected /api/connections payload: {type(data).__name__}')
		return data

	def resolve(self) -> dict[str, Any]:
		"""Find this module's connection: by explicit id/label, else by module id."""
		if self._conn is not None:
			return self._conn
		conns = self.connections()
		if self.connection_ref:
			for conn in conns:
				if self.connection_ref in (conn.get('id'), conn.get('label')):
					self._conn = conn
					return conn
			raise CompanionError(f'no connection matching {self.connection_ref!r} (have: {[c.get("label") for c in conns]})')
		matches = [c for c in conns if c.get('moduleId') == MODULE_ID]
		if not matches:
			raise CompanionError(f'no {MODULE_ID} connection in Companion (have: {[c.get("moduleId") for c in conns]})')
		if len(matches) > 1:
			raise CompanionError(f'{len(matches)} {MODULE_ID} connections; pass COMPANION_CONNECTION to pick one')
		self._conn = matches[0]
		return self._conn

	@property
	def label(self) -> str:
		return str(self.resolve().get('label') or '')

	@property
	def conn_id(self) -> str:
		return str(self.resolve().get('id') or '')

	def status(self) -> dict[str, Any]:
		"""Connection health as Companion reports it (``status.category == 'good'``)."""
		resp = self._session.get(f'{self.base}/api/connections/{self.conn_id}/status', timeout=self.timeout)
		resp.raise_for_status()
		return resp.json()

	def category(self) -> str:
		return str(((self.status() or {}).get('status') or {}).get('category') or '')

	def restart(self) -> None:
		resp = self._session.post(f'{self.base}/api/connections/{self.conn_id}/restart', timeout=self.timeout)
		if resp.status_code >= 400:
			raise CompanionError(f'restart failed: HTTP {resp.status_code} {resp.text[:200]}')

	# ---- driving ----

	def press(self, row: int, col: int) -> None:
		resp = self._session.post(f'{self.base}/api/location/{self.page}/{row}/{col}/press', timeout=self.timeout)
		if resp.status_code >= 400:
			raise CompanionError(f'press {self.page}/{row}/{col} failed: HTTP {resp.status_code} {resp.text[:200]}')

	def down(self, row: int, col: int) -> None:
		self._session.post(f'{self.base}/api/location/{self.page}/{row}/{col}/down', timeout=self.timeout)

	def up(self, row: int, col: int) -> None:
		self._session.post(f'{self.base}/api/location/{self.page}/{row}/{col}/up', timeout=self.timeout)

	# ---- reading module state ----

	def variable(self, name: str) -> str | None:
		url = f'{self.base}/api/variable/{quote(self.label, safe="")}/{quote(name, safe="")}/value'
		resp = self._session.get(url, timeout=self.timeout)
		if resp.status_code == 404:
			return None
		resp.raise_for_status()
		text = resp.text
		# Companion returns the raw value; a JSON string comes back quoted.
		if len(text) >= 2 and text[0] == '"' and text[-1] == '"':
			return text[1:-1]
		return text

	def variables(self, names: list[str]) -> dict[str, str | None]:
		return {name: self.variable(name) for name in names}

	def wait_variable(
		self,
		name: str,
		expected: str,
		timeout: float = 2.0,
		interval: float = 0.1,
	) -> tuple[bool, list[str | None]]:
		"""Poll one variable until it equals ``expected``; returns the poll history."""
		deadline = time.monotonic() + timeout
		seen: list[str | None] = []
		while True:
			value = self.variable(name)
			seen.append(value)
			if value == expected:
				return True, seen
			if time.monotonic() >= deadline:
				return False, seen
			time.sleep(interval)
