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

- **Navigate to Next Session** — Move to the next session. Does nothing when the device reports there is no next session.
- **Navigate to Previous Session** — Move to the previous session. Does nothing when the device reports there is no previous session.
- **Show Session by ID** — Jump straight to a session by its id.

### Playback

- **Toggle Playback** — Pauses a running timer, starts a paused or idle one. Uses the device's reported `timer_run_state`, so a paused timer resumes rather than being treated as idle.
- **Start / Resume Session** — Start or resume the current session's timer.
- **Pause Session** — Pause the current session's timer. Rejected by the device for a time-of-day session, which cannot be paused.
- **Reset Current Session** — Return the current session to its configured start value and leave it paused.
- **Reset Program Elapsed Timer** — Reset the program's elapsed counter.

### Program editing

- **Add Session** — Append a session to the program, with mode, duration or time-of-day offset, presenter, notes and flash timing, and optionally start it immediately. Refuses to send a countdown shorter than 1 second, which the device rejects.
- **Move Session Up** / **Move Session Down** — Reorder a session by id.
- **Delete All Sessions** — Remove every session. Requires the confirm checkbox to be ticked.
- **Delete All Messages** — Remove every message. Requires the confirm checkbox to be ticked.

### Time adjustment

- **Add Time** — Add seconds to the current timer.
- **Subtract Time** — Subtract seconds from the current timer.

### Effects and display

- **Blackout** — Enable, disable, or toggle the blackout screen. `set_blackout` has no toggle form, so toggling is resolved from the device's reported `is_blackout`.
- **Set Glow** / **Toggle Glow** — Control the glow effect. Glow and blackout are mutually exclusive on the device.
- **Set Flash** / **Toggle Flash** — Control the 1 Hz message flash.
- **Set Brightness** — Set the backlight to a whole number from 0 to 100.
- **Set Time-is-Up Display** / **Toggle Time-is-Up Display** — Control the time-is-up overlay.
- **Show Idle Screen** — Take the timer off screen and return to the idle state.

### Messages

- **Show Message** — Display a message with optional flashing. Pressing the button again while a message is on screen hides it, so one button toggles.
- **Hide Message** — Take the message off screen without removing it from the program.

## Variables

- **timer_run_state** — Timer engine state: `idle`, `running`, or `paused`
- **elapsed_time** — Session running time in milliseconds
- **timer** — Current on-screen reading in milliseconds (unsigned)
- **current_session_name** — Name of the current session
- **current_presenter_name** — Name of the current presenter
- **is_playing** — Whether the timer is running ("Yes"/"No")
- **is_glowing** — Whether glow effect is active ("Yes"/"No")
- **is_blackout** — Whether blackout mode is active ("Yes"/"No")
- **message_text** — Currently displayed message text
- **current_session_number** — Current session number (1-based, e.g., 2 for the second session)
- **total_sessions** — Total number of sessions in the program
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
