# CueTime JSON Control Protocol


| Validation |  |  |  |
| - | - | - | - |
|----------------|-----------------|----------------|-----------------|
| Reviewed Date  | 2026-10-09      | Version Code   | 146             |

This document is the complete specification of the **CueTime JSON control
protocol** as implemented by the CueTime Display Android application. It
covers both transports — HTTP (port 8080) and WebSocket (port 8081) — which
speak the **same JSON message format**.

The authoritative schema is `schemas/protocol-schema.json`, generated from the
Kotlin `@Serializable` data classes at build time.

---

## 1. Transports

### 1.1 HTTP (port 8080)

| Property           | Value                                    |
|--------------------|------------------------------------------|
| Transport          | HTTP/1.1                                 |
| Port               | **8080**                                 |
| Authentication     | None                                     |
| Content-Type       | `application/json`                       |
| Endpoint           | `POST /api/command`                      |
| Request/Response   | One JSON command → one JSON response     |
| Push events        | ❌ Not available                         |

**Every command is a `POST /api/command` — this protocol has no other
endpoint.** The body of the request is one command object (§3); the body of the
reply is that command's one response object (§4). **Reading state is a command
too** — `request_status` (or one of the section requests, §3.5), `get_program`,
`get_program_list` — so an HTTP client learns state by posting, not by a
separate read route.

HTTP is request/response only — **nothing is ever sent to a client that did not
ask.** A command's result arrives either in its own reply (an `ack_response` or
`error_response`) or, when the reply does not carry it, in a follow-up command:
`request_status` (whose `sessions` and `messages` sections are included by
default) or `get_program`. Use the WebSocket transport (§1.2) when you want a
change pushed instead of polled.

**Status codes.** `POST /api/command` answers **HTTP 200** when the reply is an
`ack_response` or a `*_response`, and **HTTP 400** when it is an
`error_response`. The body is always the JSON message described in §4, so read
the body to tell one rejection from another — the status only distinguishes
success from failure.

**The reply echoes `request_id` when the client sent one**, exactly as on the
WebSocket transport. Nothing is invented: a request without the field gets a
reply without it.

### 1.2 WebSocket (port 8081)

| Property           | Value                                    |
|--------------------|------------------------------------------|
| Transport          | WebSocket (RFC 6455)                     |
| Port               | **8081**                                 |
| Authentication     | None                                     |
| Frame type         | Text frames (opcode 0x1)                 |
| Payload format     | One JSON object per frame                |
| Ping interval      | 5 seconds                                |
| Request/Response   | Send JSON → receive JSON response frame  |
| Push events        | ✅ Broadcast on state changes            |
| Connection greeting| `hello_event` event sent immediately on open|

### 1.3 Connection Lifecycle (WebSocket)

```
Client                          Server
  |                               |
  |--- WebSocket handshake ------>|  (HTTP upgrade on port 8081)
  |<----- hello_event (Event) -----|  (device info, version)
  |                               |
  |--- command (JSON text) ------>|
  |<--- ack_response / error_response (Response) -----|
  |                               |
  |--- request_status ----------->|
  |<--- status_response ----------|  (full device status)
  |                               |
  |<--- control_center_status_event |  (pushed on whole-second ticks, ~1 Hz)
  |<--- view_status_event ---------|  (pushed on whole-second ticks, ~1 Hz)
  |<--- program_changed_event -----|  (on program change)
  |                               |
  |<--- ping (WebSocket) ---------|  (every 5 seconds)
  |--- pong --------------------->|
```

### 1.4 Security and network exposure

**The JSON protocol is unauthenticated, and both transports are plaintext.**
Neither §1.1 nor §1.2 asks for a credential: there is no session, no claim, and
no TLS. Any client that can open a TCP connection to port 8080 or 8081 can run
every command in §3 — including `send_program`, the session and message editing
commands, the `delete_*` commands and `set_brightness` — and every WebSocket
client receives every state broadcast, whether or not it is entitled to. There is
no per-client authorization to configure.

Mitigate at the network, not in the protocol: put the display on a trusted,
isolated network, or restrict ports 8080 and 8081 with a firewall, and treat
reachability of those ports as equivalent to control of the device.

The commands that would leave the display itself compromised are **not** on this
protocol: `shutdown`, `enable_adb`, `set_name`, `set_api_key` and the
display-group commands are protobuf-only (they exist on `ws://<device>:8002` and
`wss://<device>:8443`, where the claim model of the primary protocol applies). An
unauthenticated caller on 8080/8081 can change everything the display is *showing*
and *holds*, but cannot power it off or enable ADB.

**Only `POST /api/command` is part of this protocol.** The device's other HTTP
routes — the diagnostic JSON snapshots and the routes its bundled operator page
uses — are not part of this API, are not documented here, and may change or be
removed without notice. Build on `POST /api/command` and the message types in
this document only.

---

## 2. Message Envelope

Every JSON message is a single JSON object with a `type` field that acts as
the discriminator. Messages are identical between HTTP and WebSocket transports.

### 2.1 Common Fields

All messages may include:

| Field        | Type   | Description                              |
|--------------|--------|------------------------------------------|
| `type`       | string | Message type discriminator (required)    |
| `request_id` | string | Client-supplied correlation identifier (optional; echoed in reply only when present) |

**Absent means absent, not `null`.** A field the device has no value for is
**omitted from the JSON object** rather than sent as `null` — the examples in
this document show `null` for a field that may have no value, but the wire form
is a missing key (for instance a `view` section with no message on screen omits
`message_id`, and an `ack_response` for a command that created no stored entity
omits `entity_id`). Read such a field as "no value", and do not require its
presence unless the field table marks it required (`Req: yes`) or the text says
so.

**Send a fresh, unique `request_id` with every command.** That is the contract
here, as it is on every transport: the id is what makes a reply attributable to
the request that produced it. On the WebSocket transport, replies are **not
guaranteed to arrive in the order the commands were sent** — correlate on the
id, never on arrival order.

`request_id` does not make a command idempotent here: retrying a command with
the same `request_id` is executed again. It is a correlation identifier only —
reinstate your own duplicate suppression if you need it.

---

## 3. Commands (Client → Server)

Commands are sent as JSON objects. The `type` field must be one of the
command types listed below. Required fields are noted in each table.

### 3.1 Timer Control

**Session states.** `control_center.timer_run_state` reports `running`, `paused`, or `idle`.
**A current session exists exactly while the timer is `running` or `paused`;**
`idle` means there is **no current session** (`current_session_id` empty and
the idle screen shown). A **paused** timer stays on the screen, frozen at its
current value; an **idle** timer is not on the screen at all.

#### `start_session`

Starts or resumes a session's timer. The optional `session_id` names the
session to start; without it the command acts on whatever session is already
current.

* **Without `session_id`** the command acts on the current session and never
  changes which session is current: a paused session starts — from its paused
  position, which is its configured start value if it is paused at the
  beginning (freshly selected, navigated to, or reset) — a running session is a
  harmless no-op answered with `ack_response`, and with no current session
  there is nothing to start, so the command is rejected (`INVALID_COMMAND`,
  "No active session to start").
* **With `session_id` naming the current session** the command behaves exactly
  as the form without `session_id`: a paused session starts, and a running
  session is a no-op. Naming the current session never restarts it, whatever
  state it is in.
* **With `session_id` naming a different session** — including when no session
  is current — that session is loaded as the current session and started from
  its configured value. A session that is not current keeps no paused
  position — the display does not store a per-session
  elapsed value — so this is a fresh start, not a resume of a held position.
  The session that was current before is no longer the current session.
* `session_id` must already exist in the program. An unknown id is rejected
  with an `error_response` with code `INVALID_SESSION` (`"Session not found
  in program"`) and nothing on the display changes.

A successful `start_session` that names a different session triggers the same
broadcasts as `show_session` followed by `start_session`: `program_changed_event`,
`view_status_event`, `control_center_status_event` and `sessions_status_event`,
with no duplicates — and no `messages_status_event`, because nothing in the
switch touches message data. The form without `session_id`
triggers only the timer-change broadcasts (`view_status_event` /
`control_center_status_event`), because it does not change which session is
current.

```json
{ "type": "start_session", "session_id": null, "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `session_id` | string | no | — |
| `request_id` | string | no | Optional correlation identifier |

#### `pause_session`

Pauses the current session's timer.

Returns an `error_response` with code `INVALID_COMMAND` in these cases:

* **Time of Day** session — a time of day cannot be paused, and a frozen wall
  clock on stage looks like a working clock. The ToD session keeps running.
  Checked before the timer state, so a *current* ToD session reports this
  rejection whatever its timer state.
* **No current session** — the timer is idle and there is no clock to pause.

`pause_session` still works for a running countdown / count-up session, and
pausing an already-paused session remains an accepted no-op.

```json
{ "type": "pause_session", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `add_session`

Creates a **NEW** program session (create-only). Appends the session at
the **end** of the program, regardless of which session (if any) is
currently selected — the order of `add_session` calls is preserved in
`program_changed_event` / `sessions_status_event`, matching the mobile app.
`session_id` is optional — when omitted one is generated; when supplied it
must not already exist (else `INVALID_PARAMETER`; use `update_session`). Does
**not** make the session current and does **not** touch the timer —
unconditionally, including when the program has no current session at
all: a newly added session is never auto-selected. Follow with
`show_session` to display it.

**`seconds` vs `offset`:** for a **countdown** session `seconds` is the
duration and is required, and it must be **at least 1 second** — a countdown
counts down a length of time, so `0` has no meaning and is rejected with
`INVALID_PARAMETER`. For a **count-up** session `seconds` is the target
duration and is **optional** — a count-up created without it starts from zero
and counts up (the duration is optional for count-up; a count-up target of `0`
is accepted). For both modes `offset`
is **ignored**. For a **time_of_day** session the desired
start time is carried by `offset` — an integer count of **milliseconds past
midnight** — and `seconds` is **unused** unless `offset` is omitted, in which
case `seconds` (seconds past midnight) is accepted as a backwards-compatible
fallback for controllers that predate `offset`. A `time_of_day` session that
provides neither field is rejected with `INVALID_PARAMETER`. The device stores
time_of_day start times rounded to the nearest second — the same resolution as
the legacy `seconds` representation — so an echoed `offset` is always a whole
number of seconds. The start time must be a real time of day: `offset` is
accepted only in `0`–`86399999` (`00:00:00`–`23:59:59`) and the `seconds`
fallback only in `0`–`86399`; a value outside that range has no meaning as a
time of day and is rejected with `INVALID_PARAMETER` naming the field (the
same rule is enforced inside a Program Session; see `send_program` below).

**The ack carries the new id in `entity_id`.** Whether `session_id` was supplied
or generated, `add_session` answers with an `ack_response` whose `entity_id` is
the new session's id — use it directly. (The `sessions` section of status and the
`sessions_status_event` carry it too, if you prefer to read it from there.)

```json
{
  "type": "add_session",
  "mode": "countdown",
  "seconds": null,
  "notes": null,
  "offset": null,
  "flash_start_time_seconds": null,
  "flash_length_seconds": null,
  "name": null,
  "session_id": null,
  "presenter_name": null,
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `mode` | string | no | — |
| `seconds` | int | no | — |
| `notes` | string | no | — |
| `offset` | int | no | — |
| `flash_start_time_seconds` | int | no | — |
| `flash_length_seconds` | int | no | — |
| `name` | string | no | — |
| `session_id` | string | no | — |
| `presenter_name` | string | no | — |
| `request_id` | string | no | Optional correlation identifier |

#### `update_session`

Edits an existing program session (update-only). `session_id` is
required and must already exist (else `INVALID_SESSION`; use
`add_session`). Omitted fields are preserved from the existing
session. Never changes the current-session pointer.

**Takes effect immediately on a non-running current session.** When
the updated session is the **current session** and it is **not
running**, the display re-arms the session with the new values right
away — no session switch and no explicit `reset_current_session` are
needed. The state broadcast after the command reports the new values,
and a following `start_session` runs the session with those values.
This matches the mobile app, which resets an edited session
automatically.

* A non-running current session is **paused** (a current session is always
  running or paused), so the command is **accepted**
  and the session is re-armed, which discards the position it was
  paused at. The ack_response message states this explicitly — `"Session
  updated (paused session was reset to the new value)"` — so the
  integrator can surface it to the operator (the mobile app asks the
  operator to confirm in a dialog; the API has no dialog, so the ack_response
  message is the explicit notice).
* A **running** session cannot be edited: the request is **rejected** with
  `INVALID_COMMAND` and a message naming the required action — `"Cannot update
  a running session; pause or reset it first"`. Accepting the edit would
  change the stored data while the live timer keeps counting the old value,
  so the program payload and the screen would disagree until the session is
  re-armed (the mobile app blocks editing running sessions entirely, and the
  API enforces the same rule). Pause or reset the session first, then edit it.
* A session that is **not** the current session is not armed, so the edit is
  content-only: the new values apply when that session is shown.
* An update that changes no field value (a no-op) does not re-arm either.

**`seconds` vs `offset`:** the same rule as `add_session` applies — a countdown
edit must leave the session with **at least 1 second**, for a count-up `seconds`
is the optional target (`0` is accepted), and for a
**time_of_day** session the desired start time is carried by `offset`
(milliseconds past midnight) and `seconds` is **unused** except as the legacy
fallback when `offset` is omitted; `offset` is ignored for countdown /
count-up sessions. Switching a session to `time_of_day` with neither value is
rejected with `INVALID_PARAMETER` (`offset is required when switching a session
to time_of_day mode`); a session that is already `time_of_day` keeps its start
time when `offset` and `mode` are both omitted. The `00:00:00`–`23:59:59`
range is enforced here exactly as in `add_session`, and against the
**resulting** session: an update that would leave an impossible start time
stored (for example on a session written by an older build) is rejected rather
than accepted unchanged.

```json
{
  "type": "update_session",
  "mode": null,
  "seconds": null,
  "notes": null,
  "offset": null,
  "flash_start_time_seconds": null,
  "flash_length_seconds": null,
  "name": null,
  "session_id": "example",
  "presenter_name": null,
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `mode` | string | no | — |
| `seconds` | int | no | — |
| `notes` | string | no | — |
| `offset` | int | no | — |
| `flash_start_time_seconds` | int | no | — |
| `flash_length_seconds` | int | no | — |
| `name` | string | no | — |
| `session_id` | string | yes | Required |
| `presenter_name` | string | no | — |
| `request_id` | string | no | Optional correlation identifier |

#### `show_session`

Selects an existing program session by ID and displays it (navigate-by-ID).
`session_id` is required and must already exist (else `INVALID_SESSION`).

Selection only: `show_session` changes which session is current and never
changes the timer's run state. Switching to another session displays it
**paused** for a `countdown` / `countup` session, or **running** for a
**`time_of_day`** session (a wall clock cannot be paused). Naming the session
that is already current changes nothing — a running timer keeps running — so
the command is safe to repeat. Use `start_session` to start or resume a
session and `pause_session` to hold one.

**`session_state` was removed in 1.1.2.21 (build 143).** Sending it with any
value is rejected with `INVALID_PARAMETER` —
`"session_state is no longer supported - use start_session or pause_session"` —
before any state change, rather than being silently ignored. The one-shot
configure-and-start flow is now `show_session` followed by `start_session`, or
a single `start_session` carrying the `session_id`.

```json
{ "type": "show_session", "session_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `session_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `add_time`

```json
{
  "type": "add_time",
  "seconds": null,
  "ms": 0,
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `seconds` | int | no | — |
| `ms` | int | no | — |
| `request_id` | string | no | Optional correlation identifier |

Returns an `INVALID_COMMAND` error if there is no current session (the timer is
`idle`): `add_time` mutates the clock, and an idle timer has no current
session and no clock to mutate. When the session is running or paused, `add_time`
increases the remaining time; a **negative** amount subtracts instead, so
`add_time` and `subtract_time` are inverses. Any signed amount is accepted
(`0` is a no-op). A **time_of_day** session is a
wall clock rather than a countdown/count-up, so `add_time` is also rejected for
a current ToD session: it returns `INVALID_COMMAND` ("Cannot add time to
a Time of Day session").

The amount is carried in **`ms`** — whole milliseconds, so sub-second
adjustments are expressible. The older **`seconds`** field is **deprecated**: it
is still accepted for clients that have not migrated, but it is whole seconds
only and is **ignored outright whenever `ms` is nonzero** — the two are
alternatives, never a sum, so `{"ms": 1500, "seconds": 60}` adds 1.5 s, not
61.5 s. Send `ms`. A fractional amount in either field is rejected with
`INVALID_PARAMETER` rather than silently truncated.

#### `subtract_time`

```json
{
  "type": "subtract_time",
  "seconds": null,
  "ms": 0,
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `seconds` | int | no | — |
| `ms` | int | no | — |
| `request_id` | string | no | Optional correlation identifier |

Returns an `INVALID_COMMAND` error if there is no current session (the timer is
`idle`): `subtract_time` mutates the
clock, and an idle timer has no current session and no clock to mutate. When
the session is running
or paused, `subtract_time` decreases the remaining time; a **negative**
amount adds instead, so `subtract_time` and `add_time` are inverses. Any
signed amount is accepted (`0` is a no-op). The amount is carried in **`ms`**,
with the deprecated **`seconds`** accepted as a fallback on the same terms as
`add_time` (`ms` wins when nonzero). A running or paused
**countdown** may be driven below zero (overtime) — the clock goes negative,
while the reading reported as `timer` stays positive (§4.4). A **count-up** has
no overrun state, so its clock floors at `00:00`: moving it past zero (by
`subtract_time`
or by a negative `add_time` amount) is still accepted,
but leaves the `timer` reading at `00:00` and further movements
leave it there. A **time_of_day** session is a wall clock rather than
a countdown/count-up, so `subtract_time` is also rejected for
a current ToD session: it returns `INVALID_COMMAND` ("Cannot subtract time from a Time
of Day session").

#### `reset_current_session`

**Returns the current session to its configured starting value.** The session
stays the current session and stays on the screen, but it is re-armed and left
**paused** at its configured value: a running session is stopped, and any
position it had reached (including a paused one) is discarded. Its
`elapsed_time` starts again from zero and its stored `started_at_timestamp` is
cleared, so `start_time` reads as never started. The stored program is unchanged;
the display's own state is not, so the command also pushes a
`program_changed_event` for controllers that keep their own program copy.

Rejected with `INVALID_COMMAND` when there is **no current session** (the timer
is `idle` — "No current session to reset") and when the current session is a
**`time_of_day`** session ("Cannot reset a Time of Day session"), because a wall
clock has no start position to return to. Use `pause_session` / `start_session`
for a ToD clock.

```json
{ "type": "reset_current_session", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `reset_program_elapsed_timer`

**Sets `program_elapsed_time` back to zero.** The counter starts counting from
zero again immediately if a session timer is running, and otherwise stays at zero
until a session is next started. The current session's stored
`started_at_timestamp` is cleared at the same time. Nothing else moves: the
program, the sessions, the timer's own `timer` value and the run state are all
untouched — this is not a reset of the session clock. Never rejected.

```json
{ "type": "reset_program_elapsed_timer", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

### 3.2 Display Control

#### `show_message`
Displays a message, addressed either by a stored program message id or by
text.
```json
{
  "type": "show_message",
  "message_id": null,
  "text": "example",
  "request_id": null,
  "flash": false
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message_id` | string | no | — |
| `text` | string | no | — |
| `request_id` | string | no | Optional correlation identifier |
| `flash` | boolean | no | — |

Provide **either** `message_id` **or** `text`:

* If `message_id` is non‑empty it takes precedence and `text` is ignored.
* If `message_id` is supplied but is not a stored message in the loaded program,
  the command is rejected with `INVALID_PARAMETER` — **even when `text` was also
  supplied**. It does not fall back to the text, because that would put
  different content on screen with no error for anyone to notice.
* If neither is supplied (or both are empty), the command is rejected with
  `INVALID_PARAMETER`.
* If `text` matches no stored message in the loaded program, the display stores
  it as a new message and then shows that one. `is_showing` is reported per
  message id ([§4.8](#48-messages_status_response)), so a message on screen has
  to exist in the program to be named by the screen. Storing it changes the
  message list, so that one `show_message` also announces
  `program_changed_event`.

**The two forms differ in whether they change the program.**

`message_id` is a **read‑only lookup** of an existing stored program message; it
displays that message's current content and **does not create or modify** any
message. (Use `add_message` / `update_message` to create or change stored
messages; only ad-hoc `text` above is stored automatically.)

`text` **reuses** a stored message when the content matches, and otherwise
**creates** one:

* If the loaded program already holds a message with that content (compared
  **after trimming**), that message is shown and nothing is added.
* If no message matches, a **new message is created** in the loaded program — a
  generated unique id and version, exactly as `add_message` produces — and then
  displayed. The message therefore appears in `program_response` and in
  `messages_status_response` from then on, and the change is announced like any
  other message edit (a `messages_status_event`, plus a `program_changed_event`).

So a controller that shows transient text accumulates messages: prefer
`message_id` for content the program already holds. `hide_message` takes a
displayed message off screen but does **not** remove it from the program — use
`delete_message` for that. The `ack_response` carries the id of the message that
ended up on screen in `entity_id` — the message named by `message_id`, or the
stored message reused/created for `text`. (It is in the `messages` section of
status and in `messages_status_event` too.)

Because the `text` form may have to create a message, and the `message_id` form
looks one up in the loaded program, **`show_message` requires a loaded program**
and is rejected with `INVALID_COMMAND` when there is none — the same rule
`add_message`, `delete_message` and `update_message` follow. (A request carrying
neither `message_id` nor `text` is `INVALID_PARAMETER` instead, checked first: a
malformed request is a caller bug whatever the device state.) Supplying
`message_id` as well does not let the text form skip the requirement — the
`message_id` wins, `text` is discarded, and nothing is created. A `show_message`
that creates a message is a program change, so it is announced like one — the
same `messages_status_event` a reuse or a by-id show pushes, plus a
`program_changed_event`.

**`flash`:** `true` turns the 1 Hz message flash on as the message is displayed.
Omitting it (or sending `false`) leaves the flash state exactly as it is — it does
**not** turn flashing off, because the flag is shared with `set_flash` /
`toggle_flash` and may be on deliberately. It is reported as `is_flashing` in the
`messages` section (§4.8) and in the `view` section (§4.5), and `hide_message`
turns it off.

This transitions the display into message mode; the message persists on screen
until replaced by another display command (e.g. `hide_message`, `show_idle`, or a
new `show_message`).

#### `hide_message`

**Takes the message off screen without touching the program.** The message stays
in `message_list` and can be shown again with `show_message`; only
`delete_message` removes it. What is revealed is whatever was underneath: the
timer if it is running or paused, otherwise the idle screen — an idle timer is
never shown. Any active message flash is stopped as the message is hidden.
Never rejected: hiding a display that is showing no message is an accepted no-op.

```json
{ "type": "hide_message", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `show_idle`

Puts the screen into its idle state, clears the current session and resets
`program_elapsed_time` to zero: the timer is idle, `current_session_id`
becomes empty, `current_session_index` becomes `-1`, and no session reports
`is_current`. The loaded
program, its sessions and its messages
are preserved, and no session's stored values (duration, offset, flash
settings) change, so any session can be selected again with `show_session` and
runs from its configured values. Until one is, `start_session` is rejected with
`INVALID_COMMAND` ("No active session to start"). Because an idle screen must
never mask an active session, a session timer is never left running after
`show_idle`.

```json
{ "type": "show_idle", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `set_blackout`

Takes a required `action` field: "enable" or "disable".

```json
{ "type": "set_blackout", "action": "enable", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `action` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**Mutual exclusion with glow:** blackout and glow are mutually exclusive (matching the
mobile UI). Enabling blackout automatically disables glow, and vice versa, so the
display never reports both effects active at once.

### 3.3 Visual Effects

#### `set_glow`

Turns the on-screen glow effect on or off with the required `enabled` field.

**Mutual exclusion with blackout:** enabling glow disables blackout, and enabling
blackout disables glow (§3.2), so the display never reports both effects active at
once; disabling either does not restore the other. The state is reported as
`is_glowing` in the control-center and view sections, and survives a change of
what is on screen. Never rejected.

```json
{ "type": "set_glow", "request_id": null, "enabled": false }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |
| `enabled` | boolean | yes | Required |

#### `set_flash`

Takes a required `action` field: "enable", "disable", or "toggle". This drives
the **1 Hz message flash** — the flag `show_message`'s `flash` field sets (§3.2)
and `hide_message` clears, reported as `is_flashing` in the messages (§4.8) and
view (§4.5) sections.

**`start_time_seconds` was removed in 1.1.2.23 (build 145).** The field never
configured anything, so sending it is rejected with `INVALID_PARAMETER` —
`"start_time_seconds is no longer supported - configure flash timing with add_session or update_session"` —
rather than being silently ignored. Configure automatic flash timing on the
session with `add_session` / `update_session` (`flash_start_time_seconds` /
`flash_length_seconds`).

**`action: "toggle"` does not report the resulting state.** `set_flash`
answers with an `ack_response` that carries no new flag, so a caller that needs
to be certain of the outcome should send an explicit `enable` / `disable` and
read `is_flashing` when it must know. Never rejected once `action` is valid.

```json
{ "type": "set_flash", "action": "enable", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `action` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `toggle_glow`

Flips the glow effect without the caller having to know its current state.
Enabling it this way disables blackout, exactly as `set_glow` does. The reply is
an `ack_response` that does **not** report the resulting state — read `is_glowing`
from the control-center or view section (§4.4, §4.5), or use `set_glow` when the
caller must be certain. Never rejected.

```json
{ "type": "toggle_glow", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `toggle_flash`

Flips the flash effect — the same thing as `set_flash` with
`action: "toggle"`. The reply is an `ack_response` that does **not** report the
resulting state: read `is_flashing` (§4.5, §4.8), or use `set_flash` with an
explicit action when the caller must be certain. Never rejected.

```json
{ "type": "toggle_flash", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

### 3.4 Configuration

#### `set_brightness`

```json
{ "type": "set_brightness", "brightness": 0, "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `brightness` | int | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

`brightness` is a **whole number in `0`–`100`** (0 is backlight off or black,
depending on the display; 100 is the hardware maximum). A value outside that
range, or a fractional value such as `50.5`, is rejected with
`INVALID_PARAMETER` — the value cannot be stored as sent, so it is an error
rather than a rounded number.

#### `set_is_time_up_display`

Turns the "time is up" overlay on or off with the required `enabled` field. The
setting is **persisted** across restarts. With it off, a countdown that reaches
zero does not show the overlay; the clock's own behavior is unchanged. It is
reported as `is_time_up_display` in the settings section (§4.6), and it is one of
the inputs to `is_time_up_flashing` in the control-center and view sections
(§4.4, §4.5), which is what actually reports whether the overlay is showing right
now. Never rejected.

```json
{ "type": "set_is_time_up_display", "request_id": null, "enabled": false }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |
| `enabled` | boolean | yes | Required |

#### `toggle_is_time_up_display`

Flips the same persisted setting without the caller having to know its current
state. The reply is an `ack_response` that does **not** report the resulting
state — read `is_time_up_display` from the settings section (§4.6), or use
`set_is_time_up_display` when the caller must be certain. Never rejected.

```json
{ "type": "toggle_is_time_up_display", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

### 3.5 Status Requests

#### `request_status`

Requests the combined device status. `detailed` defaults to `true`, so the
`sessions` and `messages` sections are included unless it is explicitly set to
`false`.

```json
{ "type": "request_status", "detailed": false, "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `detailed` | boolean | no | — |
| `request_id` | string | no | Optional correlation identifier |

#### `request_control_center_status`

```json
{ "type": "request_control_center_status", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `request_view_status`

```json
{ "type": "request_view_status", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `request_settings_status`

```json
{ "type": "request_settings_status", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `request_sessions_status`

```json
{ "type": "request_sessions_status", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `request_messages_status`

```json
{ "type": "request_messages_status", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

### 3.6 Program Management

> **UUID-like identifiers:** All `program_id`, `session.id`, `message.id`,
> and `version` fields are UUID or UUID-like strings. A string "looks like
> a UUID" if it (1) contains 2 or more groups of alphanumeric characters
> (0–9, a–z, A–Z) separated by hyphens, and (2) does not exceed 64
> characters. Standard UUIDs of any variant (v4, v7, etc.) always match.

#### `get_program`

```json
{ "type": "get_program", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `get_program_list`

```json
{ "type": "get_program_list", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

Returns the program **library** — the programs the display holds — as a list of
program summaries. The reply is `program_list_response`.

It is a **read**: it changes no state and **broadcasts nothing**. There is
deliberately no `program_list_event`: the list is only ever a response to a
request, and a change to it arrives as a `program_changed_event`, which carries
the full program and therefore any change to the list.

The display holds **at most one program at a time** — the loaded one — so
`program_list` is either **empty** (nothing loaded) or a **single entry** naming
the loaded program. `program_id` therefore always matches `get_program`'s
`program_id`, and `name` matches its `program_name`. Persisting a real
multi-program library is planned; when it lands, the list can hold more entries
but its shape does not change.

> **Field naming:** the summary's name field is `name`, not `program_name` —
the entry is already a program object, so the `program` prefix would be
redundant (the top-level `program_id` keeps it, to avoid reading as a bare
`id`). This matches the session summary, which likewise uses `name`. The program
object in `get_program` / `send_program` still spells it `program_name`.

#### `delete_program`

```json
{ "type": "delete_program", "program_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `program_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

Deletes a program from the display's library. The reply is an `ack_response`
(or an `error_response` on rejection).

`program_id` is required and must name a program the device holds — the library
[`get_program_list`](#get_program_list) reports. There is no "delete the loaded
program" shorthand and no "delete everything".

| Condition | Result |
|-----------|--------|
| `program_id` empty or absent | `error_response` `INVALID_PARAMETER` — `"program_id cannot be empty"` |
| `program_id` names no held program | `error_response` `INVALID_PARAMETER` — `"Program ID <id> not found"` |
| Target is the loaded program and a session timer is running | `error_response` `DEVICE_BUSY` — `"Cannot delete a program while a session is active. Please pause it first"` |

**Rejected while a session timer is running.** If the target is the loaded
program and its session timer is actively running
(`control_center.timer_run_state` is `running`), the reply is `DEVICE_BUSY` and
nothing changes. A session that is merely **paused** does not block the
deletion — the exception is tied to a **running** timer, exactly as in
`send_program`.

**On success the display is left with a new, empty program.** Deleting the
loaded program does not leave the display program-less: the program is removed
and a fresh **empty** one is created — a new `program_id`, no sessions, no
messages. This matches the fallback program a controller gets by sending
`add_session` to a clean display. Consequences:

* `get_program` reports `has_program: true` with the new empty program — not
  `has_program: false`.
* `get_program_list` then lists **that new program**, under its new id; the id
  just deleted is gone and cannot be deleted again.
* The deleted program's sessions and messages go with it, the current session is
  cleared, `program_elapsed_time` resets to zero, and no timer is left running.
* A `program_changed_event` (plus `sessions_status_event` and
  `messages_status_event`, since both lists are now empty) is pushed to every
  WebSocket client, carrying the new empty program. There is deliberately no
  `delete_program` event: the program-changed event already carries the
  resulting state in full.

Deleting a program that is *not* the loaded one is a library operation with no
effect on the screen. That case cannot arise while the display holds a single
program, but the rule is fixed now so a multi-program library needs no protocol
change.

#### `send_program`

Replaces the entire loaded program.

**The program object's required fields.** A program must carry `program_id`,
`program_name`, `version`, `settings` and `sessions`; a payload missing any of
them is rejected with `INVALID_PARAMETER` naming the nested path (for example
`Field 'program.settings' is required for type 'send_program'`) and the
previously loaded program is left untouched. `messages` is optional — omit it
and the program is stored with no messages — as are the individual fields
inside `settings`, which default to `0`. `user_id` is optional too. Inside a
`session` object only `name` is required, and inside a `message` object only
`content`; every other field has a default and can be omitted. The `program`
object's own fields, and the Session / Message / Settings objects inside it, are
specified in [§4.9](#49-program_response).

**Rejected while a session timer is running:** If a session timer is actively
running (`control_center.timer_run_state` is `running`) when `send_program`
arrives, the display
**rejects** the command with `DEVICE_BUSY` ("Cannot load a new program while a
session is active. Please pause it first") and leaves the running timer
completely uninterrupted. The only exception: re-sending the **same
`program_id`** with the currently running session still present in the incoming
program is allowed and does not disturb the running timer.

When the incoming program carries a `program_id` that is not the one loaded,
the display stores it and puts the display back into its **idle state** with
**no session selected** — the current screen content (timer, session, or
message) is cleared, and `program_elapsed_time` is reset to zero. The
controller explicitly starts a session (`show_session` / `start_session`) when
the show begins.

A `send_program` carrying the `program_id` that is **already loaded** does
**not** return the display to idle and does **not** reset
`program_elapsed_time`: the current session stays selected and displayed with
the `elapsed_time` it had, the timer keeps the value it was armed with, and
`program_elapsed_time` keeps counting from where it was. This is the frame a
controller sends to push an edit during a show — renaming a session, fixing a
duration, or deleting an unused session — without stopping the clock the
operator already started. What such a re-send **does** change is the stored
program content (sessions, messages, settings and `version`, including each
session's and each message's `version`); nothing on screen is re-derived from
it, so the current session keeps its position until it is re-armed by
`reset_current_session` or re-shown with `show_session`. The one
same-`program_id` case that returns the display to idle is an edit whose
incoming sessions no longer contain the current session: the display then has
no session to show, so it goes to **idle** with no session selected and resets
`program_elapsed_time` to zero.

**What an accepted `send_program` announces:** the program was stored, so the
command always pushes `program_changed_event`, `sessions_status_event` and
`messages_status_event` — including a byte-identical re-send with no edit at all
(the frame itself confirms the display holds the program the controller sent).
The `view_status_event` + `control_center_status_event` pair follows the screen
and the clock instead: it is pushed when the load clears the timer and returns
the display to idle, and it is **not** pushed for a same-`program_id` re-send
that preserves the show — the current session, its `elapsed_time` and
`program_elapsed_time` all stay as they were, so nothing changed to announce.

**`duration_seconds` vs `offset` in the session objects:** for countdown /
count-up sessions the duration travels in `duration_seconds` and `offset` is
absent. For a **time_of_day** session the desired start time travels in
`offset` (an integer count of **milliseconds past midnight**) and
`duration_seconds` is **unused** — it is still accepted as a legacy fallback
when `offset` is omitted, so a controller written before `offset` existed keeps
working. On output — `get_program` responses and `program_changed_event` — the
device emits `offset` for `time_of_day` sessions and **omits**
`duration_seconds` for them, so a client should read `offset` for
`time_of_day` and `duration_seconds` for countdown / count-up. A `time_of_day`
start time must be a real time of day (`00:00:00`–`23:59:59`); a program
containing a session outside that range is rejected with `INVALID_PARAMETER`
and the previously loaded program is left untouched. `countdown` / `countup`
durations are not bounded — a countdown may run for more than 24 hours.

**Every whole-number field in the payload is enforced as one.** A fractional
`duration_seconds`, `offset`, or flash value — in a session object or in
`settings` — is rejected with `INVALID_PARAMETER` naming the path
(`program.sessions[2].duration_seconds`, `program.settings.flash_length_seconds`)
rather than being truncated, and the previously loaded program is left
untouched. These are the same whole-second quantities the session commands
carry; configure them per session instead of by editing a program where you can.

**Nothing in a payload may be negative.** A negative `duration_seconds`, `offset`,
`flash_start_time_seconds` or `flash_length_seconds` — in a session object or in
`settings` — is rejected with `INVALID_PARAMETER`, and the previously loaded
program is left untouched. A negative `offset` is never quietly treated as
midnight, and a negative `flash_length_seconds` is never accepted merely because
the flash-window arithmetic happens to allow it. On this transport the rejection
names the wire field it received (for a time_of_day `offset`, that is
`program.sessions[i].offset`); the session-level commands name the same values
by their session.

**A countdown needs at least 1 second.** A `countdown` session whose
`duration_seconds` is `0` (or less) is rejected with `INVALID_PARAMETER` naming
the session and the value — the same floor `add_session` / `update_session`
enforce, and the one Crestron has always documented. A `countup`
`duration_seconds` of `0` is accepted (its duration is an optional target), and a
`time_of_day` value of `0` is accepted (there the field is a start time, and `0`
is midnight).

```json
{
  "type": "send_program",
  "program": {
    "settings": {
      "flash_start_time_seconds": 0,
      "flash_length_seconds": 0
    },
    "sessions": [],
    "user_id": null,
    "program_id": "example",
    "program_name": "example",
    "messages": [],
    "version": ""
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `program` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `navigate_next_session`

Navigates to the next session in the program. Rejected with `INVALID_COMMAND`
when there is **no current session** — there is nothing to move from, and there
is no fallback to the first session; select one with `show_session` instead. Also
rejected with no program loaded, an empty program, or when the current session is
already the last.

```json
{ "type": "navigate_next_session", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

#### `navigate_previous_session`

Navigates to the previous session in the program. Rejected with `INVALID_COMMAND`
under the same conditions as `navigate_next_session` — including **no current
session**, for the same reason — plus when the current session is already the
first. Neither command ever selects a session on its own when none is current.

```json
{ "type": "navigate_previous_session", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

A successfully reached session is selected and displayed **`PAUSED`**
(countdown/count-up) until it is started — except a **`time_of_day`** session,
which **runs immediately**, so a clock is live as soon as it is reached and
`control_center.timer_run_state` is `running` for it. A `time_of_day` session
has no held state: `pause_session` is rejected for a current one in every timer
state.

**The reply does not name the session that became current.** It is an
`ack_response`, and `entity_id` is not filled for the navigation commands yet.
Read the new session from the `sessions_status_event` (the entry with
`is_current: true`), from `view.session_id` / `control_center.current_session_id`,
or from `sessions_status_response` / `request_status` after the fact. Navigation is
by position, so the resulting id is not something the caller can know in advance —
and the program may not be the one it last read.

**`is_current` in the session summary:** the session summary in
`sessions_status_response` / `sessions_status_event` carries `is_current`
(true for the current session, whether running or paused). It replaces the old
`is_playing` name, which this protocol no longer emits. The Program Session
object (in `get_program`, `program_response` and `program_changed_event`) does
**not** carry `is_current` (or its retired `is_playing` name): it is program
content only. `send_program` still accepts either name on a session for
backward compatibility, but ignores it — the display derives the current
session from its own current-session pointer.

### 3.7 Message Management

#### `add_message`

```json
{ "type": "add_message", "request_id": null, "content": "" }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |
| `content` | string | yes | Required |

**The ack carries the new id in `entity_id`.** `add_message` answers with an
`ack_response` whose `entity_id` is the new message's id — use it directly.
(The `messages` section of status and the `messages_status_event` carry it too,
if you prefer to read it from there.)

#### `update_message`

```json
{
  "type": "update_message",
  "message_id": "example",
  "request_id": null,
  "content": ""
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |
| `content` | string | yes | Required |

Returns an `error_response` `INVALID_COMMAND` when no program is loaded, and
`INVALID_PARAMETER` when `message_id` names no message in the loaded program
(`"Message ID <id> not found in program"`). A missing or empty `message_id` or
`content` is `INVALID_PARAMETER` as well.

#### `delete_message`

Deletes a message by its ID.

If the message is currently displayed, this command returns a `DEVICE_BUSY`
error. A message that is not currently displayed may be deleted.

Returns an `error_response` `INVALID_COMMAND` when no program is loaded, and
`INVALID_PARAMETER` when `message_id` names no message in the loaded program
(`"Message ID <id> not found in program"`). A missing or empty `message_id` is
`INVALID_PARAMETER` as well.

```json
{ "type": "delete_message", "message_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `move_message_up`

Moves the message one position earlier in the program's message list (a swap
with its neighbour), and `move_message_down` one position later.

Returns an `error_response` `INVALID_COMMAND` when no program is loaded —
there is no message list to reorder — and `INVALID_PARAMETER` when
`message_id` names no message in the loaded program or the message is already
first (up) / already last (down). A missing or empty `message_id` is
`INVALID_PARAMETER` as well.

```json
{ "type": "move_message_up", "message_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `move_message_down`

Same rejections as `move_message_up`, with "already last" in place of "already
first".

```json
{ "type": "move_message_down", "message_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `delete_all_messages`

Deletes all messages from the program.

If any message is currently active (being displayed), this command returns a
`DEVICE_BUSY` error. If no messages are displayed, all messages are removed.

```json
{ "type": "delete_all_messages", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

### 3.8 Session Management

#### `move_session_up`

Moves the session one position earlier in the program order (a swap with its
neighbour). Returns an `error_response` with code `INVALID_SESSION` if no program
is loaded, `session_id` is not found in the program, or the session is already
first. An empty `session_id` is `INVALID_PARAMETER`.

```json
{ "type": "move_session_up", "session_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `session_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `move_session_down`

Moves the session one position later in the program order (a swap with its
neighbour). Returns an `error_response` with code `INVALID_SESSION` if no program
is loaded, `session_id` is not found in the program, or the session is already
last. An empty `session_id` is `INVALID_PARAMETER`.

```json
{ "type": "move_session_down", "session_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `session_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `delete_session`

Deletes a single session from the program by its session ID. Messages are preserved.

A session that is **currently active** (its timer is `RUNNING`) must **not** be
deleted; attempting to do so returns a `DEVICE_BUSY` error.

If the session is the current session but the timer is `PAUSED` or `IDLE`,
the timer is fully cleared (the display returns to IDLE with no active
session), the current session reference is cleared, and the session is
deleted.

Returns an `error_response` with code `INVALID_SESSION` if no program is loaded
or `session_id` is not found in the program; an empty `session_id` is
`INVALID_PARAMETER`.

```json
{ "type": "delete_session", "session_id": "example", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `session_id` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

#### `delete_all_sessions`

Deletes all sessions from the program. Messages are preserved.

If any session's timer is **currently active** (`RUNNING`), this command returns
a `DEVICE_BUSY` error — the program may not be cleared while active.

If no sessions are active (timer is `IDLE` or `PAUSED`), all sessions are removed
and the timer is fully cleared (the display returns to IDLE with no active
session).

```json
{ "type": "delete_all_sessions", "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `request_id` | string | no | Optional correlation identifier |

---

## 4. Responses (Server → Client, both transports)

Sent in response to any command. Every response `type` ends in `_response`:
`ack_response`/`error_response` are the generic results for mutating commands; `*_response`
replies answer the matching `request_*`/`get_*`/status command. Replies echo
the command's `request_id` when one was sent; pushed `*_event` frames never
do.

### 4.1 `ack_response`

```json
{
  "type": "ack_response",
  "message": "",
  "entity_id": null,
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `message` | string | yes | Required |
| `entity_id` | string | no | — |
| `request_id` | string | no | Optional correlation identifier |

`entity_id` is present when the command created or resolved a stored entity —
currently `add_session` (the new session's id, supplied or generated),
`add_message` (the new message's id) and `show_message` (the id of the message
shown, whether it was named by `message_id` or reused/created from `text`).
Every other mutating command omits it. Treat `entity_id` as **optional on any
`ack_response`**: which commands fill it may grow, so read it when it is there
and fall back to a status command (`request_status`, `get_program`) or the
matching status event when it is not. Two commands that *do* resolve an id still
leave the field empty: `navigate_next_session` / `navigate_previous_session`
(§3.6) and `delete_program`, whose replacement program has a new `program_id`
the caller cannot know — read those from the status sections or their events
after the command.

### 4.2 `error_response`

```json
{
  "type": "error_response",
  "code": "",
  "message": "",
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `code` | string | yes | Required |
| `message` | string | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

An `error_response` reports a command that **did not run**. Rejection is
**side-effect free**: no part of the command is applied — timer value and
state, the current session, program contents, screen mode, and visual effects
(blackout, glow, flash, brightness) are all left exactly as they were, and no
`*_event` is broadcast because of the attempt. A command therefore either
succeeds in full (`ack_response` plus any events) or fails with
`error_response` and changes nothing; it is never partially applied. This
holds on both transports and for every rejection code below.

**Error codes:**

| Code                 | Description                             |
|----------------------|-----------------------------------------|
| `INVALID_COMMAND`    | Message has no `type`, an unknown type, or is not a valid command. Also used for a command that needs a loaded program when none is: `add_message`, `update_message`, `delete_message`, `show_message`, and `move_message_up` / `move_message_down`. |
| `PARSE_ERROR`        | The request body or WebSocket text frame is not JSON at all, so no message could be read. Distinct from `INVALID_COMMAND`, which describes a well-formed message. |
| `INVALID_PARAMETER`  | Missing or invalid field or value: a missing required field, an out-of-range `brightness` (`0`–`100`), a fractional or negative value in a whole-number field, a `countdown` duration below 1 second, a `time_of_day` `offset` outside `00:00:00`–`23:59:59`, a duplicated session or message id, a countdown session whose flash window cannot fire, or a `message_id` that is not in the loaded program. |
| `UNKNOWN`            | Internal error processing the command   |
| `INVALID_SESSION`    | A session-scoped command named a `session_id` that is not in the loaded program (or no program is loaded). Used by `start_session`, `update_session`, `show_session`, `move_session_up` / `move_session_down` and `delete_session`. A missing, empty or malformed `session_id` is `INVALID_PARAMETER` instead. |
| `DEVICE_BUSY`        | The operation cannot be performed because the target resource is currently active (e.g., deleting a session whose timer is running, deleting a message that is displayed, or `delete_program` on the loaded program while a session timer is running). |
| `HARDWARE_ERROR`     | Hardware subsystem failure — the write did not take effect (e.g. `set_brightness` could not change the screen brightness). |
| `INTERNAL_ERROR`     | Internal error — the command produced a result shape the handler does not recognize. Should not occur; report it if it does. |

### 4.3 `status_response`

Combined device status: the reply to `request_status` on both transports.
Includes the `control_center`,
`view`, and `settings` sections; `sessions`/`messages` are included when the
request asked for a detailed status.

```json
{
  "type": "status_response",
  "settings": {
    "brightness": 0,
    "is_time_up_display": false,
    "default_flash_length": 0.0,
    "default_flash_start_time": 0.0,
    "view_only_code": null,
    "screen_version": ""
  },
  "view": {
    "is_time_up_flashing": false,
    "session_name": "example",
    "message_text": "",
    "is_flashing": false,
    "elapsed_time": 0.0,
    "session_id": "example",
    "message_id": null,
    "presenter_name": "example",
    "progress_bar": 0.0,
    "is_glowing": false,
    "program_elapsed_time": 0.0
  },
  "sessions": {
    "session_list": []
  },
  "messages": {
    "message_list": [],
    "is_flashing": false
  },
  "control_center": {
    "flash_start_time": 0.0,
    "is_next_session": false,
    "current_presenter_name": "example",
    "current_session_name": "example",
    "current_session_id": "example",
    "current_session_index": 0,
    "is_blackout": false,
    "program_time": 0.0,
    "is_glowing": false,
    "timer_run_state": "idle",
    "is_time_up_flashing": false,
    "timer": 0.0,
    "is_previous_session": false,
    "elapsed_time": 0.0,
    "flash_length": 0.0,
    "program_elapsed_time": 0.0
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `settings` | object | no | — |
| `view` | object | no | — |
| `sessions` | object | no | — |
| `messages` | object | no | — |
| `control_center` | object | no | — |
| `request_id` | string | no | Optional correlation identifier |

### 4.4 `control_center_status_response`

Reply to `request_control_center_status`.

**`timer_run_state` replaced `is_playing`:** `control_center.timer_run_state`
reports the run state of the timer engine itself (`idle`, `running`, or
`paused`). It is a property of the timer module: `idle` means there is no
current session (`current_session_id` empty), while `running` and `paused` both
have one. The former `is_playing` field was true only while `running` and was
false for both `paused` and `idle`, so it could not tell a paused timer
(still on screen, frozen at its value) from an idle timer (taken off the
screen). Use `timer_run_state` for that distinction; `is_playing` is **no
longer emitted** by this protocol and was exactly `timer_run_state == running`
while it existed. The field is deliberately named `timer_run_state` — `timer_`
because it describes the timer engine rather than the loaded session, and
`_run_state` to avoid reviving `timer_state`, the name retired when
`setup_timer` became `session_state`.

**Not the session-level field.** `control_center.timer_run_state` describes the
timer engine only. The field that marks the *current session* is the session
summary's `is_current` (see §4.7); a paused current session has `is_current`
true and `timer_run_state` `paused`, and both are correct.

**`timer` is the unsigned on-screen reading.** It carries, in milliseconds,
the value shown on the display. The sign is stripped (`abs()`), so a countdown
30 s past zero reports `30000`, **not** `-30000`; `0` means the countdown
reached zero. This protocol exposes no signed timer field. To detect overtime,
read `timer` together with `is_time_up_flashing`; do not expect a negative
`timer`. `elapsed_time` is the session's **running time**, not an overrun
indicator — it is independent of `add_time` / `subtract_time`, so it does not
tell you how far past zero the clock is.

```json
{
  "type": "control_center_status_response",
  "control_center": {
    "flash_start_time": 0.0,
    "is_next_session": false,
    "current_presenter_name": "example",
    "current_session_name": "example",
    "current_session_id": "example",
    "current_session_index": 0,
    "is_blackout": false,
    "program_time": 0.0,
    "is_glowing": false,
    "timer_run_state": "idle",
    "is_time_up_flashing": false,
    "timer": 0.0,
    "is_previous_session": false,
    "elapsed_time": 0.0,
    "flash_length": 0.0,
    "program_elapsed_time": 0.0
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `control_center` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**The `control_center` object.** Every field is present in every reply.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `flash_start_time` | float | yes | Required |
| `is_next_session` | boolean | yes | Required |
| `current_presenter_name` | string | yes | Required |
| `current_session_name` | string | yes | Required |
| `current_session_id` | string | yes | Required |
| `current_session_index` | int | yes | Required |
| `is_blackout` | boolean | yes | Required |
| `program_time` | float | yes | Required |
| `is_glowing` | boolean | yes | Required |
| `timer_run_state` | string | yes | Required |
| `is_time_up_flashing` | boolean | yes | Required |
| `timer` | float | yes | Required |
| `is_previous_session` | boolean | yes | Required |
| `elapsed_time` | float | yes | Required |
| `flash_length` | float | yes | Required |
| `program_elapsed_time` | float | yes | Required |

Units and values:

* `timer`, `elapsed_time`, `program_time`, `program_elapsed_time`,
  `flash_start_time` and `flash_length` are **milliseconds**, and are the only
  fields here that are.
* `timer_run_state` is one of `idle`, `running`, `paused`.
* `current_session_index` is `-1` and `current_session_id` /
  `current_session_name` / `current_presenter_name` are empty strings when no
  session is current (the timer is `idle`); `is_previous_session` and
  `is_next_session` say whether navigation is available.
* `elapsed_time` is the current session's **running time**: wall-clock time
  accumulated while the timer runs, in milliseconds. It is frozen while paused
  and is **not** moved by `add_time` / `subtract_time`, so `timer` is not
  `session duration − elapsed_time`. It is never negative.
* `program_time` is the total programmed duration — the sum of the
  `countdown` / `countup` session durations, excluding `time_of_day` sessions,
  which have no length. `program_elapsed_time` is the wall-clock time since the
  program started, and is reset to `0` when the display returns to idle.

### 4.5 `view_status_response`

Reply to `request_view_status`.

```json
{
  "type": "view_status_response",
  "view": {
    "is_time_up_flashing": false,
    "session_name": "example",
    "message_text": "",
    "is_flashing": false,
    "elapsed_time": 0.0,
    "session_id": "example",
    "message_id": null,
    "presenter_name": "example",
    "progress_bar": 0.0,
    "is_glowing": false,
    "program_elapsed_time": 0.0
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `view` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**The `view` object** — what the audience sees.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `is_time_up_flashing` | boolean | yes | Required |
| `session_name` | string | yes | Required |
| `message_text` | string | yes | Required |
| `is_flashing` | boolean | yes | Required |
| `elapsed_time` | float | yes | Required |
| `session_id` | string | yes | Required |
| `message_id` | string | no | — |
| `presenter_name` | string | yes | Required |
| `progress_bar` | float | yes | Required |
| `is_glowing` | boolean | yes | Required |
| `program_elapsed_time` | float | yes | Required |

Units and values:

* `elapsed_time` and `program_elapsed_time` are **milliseconds**, with the same
  meaning as in §4.4.
* `progress_bar` is a **percentage from `0` to `100`**, and only a `countdown`
  session ever reports anything but `0`: it is `remaining / duration × 100`, so
  `100` is a full bar at the session's start and `0` means the countdown has
  reached zero (the bar is hidden). A `countup` or `time_of_day` session reports
  `0` for its whole life. Read it with `timer`, not with `elapsed_time`.
* `message_id` is present only while the screen is on one of the program's
  messages; `message_text` is that message's text, and is empty otherwise.
* `session_id` is the id of the current session, and is empty when no session
  is current.

### 4.6 `settings_status_response`

Reply to `request_settings_status`.

```json
{
  "type": "settings_status_response",
  "settings": {
    "brightness": 0,
    "is_time_up_display": false,
    "default_flash_length": 0.0,
    "default_flash_start_time": 0.0,
    "view_only_code": null,
    "screen_version": ""
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `settings` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**The `settings` object.**

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `brightness` | int | yes | Required |
| `is_time_up_display` | boolean | yes | Required |
| `default_flash_length` | float | yes | Required |
| `default_flash_start_time` | float | yes | Required |
| `view_only_code` | string | no | — |
| `screen_version` | string | yes | Required |

Units and values:

* `brightness` is a whole number in `0`–`100`.
* `default_flash_start_time` and `default_flash_length` are **milliseconds**.
* `view_only_code` is present only when a view-only code is configured.
* `screen_version` is the app's version name (the `version_name` of
  `hello_event`); the numeric build is that event's `version_code`.

### 4.7 `sessions_status_response`

Reply to `request_sessions_status`.

```json
{ "type": "sessions_status_response", "sessions": {"session_list": []}, "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `sessions` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**Every entry in `session_list` is a session summary.**

```json
{
  "notes": "",
  "offset": null,
  "index": 0,
  "presenter_name": null,
  "version": "",
  "duration": null,
  "mode": "countdown",
  "started_at_timestamp": null,
  "flash_start_time_seconds": 0,
  "flash_length_seconds": 0,
  "name": "",
  "id": "",
  "is_current": false
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `notes` | string | yes | Required |
| `offset` | int | no | — |
| `index` | int | yes | Required |
| `presenter_name` | string | no | — |
| `version` | string | yes | Required |
| `duration` | int | no | — |
| `mode` | string | yes | Required |
| `started_at_timestamp` | int | no | — |
| `flash_start_time_seconds` | int | yes | Required |
| `flash_length_seconds` | int | yes | Required |
| `name` | string | yes | Required |
| `id` | string | yes | Required |
| `is_current` | boolean | yes | Required |

Units and values:

* `index` is the session's position in the program, counted from `0`; session
  order is the program's array order.
* `mode` is one of `countdown`, `countup`, `time_of_day`.
* `duration` is in **seconds** — the one time in this protocol that is not
  milliseconds — and is **omitted for a `time_of_day` session**, which carries
  `offset` (milliseconds past midnight) instead.
* `started_at_timestamp` is Unix **milliseconds**, and is absent until the
  session has been started.
* `is_current` marks the **current session**, running or paused (see §4.4 for
  how it differs from `timer_run_state`).

**`is_current` — not the same field as `control_center.timer_run_state`:** this
`is_current` marks the current session, the `control_center` one marks the
timer engine's run state. It is true for the current session whether that
session is running or paused, whereas `control_center.timer_run_state` (§4.4),
a different field, is `running` only while the timer is actively counting; for
a paused current session the two differ and both are correct. This field was
named `is_playing` up to version 1.1.2.19 (build 141); from version 1.1.2.20
(build 142) it is emitted as `is_current` only.

### 4.8 `messages_status_response`

Reply to `request_messages_status`.

```json
{ "type": "messages_status_response", "messages": {"message_list": [], "is_flashing": false}, "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `messages` | object | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

**Every entry in `message_list` is a message summary.**

```json
{ "is_showing": false, "id": "", "text": "" }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `is_showing` | boolean | yes | Required |
| `id` | string | yes | Required |
| `text` | string | yes | Required |

> **`is_showing` describes the display, not the message.** It is true for the one
> message the screen is on and false for every other message — including for all
> of them when the screen is idle, on the timer, covered by a blackout, or
> showing a device notice that is not one of the program's messages. The screen
> decides this; the stored program does not carry it. The section's own
> `is_flashing` reports whether that message is on screen *and* flashing; a
> message summary carries no flash state of its own. (A message *inside a
> program* does carry an `is_flashing`, read from the screen the same way — see
> [§4.9](#49-program_response).)

### 4.9 `program_response`

Reply to `get_program`.

> **Program content only.** The Program Session object carries no session-level
> state: `is_current`, its retired `is_playing` name, and `index` are **not**
> present (read `is_current` and `index` from the session summary in
> `sessions_status_response` / `sessions_status_event` instead). `send_program`
> still accepts all three names on a session for backward compatibility, but
> ignores them; session order is array order.

> **Messages carry no display state either.** A message's `is_showing` and
> `is_flashing` are read from the screen as the frame is built (see
> [§4.8](#48-messages_status_response)), and `send_program` accepts both names on
> an inbound message and ignores them: what the display stores about a message is
> `id`, `content` and `version`. Re-sending a program therefore cannot mark one
> of its messages as showing — only `show_message` puts a message on screen.

```json
{
  "type": "program_response",
  "has_program": true,
  "program": {
    "settings": {
      "flash_start_time_seconds": 0,
      "flash_length_seconds": 0
    },
    "sessions": [],
    "user_id": null,
    "program_id": "example",
    "program_name": "example",
    "messages": [],
    "version": ""
  },
  "request_id": null
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `has_program` | boolean | yes | Required |
| `program` | object | no | — |
| `request_id` | string | no | Optional correlation identifier |

**The `program` object.** It is the same object in `program_response` and in
`program_changed_event` (§5.7), and it is the object `send_program` accepts.

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `settings` | object | yes | Required |
| `sessions` | array | yes | Required |
| `user_id` | string | no | — |
| `program_id` | string | yes | Required |
| `program_name` | string | yes | Required |
| `messages` | array | no | — |
| `version` | string | yes | Required |

`settings` carries the program's default flash configuration, in **whole
seconds**:

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `flash_start_time_seconds` | int | no | — |
| `flash_length_seconds` | int | no | — |

Each entry in `sessions` is a **program session**:

```json
{
  "duration_seconds": null,
  "mode": "countdown",
  "started_at_timestamp": null,
  "notes": "",
  "offset": null,
  "flash_start_time_seconds": 0,
  "flash_length_seconds": 0,
  "name": "",
  "id": "",
  "presenter_name": null,
  "version": ""
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `duration_seconds` | int | no | — |
| `mode` | string | no | — |
| `started_at_timestamp` | int | no | — |
| `notes` | string | no | — |
| `offset` | int | no | — |
| `flash_start_time_seconds` | int | no | — |
| `flash_length_seconds` | int | no | — |
| `name` | string | yes | Required |
| `id` | string | no | — |
| `presenter_name` | string | no | — |
| `version` | string | no | — |

* `duration_seconds` is in **seconds** and `offset` is in **milliseconds past
  midnight** — a deliberately mixed pair, because `offset` is a wall-clock time
  and `duration_seconds` is a length. Exactly one of the two is present:
  `duration_seconds` for `countdown` / `countup`, `offset` for `time_of_day`.
  See §3.6 for how `send_program` treats them on the way in.
* `flash_start_time_seconds` and `flash_length_seconds` are in **seconds**.
* `id` and `version` are generated by the device when omitted; a client that
  wants to address a session with `show_session` should send `id`.
* `started_at_timestamp` is the display's own runtime state (Unix
  milliseconds), not program content, and is preserved across a re-send of the
  same program.

Each entry in `messages` is a **program message**:

```json
{
  "is_flashing": false,
  "is_showing": false,
  "id": "",
  "version": "",
  "content": ""
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `is_flashing` | boolean | no | — |
| `is_showing` | boolean | no | — |
| `id` | string | no | — |
| `version` | string | no | — |
| `content` | string | yes | Required |

* `is_showing` and `is_flashing` are read from the screen as the frame is built;
  inbound they describe the sender's screen and are ignored.
* `id` and `version` are generated when omitted.

### 4.10 `program_list_response`

Reply to `get_program_list`.

```json
{ "type": "program_list_response", "program_list": [], "request_id": null }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `program_list` | array | yes | Required |
| `request_id` | string | no | Optional correlation identifier |

Each entry in `program_list` is a **program summary**:

| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `program_id` | string | yes | Required |
| `name` | string | yes | Required |

The name field is `name`, not `program_name` — see the note under
[`get_program_list`](#get_program_list).

> **A program summary is metadata only.** It carries identity and name, and
> nothing else — no `sessions`, no `messages`, no `version`, no `settings`.
> Fetch the full content of a program with `get_program`.

---

## 5. Events (Server → Client, WebSocket only)

Events are pushed to all connected WebSocket clients when state changes.
They are **not** sent over HTTP, are never replies to a request, and never
carry `request_id`. Every event `type` ends in `_event` — see §5.1.

Query commands never push anything: `request_status`, `get_program`,
`get_program_list` and the other status requests are answered only on the
connection that asked, with no event to any client. In particular there is no
`program_list_event` — a change to the program library arrives as
`program_changed_event`.

A command pushes each event type **at most once**, however many internal changes
it made, and a command that finds the display already in the state it would have
set pushes nothing (the `ack` is its confirmation). The collapse is scoped to the
one command: two separate commands that leave the display in the identical state
each push, even if the frames are byte-for-byte the same.

### 5.1 `hello_event`

Sent immediately after WebSocket handshake. The connection greeting: not a
reply to anything and never carries `request_id`.

```json
{
  "type": "hello_event",
  "version_name": "example",
  "screen_name": "example",
  "version_code": 0,
  "screen_id": "example"
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `version_name` | string | yes | Required |
| `screen_name` | string | yes | Required |
| `version_code` | int | yes | Required |
| `screen_id` | string | yes | Required |

### 5.2 `control_center_status_event`

Pushed on whole-second timer ticks, and on timer state changes. Steady state is
**~1 Hz**: the source is the per-displayed-second `SessionTick`, not a 5 ms
poll, and broadcast pushes are additionally throttled to at least 50 ms apart.
Contains the full control center state — the same fields, with the same
`timer` semantics, as §4.4.

```json
{
  "type": "control_center_status_event",
  "control_center": {
    "flash_start_time": 0.0,
    "is_next_session": false,
    "current_presenter_name": "example",
    "current_session_name": "example",
    "current_session_id": "example",
    "current_session_index": 0,
    "is_blackout": false,
    "program_time": 0.0,
    "is_glowing": false,
    "timer_run_state": "idle",
    "is_time_up_flashing": false,
    "timer": 0.0,
    "is_previous_session": false,
    "elapsed_time": 0.0,
    "flash_length": 0.0,
    "program_elapsed_time": 0.0
  }
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `control_center` | object | yes | Required |

### 5.3 `view_status_event`

Pushed on whole-second timer ticks, and on timer state changes. Steady state is
**~1 Hz**, the same cadence as `control_center_status_event` (per-displayed-second
`SessionTick`, throttled to ≥50 ms apart). Represents what the audience sees.

```json
{
  "type": "view_status_event",
  "view": {
    "is_time_up_flashing": false,
    "session_name": "example",
    "message_text": "",
    "is_flashing": false,
    "elapsed_time": 0.0,
    "session_id": "example",
    "message_id": null,
    "presenter_name": "example",
    "progress_bar": 0.0,
    "is_glowing": false,
    "program_elapsed_time": 0.0
  }
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `view` | object | yes | Required |

### 5.4 `settings_status_event`

Pushed when settings change.

```json
{
  "type": "settings_status_event",
  "settings": {
    "brightness": 0,
    "is_time_up_display": false,
    "default_flash_length": 0.0,
    "default_flash_start_time": 0.0,
    "view_only_code": null,
    "screen_version": ""
  }
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `settings` | object | yes | Required |

### 5.5 `sessions_status_event`

Pushed when the program or sessions change.

```json
{ "type": "sessions_status_event", "sessions": {"session_list": []} }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `sessions` | object | yes | Required |

### 5.6 `messages_status_event`

Pushed when messages in the program change, or when the message the display is on
changes (which is what `is_showing` reports).

```json
{ "type": "messages_status_event", "messages": {"message_list": [], "is_flashing": false} }
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `messages` | object | yes | Required |

### 5.7 `program_changed_event`

Pushed when a program is loaded or modified.

```json
{
  "type": "program_changed_event",
  "has_program": true,
  "program": {
    "settings": {
      "flash_start_time_seconds": 0,
      "flash_length_seconds": 0
    },
    "sessions": [],
    "user_id": null,
    "program_id": "example",
    "program_name": "example",
    "messages": [],
    "version": ""
  }
}
```
| Field | Type | Req | Notes |
|-------|------|-----|-------|
| `has_program` | boolean | yes | Required |
| `program` | object | no | — |

### 5.8 Event Frequency Summary

| Event                          | Trigger                 | Frequency        |
|--------------------------------|-------------------------|------------------|
| `hello_event`                  | WS connect              | Once             |
| `control_center_status_event`  | Whole-second timer tick, or state change | ~1 Hz in steady state |
| `view_status_event`            | Whole-second timer tick, or state change | ~1 Hz in steady state |
| `settings_status_event`        | Settings change         | On change        |
| `sessions_status_event`        | Program/session change  | On change        |
| `messages_status_event`        | Program/message change  | On change        |
| `program_changed_event`        | Program load/edit       | On change        |

---

## 6. Transport Differences Summary

| Aspect            | HTTP (port 8080)              | WebSocket (port 8081)             |
|-------------------|-------------------------------|-----------------------------------|
| Transport         | One request, one reply        | Persistent connection             |
| Commands          | `POST /api/command`           | JSON text frame                   |
| Responses         | HTTP 200 + JSON body, or HTTP 400 when the body is an `error_response` | JSON text frame |
| Reading state     | Poll with `request_status` / `get_program` / `get_program_list` | Same commands, plus push events |
| Hello             | ❌ Not sent                   | ✅ `hello_event` on connect       |
| Push events       | ❌ Not available              | ✅ Broadcast on state changes     |
| Best for          | Simple clients, scripts       | Real-time control, UIs            |

The command set and the message shapes are identical: a command sent as a
WebSocket text frame is the same object as the body of a `POST /api/command`, and
the reply is the same response object in both cases.

---

## 7. Schema and Versioning

The protocol schema is defined as Kotlin `@Serializable` data classes in
`JsonProtocolMessage.kt` — the **compiler is the source of truth**. A JSON
Schema file (`protocol-schema.json`) is generated at build time via:

```
./gradlew generateJsonProtocolSchema
```

The generated schema is committed to the repository for consumption by
Python and JavaScript clients. If you change a `@Serializable` data class,
regenerate and commit the schema.

---

## 8. Discovery (mDNS)

The device advertises the following TXT records via mDNS on `_cuetime._tcp`:

| Key           | Value    | Description                    |
|---------------|----------|--------------------------------|
| `http_port`   | `8080`   | HTTP JSON API port             |
| `json_ws_port`| `8081`   | JSON WebSocket port            |
| `ws_port`     | `8002`   | Protobuf WebSocket (insecure)  |
| `tls_port`    | `8443`   | Protobuf WebSocket (secure)    |
| `json_port`   | `9001`   | Crestron TCP control port      |

---

## 9. Migration from HTTP to WebSocket

| Step | Action                                                     |
|------|------------------------------------------------------------|
| 1    | Continue using HTTP port 8080 — nothing changes            |
| 2    | Connect to WebSocket at `ws://<device>:8081`               |
| 3    | Receive `hello_event` event on connect                        |
| 4    | Send the same JSON commands as WebSocket text frames       |
| 5    | Handle push events instead of polling with `request_status` |
| 6    | Drop HTTP polling once push events are working             |

Port 8080 is **not deprecated** — it remains a supported transport
indefinitely.
