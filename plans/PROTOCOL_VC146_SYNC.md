# Companion Module Sync to JSON Protocol vc146

**Date:** 2026-10-09
**Updated:** 2026-10-10 — implementation landed; this doc now records status, not just intent.
**Repo:** `companion-module-cuetime-stagedisplay`
**Far-side source of truth:** `Android-Display-App/docs/HTTP_JSON_CONTROL_PROTOCOL.md`
@ `e0b2069a` ("Align the HTTP JSON protocol docs, schema and validation."),
**reviewed 2026-10-09, Version Code 146**.
**Supersedes:** `plans/SCHEMA_AND_WEBSOCKET_UPDATE.md` (2026-09-03, vc141), which
has been deleted — its still-useful content is folded in below (§2 records what
changed and where the old plan's assumptions were wrong).

This document vendors the current protocol spec into the repo
(`HTTP_JSON_CONTROL_PROTOCOL.md`, copied verbatim from the far side) and records
the work that brought the module back in sync.

---

## 0. Where this stands

Phases 0–5 are **done**. The module builds, its 41 tests pass, and it talks the
vc146 protocol over a WebSocket. The module has also been exercised against real
**firmware 1.1.2.24 / build 146** — 29/29 checks passed, including the two unit
conversions and the ad-hoc timer flow (§11). Two transport-hardening items remain
unbuilt and one test-parity item is outstanding; §6.7 lists them.

| Area                                                   | Status                                            |
| ------------------------------------------------------ | ------------------------------------------------- |
| Vendored spec + schema + conformance note              | done                                              |
| Generated types + ajv conformance tests + drift CI job | done                                              |
| WebSocket transport + reconnect                        | done (fixed-delay retry; backoff still open)      |
| Silence watchdog                                       | **not built**, but no longer blocked — §11        |
| Event-driven state, variables, feedbacks               | done                                              |
| Actions mapped to vc146 commands                       | done (26 actions / 25 distinct commands)          |
| Config, presets, README, HELP                          | done                                              |
| Far-side `test_ws_json_protocol.py` parity fixtures    | **not ported** — §6.7                             |
| Manual pass against a vc146 device                     | **done** for the read path, actions, errors — §11 |

Verification currently green:

```
yarn typecheck   0 errors (covers src/, including tests and fixtures)
yarn test        41 passed / 5 files
yarn build       OK; dist/ contains production files only
prettier --check All matched files use Prettier code style
CI protocol-drift regenerates and diffs src/protocol/generated.ts → clean
```

---

## 1. Why this was needed

The local `HTTP_JSON_CONTROL_PROTOCOL.md` was a 2026-06-12-era HTTP document with a
one-line "authoritative schema" note added 2026-09-03. The far-side document has
since been **regenerated** (vc 142 → 146) and is ~3× larger. Critically, almost
every wire detail the module depended on has changed:

- The only HTTP endpoint is now `POST /api/command`. The module's `GET /api/status`
  and `GET /api/status/sessions` polling endpoints **are not part of the protocol
  at all** — they may exist as internal diagnostic routes but are explicitly
  undocumented and unstable.
- The reply envelope no longer has `success`. Status is now `type`-discriminated
  (`status_response`, `ack_response`, `error_response`, …).
- The legacy command names the module sent (`start_timer`, `pause_timer`,
  `blackout`, `hide_display`, `setup_timer`) are **gone from the handler**.
- `control_center.is_playing` was replaced by `timer_run_state`
  (`idle` | `running` | `paused`); session-summary `is_playing` was replaced by
  `is_current`; `settings.version` was renamed `screen_version`.
- WebSocket (port 8081) pushes `*_event` broadcasts at ~1 Hz while a timer runs,
  plus on every state change.

In short: the module as it stood could not drive a vc146 device except by
accident, and its read path was dead.

---

## 2. What changed since the vc141 plan (corrections to the old plan)

Preserved as a record of why the vc141 assumptions were wrong.

| Old plan (vc141) claim                                                                                                   | vc146 reality                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `set_flash` schema says `start_time_seconds` but handler wants `{enabled}`; module sends `{enabled}`                     | **Both changed.** `set_flash` now takes a required `action: "enable"│"disable"│"toggle"`. `start_time_seconds` was removed in build 145 and is now rejected with `INVALID_PARAMETER`.                                                                     |
| `request_id` required by the handler, `MISSING_REQUEST_ID` error                                                         | **Now optional** (`string│null`); replies echo it only when sent. The module still always sends a fresh id for correlation.                                                                                                                               |
| Section-reply types missing from the schema; `status_response` sections typed `string`                                   | **Fixed.** Schema now has full `*_response` and `*_event` unions with typed section objects (`JsonControlCenterStatus`, `JsonViewStatus`, `JsonSettingsStatus`, `JsonSessionsStatus`, `JsonMessagesStatus`, `JsonProgram`, `JsonSession`, `JsonMessage`). |
| Push events ~20 Hz, needs coalescing to 5–10 Hz                                                                          | Now **~1 Hz steady state**. No meaningful coalescing needed.                                                                                                                                                                                              |
| `show_session(session_id, session_state)` arms + starts                                                                  | `session_state` **removed in build 143** and now rejected. Arm with `show_session`, then start with `start_session` (or `start_session` with `session_id` alone).                                                                                         |
| Ad-hoc timer: pre-generate UUID, `add_session`, fall back to `update_session`, pause-first                               | `add_session` **returns the new id in `ack_response.entity_id`**. No pre-generated UUID, no fallback needed.                                                                                                                                              |
| Error codes `MISSING_TYPE`, `UNKNOWN_TYPE`, `SCHEMA_VIOLATION`, `UNSUPPORTED_VERSION`, `DEVICE_BUSY`, `PROCESSING_ERROR` | Current set: `INVALID_COMMAND`, `PARSE_ERROR`, `INVALID_PARAMETER`, `UNKNOWN`, `INVALID_SESSION`, `DEVICE_BUSY`, `HARDWARE_ERROR`, `INTERNAL_ERROR`.                                                                                                      |
| `add_time`/`subtract_time` carry `seconds`                                                                               | Now carry **`ms`** (preferred); `seconds` deprecated and ignored when `ms` is nonzero. See §7 — the module sends `ms`.                                                                                                                                    |
| `setup_timer` allowed duration `0` (UI `min: 0`)                                                                         | Countdown now requires **at least 1 second** in `add_session` / `update_session` and in `send_program`; count-up `0` is accepted; ToD `0` = midnight.                                                                                                     |
| Old plan §2.6 items to file far-side                                                                                     | All resolved (schema regenerated clean). Nothing to file.                                                                                                                                                                                                 |
| Concept: schema-generated types, WS-only, no back-compat, event-driven store                                             | **Landed.** Carried through §4–§8.                                                                                                                                                                                                                        |

---

## 3. Gap analysis (as it stood before this work; all rows now closed)

| Area            | Was (`src/`)                                                                          | vc146 target                                                                                                                                                          | Now  |
| --------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| Transport       | HTTP `fetch` to `/api/command`; 2 s polling of `/api/status` + `/api/status/sessions` | WS `ws://host:8081` only (D1); push events drive all state, no HTTP polling                                                                                           | done |
| Read of state   | `ApiResponse.success` + `control_center`; assumes `success: true`                     | `type`-discriminated events; no `success` field exists                                                                                                                | done |
| Command names   | `start_timer`, `pause_timer`, `blackout{enabled}`, `hide_display`, `setup_timer`      | `start_session`, `pause_session`, `set_blackout{action}`, `hide_message`, `add_session`                                                                               | done |
| Run state       | `cc.is_playing` (bool)                                                                | `cc.timer_run_state` (`idle`/`running`/`paused`)                                                                                                                      | done |
| Current session | `cc.current_session_index`                                                            | same, plus `current_session_id`; `-1`/empty when idle                                                                                                                 | done |
| Session list    | `sessions.session_list[].is_playing`, `.session_name`                                 | `.is_current`, `.name`, `.index`, `.mode`, `.duration`/`.offset`                                                                                                      | done |
| Messages        | not read at all                                                                       | `messages.message_list[].{id,text,is_showing}`, `.is_flashing`                                                                                                        | done |
| Settings        | `settings.version`                                                                    | `settings.screen_version` (+ `brightness`, `view_only_code`)                                                                                                          | done |
| Timer units     | ms (kept)                                                                             | ms for `timer`/`elapsed_time`/`program_*`; **seconds** for session `duration`/`flash_*`; **ms past midnight** for ToD `offset`                                        | done |
| Prev/next       | `cc.is_previous_session`/`is_next_session`                                            | unchanged                                                                                                                                                             | done |
| Types           | hand-written `logic.ts` interfaces                                                    | vendor schema + generated types matching it                                                                                                                           | done |
| Event handling  | none                                                                                  | `hello_event`, `control_center_status_event`, `view_status_event`, `settings_status_event`, `sessions_status_event`, `messages_status_event`, `program_changed_event` | done |
| `request_id`    | not sent                                                                              | send fresh per command; correlate replies by id                                                                                                                       | done |
| Config          | `port` default `8080`, labelled HTTP                                                  | default `8081`, labelled WebSocket (mDNS `json_ws_port`)                                                                                                              | done |

---

## 4. Decisions

### Resolved before implementation

- **D1 — Transport: WebSocket-only.** One transport, `ws://host:8081`, driven
  entirely by push events. No HTTP transport mode, no polling fallback, no
  transport dropdown. The device still supports HTTP; this module does not use it.
- **D2 — Types: vendor + generate.** `schemas/protocol-schema.json` is committed and
  `src/protocol/generated.ts` is generated from it by
  `scripts/generate-protocol.mjs`. Provenance and the regen command are documented
  in `README.md` and `docs/CONFORMANCE.md`.
- **D3 — `setup_timer` replacement: ad-hoc `add_session` flow.** `add_session` reads
  the new id from `ack_response.entity_id`, then optionally `start_session` with it.
- **D4 — `show_message`: keep the UX toggle, implement it statelessly.** If a
  message is currently on screen (`view.message_text`), send `hide_message`;
  otherwise send `show_message`. No local `lastShownMessage` bookkeeping.
- **D5 — `request_id`: always send.** Fresh `crypto.randomUUID()` per command;
  correlate strictly by id (replies are not order-guaranteed over WS).
- **D6 — Action id renames; no upgrade scripts.** Rename where it removes confusion
  (`pause_timer` → `pause_session`, `hide_display` → `hide_message`, `setup_timer` →
  `add_session`). Renamed ids break any button that used them.
  **This module has not shipped**, so there are no deployed instances and therefore
  no upgrade scripts to write for vc146 — in particular, no `8080` → `8081` config
  migration. `src/upgrades.ts` remains the empty template placeholder.

### Decided during implementation

- **D7 — Three connection states, not four.** `ClientStatus` is
  `disconnected | connecting | live`. The planned separate `handshaking` state was
  dropped: `connecting` already spans "socket is up, device has not said hello",
  and a distinct state only added a value nobody branches on. `live` means
  `hello_event` was received, _not_ that TCP connected — so a socket that opens
  onto a silent device never reports connected.
- **D8 — `send()` returns a result object; only the transport failure throws.**
  `ResponseResult { ok, type, code?, message?, response? }`. A device-level
  rejection (`error_response`) is `ok: false`, not a thrown exception, so actions
  log-and-continue. This also fixed a pre-existing bug where `ack_response` was
  classified as a failure. In-flight requests are **settled** with
  `code: 'DISCONNECTED'` when the link drops, rather than rejected, so no caller
  can produce an unhandled rejection. Commands time out after 5 s as
  `code: 'TIMEOUT'`.
- **D9 — Injectable socket + typed fixtures, because `as any` hid the last bug.**
  `ProtocolClient` depends on a structural `WebSocketLike` interface with a
  `socketFactory` option, so unit tests drive protocol logic with no network and
  the integration tests open a real socket. Test inputs are built by typed builders
  in `src/protocol/fixtures.ts`; the previous tests used `as any` casts and so
  agreed with the code on field names (`progress`, `elapsed`,
  `settings.is_time_up_flashing`, `settings.blackout_enabled`) that **do not exist
  in vc146**. Spelling the fields out makes that class of drift a compile error.
- **D10 — Compile-time enforcement of command names and payloads.**
  `sendCommand<K extends CommandType>(type: K, payload?: CommandPayloads[K])`.
  Every `sendCommand` call is therefore checked against the generated union, which
  is what forced the HTTP-era command names out of `actions.ts`.
- **D11 — Frame encoding is normalised defensively.** `ws` hands text frames to the
  client as `Buffer`s, so a `typeof data === 'string'` check silently dropped every
  pushed event. `frameToText()` accepts string / `Buffer` / `Buffer[]` /
  `ArrayBuffer`. Covered by an integration test against a real `ws` server.
- **D12 — `dist/` carries production files only.** `tsconfig.build.json` extends the
  base config and excludes `src/**/*.test.ts` and `src/protocol/fixtures.ts`;
  `build`/`package` run the base config with `--noEmit` first (so tests are still
  type-checked in CI) and then emit with the build config. `scripts/clean.mjs`
  removes `dist/` before emitting so a newly-excluded or deleted file cannot linger
  and ship.
- **D13 — No polling; one hydration.** The 2 s `updateVariables()` interval is gone.
  The client requests `request_status { detailed: true }` exactly once after the
  first `hello_event`, guarded so a repeated hello does not re-hydrate.

---

## 5. WebSocket strategy for Companion

### 5.1 Process model (verified)

- Each connection instance runs in its **own long-lived Node.js child process**
  (`runtime: nodejs-ipc`, one process per instance, isolated from Companion core
  and from other instances). It stays alive for the lifetime of the instance;
  Companion action presses are delivered to it over IPC.
- A single WS socket per instance, held open indefinitely, is therefore the normal
  pattern. No polling loop and no separate worker are needed — the socket's
  handlers _are_ the background listener, driven by Node's event loop.
- Companion restarts the module process when you save files in the module folder
  and when the instance config changes; if the process exits, Companion respawns
  it. Sockets are never shared across instances.

### 5.2 Lifecycle contract

- **`init(config, isFirstInit)`** — registers action/feedback/variable/preset
  definitions, projects the (empty) state, then starts the socket and returns.
  It does **not** await the connection: the Bitfocus docs warn that awaiting here
  makes Companion think the module timed out and restart it.
- **`configUpdated(config)`** — stops the current client and reconnects with the
  new host/port.
- **`destroy()`** — stops the client, which clears the reconnect timer, settles
  in-flight requests, and closes the socket.

`updateStatus()` drives the Connections-page indicator: `Connecting` while
connecting, `Ok` on `live`, `ConnectionFailure` otherwise. The `is_connected`
feedback derives from `live`, not from `updateStatus`.

### 5.3 Client as built (`src/protocol/client.ts`)

- **Library.** `ws`, behind an injected `socketFactory` (D9).
- **State machine.** `disconnected → connecting → live` (D7); `live` is set by
  `hello_event`.
- **Hydration.** One `request_status { detailed: true }` after the first hello (D13).
- **Dispatch.** `parseInbound()` → `isResponse()` to the pending-request map keyed
  by `request_id`, otherwise emitted as an event. Unrecognised frames are logged at
  `warn` and dropped.
- **Send path.** Fresh `request_id` per command, 5 s timeout, `ResponseResult` (D8).
  `send()` throws only when `readyState !== OPEN`, i.e. a transport misuse.
- **Frame normalisation.** `frameToText()` (D11).
- **Errors.** An `'error'` handler is always attached — an unhandled `ws` error
  would crash the module process. Errors mark the client disconnected and close the
  socket, and `close` drives reconnection.
- **Reconnect.** Fixed 2 s delay, timer `unref()`ed so it cannot hold the process
  open, guarded by a `stopped` flag so `stop()` is never followed by a reconnect.
  **This is a simplification of the planned exponential backoff + jitter, and is
  open work — §6.7.**

### 5.4 Cost and behaviour inside Companion

- Measured on firmware 1.1.2.24 (§11): while a timer runs the device pushes
  `control_center_status_event` and `view_status_event` **~1 Hz each — ~2 events/s
  total** — and goes silent when idle. The doc's "~1 Hz steady state" is per event
  type. Each event re-projects ~17 variables and re-checks 14 feedbacks, so ~28
  feedback evaluations per second; negligible.
- Event-driven state removes the 2 s HTTP polling loop and all HTTP round-trips for
  reads.
- Multiple Companion instances (and the mobile app) each hold their own WS
  connection; the server broadcasts to all. No leader election needed.
- Failure modes designed for: device reboot / IP change (reconnect; a
  `bonjour-device` selection re-resolves through Companion, a manual host does not),
  port 8081 blocked (`ConnectionFailure` surfaced), and a device whose mDNS
  advertises only `http_port` (module cannot connect — §8 risk 8).

---

## 6. Work breakdown and status

### 6.1 Phase 0 — Vendor the contract (done)

1. `HTTP_JSON_CONTROL_PROTOCOL.md` replaced with the vc146 copy.
2. `schemas/protocol-schema.json` vendored from `Android-Display-App` @ `e0b2069a`
   (md5 `24550e042dde121e84338e4211121dbd`).
3. `docs/CONFORMANCE.md` records the far-side commit/date, content hash, regen
   command, target firmware, and the protocol facts the module relies on.
4. `README.md` documents the vendored schema, its provenance, and
   `yarn generate-protocol`.

### 6.2 Phase 1 — Protocol types / plumbing (done)

1. `scripts/generate-protocol.mjs` → `src/protocol/generated.ts`: string-literal
   unions from the `const` discriminators; per-union payload type maps; nested
   object interfaces; discriminated `Command`/`Response`/`Event`;
   `buildCommand()`; `parseInbound()` + `isResponse()`/`isEvent()` narrowing.
2. `yarn generate-protocol` added (generator + prettier); chained into
   `build`/`package` through that same script so there is exactly one generation
   pipeline — `build` previously called the generator directly, which emitted
   `generated.ts` in a form `prettier --check` rejected; CI job `protocol-drift`
   regenerates and fails if the file is dirty **or untracked** (`git diff` alone
   is vacuous for a file that was never committed).
3. `ajv` (draft 2020-12) added; `src/protocol/generated.test.ts` validates every
   generated command, response and event against the vendored schema, plus
   parser/narrowing/malformed-frame cases (8 tests).

### 6.3 Phase 2 — Transport (done, two items open)

`src/protocol/client.ts` per §5.3. WS is the only transport: `send()` always goes
out over the socket, there is no HTTP code path and no transport selection.

Open: reconnect backoff, silence watchdog — §6.7.

### 6.4 Phase 3 — Event-driven state, variables, feedbacks (done)

1. `src/protocol/state.ts`: `ProtocolState` assembled from `hello_event` + the
   hydration `status_response` + push events. Pure and immutable
   (`applyEvent`, `applyResponse`, `createInitialState`).
2. `latestStatus`, the 2 s `updateVariables()` poll, `connected`-by-polling,
   `blackoutToggle` and `lastShownMessage` are all gone. `main.ts` holds
   `state: ProtocolState` and calls `refreshFromState()` on every event, response,
   and status change.
3. `src/logic.ts` holds the pure derivations: `extractVariableValues()` (17
   variables) and 11 boolean checks, unit-tested.
4. `InstanceStatus` is driven from the client's state machine (Connecting / Ok /
   ConnectionFailure).

### 6.5 Phase 4 — Actions (done)

26 actions over 25 distinct vc146 commands; see §7. Every payload goes through the
generated builder and every call is compile-time checked (D10). Guards use event
state (`is_next_session`, `is_previous_session`, `timer_run_state`, `is_blackout`),
never local guesses.

Validation the module performs locally so the device does not have to reject it:
countdown duration ≥ 1 s; ToD offset parseable as `HH:MM:SS` within
`00:00:00–23:59:59`; brightness a whole number 0–100; `delete_all_*` gated behind a
confirm checkbox.

### 6.6 Phase 5 — Config, presets, docs (done)

1. `getConfigFields()`: `port` default `8081`; mDNS host unchanged
   (`_cuetime._tcp`). A discovered device still takes precedence over a manual host.
2. `companion/manifest.json` re-indented to repo style (content unchanged).
3. `README.md` and `companion/HELP.md` action/variable/feedback lists and preset
   descriptions rewritten against the new surface.
4. `src/presets.ts` restored to HEAD's 20 presets with action ids remapped
   (`pause_timer` → `pause_session`); `setPresetDefinitions(structure, presets)`.

Cross-checked mechanically: all 10 `actionId`s, 8 `feedbackId`s and 8
`$(cuetime:…)` variable references in presets resolve to definitions that exist.

### 6.7 Remaining work

1. **Reconnect backoff.** Replace the fixed 2 s retry with exponential backoff
   1 s → 30 s plus jitter, reset on a successful `hello_event`, so a device that is
   off is not retried every two seconds forever. Pure client change; no device
   needed to validate.
2. **Silence watchdog.** No traffic for ~15 s while nominally `live` should force a
   reconnect, tracking the last frame of _any_ kind. Not built, but the blocking
   question is now answered (§11): the device pings every 5.00 s exactly, and it
   **auto-pongs a client-initiated `ws.ping()`**. Either signal therefore works, and
   the client-initiated ping is the better one because it does not depend on server
   behaviour. Note an idle timer legitimately pushes no events, so "no events" must
   never be the signal.
3. **Far-side integration fixtures.** Re-scoped after inspecting the far side:
   `test_ws_json_protocol.py` is **4,875 lines / 199 test functions / 27 groups** and
   is a **live-device suite** (`device_lease.py`, `host` argument, and a
   `CrossTransportGroup` that compares WS against HTTP). It cannot run in CI, so:
   - **Offline (CI-able):** a small set of golden payloads for the ~25 commands the
     module actually sends. This is the only thing that catches unit errors, since
     schema validation cannot — `offset: 3600` is a valid integer and a wrong value.
   - **Device-gated:** running the far-side suite itself alongside a manual pass.
4. **Manual pass against a vc146 device:** done for the read path, the ad-hoc timer
   flow, effects, messages and device-side validation (§11). Still to do: the far-side
   suite run, and `set_brightness` (deliberately not exercised — see §11).
5. **ToD guards.** §11 confirmed a time-of-day session rejects `pause_session`,
   `add_time`, `subtract_time` and `reset_current_session` with `INVALID_COMMAND`.
   The module currently sends them anyway and only logs at `warn`, so an operator's
   button silently does nothing. Guarding locally needs `current_session_mode`
   exposed (see §8).
6. **Optional, unexposed but implemented-in-schema actions:** `add_message`,
   `update_message`, `delete_message`, `move_message_up`/`_down`, `delete_session`,
   `update_session`, `send_program`, `get_program`, `get_program_list`, and the five
   unused `request_*` commands. `request_status` is used internally for hydration.

---

## 7. Action mapping (old → new, as implemented)

`add_time` / `subtract_time` send **`ms`**, not the deprecated `seconds`. The
option UI stays in seconds and the callback converts (`toWholeMs`). The doc is
explicit: send `ms`; `seconds` is ignored whenever `ms` is nonzero and is only kept
for clients that have not migrated.

| Old action id                          | New action id                                                                                  | vc146 command(s)                         | Notes                                                     |
| -------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------- |
| `start_timer`                          | `start_session`                                                                                | `start_session`                          | no `session_id` = act on the current session              |
| `resume_timer`                         | `start_session`                                                                                | `start_session`                          | merged into one action                                    |
| `pause_timer`                          | `pause_session`                                                                                | `pause_session`                          | device rejects for ToD / idle                             |
| `toggle_playback`                      | `toggle_playback` (id kept)                                                                    | `pause_session` / `start_session`        | driven off `timer_run_state`                              |
| `navigate_next_session`                | unchanged                                                                                      | `navigate_next_session`                  | guarded on `is_next_session`; no wrap-around              |
| `navigate_previous_session`            | unchanged                                                                                      | `navigate_previous_session`              | guarded on `is_previous_session`                          |
| `add_time`                             | unchanged                                                                                      | `add_time { ms }`                        | UI seconds → `ms`                                         |
| `subtract_time`                        | unchanged                                                                                      | `subtract_time { ms }`                   | same                                                      |
| `blackout`                             | `blackout` (id kept)                                                                           | `set_blackout { action }`                | no toggle command; `toggle` resolved from `is_blackout`   |
| `enable_blackout` / `disable_blackout` | dropped (covered by `blackout`)                                                                | —                                        |                                                           |
| `set_glow`                             | unchanged                                                                                      | `set_glow { enabled }`                   | enabling glow disables blackout on the device             |
| `toggle_glow`                          | unchanged                                                                                      | `toggle_glow`                            | ack carries no state                                      |
| `set_flash`                            | unchanged                                                                                      | `set_flash { action }`                   | **was `{ enabled }`**                                     |
| `toggle_flash`                         | unchanged                                                                                      | `toggle_flash`                           | ack carries no state                                      |
| `show_message`                         | `show_message`                                                                                 | `show_message` / `hide_message`          | toggles from `view.message_text` (D4); `flash` boolean    |
| `hide_display`                         | `hide_message`                                                                                 | `hide_message`                           | renamed                                                   |
| `show_idle`                            | unchanged                                                                                      | `show_idle`                              | clears the current session, resets `program_elapsed_time` |
| `setup_timer`                          | `add_session`                                                                                  | `add_session` → optional `start_session` | id read from `ack_response.entity_id` (D3)                |
| —                                      | `show_session`, `move_session_up`, `move_session_down`, `delete_all_sessions`                  | same names                               | new                                                       |
| —                                      | `reset_current_session`, `reset_program_elapsed_timer`                                         | same names                               | new                                                       |
| —                                      | `set_brightness`, `set_is_time_up_display`, `toggle_is_time_up_display`, `delete_all_messages` | same names                               | new                                                       |

### Ad-hoc timer flow (replaces `setup_timer`)

1. `add_session` with the configured `mode`, `seconds` (countdown/count-up) or
   `offset` (ToD, **ms past midnight**), `name`, `presenter_name`, notes and flash
   fields. It appends and does **not** select.
2. Read the new id from `ack_response.entity_id`.
3. If "start it" is ticked, `start_session { session_id }` with that id.

- `session_state` is not sent anywhere — rejected since build 143.
- Countdown `seconds` must be **≥ 1**; the action refuses to send anything less
  rather than letting the device return `INVALID_PARAMETER`.
- **Unit split-brain (§8 risk 6) actually bit here.** Two bugs were found while
  writing this document and are fixed: `add_time`/`subtract_time` were sending the
  deprecated `seconds` field, and the ToD `offset` was computed in seconds rather
  than the milliseconds the schema requires — a silent 1000× error. Both are now
  covered by §6.7 item 3's fixture parity, which does not exist yet.

---

## 8. Variables and feedbacks (as implemented)

### Variables (17)

| Variable                                    | Source (vc146)                     | Notes                               |
| ------------------------------------------- | ---------------------------------- | ----------------------------------- |
| `timer_run_state`                           | `cc.timer_run_state`               | `idle` / `running` / `paused`       |
| `elapsed_time`                              | `cc.elapsed_time` (ms)             | session running time                |
| `timer`                                     | `cc.timer` (ms, unsigned)          | `abs()`; 0 = countdown at zero      |
| `current_session_name`                      | `cc.current_session_name`          | empty when idle                     |
| `current_presenter_name`                    | `cc.current_presenter_name`        | empty when idle                     |
| `is_playing`                                | `cc.timer_run_state === "running"` | legacy convenience string           |
| `is_glowing`                                | `cc.is_glowing`                    |                                     |
| `is_blackout`                               | `cc.is_blackout`                   |                                     |
| `message_text`                              | `view.message_text`                | empty when no message               |
| `current_session_number`                    | `cc.current_session_index + 1`     | 0 when idle                         |
| `total_sessions`                            | `session_list.length`              |                                     |
| `elapsed_formatted`                         | `formatTime(view/cc elapsed)`      | `MM:SS`, or `HH:MM:SS` past an hour |
| `remaining_formatted`                       | `formatTime(cc.timer)`             | same formatting                     |
| `previous_session_name` / `_presenter_name` | `session_list[index-1]`            | indexed, not gated on the flag      |
| `next_session_name` / `_presenter_name`     | `session_list[index+1]`            | indexed, not gated on the flag      |

`is_playing` is kept for compatibility with existing buttons but
`timer_run_state` is the honest field — `is_playing` cannot distinguish paused from
idle, which is exactly why the protocol retired it.

Still unexposed: `current_session_id`, `current_session_mode`, `progress_bar`,
`program_elapsed_time` (+ formatted), `screen_version`/`screen_name`,
`is_time_up_flashing`, `brightness`.

### Feedbacks (14)

| Feedback                                       | Source                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `is_connected`                                 | client `live` state, not `updateStatus`                     |
| `is_playing` / `is_paused` / `is_idle`         | `cc.timer_run_state`                                        |
| `is_glowing`                                   | `cc.is_glowing`                                             |
| `is_blackout`                                  | `cc.is_blackout` (advanced, swaps the eye / bar-eye PNG)    |
| `is_flashing`                                  | `view.is_flashing`                                          |
| `has_previous_session` / `no_previous_session` | `cc.is_previous_session`                                    |
| `has_next_session` / `no_next_session`         | `cc.is_next_session`                                        |
| `message_showing`                              | `view.message_text` (whitespace-only counts as not showing) |
| `is_time_up_display`                           | `settings.is_time_up_display`                               |
| `is_time_up_flashing`                          | `cc.is_time_up_flashing` **or** `view.is_time_up_flashing`  |

`is_blackout` and `is_glowing` are mutually exclusive on the device, so a single
three-state indicator may be a nicer preset than two buttons — not done.

---

## 9. Risks / open questions — resolution status

| #   | Risk                                             | Status                                                                                                                                                                                                                         |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `add_session` while a session timer is running   | **Resolved on hardware.** Verified against firmware 1.1.2.24: accepted while a countdown ran, the session was appended, and the running timer and current session were untouched. See §11.                                     |
| 2   | `entity_id` completeness                         | **Resolved for the implemented flow.** `add_session` fills it; the action falls back to `start_session` without an id, which acts on the current session — so a missing `entity_id` degrades rather than breaks.               |
| 3   | `request_id` optionality                         | **Resolved.** Always sent; replies keyed by id; a reply without one is still surfaced to `onResponse` but resolves nothing.                                                                                                    |
| 4   | Silence watchdog                                 | **Unblocked, still unbuilt.** Measured: the device pings every 5.00 s and auto-pongs a client `ws.ping()`, so either signal is usable. See §11 and §6.7 item 2.                                                                |
| 5   | Field omission ("absent means absent, not null") | **Resolved.** Derivations use `?? default` throughout; nothing requires an optional field to be present.                                                                                                                       |
| 6   | Unit split-brain                                 | **Fixed and now verified on hardware.** ToD `offset` is confirmed **milliseconds** (sent `3600000`, echoed `3600000`); `add_time`/`subtract_time` `ms` measured exact. Golden-fixture coverage still worthwhile (§6.7 item 3). |
| 7   | Action id renames break existing buttons         | **Accepted (D6).** Nothing has shipped, so there are no existing deployments — see D6 for why no upgrade scripts are needed.                                                                                                   |
| 8   | WS port availability                             | **Documented.** Firmware must expose `json_ws_port` (8081) and the network must allow it; a device advertising only `http_port` is not controllable.                                                                           |

---

## 10. Remaining work, in order

0. Commit `src/protocol/**` (it is currently untracked in the working tree). The
   `protocol-drift` guard reads `git status`, so it reports drift until
   `src/protocol/generated.ts` is tracked — that is the intended behaviour, not a
   false positive.
1. **Correctness debt from this change:** extract the payload-building and
   validation logic out of the action callbacks into an exported pure module and
   unit-test it. Today `toWholeMs` and `parseTimeOfDayOffsetMs` are unreachable from
   tests, which is exactly why the `ms`/`offset` bugs shipped — they were caught by
   re-reading the spec, not by the suite.
2. `checkIsFlashing` should OR `view.is_flashing` with `state.messagesFlashing`.
   Today `messagesFlashing` is written by the state store and read by nothing, and
   the messages section is a second authoritative report of the same flash.
3. Reconnect backoff (§6.7 item 1) — client-only, no device needed.
4. Silence watchdog (§6.7 item 2) — unblocked by §11.
5. ToD guards, plus the `current_session_mode` / `current_session_id` /
   `progress_bar` variables (§6.7 item 5, §8).
6. Offline golden payloads, then the far-side suite run against the device.

---

## 11. Hardware validation — firmware 1.1.2.24, build 146 (2026-10-10)

Run against a live display at `192.168.1.53` using the built `dist/` client. The
read path and the error path were exercised first with no state mutation; the
mutating checks were reversible, and the device was returned to its baseline
(`sessions=0 run=idle blackout=false glow=false message=""`, brightness unchanged)
with `show_idle` + `delete_all_sessions`. **29/29 checks passed.**

### Confirmed

- `hello_event` on connect: `screen_name` "CueTime 24 Display", `version_name`
  1.1.2.24, `version_code` **146**. `connecting → live` on hello, as designed.
- **Text frames arrive as `Buffer`s** (`kind=Buffer isBinary=false`). D11 was a real
  bug that would have dropped every pushed event; now verified against firmware.
- Hydration: the automatic `request_status {detailed: true}` returned a
  `status_response` with all 16 `control_center` fields, and state populated.
- `request_id` correlation: replies came back carrying our generated UUIDs.
- **Server pings every 5.00 s exactly** (four consecutive 5.00 s gaps), and the
  device **auto-pongs a client-initiated `ws.ping()`**. This is what unblocks the
  watchdog, and it means the client-initiated form is viable — the better choice,
  since it does not depend on server behaviour.
- **Event rate while running: ~2 events/s** (`control_center_status_event` ~1 Hz +
  `view_status_event` ~1 Hz), silent when idle. This corrects the doc's "~1 Hz".
- Ad-hoc timer flow (D3): `add_session` returned `entity_id` →
  `start_session {session_id}` → `timer_run_state` `running` with
  `current_session_id` matching.
- `add_session` creates but does **not** select the session; it appears in
  `session_list` with the expected `mode`, `name` and `duration`.
- `add_time {ms: 5000}` → exactly **+5000 ms**; `subtract_time {ms: 2000}` → exactly
  **−2000 ms**. Measured while paused, so there is no clock drift in the comparison.
- **ToD `offset` is milliseconds:** sent `3600000` (01:00:00), echoed `3600000`. This
  confirms the §7 fix; the pre-fix code sent `3600`, which would have been wrong.
- `set_blackout {action}` works, and **`set_glow` cleared blackout** — the documented
  mutual exclusion is real, so two independent preset buttons can display an
  impossible state.
- `show_message` set `view.message_text`; `hide_message` cleared it. Confirms D4's
  toggle source.
- Device-side validation mirrors our local guards: countdown `seconds: 0` →
  `INVALID_PARAMETER` "Session duration must be ≥ 1"; `offset` past 23:59:59 →
  `INVALID_PARAMETER` "offset must be within 00:00:00 to 23:59:59".
- Refusals surface correctly through `ResponseResult`: `ok=false` with a `code` and
  a human-readable `message` (e.g. `pause_session` on an idle display →
  `INVALID_COMMAND` "No active session to pause").
- **Risk 1 closed:** `add_session` was accepted while a countdown was running; the
  session was appended and the running timer was untouched.
- **ToD rejection cases confirmed** on a real ToD session: `pause_session`
  ("Cannot pause a Time of Day session"), `add_time` ("Cannot add time to a Time of
  Day session") and `reset_current_session` ("Cannot reset a Time of Day session")
  each returned `INVALID_COMMAND`. This is the evidence behind §6.7 item 5.

### Not covered

- `set_brightness` was **not** exercised. A wrong value leaves the display at the
  wrong brightness, and the display sat at `brightness: 80` rather than a known
  baseline, so it was not worth the risk. Test it where that is acceptable.
- The far-side `test_ws_json_protocol.py` suite has not been run (199 tests, needs a
  leased device).
- No link drop occurred during the run, so watchdog behaviour is still unexercised.

### Far-side discrepancies found

1. **Doc says push events are "~1 Hz steady state".** Measured ~2 events/s; the
   figure is per event type, but the doc reads as a per-connection total.
2. **`settings.default_flash_length` unit looks wrong in the doc.** §4.6 states
   `default_flash_start_time` and `default_flash_length` are milliseconds, but the
   device reported `settings.default_flash_length: 4` while `control_center`
   reported `flash_length: 4000` — evidently the same 4-second flash. So settings
   appears to be **seconds**. The module reads neither field today, so there is no
   impact, but anything that exposes flash timing must resolve which side is wrong
   first.
