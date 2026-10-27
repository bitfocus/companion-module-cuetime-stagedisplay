"""WebSocket client for the CueTime device.

This is the ground-truth side of the harness: a second client on the same
broadcast stream the module receives, plus request/response for absolute
snapshots. Events are full snapshots of the state they name (spec §5), so the
frame stream is an unambiguous record of what the device did.

Nothing here imports module code — the device is the oracle, the module is
asserted against it.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any, Callable

import websockets


class DeviceError(RuntimeError):
	"""A command was rejected by the device, or the connection failed."""


Frame = dict[str, Any]
Predicate = Callable[[Frame], bool]


class DeviceClient:
	def __init__(self, host: str, port: int = 8081, timeout: float = 5.0) -> None:
		self.host = host
		self.port = port
		self.timeout = timeout
		self.hello: Frame | None = None
		# (monotonic ts, frame) for every frame received, in arrival order.
		self.frames: list[tuple[float, Frame]] = []
		self._ws: Any = None
		self._reader: asyncio.Task[None] | None = None
		self._pending: dict[str, asyncio.Future[Frame]] = {}
		self._new_frame = asyncio.Event()
		self._seq = 0
		self.closed = asyncio.Event()

	# ---- lifecycle ----

	async def connect(self) -> Frame:
		self._ws = await websockets.connect(
			f'ws://{self.host}:{self.port}',
			open_timeout=self.timeout,
			ping_interval=20,
			ping_timeout=20,
			max_queue=None,
		)
		self._reader = asyncio.create_task(self._read_loop())
		hello = await self.wait(lambda f: f.get('type') == 'hello_event', timeout=self.timeout)
		if hello is None:
			raise DeviceError('no hello_event within timeout')
		self.hello = hello
		return hello

	async def close(self) -> None:
		if self._reader is not None:
			self._reader.cancel()
			try:
				await self._reader
			except (asyncio.CancelledError, Exception):
				pass
			self._reader = None
		if self._ws is not None:
			await self._ws.close()
			self._ws = None

	async def __aenter__(self) -> 'DeviceClient':
		await self.connect()
		return self

	async def __aexit__(self, *exc: object) -> None:
		await self.close()

	# ---- reading ----

	async def _read_loop(self) -> None:
		assert self._ws is not None
		try:
			async for raw in self._ws:
				try:
					frame = json.loads(raw)
				except json.JSONDecodeError:
					continue
				self.frames.append((time.monotonic(), frame))
				self._new_frame.set()
				rid = frame.get('request_id')
				if rid and rid in self._pending and not self._pending[rid].done():
					self._pending[rid].set_result(frame)
		except asyncio.CancelledError:
			raise
		except Exception:
			pass
		finally:
			self.closed.set()

	async def wait(self, pred: Predicate, timeout: float | None = None, start: int | None = None) -> Frame | None:
		"""Wait for the first frame at or after ``start`` satisfying ``pred``."""
		deadline = time.monotonic() + (self.timeout if timeout is None else timeout)
		idx = len(self.frames) if start is None else start
		while True:
			while idx < len(self.frames):
				frame = self.frames[idx][1]
				idx += 1
				if pred(frame):
					return frame
			remaining = deadline - time.monotonic()
			if remaining <= 0:
				return None
			self._new_frame.clear()
			try:
				await asyncio.wait_for(self._new_frame.wait(), remaining)
			except asyncio.TimeoutError:
				return None

	async def wait_event(self, kind: str, timeout: float | None = None, start: int | None = None) -> Frame | None:
		return await self.wait(lambda f: f.get('type') == kind, timeout=timeout, start=start)

	def responses_since(self, start: int) -> list[Frame]:
		return [f for _, f in self.frames[start:] if str(f.get('type', '')).endswith('_response')]

	@property
	def mark(self) -> int:
		"""Index to pass as ``start`` to only consider frames from now on."""
		return len(self.frames)

	def events_since(self, start: int) -> list[Frame]:
		return [f for _, f in self.frames[start:] if str(f.get('type', '')).endswith('_event')]

	def event_kinds_since(self, start: int) -> list[str]:
		return [str(f.get('type')) for f in self.events_since(start)]

	# ---- writing ----

	def _next_id(self) -> str:
		self._seq += 1
		return f'conf-{self._seq}'

	async def send(self, command: Frame, request_id: str | None = None, timeout: float | None = None) -> Frame:
		"""Send a command and return its response frame (ack or error)."""
		if self._ws is None:
			raise DeviceError('not connected')
		rid = request_id or self._next_id()
		fut: asyncio.Future[Frame] = asyncio.get_running_loop().create_future()
		self._pending[rid] = fut
		try:
			await self._ws.send(json.dumps({**command, 'request_id': rid}))
			return await asyncio.wait_for(fut, self.timeout if timeout is None else timeout)
		except asyncio.TimeoutError as exc:
			raise DeviceError(f'no response to {command.get("type")} within timeout') from exc
		finally:
			self._pending.pop(rid, None)

	async def send_nowait(self, command: Frame, request_id: str | None = None) -> str:
		"""Send a frame without waiting for its reply.

		Used by the request-id audit, which needs two frames on the wire with the same
		id; awaiting them through ``send`` would correlate the wrong reply.
		"""
		if self._ws is None:
			raise DeviceError('not connected')
		rid = request_id or self._next_id()
		await self._ws.send(json.dumps({**command, 'request_id': rid}))
		return rid

	async def command(self, type_: str, **fields: Any) -> Frame:
		return await self.send({'type': type_, **fields})

	async def command_ok(self, type_: str, **fields: Any) -> tuple[bool, Frame]:
		"""Send a command and report whether the device acknowledged it."""
		resp = await self.command(type_, **fields)
		return resp.get('type') == 'ack_response', resp

	async def snapshot(self) -> Frame:
		resp = await self.command('request_status')
		if resp.get('type') != 'status_response':
			raise DeviceError(f'expected status_response, got {resp.get("type")}: {resp}')
		return resp

	# ---- convenience accessors over a snapshot ----

	@staticmethod
	def cc(status: Frame) -> Frame:
		return status.get('control_center') or {}

	@staticmethod
	def view(status: Frame) -> Frame:
		return status.get('view') or {}

	@staticmethod
	def settings(status: Frame) -> Frame:
		return status.get('settings') or {}

	@staticmethod
	def sessions(status: Frame) -> list[Frame]:
		return (status.get('sessions') or {}).get('session_list') or []

	@staticmethod
	def messages(status: Frame) -> Frame:
		return status.get('messages') or {}

	@staticmethod
	def message_list(status: Frame) -> list[Frame]:
		return (status.get('messages') or {}).get('message_list') or []
