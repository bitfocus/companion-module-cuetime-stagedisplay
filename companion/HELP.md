# CueTime Stage Display

This module controls CueTime Stage Display devices over the CueTime **JSON control
protocol, WebSocket transport only** (`ws://<device>:8081`).

The authoritative machine-readable schema for the protocol is `protocol-schema.json`,
generated from the Kotlin `@Serializable` data classes in the sibling
`Android-Display-App/` repo (`../../Android-Display-App/schemas/protocol-schema.json`
relative to this repo's checkout). It covers both the HTTP (port 8080) and WebSocket
(port 8081) transports, which share the same JSON message format; this module uses
only the WebSocket transport, because it is the transport that pushes state changes
as events.

The device is the source of truth for state. The module never guesses and never
polls: it connects, waits for `hello_event`, hydrates once with `request_status`,
and then tracks the events the device pushes.

## Configuration

### Discovery via mDNS

CueTime Display devices advertise themselves on the local network via mDNS/DNS-SD under the service type `_cuetime._tcp`. In the module config, you can either:

1. **Select a discovered device** from the dropdown (populated automatically by Companion via mDNS)
2. **Manually enter** the device IP address and port if mDNS is unavailable

A discovered device takes precedence over a manually entered address.

### Manual Connection

If mDNS is unavailable, enter the device's IP address and port (default: 8081).

## Actions

### Navigation

- **Navigate to Next Session** — Move to the next session. From an **idle** display this selects the first session instead, because the device rejects navigation when nothing is current and has no fallback to the first. Does nothing (with a debug log) at the last session.
- **Navigate to Previous Session** — Move to the previous session. From an **idle** display this also selects the first, since there is nothing before the start of a program.
- **Show Session** — Select a session by its **position** in the program (1 = first). This is the only way into a program from idle, and needs no ids.

### Playback

- **Toggle Playback** — Pauses a running timer, starts a paused or idle one. Uses the device's reported `timer_run_state`, so a paused timer resumes rather than being treated as idle.
- **Start / Resume Session** — Start or resume the current session's timer. From an **idle** display this starts the **first** session, so Play works without selecting anything first.

A note on idle: `start_session` and `navigate_*` are both rejected when no session is
current ("No active session to start", "No next session available"), and the device is
explicit that it has no fallback to the first session. The module handles this for you
as described above — it either names the first session or selects it first — so the
buttons work from idle without any extra setup.

Also note the device leaves a **navigated** session paused, so after moving to the next
session you still need Play to start its timer.

- **Pause Session** — Pause the current session's timer.
- **Reset Current Session** — Return the current session to its configured start value and leave it paused.
- **Reset Program Elapsed Timer** — Reset the program's elapsed counter.

A **Time of Day** session is a wall clock: it always runs, has no length, and cannot be
paused or reset. These actions therefore do nothing when the current session is a Time
of Day one — the device would refuse them anyway, and skipping locally means the log
says why instead of a button appearing to be broken.

### Sessions

- **Add Session** — Append a session to the program, with mode, duration or time-of-day offset, presenter, notes and flash timing, and optionally start it immediately. Refuses to send a countdown shorter than 1 second, which the device rejects.
- **Update Session** — Edit an existing session. Leave the session id blank to edit the current one, and leave any field blank to preserve it. Two device rules are enforced up front: a **running** session cannot be edited (pause or reset it first), and switching a session **to** Time of Day requires an offset. Editing the current, non-running session re-arms it immediately and **discards the position it was paused at** — the device says so in its reply, and the module logs that message.
- **Move Session Up** / **Move Session Down** — Reorder a session. Leave the session id blank to move the **current** session, which is usually what an operator wants mid-show. Does nothing when the session is already first (up) or last (down), rather than provoking a device error.
- **Delete Session** — Remove one session. Blank means the current session. Refused while that session's timer is running. Deleting a paused or idle _current_ session also clears the timer and returns the display to the idle screen.
- **Delete All Sessions** — Remove every session. Requires the confirm checkbox to be ticked.

### Time adjustment

- **Add Time** — Add seconds to the current timer. Fractional seconds are accepted; they are converted to whole milliseconds, which is the field the device expects.
- **Subtract Time** — Subtract seconds from the current timer.

Both do nothing on a Time of Day session, for the same reason as Pause Session above.

### Effects and display

- **Blackout** — Enable, disable, or toggle the blackout screen. `set_blackout` has no toggle form, so toggling is resolved from the device's reported `is_blackout`.
- **Set Glow** / **Toggle Glow** — Control the glow effect. Glow and blackout are mutually exclusive on the device.
- **Set Flash** / **Toggle Flash** — Control the 1 Hz message flash.
- **Set Brightness** — Set the backlight to a whole number from 0 to 100.
- **Set Time-is-Up Display** / **Toggle Time-is-Up Display** — Control the time-is-up overlay.
- **Show Idle Screen** — Take the timer off screen and return to the idle state.

### Messages

Messages are addressed by **position in the program's message list** (1 = first). The
protocol's message summaries carry no position field — the list order _is_ the
position — so a position is the only address an operator can reason about without
copying opaque ids out of the device. The `total_messages` variable tells you how
many there are.

`show_message` accepts **either** a stored message number **or** literal text. A
stored message is shown with its own configured flash settings, which is why
addressing it by number is preferable when the message already exists in the program.
The two forms differ in reach: a stored message is a program message, whereas literal
text is an ad-hoc overlay that leaves the program untouched — and unlike the stored
form, it needs no program loaded.

- **Add Message** — Append a message to the program's message list. Adding does not display it; use **Show Message** for that.
- **Update Message** — Replace the text of the message at a given position. Allowed even while that message is on screen (only _deleting_ a displayed message is refused).
- **Delete Message** — Delete the message at a given position. The device refuses this while that message is on screen ("device busy"), so hide it first.
- **Move Message Up** / **Move Message Down** — Reorder the message at a given position. Does nothing when it is already first (up) or last (down).
- **Delete All Messages** — Remove every message. Requires the confirm checkbox to be ticked.
- **Show Message** — Display a message, addressed either by a stored message number or by arbitrary text. Set the stored message number to 0 to use the text field. Pressing the button again takes that specific message down, so one button toggles — and a second button for a different message still works while the first is on screen.
- **Hide Message** — Take the message off screen without removing it from the program.

## Variables

- **timer_run_state** — Timer engine state: `idle`, `running`, or `paused`
- **elapsed_time** — Session running time in milliseconds
- **timer** — Current on-screen reading in milliseconds (unsigned)
- **current_session_name** — Name of the current session
- **current_presenter_name** — Name of the current presenter
- **current_session_id** — Id of the current session (empty when idle)
- **current_session_mode** — Mode of the current session (`countdown`, `countup`, `time_of_day`, or empty when idle)
- **is_playing** — Whether the timer is running ("Yes"/"No")
- **is_glowing** — Whether glow effect is active ("Yes"/"No")
- **is_blackout** — Whether blackout mode is active ("Yes"/"No")
- **message_text** — Currently displayed message text
- **current_session_number** — Current session number (1-based, e.g., 2 for the second session)
- **total_sessions** — Total number of sessions in the program
- **total_messages** — Total number of messages in the program
- **progress_bar** — Remaining proportion of a **countdown**, 0–100 (100 at the start, 0 when it finishes). Count-up and Time of Day sessions always read 0.
- **elapsed_formatted** — Formatted elapsed time (MM:SS or HH:MM:SS)
- **remaining_formatted** — Formatted remaining time (MM:SS or HH:MM:SS)
- **previous_session_name** — Name of the session before the current one
- **next_session_name** — Name of the session after the current one
- **previous_session_presenter_name** — Presenter of the previous session
- **next_session_presenter_name** — Presenter of the next session

## Feedbacks

- **Device Is Connected** — The WebSocket transport is connected and the device has said hello
- **Timer Is Running** / **Timer Is Paused** / **Timer Is Idle** — Which of the three `timer_run_state` values the device reports
- **Glow Effect Active** — Glow is on
- **Blackout Mode Active** — Blackout is on
- **Flash Effect Active** — The message flash is on
- **Previous Session Exists** / **No Previous Session** — Whether navigating back is available
- **Next Session Exists** / **No Next Session** — Whether navigating forward is available
- **Message Is Showing** — A message is on screen
- **Time-is-Up Display Enabled** — The time-is-up overlay is enabled
- **Time-is-Up Flash Active** — The time-is-up flash is running
- **Session Progress Bar** — Draws the remaining proportion as a colour strip along the bottom or top edge of the button, optionally with the percentage as text. **The device only reports a progress percentage for a countdown session**, so on a count-up or Time of Day session the bar stays empty for the session's whole life — worth checking which sessions a button will be used during. The strip is a raw pixel buffer refreshed on each state event, so a thick bar costs more to draw than a thin one.

## Presets

The module includes a set of built-in presets. After applying a preset to a button, you can freely customize colors, text, actions, and icons in the Companion button editor.

### Navigation Presets

| Preset                           | Description                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Navigate to Next Session**     | Arrow icon. No feedback.                                                                                         |
| **Navigate to Previous Session** | Arrow icon. No feedback.                                                                                         |
| **Previous Session**             | Shows the previous session name on a frame. Tap to navigate back. Blue highlight when a previous session exists. |
| **Next Session**                 | Shows the next session name on a frame. Tap to navigate forward. Blue highlight when a next session exists.      |

### Timer Control Presets

| Preset              | Description                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **Toggle Playback** | Play/pause icon. Starts or pauses based on the device's reported run state. Top bar turns green when the timer is running. |
| **Pause Timer**     | Play/pause icon. Always pauses the timer.                                                                                  |
| **Add Time**        | Plus icon. Adds 60 seconds.                                                                                                |
| **Subtract Time**   | Minus icon. Subtracts 30 seconds.                                                                                          |

### Time Display Presets

| Preset             | Description                                                                                                             |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **Elapsed Time**   | Large readout of the formatted elapsed time. Top bar turns green when running.                                          |
| **Remaining Time** | Large readout of the formatted remaining time. Top bar turns green when running.                                        |
| **Time Info**      | Stacked readout showing elapsed time on top and remaining time on bottom, on a frame. Top bar turns green when running. |

### Session Info Preset

| Preset              | Description                                                       |
| ------------------- | ----------------------------------------------------------------- |
| **Session Counter** | Shows "X/Y" on a frame. Green feedback when the timer is running. |

### Message Preset

| Preset           | Description                                                                                                                                                                              |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Show Message** | Message icon with "M?" text. The default action sends "Fill in message" — edit the button's action to change the text. Pressing it again while a message is on screen hides the message. |

The toggle reads the message state the device reports, so it stays correct even when the message was shown or hidden from elsewhere. To create additional message buttons with different text, edit the action's `Message text` field.

### Effect Presets

| Preset           | Description                                                        |
| ---------------- | ------------------------------------------------------------------ |
| **Toggle Flash** | Flash icon. Toggles the flash effect. Orange feedback when active. |
| **Toggle Glow**  | Glow icon. Toggles the glow effect. Yellow feedback when active.   |

### Customizing Presets

After applying a preset to a button, you can:

- **Change the text**: Edit the button's `text` field to use any variable reference (e.g., `$(cuetime:current_session_name)`) or static text.
- **Change the colors**: Adjust text color (`color`) and background color (`bgcolor`) in the button's style tab.
- **Change the action parameters**: For example, edit the Show Message action's `Message text` to send a different message.
- **Swap icons**: Presets using `icon_frame` can use any icon by changing the button's image in the style tab.
- **Add additional actions**: Buttons can have multiple actions, feedbacks, and long-press behaviors.
