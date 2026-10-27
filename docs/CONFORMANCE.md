# Protocol Conformance Plan

This module talks to the CueTime Display app over the **JSON control protocol on
WebSocket** (`ws://<device>:8081`). "Conformance" here means one question,
answered with evidence: *when an operator presses a Companion button, does the
device do the documented thing, and does the module then report what the device
actually did?*

The scope is deliberately narrow:

- **In scope** — every command the module can send (33 actions), every feedback
  and variable it derives (15 feedbacks, 21 variables), the connection lifecycle,
  and the failure paths (reconnect, protocol errors, back-pressure).
- **Out of scope** — HTTP transport (the module does not use it, decision D1),
  Crestron/protobuf transports, and device UI behaviour that no client can
  observe.

---

## 1. Vendored artifacts

| Artifact      | Vendored path                   | Far-side source                                          |
| ------------- | ------------------------------- | -------------------------------------------------------- |
| Protocol spec | `HTTP_JSON_CONTROL_PROTOCOL.md` | `Android-Display-App/docs/HTTP_JSON_CONTROL_PROTOCOL.md` |
| JSON Schema   | `schemas/protocol-schema.json`  | `Android-Display-App/schemas/protocol-schema.json`       |

- **Version Code 147**, Reviewed Date 2026-10-12 (spec header).
- Schema md5: `aff80bf5064d726ab29a4d4f80b83625`.
- Copied verbatim; the copies must stay byte-identical to the far-side files.

Regenerate from the far-side repo, then re-vendor and rebuild:

```sh
# far side
cd Android-Display-App/CueTimeDisplay && ./gradlew generateJsonProtocolSchema
# here
cp -f ../Android-Display-App/docs/HTTP_JSON_CONTROL_PROTOCOL.md .
cp -f ../Android-Display-App/schemas/protocol-schema.json schemas/
yarn generate-protocol && yarn build && yarn test
```

The `protocol-drift` CI job re-runs `yarn generate-protocol` and fails if the
committed `src/protocol/generated.ts` does not match the schema, so a stale
schema cannot land silently.

### What changed in vc147 (and why it affects the tests)

vc146 → vc147 is not a cosmetic revision; four changes land directly on this
module's behaviour:

1. **`show_message` with `text` is ad-hoc.** It no longer creates or reuses a
   stored message, announces no `program_changed_event`, needs no loaded
   program, reports the text in `view.message_text` with `view.message_id`
   empty, and returns **no `entity_id`**. (vc146 created/reused a message.)
2. **`flash` on `show_message` is three-state.** `true` on, **`false` stops a
   flash already running**, omitted leaves it alone. In vc146 `false` was a
   documented no-op. The module therefore only ever sends `flash` when the
   operator picks On/Off, never for "keep".
3. **`view.is_flashing` is the message flash only.** Session flashing is
   `is_time_up_flashing`; the two never overlap. The module's `is_flashing` and
   `is_time_up_flashing` feedbacks must not bleed into each other.
4. **§5.9 delivery and back-pressure.** Each WS client has its own 32-frame
   bounded queue; event frames coalesce by kind; responses are never coalesced —
   a response that will not fit **closes that connection**. A slow client must
   not affect the module's client, and a closed connection must be reconnected
   and rehydrated (this is test group G3).

Also new: an inbound `null` string is read as absent (an empty string is a real
value), and `entity_id` is now documented as present only for `add_session`,
`add_message`, and `show_message` addressed by `message_id`.

## 2. Target devices

| Device build             | Status      | Notes                         |
| ------------------------ | ----------- | ----------------------------- |
| vc 149                   | current     | primary conformance target    |
| vc 150 (WIP)             | in progress | run the same matrix when ready |
| vc 146                   | retired     | historical; no longer tested  |

**Version codes track the app build, not the protocol.** The vendored document is
Version Code 147 and the devices under test report 149 (150 in progress): that
difference means the protocol has not changed since 147, not that the document is
stale. The far side regenerates the document when the protocol changes.

What this means for a run:

- Every run records `hello_event.version_code` / `version_name` — not because the
  number must match the document, but so the evidence says which build was
  tested. A run without a recorded device build is not evidence.
- Where a device behaviour disagrees with the document, that is a real divergence:
  either the module is wrong, or the document is missing/behind a protocol change
  and needs regenerating. Classify it explicitly; do not silently code around it.
- Comments in `src/` still cite "vc146" in places, because that is the revision
  each claim was verified against. They are re-stamped once the same claims are
  re-verified on the build under test — until then, read a version label in a
  comment as "the revision this was checked on", not "the revision we support".
- The matrix is written against the *documented* contract, so it stays valid as
  the far side regenerates the doc at 149/150. Where a row depends on a version,
  the row says so.

## 3. Verification tiers

| Tier  | What it proves                                          | Hardware | Runs            |
| ----- | ------------------------------------------------------- | -------- | --------------- |
| **T0** | Payload builders and schema validity, outbound fixtures | no       | CI (each push)  |
| **T1** | Fixture parity: far-side cases replayed through the module's state machine | no | CI (each push) |
| **T2** | Three-way conformance: Companion → device, ground truth from the device | yes | on demand |
| **T3** | Device self-consistency: far-side suite against the same build | yes | on demand, before T2 |

T0 is the existing 151 unit tests. T1 is the port of the far-side
`integration_tests/test_ws_json_protocol.py` cases into recorded fixtures — it is
the missing piece that lets CI cover protocol semantics without a device. T3 runs
*before* T2 in a session: if the far-side suite fails, a T2 failure cannot be
attributed to the module.

T2 is what the rest of this document specifies.

---

## 4. The harness (T2): three-way, device as ground truth

### 4.1 Topology

```
       ┌──────────────┐   POST /api/location/<p>/<r>/<c>/press
       │   pytest     │───────────────────────────────────────────┐
       │  (harness)   │                                           ▼
       │              │                                   ┌───────────────┐
       │              │   GET /api/variable/<label>/<v>    │   Companion   │
       │              │◄──────────────────────────────────│   5.1.x       │
       │              │   GET /api/connections/<id>/status  └───────┬───────┘
       │              │                                             │ ws 8081
       │              │        ws 8081 (own client: events +         │ (module)
       │              │        request_status)                      ▼
       │              │────────────────────────────────────►┌───────────────┐
       └──────────────┘                                     │  CueTime      │
                                                            │  device       │
                                                            └───────────────┘
```

Three independent perspectives on one action:

1. **Intent** — the button press, delivered through Companion's own HTTP API.
   This exercises presets and actions exactly as an operator does; the harness
   never imports module code.
2. **Effect** — what the device did, read from a *separate* WebSocket client that
   subscribes to the same broadcast event stream the module receives, plus
   `request_status` snapshots for absolute values.
3. **Report** — what the module tells Companion, read back as module variables.

**Yes, this is the right shape**: drive Companion, observe the device, compare.
The comparison only works because of two properties of the protocol:

- every event frame is a **full snapshot** of the state it names, so the device's
  broadcast is an unambiguous ground truth at each point in time; and
- events are **broadcast to every connected client**, so the harness's client and
  the module's client are told the same thing at the same moment.

### 4.2 Direction matters — run both

The harness runs each scenario in whichever direction it is meaningful, because
they fail differently:

- **Companion → device (forward).** Catches wrong/missing commands, wrong
  parameters, wrong addressing (position → id resolution), local guards that
  refuse valid operations.
- **Device → Companion (reverse).** Catches missing subscriptions, hydration
  gaps, and stale state. This is where modules usually break: the command path is
  exercised by every button press, while the reverse path is only exercised
  between different clients.

A scenario that only asserts "the device changed" proves nothing about the
module; a scenario that only asserts "the variable changed" proves nothing about
the device. Every row in §5 asserts both.

### 4.3 The loop

For each scenario:

1. **Arrange.** Force a known device state *directly* (harness → device): load the
   fixture program, `show_idle`, ensure flash off, set brightness 100. Then
   `POST /api/connections/<id>/restart` and wait for the module to rehydrate
   (`GET /api/connections/<id>/status` is `good` and variables are populated).
   Restarting per scenario is deliberate: hydration bugs are cheap to find this
   way and expensive to find in the field.
2. **Act.** `POST /api/location/<page>/<row>/<col>/press` — or, for reverse
   scenarios, send the command from the harness's own device client.
3. **Observe devices-side.** Wait for the expected event kind on the harness
   client (bounded), then take a `request_status` snapshot.
4. **Observe module-side.** Poll `GET /api/variable/<label>/<name>/value` until
   the expected value or the settle budget expires; assert the *final* value, and
   that it did not flap (record every poll).
5. **Assert invariants** (§7): connection stayed `good`, no reconnect, no
   unexpected `error_response`, no duplicate `request_id`.
6. **Record.** Timeline + snapshots + assertions into the run bundle (§8).

### 4.4 What the harness must not do

- **No polling loops as the observation mechanism.** The device pushes ~1 Hz
  `control_center_status_event` / `view_status_event`; a poller adds traffic and
  hides coalescing behaviour. Poll only for the module variable readback (there
  is no push channel for module variables).
- **No importing module internals.** Assert through Companion's public API only;
  otherwise a passing test proves nothing about what an operator sees.
- **No shared device client between scenarios.** A dedicated client per scenario
  keeps one scenario's queue back-pressure out of the next one's results.
- **No assertions on wall-clock sub-second timing.** Tick pushes and broadcasts
  are throttled to ≥50 ms apart; assert ordering and eventual values, not
  intervals.

---

## 5. Scenario matrix

Legend: **Act** is what the harness does; **Device** is the ground-truth
expectation read from the harness's own WS client; **Module** is the assertion on
Companion-side variables/status. `§` refers to the vendored spec.

### A. Lifecycle & hydration

| ID  | Act                                                  | Device                                              | Module                                                    | §   |
| --- | ---------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------- | --- |
| A1  | Restart the module connection                        | `hello_event` then hydration commands answered; one client only | status `good`; all 21 variables populated; values equal a fresh `request_status` | §1.3, §4 |
| A2  | Restart the device app while Companion stays up      | module reconnects after backoff; new `hello_event`   | rehydrated within budget; no stale values; `is_connected` feedback true | §1.3 |
| A3  | Drop the module's TCP connection from the device side (or restart the device's WS server) | module reconnects | values converge to device truth; no duplicate-command storm | §1.3 |
| A4  | Restart module with **no program loaded**            | hydration succeeds; `message_list`/`session_list` empty | exists without errors; position-based message action refuses locally with a warning and sends nothing | §3.2 |

### B. Timer control

| ID  | Act                        | Device                                                       | Module                                                     | §     |
| --- | -------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | ----- |
| B1  | Press `toggle_playback` (start) | `control_center.timer_run_state: running`; `elapsed_time` advancing | `timer_run_state=running`, `is_playing=Yes`, `elapsed_formatted` advancing | §3.2 |
| B2  | Press `toggle_playback` again (pause) | `timer_run_state: paused`; elapsed frozen             | `timer_run_state=paused`; `is_paused` feedback true         | §3.2 |
| B3  | Press `navigate_next` / `navigate_previous` | `current_session_id`/`current_session_name` change | `current_session_id`/`_name`/`_number` match device         | §4.4 |
| B4  | Press `add_time` (60 s) then `subtract_time` (60 s) | `timer` +60000 then back; countdown ≥ 1 s rule respected | `timer`/`remaining_formatted` track; no local/device disagreement | §3.2 |
| B5  | Press `reset_current_session`, then `reset_program_elapsed_timer` | elapsed returns to 0; run state per spec | `elapsed_time` and `elapsed_formatted` match               | §3.2 |
| B6  | Press `pause` against a `time_of_day` session | device would reject `pause_session` (documented)    | module **skips locally** with a warning, sends nothing      | §3.2 |

### C. Program edits

| ID  | Act                                        | Device                                              | Module                                    | §   |
| --- | ------------------------------------------ | --------------------------------------------------- | ----------------------------------------- | --- |
| C1  | Press `add_session`                        | new session; `ack_response.entity_id` = new id      | `total_sessions` +1; new session visible   | §3.2 |
| C2  | Press `update_session` / `move_session_up` / `delete_session` | program order and content change; `program_changed_event` | counts and `previous_/next_session_name` follow list order | §4.9 |
| C3  | Press `add_message`                        | `entity_id` = new message id                        | `total_messages` +1                       | §3.2 |
| C4  | Press `delete_all_messages`, then `delete_all_sessions` | both lists empty; `current_session_id` empty | totals 0; `current_session_*` blank; no crash on next press | §3.2 |

### D. Messages & flash (vc147 semantics)

| ID  | Act                                                        | Device                                                                 | Module                                                | §     |
| --- | ---------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------- | ----- |
| D1  | Press `show_message` addressed by position                 | `view.message_text` = that message's content, `view.message_id` = its id; `is_showing` true for it; `entity_id` echoed | `message_text` equals it; `message_showing` feedback true | §3.2, §4.5 |
| D2  | Press `show_message` addressed by text, **no program loaded** | accepted; `view.message_text` = text, `view.message_id` empty; **no** `program_changed_event`; message list unchanged; all `is_showing` false | `message_text` set from `view` (not from `messages_status`); `total_messages` unchanged | §3.2 |
| D3  | `set_flash enable` → then `show_message` with flash **Off** | `view.is_flashing` true, then **false** (vc147: `false` stops an inherited flash) | `is_flashing` feedback follows; the module sent `flash:false` only because the operator chose Off | §3.2, §4.5 |
| D4  | `show_message` with flash **Keep** while flash is on        | `view.is_flashing` stays true; no flash field on the wire                | `is_flashing` still true; module never sent `flash`     | §3.2 |
| D5  | Press `hide_message`                                       | `view.message_text` empty; `view.is_flashing` false                     | `message_text` empty; `is_flashing` false               | §3.2 |
| D6  | Countdown reaching zero with flash window + `set_is_time_up_display on` | `view.is_time_up_flashing` true while `view.is_flashing` false | `is_time_up_flashing` feedback true, `is_flashing` **false** — the two must not bleed | §4.5 |
| D7  | `set_is_time_up_display off`, then let a countdown expire  | time-up cue never reports; session flash window still does             | `is_time_up_display` feedback false; session flashing still reported | §3.2, §4.5 |

### E. Display state

| ID  | Act                                    | Device                                            | Module                                     | §    |
| --- | -------------------------------------- | ------------------------------------------------- | ------------------------------------------ | ---- |
| E1  | Press `blackout` on, then off          | `view.is_blackout` follows; timer keeps running    | `is_blackout` variable/feedback follow; elapsed keeps advancing | §3.2 |
| E2  | Press `set_glow on`, `toggle_glow`     | `is_glowing` in view/control_center               | `is_glowing` follows                        | §3.2 |
| E3  | Press `show_idle` while a message is up | message cleared; idle view                        | `message_text` cleared                      | §3.2 |
| E4  | Press `set_brightness` 20 then 100     | `settings.brightness` follows; no rejection       | no error logged; module state unaffected    | §4.6 |

### F. Device-initiated changes (reverse direction)

| ID  | Act                                                      | Device                                  | Module                                                     | §     |
| --- | -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------- | ----- |
| F1  | Harness sends `start_session` directly on the device     | run state running                       | all dependent variables/feedbacks converge within budget   | §5    |
| F2  | Harness sends a burst: 5 × `show_session` in 200 ms      | events coalesce by kind (§5.9)          | variable ends at the **final** session, not an intermediate | §5.9  |
| F3  | Harness loads a different program (`send_program`)       | `program_changed_event`                 | `total_sessions`/`total_messages` and current-session vars follow | §4.9 |
| F4  | Device-local operator action (physical buttons / Android UI) | same event stream                    | same convergence assertion                                 | §5    |

### G. Resilience & error paths

| ID  | Act                                                             | Expected                                                                                   | §     |
| --- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| G1  | Press a position-based message action with an out-of-range position | module refuses locally with a warning; **nothing** sent; no device error frame           | §3.2  |
| G2  | Press `show_message` with empty text and no position             | same local refusal (vc147 rejects blank ad-hoc text with `INVALID_PARAMETER`)                | §3.2  |
| G3  | Harness opens a client that stops reading to fill the 32-frame queue | only *that* connection is closed; module's client unaffected and still in sync; device log shows `ClientFrameWriter slow write` | §5.9  |
| G4  | Run the whole matrix and inspect every module request id          | no duplicate `request_id`; every reply correlated; no unhandled `error_response`             | §2, §3.3 |
| G5  | 10-minute soak: 1 press/second across timer/nav/message actions   | no reconnect, connection status stays `good`, Companion process memory flat, device state matches module at the end | —     |

---

### 5.1 First hardware run — 2026-10-27

Device `CueTime_32807a9c3d83`, `1.1.2.27 (149)`, at `192.168.1.145:8081`.
Run: `python3 conformance/run_conformance.py` → **16/16 device scenarios pass**
(A1/F1/F2 skipped: no Companion endpoint was reachable from the harness host).
Evidence: `conformance/results/<stamp>/run.json`.

The vc147 semantics that motivated the re-vendor are all confirmed on the device:

| Check | Result |
| ----- | ------ |
| D2 ad-hoc `show_message` text: no `entity_id`, no `program_changed_event`, `view.message_id` empty, all `is_showing` false | confirmed |
| D3 `flash:false` **stops** a running flash; omitted leaves it alone | confirmed |
| D6 `is_time_up_flashing` never surfaces as `is_flashing`, and both can run at once | confirmed |
| G3 200 status requests from a non-reading client: **200/200 responses delivered**, no coalescing, no silent drop; a second client's snapshot took 15 ms while that back-pressure was live | confirmed |
| B6 `pause_session` / `add_time` / `subtract_time` / `reset_current_session` refused on `time_of_day` | confirmed |
| G1/G2 error codes (`INVALID_PARAMETER` for unknown `message_id`, blank or missing message address) | confirmed |

Two things the run found that the document does not say:

1. **`add_session` enforces `flash_length_seconds <= flash_start_time_seconds`**
   (`INVALID_PARAMETER`, message "Flash length must be ≤ flash start time").
   The document only lists "a countdown session whose flash window cannot fire"
   as the reason, without the relation. Either the field table should state the
   constraint or the error list should explain it.
2. **`is_time_up_flashing` stays true past the countdown's zero** (a 3 s session
   with a 2 s window still reported it ~3.5 s after zero). The document describes
   the cue as being "at zero"; its tail beyond zero is unspecified. D6 therefore
   asserts inside the flash window only, not against cue duration.

Nothing in the run contradicted the module's own assumptions — expected, because
the module was written against the vc147 semantics before the document was
re-vendored. The Companion-dependent groups (A, F) remain unproven on hardware and
are what the next bench session must close.

## 6. Variable ↔ protocol mapping (assertion table)

The readback side of every row above resolves to these. Formatting rules are the
module's own (`formatTime`), so they are asserted as derived values, not
compared to raw device fields.

| Companion variable        | Source in device state                          | Comparison                        |
| ------------------------- | ----------------------------------------------- | --------------------------------- |
| `timer_run_state`         | `control_center.timer_run_state`                | exact                             |
| `elapsed_time`            | `control_center.elapsed_time` (ms)              | exact (ms)                        |
| `timer`                   | `control_center.timer` (ms)                     | exact (ms)                        |
| `current_session_id`      | `control_center.current_session_id`             | exact                             |
| `current_session_name`    | `control_center.current_session_name`           | exact                             |
| `current_presenter_name`  | `control_center.current_presenter_name`         | exact                             |
| `current_session_number`  | `control_center.current_session_index + 1`      | exact (0 when idle)               |
| `current_session_mode`    | session summary with `is_current`               | exact                             |
| `is_playing`              | `timer_run_state == running`                    | `Yes`/`No`                        |
| `is_glowing`              | `view`/`control_center.is_glowing`              | `Yes`/`No`                        |
| `is_blackout`             | `control_center.is_blackout`                    | `Yes`/`No`                        |
| `message_text`            | **`view.message_text`** (not `messages_status`)  | exact — see D2                    |
| `total_sessions`          | length of `session_list`                        | exact                             |
| `total_messages`          | length of `message_list`                        | exact — see D2                    |
| `previous_/next_session_*` | neighbours of `current_session_index`          | exact                             |
| `elapsed_formatted`       | `view.elapsed_time ?? control_center.elapsed_time` | `MM:SS` / `HH:MM:SS`           |
| `remaining_formatted`     | `control_center.timer`                          | `MM:SS` / `HH:MM:SS`              |
| `progress_bar`            | derived: remaining ÷ duration for countdowns    | ±1 (rounding)                     |

Feedbacks are asserted through the variables wherever they share a source
(`is_glowing`, `is_blackout`, `is_flashing`, `is_time_up_flashing`,
`is_playing`, `is_paused`, `is_idle`, `has_previous/next_session`); the two that
render (`progress_bar`) are asserted on device numbers rather than pixels.

## 7. Assertion rules

- **Settle budget:** 1.0 s command → device (device processes synchronously;
  this is generous), 2.0 s device → module variables (event push + IPC + the
  module's own update). Budgets are per-scenario constants, not sleeps in the
  happy path: wait for the condition, fail at the budget.
- **No-flap:** a variable polled during the loop must not end at a value the
  device never reported. Record every poll; a flap is a failure even if it
  settles.
- **Connection health** is asserted before and after every scenario:
  `GET /api/connections/<id>/status` → `status.category == "good"`, and the
  connection id unchanged (no silent recreate).
- **Idempotence:** after the settle window, one more `request_status` must agree
  with the module's values — this catches a module that converged by accident.
- **No tolerances on strings or ids**; the only numeric tolerance is
  `progress_bar` ±1 and timing fields asserted `>=` a floor for advancing clocks.

## 8. Evidence bundle

Each T2 run writes one directory, `conformance/results/<UTC timestamp>-<device
build>/`:

| File                          | Content                                                    |
| ----------------------------- | ---------------------------------------------------------- |
| `run.json`                    | device `hello_event` (version code/name), Companion version, module version, harness git SHA, scenario list |
| `timeline-<scenario>.jsonl`   | every device frame received by the harness client, with monotonic timestamps |
| `variables-<scenario>.jsonl`  | every module-variable poll during the scenario              |
| `junit.xml`                   | machine-readable results (same shape the far-side suite emits) |
| `notes.md`                    | human observations, screenshots for anything visual          |

A run with no `run.json` is not evidence: the device build must be pinned to the
results.

## 9. Prerequisites and how to run

Environment (no secrets in git):

| Variable                    | Meaning                                                        |
| --------------------------- | -------------------------------------------------------------- |
| `CUETIME_DEVICE`            | device host/IP for the WS client                               |
| `CUETIME_DEVICE_PORT`       | default `8081`                                                 |
| `COMPANION_URL`             | e.g. `http://companion.local:8000`                             |
| `COMPANION_CONNECTION`      | connection **id or label**; resolved via `GET /api/connections` by `moduleId` when omitted |
| `COMPANION_PAGE`            | page holding the conformance button layout (default `1`)        |
| `CUETIME_FAR_SIDE`          | path to `Android-Display-App` (for `device_lease.py` reuse)     |

Device-side preconditions per session:

1. Fixture program loaded: ≥ 3 sessions (one `countdown` with a 30 s duration and
   a flash window near zero, one `countup`, one `time_of_day`) and ≥ 3 messages,
   one of whose text is unique enough to identify by content.
2. Companion layout: the 20 presets from `src/presets.ts` placed on a dedicated
   page, one per button, in a documented page/row/col grid so scenarios can press
   them by location.
3. Module instance configured against the device; label recorded for variable
   readback.

Commands:

```sh
# T3 first: prove the device matches its own spec, so T2 failures are attributable
python3 "$CUETIME_FAR_SIDE/integration_tests/test_ws_json_protocol.py" "$CUETIME_DEVICE" \
    --port 8081 --http-port 8080 --junit-xml-dir conformance/results/far-side

# T2: three-way harness
pytest conformance -v --device-build vc149
```

`device_lease.py` (`--no-lease`, `--lease-wait`, `--lease-file`) is reused rather
than reimplemented, so a T2 run and a far-side run cannot collide on one device.

## 10. Exit criteria

Conformance for a release tag requires, in order:

- [ ] T0 green in CI (payload builders + schema validation).
- [ ] T1 fixture parity landed: far-side cases replayed through the module's
      state machine in CI, no hardware.
- [ ] T3 far-side suite green against the target build (vc149), same session.
- [x] T2 device scenarios (S, B–E, G) green against vc149 — 2026-10-27, see §5.1.
- [ ] T2 groups A and F green against vc149 (needs Companion reachable from the
      harness host: press a button, assert the module caught up).
- [ ] T2 group G green or each failure written up with its device log excerpt.
- [ ] Any spec/device divergence filed against the far side (doc regenerated at
      the shipping version code) rather than worked around in the module.

Until those hold, the module is **unit- and mock-verified, not
hardware-verified**, and the release notes must say so.

## 11. Known risks / expected findings

| Risk                                                                 | Where it shows up |
| -------------------------------------------------------------------- | ----------------- |
| Spec (vc147) is behind the devices (149/150) — behaviour may already differ | §2 policy; A1 records the build every run |
| vc147's `flash:false` now *stops* a flash where vc146 ignored it      | D3 — the module only sends `flash` on an explicit On/Off choice |
| Ad-hoc `show_message` returns no `entity_id` and does not touch the program | D2 — module must not expect a message to appear in `messages_status` |
| Hydration gaps only visible when the module did not cause the change   | F1–F4 |
| Back-pressure closes non-reading clients outright                      | G3 |
| Position→id resolution against a stale list (operator presses fast)    | G1, F2 |
| Time-of-day sessions reject timer commands                             | B6 |

## 12. Open questions for the far side

1. Can the protocol docs + schema be regenerated at **Version Code 149** (and 150
   once it ships) so this plan tests the documented contract of the build under
   test?
2. Does the device expose its WS client count / per-client queue depth anywhere
   observable (log line, debug endpoint)? It would turn G3 from an inference into
   a measurement.
3. Is there a way to force a clean mid-session WS drop from the device side (for
   A3) other than restarting the app or blocking the port at the network layer?
4. Should `show_message` with `message_id` pointing at a message deleted by
   another client be specified as `INVALID_PARAMETER` (currently documented for
   ids "not present in the loaded program")? G1 depends on the answer.

## Appendix — harness

The harness is implemented and has run against hardware (see §5.1). It is a
standalone asyncio runner rather than pytest, because the host has no pytest while
`websockets` and `requests` were already available — the same reasoning behind the
far side's `SuiteRunner`.

```
conformance/
├── README.md             # prerequisites and usage
├── config.py             # env/CLI configuration
├── device.py             # device WS client: hello_event, request_status, broadcast frames
├── companion.py          # Companion HTTP API: press, variables, connections, restart
├── timeline.py           # per-scenario JSONL timelines, junit.xml, run.json
├── matrix.py             # the §5 rows as scenarios (groups S, B–G, A)
├── run_conformance.py    # CLI entry point
└── results/              # evidence bundles (git-ignored; commit a run when releasing)
```

```sh
python3 conformance/run_conformance.py --list            # inventory
python3 conformance/run_conformance.py                   # device scenarios
COMPANION_URL=http://companion.local:8000 \
  python3 conformance/run_conformance.py --groups A,F     # module-facing scenarios
```

Adding a scenario means adding a `@scenario(...)` function in `matrix.py`. §5 stays
the source of truth for what is covered; `--list` prints the inventory.
