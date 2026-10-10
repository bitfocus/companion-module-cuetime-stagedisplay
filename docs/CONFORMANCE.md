# Protocol Conformance Notes

This module targets the CueTime **JSON control protocol over WebSocket**
(`ws://<device>:8081`), as specified by the far-side CueTime Display app.

## Vendored artifacts

| Artifact      | Vendored path                   | Far-side source                                          |
| ------------- | ------------------------------- | -------------------------------------------------------- |
| Protocol spec | `HTTP_JSON_CONTROL_PROTOCOL.md` | `Android-Display-App/docs/HTTP_JSON_CONTROL_PROTOCOL.md` |
| JSON Schema   | `schemas/protocol-schema.json`  | `Android-Display-App/schemas/protocol-schema.json`       |

Both were copied verbatim from `Android-Display-App` at commit
`e0b2069a` ("Align the HTTP JSON protocol docs, schema and validation.",
2026-10-09), which last touched these files. The document header records
**Reviewed Date 2026-10-09, Version Code 146**.

Schema content hash (md5): `24550e042dde121e84338e4211121dbd`.

## Regenerating the far-side artifacts

The schema is generated from Kotlin `@Serializable` classes; the document is
generated from `HTTP_JSON_CONTROL_PROTOCOL_TMPLT.md`. From the far-side repo:

```sh
cd Android-Display-App/CueTimeDisplay
./gradlew generateJsonProtocolSchema
```

Then re-copy both files into this repo (the vendored copies must stay
byte-identical), re-run `yarn generate-protocol`, and commit the result.

## Target firmware

- WebSocket transport only; **no HTTP transport** in this module (D1).
- Targets **vc 146**-era firmware. Command names and field shapes below are the
  vc146 contract; older firmware is not supported.

### Protocol facts the module relies on

- Every reply `type` ends in `_response`; every pushed event `type` ends in
  `_event`. `hello_event` arrives immediately on connect.
- Replies echo `request_id` when the client sent one; the module always sends a
  fresh `request_id` and correlates by it (replies are not order-guaranteed).
- `control_center.timer_run_state` is `idle` | `running` | `paused`.
  (`is_playing` no longer exists.)
- Session summaries use `is_current`; `control_center` time fields are
  milliseconds, session `duration` is seconds, and a `time_of_day` `offset` is
  milliseconds past midnight.
- `settings.screen_version` (not `settings.version`).
- A `countdown` session duration must be **≥ 1 second** (0 is rejected).
- `show_session` no longer accepts `session_state`.
- `set_flash` takes `action: enable | disable | toggle`.
- `add_session` / `add_message` / `show_message` return the new/affected id in
  `ack_response.entity_id`.
- Absent fields are omitted, not `null` (except where the schema explicitly
  allows `null`).

## Verification status

- [x] Unit: generated builders validate against the vendored schema (ajv).
- [x] Unit: inbound response/event fixtures parse.
- [x] Unit: state and variable/feedback derivation from event sequences.
- [x] Integration: client exercises the real `ws` transport against an in-process
      mock server (frame decoding, hydration, request-id correlation, errors).
- [ ] Fixture parity: port the far-side `integration_tests/test_ws_json_protocol.py`
      cases. Until this exists, the unit conversions below are asserted only by
      hand-written expectations.
- [ ] Integration: manual pass against a vc146 device.
- [ ] Parity: far-side `integration_tests/test_ws_json_protocol.py` run against
      the same device.

See `plans/PROTOCOL_VC146_SYNC.md` for the remaining work list.
