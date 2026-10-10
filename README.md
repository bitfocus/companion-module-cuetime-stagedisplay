# companion-module-cuetime-stagedisplay

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Protocol reference

The module controls CueTime Stage Display devices over the JSON control protocol,
**over WebSocket only** (`ws://<device>:8081`).
[HTTP_JSON_CONTROL_PROTOCOL.md](./HTTP_JSON_CONTROL_PROTOCOL.md) documents the messages.

The authoritative machine-readable schema is
[`schemas/protocol-schema.json`](./schemas/protocol-schema.json), **vendored
verbatim** from the sibling `Android-Display-App/` repo. Both the spec and the schema
are generated far-side from the Kotlin `@Serializable` data classes; the vendored
copies are committed so this repo builds standalone. See
[docs/CONFORMANCE.md](./docs/CONFORMANCE.md) for the exact far-side commit, content
hash, and regeneration instructions.

`src/protocol/generated.ts` is generated from the vendored schema by
`scripts/generate-protocol.mjs`. After updating the vendored schema, run:

```sh
yarn generate-protocol
```

Do not hand-edit `src/protocol/generated.ts`.

## Actions

- `navigate_next_session` — Navigate to next session
- `navigate_previous_session` — Navigate to previous session
- `show_session` — Jump to a session by id
- `toggle_playback` — Toggle between play and pause based on the device's reported run state
- `start_session` — Start or resume the current session
- `pause_session` — Pause the current session
- `reset_current_session` — Return the current session to its configured start value, paused
- `reset_program_elapsed_timer` — Reset the program elapsed counter
- `add_session` — Append a session (mode, duration or time-of-day offset, presenter, notes, flash timing), optionally starting it
- `move_session_up` / `move_session_down` — Reorder a session by id
- `delete_all_sessions` / `delete_all_messages` — Remove every session or message (requires confirmation)
- `add_time` — Add seconds to the timer
- `subtract_time` — Subtract seconds from the timer
- `blackout` — Enable, disable, or toggle blackout
- `set_glow` / `toggle_glow` — Control the glow effect
- `set_flash` / `toggle_flash` — Control the message flash
- `set_brightness` — Set the backlight (whole number, 0–100)
- `set_is_time_up_display` / `toggle_is_time_up_display` — Control the time-is-up overlay
- `show_message` — Show a message; pressing again while one is on screen hides it
- `hide_message` — Take the message off screen without deleting it
- `show_idle` — Show the idle screen

## Variables

- `timer_run_state` — Timer engine state (`idle`, `running`, `paused`)
- `elapsed_time` — Session running time (ms)
- `timer` — Current on-screen reading (ms, unsigned)
- `current_session_name` — Current session name
- `current_presenter_name` — Current presenter name
- `is_playing` — Whether timer is running ("Yes"/"No")
- `is_glowing` — Whether glow effect is active ("Yes"/"No")
- `is_blackout` — Whether blackout mode is active ("Yes"/"No")
- `message_text` — Current message text
- `current_session_number` — Current session number (1-based)
- `total_sessions` — Total number of sessions in the program
- `elapsed_formatted` — Formatted elapsed time (MM:SS or HH:MM:SS)
- `remaining_formatted` — Formatted remaining time (MM:SS or HH:MM:SS)
- `previous_session_name` — Name of the previous session
- `next_session_name` — Name of the next session
- `previous_session_presenter_name` / `next_session_presenter_name` — Presenter of the previous / next session

## Feedbacks

- `is_connected` — Device Is Connected
- `is_playing` / `is_paused` / `is_idle` — Which `timer_run_state` the device reports
- `is_glowing` — Glow Effect Active
- `is_blackout` — Blackout Mode Active
- `is_flashing` — Flash Effect Active
- `has_previous_session` / `no_previous_session` — Whether navigating back is available
- `has_next_session` / `no_next_session` — Whether navigating forward is available
- `message_showing` — Message Is Showing
- `is_time_up_display` — Time-is-Up Display Enabled
- `is_time_up_flashing` — Time-is-Up Flash Active

## Presets

Below is an overview of the built-in presets. After applying a preset, you can customize its text, colors, and actions in the Companion button editor.

### Navigation

- **Navigate to Next Session** — Icon button, no feedback
- **Navigate to Previous Session** — Icon button, no feedback
- **Previous Session** — Displays `previous_session_name` on a frame. Tapping navigates to the previous session. Blue feedback when a previous session exists.
- **Next Session** — Displays `next_session_name` on a frame. Tapping navigates to the next session. Blue feedback when a next session exists.

### Timer Control

- **Toggle Playback** — Icon button. Toggles between start and pause based on the device's current playing state. Top bar shows green when playing.
- **Pause Timer** — Icon button. Always pauses.
- **Add Time** — Icon button. Adds 60 seconds.
- **Subtract Time** — Icon button. Subtracts 30 seconds.

### Time Display

- **Elapsed Time** — Large formatted elapsed time. Top bar shows green when timer is running.
- **Remaining Time** — Large formatted remaining time. Top bar shows green when timer is running.
- **Time Info** — Shows elapsed time on top line and remaining time on bottom line, on a frame. Top bar shows green when timer is running.

### Session Info

- **Session Counter** — Shows `current_session_number/total_sessions` on the first line and `current_session_name` on the second line, on a frame. Green feedback when timer is running.

### Message

- **Show Message** — Icon with "M?" text on it. The default message text is "Fill in message" — edit the button's action to change the text. Tapping the button again hides the message.

### Effects

- **Toggle Flash** — Flash icon. Orange feedback when flash is active.
- **Toggle Glow** — Glow icon. Yellow feedback when glow is active.

### Customizing Presets

All presets can be customized after applying them to a button:

- **Text**: Change the `text` field in the button's style to use different variable references or static text.
- **Colors**: Adjust `color` (text color) and `bgcolor` (background color) in the button's style.
- **Actions**: Modify the action options (e.g., change the message text, seconds to add/subtract).
- **Icons**: The presets using `icon_frame` can be swapped for any icon in the button's style settings.
