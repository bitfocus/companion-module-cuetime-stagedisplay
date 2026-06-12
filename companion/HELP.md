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
- **Pause Timer** — Pause the current timer
- **Resume** — Resume a paused timer
- **Setup Timer** — Configure a new timer with duration, mode, and initial state
- **Add Time** — Add seconds to the current timer
- **Subtract Time** — Subtract seconds from the current timer
- **Blackout** — Enable, disable, or toggle the blackout screen
- **Set Glow** — Enable or disable the glow effect
- **Toggle Glow** — Toggle the glow effect on/off
- **Set Flash** — Enable or disable the flash effect
- **Toggle Flash** — Toggle the flash effect on/off
- **Show Message** — Display a message on the screen
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

## Feedbacks

- **Timer is Running** — Button lights up when timer is running
- **Glow Effect Active** — Button lights up when glow is on
- **Blackout Mode Active** — Button lights up when blackout is active
- **Flash Effect Active** — Button lights up when flash is on
- **Previous Session Exists** — Button lights up when there is a previous session
- **Next Session Exists** — Button lights up when there is a next session
- **Message Is Showing** — Button lights up when a message is displayed
- **Device Is Connected** — Button lights up when the device is reachable
- **Time-is-Up Display Enabled** — Button lights up when the time-is-up display is enabled
