# companion-module-cuetime-stagedisplay

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

## Actions

- `navigate_next_session` — Navigate to next session
- `navigate_previous_session` — Navigate to previous session
- `start_timer` — Start the timer
- `resume_timer` — Resume from pause
- `pause_timer` — Pause the timer
- `toggle_playback` — Toggle between play and pause based on current device state
- `setup_timer` — Configure a new timer (duration, mode, initial state, session_id, flash params)
- `add_time` — Add seconds to the timer
- `subtract_time` — Subtract seconds from the timer
- `blackout` — Enable, disable, or toggle blackout
- `set_glow` — Enable or disable glow effect
- `toggle_glow` — Toggle glow effect on/off
- `set_flash` — Enable or disable flash effect
- `toggle_flash` — Toggle flash effect on/off
- `show_message` — Show a message on screen; tap again to hide it
- `hide_display` — Hide the display
- `show_idle` — Show the idle screen

## Variables

- `elapsed_time` — Session elapsed time (ms)
- `timer` — Current timer value (ms)
- `current_session_name` — Current session name
- `current_presenter_name` — Current presenter name
- `is_playing` — Whether timer is running ("Yes"/"No")
- `is_glowing` — Whether glow effect is active ("Yes"/"No")
- `is_blackout` — Whether blackout mode is active ("Yes"/"No")
- `message_text` — Current message text
- `current_session_number` — Current session number (1-based)
- `total_sessions` — Total number of sessions in the program
- `elapsed_formatted` — Formatted elapsed time (MM:SS or H:MM:SS)
- `remaining_formatted` — Formatted remaining time (MM:SS or H:MM:SS)
- `previous_session_name` — Name of the previous session
- `next_session_name` — Name of the next session

## Feedbacks

- `is_playing` — Timer is Running
- `is_glowing` — Glow Effect Active
- `is_blackout` — Blackout Mode Active
- `is_flashing` — Flash Effect Active
- `has_previous_session` — Previous Session Exists
- `has_next_session` — Next Session Exists
- `message_showing` — Message Is Showing
- `is_connected` — Device Is Connected
- `is_time_up_display` — Time-is-Up Display Enabled

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
