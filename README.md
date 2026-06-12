# companion-module-cuetime-stagedisplay

See [HELP.md](./companion/HELP.md) and [LICENSE](./LICENSE)

Supported actions:

- `navigate_next_session` — Navigate to next session
- `navigate_previous_session` — Navigate to previous session
- `pause_timer` — Pause the timer
- `resume` — Resume from pause (sends `start_timer`)
- `start_timer` — Start the timer
- `setup_timer` — Configure a new timer
- `add_time` — Add seconds to the timer
- `subtract_time` — Subtract seconds from the timer
- `blackout` — Enable, disable, or toggle blackout
- `set_glow` — Enable or disable glow effect
- `toggle_glow` — Toggle glow effect
- `set_flash` — Enable or disable flash effect
- `toggle_flash` — Toggle flash effect
- `show_message` — Show a message on screen
- `hide_display` — Hide the display
- `show_idle` — Show the idle screen

Supported variables:

- `elapsed_time` — Session elapsed time (ms)
- `timer` — Current timer value (ms)
- `current_session_name` — Current session name
- `current_presenter_name` — Current presenter name
- `is_playing` — Whether timer is running
- `is_glowing` — Whether glow effect is active
- `is_blackout` — Whether blackout mode is active
- `message_text` — Current message text
