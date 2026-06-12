# CueTime Stage Display

This module controls CueTime Stage Display devices over the HTTP JSON Control Protocol.

## Configuration

### Discovery via mDNS

CueTime Display devices advertise themselves on the local network via mDNS/DNS-SD under the service type `_cuetime._tcp`. In the module config, you can either:

1. **Select a discovered device** from the dropdown (populated automatically by Companion via mDNS)
2. **Manually enter** the device IP address and port if mDNS is unavailable

### Manual Connection

If mDNS is unavailable, enter the device's IP address and port (default: 8080).

## Actions

- **Navigate to Next Session** — Move to the next session in the program
- **Navigate to Previous Session** — Move to the previous session in the program
- **Start Timer** — Start or resume the current timer
- **Resume** — Resume a paused timer
- **Pause Timer** — Pause the current timer
- **Toggle Playback** — If the timer is running, pauses it; if stopped or paused, starts it. Uses the device's actual state.
- **Setup Timer** — Configure a new timer with duration, mode, initial state, optional session ID, and flash timing
- **Add Time** — Add seconds to the current timer
- **Subtract Time** — Subtract seconds from the current timer
- **Blackout** — Enable, disable, or toggle the blackout screen
- **Set Glow** — Enable or disable the glow effect
- **Toggle Glow** — Toggle the glow effect on/off
- **Set Flash** — Enable or disable the flash effect
- **Toggle Flash** — Toggle the flash effect on/off
- **Show Message** — Display a message on the screen. Pressing the same button again hides the message.
- **Hide Display** — Hide the display
- **Show Idle Screen** — Show the idle screen

## Variables

- **elapsed_time** — Session elapsed time in milliseconds
- **timer** — Current timer value in milliseconds
- **current_session_name** — Name of the current session
- **current_presenter_name** — Name of the current presenter
- **is_playing** — Whether the timer is running ("Yes"/"No")
- **is_glowing** — Whether glow effect is active ("Yes"/"No")
- **is_blackout** — Whether blackout mode is active ("Yes"/"No")
- **message_text** — Currently displayed message text
- **current_session_number** — Current session number (1-based, e.g., 2 for the second session)
- **total_sessions** — Total number of sessions in the program
- **elapsed_formatted** — Formatted elapsed time (MM:SS or H:MM:SS)
- **remaining_formatted** — Formatted remaining time (MM:SS or H:MM:SS)
- **previous_session_name** — Name of the session before the current one
- **next_session_name** — Name of the session after the current one

## Feedbacks

- **Timer is Running** — Button lights up green when the timer is running
- **Glow Effect Active** — Button lights up when glow is on
- **Blackout Mode Active** — Button lights up when blackout is active
- **Flash Effect Active** — Button lights up when flash is on
- **Previous Session Exists** — Button lights up when there is a previous session
- **Next Session Exists** — Button lights up when there is a next session
- **Message Is Showing** — Button lights up when a message is displayed
- **Device Is Connected** — Button lights up when the device is reachable
- **Time-is-Up Display Enabled** — Button lights up when the time-is-up display is enabled

## Presets

The module includes a set of built-in presets. After applying a preset to a button, you can freely customize colors, text, actions, and icons in the Companion button editor.

### Navigation Presets

| Preset | Description |
|--------|-------------|
| **Navigate to Next Session** | Arrow icon. No feedback. |
| **Navigate to Previous Session** | Arrow icon. No feedback. |
| **Previous Session** | Shows the previous session name on a frame. Tap to navigate back. Blue highlight when a previous session exists. |
| **Next Session** | Shows the next session name on a frame. Tap to navigate forward. Blue highlight when a next session exists. |

### Timer Control Presets

| Preset | Description |
|--------|-------------|
| **Toggle Playback** | Play/pause icon. Starts or pauses based on the device's actual playing state. Top bar turns green when the timer is running. |
| **Pause Timer** | Play/pause icon. Always pauses the timer. |
| **Add Time** | Plus icon. Adds 60 seconds. |
| **Subtract Time** | Minus icon. Subtracts 30 seconds. |

### Time Display Presets

| Preset | Description |
|--------|-------------|
| **Elapsed Time** | Large readout of the formatted elapsed time. Top bar turns green when running. |
| **Remaining Time** | Large readout of the formatted remaining time. Top bar turns green when running. |
| **Time Info** | Stacked readout showing elapsed time on top and remaining time on bottom, on a frame. Top bar turns green when running. |

### Session Info Preset

| Preset | Description |
|--------|-------------|
| **Session Counter** | Shows "X/Y" on the first line and the current session name on the second line, on a frame. Green feedback when timer is running. |

### Message Preset

| Preset | Description |
|--------|-------------|
| **Show Message** | Message icon with "M?" text. The default action sends "Fill in message" — edit the button's action to change the text. **Tapping the button again hides the message**, making it a toggle. |

The message toggle works by tracking the last shown message per button press. To create additional message buttons with different text, edit the action's `Message text` field.

### Effect Presets

| Preset | Description |
|--------|-------------|
| **Toggle Flash** | Flash icon. Toggles the flash effect. Orange feedback when active. |
| **Toggle Glow** | Glow icon. Toggles the glow effect. Yellow feedback when active. |

### Customizing Presets

After applying a preset to a button, you can:

- **Change the text**: Edit the button's `text` field to use any variable reference (e.g., `$(cuetime:current_session_name)`) or static text.
- **Change the colors**: Adjust text color (`color`) and background color (`bgcolor`) in the button's style tab.
- **Change the action parameters**: For example, edit the Show Message action's `Message text` to send a different message.
- **Swap icons**: Presets using `icon_frame` can use any icon by changing the button's image in the style tab.
- **Add additional actions**: Buttons can have multiple actions, feedbacks, and long-press behaviors.
