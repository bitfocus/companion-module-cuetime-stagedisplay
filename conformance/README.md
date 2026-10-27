# T2 conformance harness

Three-way conformance testing for this module, as specified in
[`docs/CONFORMANCE.md`](../docs/CONFORMANCE.md) §4:

1. **Intent** — press buttons through Companion's own HTTP API (no module code is
   imported, so a pass means what an operator would see).
2. **Effect** — a second WebSocket client on the device records the same broadcast
   event stream the module receives, plus `request_status` snapshots. The device is
   the oracle.
3. **Report** — read the module's variables back from Companion and compare them to
   the device's report.

## Requirements

- Python 3.11+ with `websockets` and `requests` (no pytest needed).
- A CueTime device reachable on TCP 8081.
- Optional: Companion 5.1+ reachable over HTTP for the module-facing groups (A, F).

## Usage

```sh
# inventory
python3 conformance/run_conformance.py --list

# device scenarios (no Companion needed): greeting, timer, program edits,
# messages/flash, display state, error paths, back-pressure
python3 conformance/run_conformance.py

# module-facing scenarios: hydration (A) and reverse-direction tracking (F)
COMPANION_URL=http://companion.local:8000 python3 conformance/run_conformance.py --groups A,F

# a single scenario, verbose
python3 conformance/run_conformance.py --only D3 -v
```

Configuration (CLI flags win):

| Variable | Default | Meaning |
| --- | --- | --- |
| `CUETIME_DEVICE` | `192.168.1.145` | device host/IP |
| `CUETIME_DEVICE_PORT` | `8081` | device WebSocket port |
| `COMPANION_URL` | — | e.g. `http://companion.local:8000` |
| `COMPANION_CONNECTION` | auto | connection id or label; otherwise the only `cuetime-stagedisplay` connection is used |
| `COMPANION_PAGE` | `1` | page 1-based; rows/cols 0-based |

## What a run writes

`conformance/results/<UTC stamp>/`:

| File | Content |
| --- | --- |
| `run.json` | device `hello_event` (version code/name, screen id), Companion connection, every scenario and check |
| `timeline-<scenario>.jsonl` | every frame the harness client received, in arrival order |
| `variables-<scenario>.jsonl` | module-variable polls taken during the scenario |
| `junit.xml` | machine-readable results |
| `notes.md` | summary plus failures, for pasting into an issue |

`results/` is git-ignored. When a run is the evidence for a release, copy its
`run.json` + `notes.md` into `docs/conformance-runs/<tag>/` and commit those.

## Safety

- Every scenario restores what it changed (message hidden, effects off, paused),
  and the runner re-selects and pauses the session that was current when it
  started, so a run leaves the device as it found it.
- Temporary sessions/messages are deleted in a `finally`, keyed to unique ids.
- Scenarios create their own device connection and close it afterwards, so a
  stalled client in `G3` cannot leak into the next scenario.

## Adding a scenario

Add a `@scenario(...)` function in `matrix.py`:

```python
@scenario('B7', 'B', 'reset_current_session zeroes the timer', '§3.2')
async def b7_reset(ctx: Ctx) -> None:
    status = await ctx.snapshot()
    ctx.equal('timer is zero', DeviceClient.cc(status).get('timer'), 0)
```

`ctx` gives you `device` (raw protocol), `companion` (may be `None`),
`check`/`equal`, and `snapshot()`, which also records a variable poll when
Companion is configured. Device-only scenarios omit `needs_companion=True` and run
everywhere; module-facing ones set it and are skipped without a Companion URL.

Keep `docs/CONFORMANCE.md` §5 in step with the code — the table is the contract of
what has been tested, `--list` is the inventory.
