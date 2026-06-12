# HTTP JSON Control Protocol

A simplified, unauthenticated JSON-based control protocol for CueTime Display over HTTP.

## Overview

**Protocol:** HTTP/1.1 (or HTTP/2)
**Format:** JSON (request body and response)
**Base URL:** `http://<device-ip>:8080/api` (default)
**Port:** 8080 (default)
**Authentication:** None (unauthenticated mode)
**Current Version:** 1

## Service Discovery via mDNS

CueTime Display devices are discoverable on the local network using **mDNS/DNS-SD** (Multicast DNS / DNS Service Discovery). This allows clients to find devices without knowing their IP address in advance.

### Service Type

Look for services of type:

```
_cuetime._tcp
```

### Service Name

The default service name is:

```
CueTime Display
```

This may be customized by the device operator. Discovered services will have this human-readable name.

### TXT Records

Once a service is resolved, the following TXT record keys are available:

| Key | Value | Description |
|-----|-------|-------------|
| `version` | `2.0` | Service version identifier |
| `http_port` | `8080` | **HTTP JSON control port (this protocol)** |
| `cert` | `SHA256:<fingerprint>` | TLS certificate fingerprint (when available) |
| `package` | `com.tougtechnologies.cuetimedisplay` | Android package name |
| `hostname` | `<model>.local` | Device hostname for TLS certificate validation |
| `disp_name` | `<device model>` | Human-readable device model name (e.g., "Amazon Fire TV Cube") |
| `serial` | `<android_id>` | Unique, unchanging device serial (Android ID) |

### Making the Connection

1. **Discover**: Browse for `_cuetime._tcp` services on the local network using mDNS client software (e.g., `avahi-browse`, `dns-sd`, or libraries like JmDNS, Android NSD).
2. **Resolve**: Resolve the discovered service to obtain its IP address and TXT records.
3. **Read the HTTP port**: Extract the `http_port` TXT record value (default: `8080`).
4. **Connect**: Use the resolved IP address and HTTP port as the base URL:

   ```
   http://<resolved-ip>:<http_port>/api/command
   ```

### Example Usage

**Using `dns-sd` (macOS/Linux) to browse:**
```bash
dns-sd -B _cuetime._tcp local
```

**Using `avahi-browse` (Linux):**
```bash
avahi-browse -t _cuetime._tcp
```

**Once a service is found, resolve it to get the IP and TXT records:**
```bash
dns-sd -L "CueTime Display" _cuetime._tcp local
```

**Using Python with the `python-zeroconf` library:**
```python
from zeroconf import Zeroconf, ServiceBrowser, ServiceListener

class MyListener(ServiceListener):
    def add_service(self, zeroconf, type, name):
        info = zeroconf.get_service_info(type, name)
        if info:
            ip = socket.inet_ntoa(info.addresses[0])
            http_port = int(info.properties.get(b'http_port', b'8080'))
            print(f"Found CueTime Display at {ip}:{http_port}")

zeroconf = Zeroconf()
browser = ServiceBrowser(zeroconf, "_cuetime._tcp.local.", MyListener())
```

### Client Library Support

Most mDNS client libraries abstract the browse/resolve steps. For direct HTTP JSON control, the key values you need are:
- **IP address** (from resolved service host)
- **HTTP port** (from `http_port` TXT record, default `8080`)

The default port of `8080` applies when the `http_port` TXT record is absent, making discovery optional for manually configured connections.

---

## UUID Format

All UUID fields in this protocol follow UUID v7 format:
- **Version tracking fields** (`version`): Use UUIDv7 for chronological ordering and conflict resolution
- **Identifier fields** (`program_id`, `session_id`, `message_id`): Use UUID strings for unique identification

UUIDv7 provides timestamp-based ordering which helps with:
- Conflict detection and resolution
- Chronological version tracking
- Distributed system coordination

## Architecture

### Single Endpoint Design

All commands are sent to a single endpoint using HTTP POST:

```
POST http://<device-ip>:8080/api/command
Content-Type: application/json

{"type": "start_timer"}
```


### HTTP Method Usage

- **POST**: All commands (timer control, display control, configuration, program management)
- **GET**: Queries and status requests (for alternative RESTful-style access)

While POST is the primary method for all commands, a RESTful-style alternative is also supported for query operations:

```
GET http://<device-ip>:8080/api/status?detailed=false
GET http://<device-ip>:8080/api/program
```

### Authentication

This protocol runs in unauthenticated mode.

## Command Messages (Client → Server)

All commands are sent as HTTP POST requests to `/api/command` with a JSON body containing a `type` field.

### Timer Control

#### Start Timer
```http
POST /api/command
Content-Type: application/json

{
  "type": "start_timer"
}
```

#### Pause Timer
```http
POST /api/command
Content-Type: application/json

{
  "type": "pause_timer"
}
```

#### Setup Timer
```http
POST /api/command
Content-Type: application/json

{
  "type": "setup_timer",
  "name": "Intro Session",
  "presenter_name": "Fred Barneyson",
  "notes": "Keep him short."
  "seconds": 300,
  "mode": "countdown",
  "timer_state": "running",
  "session_id": "evt_001",
  "flash_start_time_seconds": 120,
  "flash_length_seconds": 30
}
```

Fields:
- `name` (optional): Session name, not used by display.
- `presenter_name` (optional): Presenter's name, not used by display
- `notes` (optional): Notes about the session, not used by display.
- `seconds` (required): Timer duration in seconds
- `mode` (optional): "countdown", "countup", or "time_of_day" (default: "countdown")
- `timer_state` (optional): "running", "paused", or "stopped" (default: "stopped")
- `session_id` (optional): Session identifier
- `flash_start_time_seconds` (optional): When to start flashing (seconds remaining for countdown, default: 0)
- `flash_length_seconds` (optional): Length of flash effect in seconds (default: 0)

#### Add Time
```http
POST /api/command
Content-Type: application/json

{
  "type": "add_time",
  "seconds": 60
}
```

#### Subtract Time
```http
POST /api/command
Content-Type: application/json

{
  "type": "subtract_time",
  "seconds": 30
}
```

### Display Control

#### Show Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "show_message",
  "text": "Break Time",
  "flash": false
}
```

#### Hide Display
```http
POST /api/command
Content-Type: application/json

{
  "type": "hide_display"
}
```

#### Show Idle Screen
```http
POST /api/command
Content-Type: application/json

{
  "type": "show_idle"
}
```

#### Blackout
```http
POST /api/command
Content-Type: application/json

{
  "type": "blackout",
  "enabled": true
}
```

Fields:
- `enabled` (optional boolean, default `true`): `true` enables blackout, `false` disables

Actions:
- `true`: Shows emergency blackout screen with large red text
- `false`: Returns to previous display mode

### Visual Effects

#### Set Glow Effect
```http
POST /api/command
Content-Type: application/json

{
  "type": "set_glow",
  "enabled": true
}
```

#### Toggle Glow Effect
```http
POST /api/command
Content-Type: application/json

{
  "type": "toggle_glow"
}
```
Toggles glow effect on/off without needing to know current state.

#### Set Flash Effect
```http
POST /api/command
Content-Type: application/json

{
  "type": "set_flash",
  "enabled": true
}
```

#### Toggle Flash Effect
```http
POST /api/command
Content-Type: application/json

{
  "type": "toggle_flash"
}
```
Toggles flash effect on/off without needing to know current state.

### Configuration

#### Set Brightness
```http
POST /api/command
Content-Type: application/json

{
  "type": "set_brightness",
  "brightness": 75
}
```
Range: 0-100

#### Set Is Time Up Display
```http
POST /api/command
Content-Type: application/json

{
  "type": "set_is_time_up_display",
  "enabled": true
}
```
Enables or disables the time-is-up display entirely. When disabled, the "time is up" state is not shown on screen even when the countdown timer reaches zero.

Fields:
- `enabled` (required, boolean): true to enable, false to disable

Default value: true (display is enabled)

#### Toggle Is Time Up Display
```http
POST /api/command
Content-Type: application/json

{
  "type": "toggle_is_time_up_display"
}
```
Toggles the time-is-up display setting without needing to know current state.

### Status and Program

#### Request Status
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_status",
  "detailed": true
}
```

Alternative RESTful-style access:
```http
GET /api/status?detailed=true
```

The `detailed` parameter controls how much information is returned:
- `detailed: true` (default): Returns full status (includes sessions, messages lists)
- `detailed: false`: Returns minimal status (control_center, view, settings sections only)

#### Individual Status Section Requests

For efficiency, you can request individual status sections instead of the full status:

**Request Control Center Status:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_control_center_status"
}
```

Alternative RESTful-style access:
```http
GET /api/status/control_center
```

**Request View Status:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_view_status"
}
```

Alternative RESTful-style access:
```http
GET /api/status/view
```

**Request Settings Status:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_settings_status"
}
```

Alternative RESTful-style access:
```http
GET /api/status/settings
```

**Request Sessions Status:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_sessions_status"
}
```

Alternative RESTful-style access:
```http
GET /api/status/sessions
```

**Request Messages Status:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "request_messages_status"
}
```

Alternative RESTful-style access:
```http
GET /api/status/messages
```

#### Get Program
```http
POST /api/command
Content-Type: application/json

{
  "type": "get_program"
}
```

Alternative RESTful-style access:
```http
GET /api/program
```

#### Send Program
```http
POST /api/command
Content-Type: application/json

{
  "type": "send_program",
  "program": {
    "program_id": "prog_001",
    "program_name": "Conference Day 1",
    "version": "0190e2b2-1234-7abc-9876-543210fedcba",
    "sessions": [
      {
        "id": "evt_001",
        "name": "Opening Keynote",
        "session_notes": "Welcome and introduction",
        "presenter_name": "John Doe",
        "timer_mode": "countdown",
        "duration_seconds": 1800,
        "flash_start_time_seconds": 120,
        "flash_length_seconds": 30,
        "version": "0190e2b2-1234-7def-9876-543210fedcba"
      }
    ],
    "messages": [
      {
        "id": "msg_001",
        "content": "Break Time - 15 minutes",
        "version": "0190e2b2-1234-7123-9876-543210fedcba"
      }
    ],
    "settings": {
      "flash_start_time_seconds": 120,
      "flash_length_seconds": 30
    }
  }
}
```

Program settings fields:
- `flash_start_time_seconds` (optional): When to start flashing (seconds remaining for countdown, default: 0)
- `flash_length_seconds` (optional): Length of flash effect in seconds (default: 0)

Program fields:
- `program_id` (required): Unique identifier for the program (UUID string)
- `program_name` (required): Human-readable program name
- `version` (required): UUIDv7 for version tracking and conflict resolution
- `sessions` (required): Ordered sequence of session objects
- `messages` (required): Collection of message objects
- `settings` (optional): Program-level settings

Session fields:
- `id` (required): Unique identifier for the session (UUID string)
- `name` (required): Session name/title
- `session_notes` (optional): Session notes/description
- `presenter_name` (optional): Name of the speaker/presenter
- `timer_mode` (optional): "countdown", "countup", or "time_of_day" (default: "countdown")
- `duration_seconds` (required): Timer duration in seconds
- `flash_start_time_seconds` (optional): When to start flashing (seconds remaining for countdown, default: 0)
- `flash_length_seconds` (optional): Length of flash effect in seconds (default: 0)
- `started_at_timestamp` (optional): Unix timestamp in milliseconds when session was started
- `version` (required): UUIDv7 for version tracking and conflict resolution

#### Navigate to Next Session
```http
POST /api/command
Content-Type: application/json

{
  "type": "navigate_next_session"
}
```

#### Navigate to Previous Session
```http
POST /api/command
Content-Type: application/json

{
  "type": "navigate_previous_session"
}
```

#### Reset Program Elapsed Timer

Reset the program elapsed timer to 0.

**Request:**
```http
POST /api/command
Content-Type: application/json

{
  "type": "reset_program_elapsed_timer"
}
```

**Response:**
```json
{"type": "ack", "success": true, "message": "Program timer reset"}
```

**Behavior:**
- Resets the program_elapsed_time_ms value to 0
- If a session is currently active and running (not paused), counting resumes immediately from 0
- If the display is idle or the session is paused, stays at 0 until the session timer next starts

### Session Management

#### Move Session Up
```http
POST /api/command
Content-Type: application/json

{
  "type": "move_session_up",
  "session_id": "evt_001"
}
```

Moves the specified session one position earlier in the program order. This swaps the session with its predecessor in the session list.

Fields:
- `session_id` (required): ID of the session to move up (UUID string)

Returns error if:
- No program is loaded
- Session ID not found in program
- Session is already first in the list

#### Move Session Down
```http
POST /api/command
Content-Type: application/json

{
  "type": "move_session_down",
  "session_id": "evt_001"
}
```

Moves the specified session one position later in the program order. This swaps the session with its successor in the session list.

Fields:
- `session_id` (required): ID of the session to move down (UUID string)

Returns error if:
- No program is loaded
- Session ID not found in program
- Session is already last in the list

#### Delete All Sessions
```http
POST /api/command
Content-Type: application/json

{
  "type": "delete_all_sessions"
}
```

Removes all sessions from the current program. Messages are preserved. Stops the current timer if running.

Alias: `delete_all_timers` (same functionality)

Returns error if no program is loaded.

### Program Message Management

#### Add Blank Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "add_blank_message"
}
```

Adds a blank message to the current program's message list. A unique message ID is generated and returned in the response.

Response includes `message_id` field with the generated UUID.

Requires an active program to be loaded.

#### Add Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "add_message",
  "content": "Break Time - 15 minutes"
}
```

Adds a message with specified content to the current program's message list. A unique message ID is generated and returned in the response.

Fields:
- `content` (required): Message content to display (supports full Unicode)

Response includes `message_id` field with the generated UUID.

Requires an active program to be loaded.

#### Delete Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "delete_message",
  "message_id": "msg_001"
}
```

Deletes a message from the current program's message list by its ID.

Fields:
- `message_id` (required): ID of the message to delete (UUID string)

Requires an active program to be loaded. Returns error if message ID not found.

#### Update Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "update_message",
  "message_id": "msg_001",
  "content": "Updated message content"
}
```

Updates the content of an existing message in the current program.

Fields:
- `message_id` (required): ID of the message to update (UUID string)
- `content` (required): New content for the message (supports full Unicode)

Requires an active program to be loaded. Returns error if message ID not found.

#### Show Program Message
```http
POST /api/command
Content-Type: application/json

{
  "type": "show_program_message",
  "message_id": "msg_001",
  "flash": false
}
```

Displays a specific message from the program's message list on the screen. Different from the `message` command which takes raw text - this command looks up a message by ID from the program's message list.

Fields:
- `message_id` (required): ID of the message to display (UUID string)
- `flash` (optional): Enable 1Hz blinking effect (default: false)

Requires an active program to be loaded. Returns error if message ID not found.

Transitions display to message mode. Message persists until replaced by another display command.

#### Move Message Up
```http
POST /api/command
Content-Type: application/json

{
  "type": "move_message_up",
  "message_id": "msg_001"
}
```

Moves the specified message one position earlier in the program's message list. This swaps the message with its predecessor.

Fields:
- `message_id` (required): ID of the message to move up (UUID string)

Returns error if:
- No program is loaded
- Message ID not found in program
- Message is already first in the list

#### Move Message Down
```http
POST /api/command
Content-Type: application/json

{
  "type": "move_message_down",
  "message_id": "msg_001"
}
```

Moves the specified message one position later in the program's message list. This swaps the message with its successor.

Fields:
- `message_id` (required): ID of the message to move down (UUID string)

Returns error if:
- No program is loaded
- Message ID not found in program
- Message is already last in the list

## Response Messages (Server → Client)

### Response Format

All responses are sent as JSON with the following structure:

```json
{
  "success": true,
  "type": "ack",
  "message": "Timer started"
}
```

For error responses, HTTP status codes are used in conjunction with JSON error details:

```json
{
  "success": false,
  "type": "error",
  "code": "INVALID_PARAMETER",
  "message": "Brightness must be 0-100"
}
```

### HTTP Status Codes

- **200 OK**: Command executed successfully
- **400 Bad Request**: Invalid command or parameters
- **404 Not Found**: Requested resource not found (for GET requests)
- **500 Internal Server Error**: Server-side error processing command

### Acknowledgment
```json
{
  "success": true,
  "type": "ack",
  "message": "Timer started"
}
```

### Error
```json
{
  "success": false,
  "type": "error",
  "code": "INVALID_PARAMETER",
  "message": "Brightness must be 0-100"
}
```

Error codes:
- `MISSING_TYPE`: Message missing 'type' field
- `UNKNOWN_TYPE`: Unknown message type
- `INVALID_PARAMETER`: Invalid parameter value
- `MISSING_PARAMETER`: Required parameter missing
- `PROCESSING_ERROR`: Error processing message
- `NOT_AVAILABLE`: Feature not available
- `INVALID_COMMAND`: Invalid command for current state

### Status Response

The status response structure depends on the `detailed` parameter in `status_request`:

**Minimal Status** (detailed: false, default):
```json
{
  "success": true,
  "type": "status",
   "control_center": {
     "current_session_id": "0190e2b2-1234-7abc-9876-543210fedcba",
     "current_session_index": 0,
     "current_session_name": "Opening Keynote",
     "current_presenter_name": "John Doe",
     "is_previous_session": false,
     "is_next_session": true,
     "is_playing": true,
     "is_glowing": false,
     "is_blackout": false,
     "timer": 150000.0,
     "flash_start_time": 120000,
     "elapsed_time": 0,
     "program_elapsed_time": 0,
     "program_time": 3600000.0
   },
   "view": {
     "presenter_name": "John Doe",
     "elapsed_time": 0,
     "program_elapsed_time": 0,
     "message_text": "Break Time",
     "session_name": "Opening Keynote",
     "progress_bar": 85.5,
     "session_id": "evt_001",
     "message_id": null,
     "is_flashing": false,
     "is_glowing": false
   },
  "settings": {
    "brightness": 80,
    "default_flash_start_time": 120,
    "default_flash_length": 30,
    "view_only_code": "ABC123",
    "is_time_up_display": true
  }
}
```

**Full Status** (detailed: true):
```json
{
  "success": true,
  "type": "status",
   "control_center": {
     "current_session_id": "0190e2b2-1234-7abc-9876-543210fedcba",
     "current_session_index": 0,
     "current_session_name": "Opening Keynote",
     "current_presenter_name": "John Doe",
     "is_previous_session": false,
     "is_next_session": true,
     "is_playing": true,
     "is_glowing": false,
     "is_blackout": false,
     "timer": 150000.0,
     "flash_start_time": 120000,
     "elapsed_time": 0,
     "program_elapsed_time": 0,
     "program_time": 3600000
   },
   "view": {
     "presenter_name": "John Doe",
     "elapsed_time": 0,
     "program_elapsed_time": 0,
     "message_text": "Break Time",
     "session_name": "Opening Keynote",
     "progress_bar": 85.5,
     "session_id": "evt_001",
     "message_id": null,
     "is_flashing": false,
     "is_glowing": false
   },
  "settings": {
    "brightness": 80,
    "default_flash_start_time": 120,
    "default_flash_length": 30,
    "view_only_code": "ABC123",
    "is_time_up_display": true
  },
  "sessions": {
    "session_list": [
      {
        "id": "evt_001",
        "index": 0,
        "start_time": 1640000000000,
        "duration": 1800,
        "session_name": "Opening Keynote",
        "presenter_name": "John Doe",
        "is_playing": true,
        "session_notes": "Welcome and introduction",
        "timer_mode": "countdown",
        "flash_start_time_seconds": 120,
        "flash_length_seconds": 30,
        "version": "0190e2b2-1234-7def-9876-543210fedcba"
      }
    ]
  },
  "messages": {
    "is_flashing": false,
    "message_list": [
      {
        "id": "msg_001",
        "text": "Break Time - 15 minutes",
        "is_showing": true
      }
  ]
    }
  },
  "settings": {
    "flash_start_time_seconds": 120,
    "flash_length_seconds": 30,
    "is_time_up_display": true
  }
}
```

**Control Center Section:**
- `current_session_id`: UUID of current session (empty string if no active session)
- `current_session_index`: 0-based index of current session in session list (-1 if no active session)
- `current_session_name`: Name of current session
- `current_presenter_name`: Name of current presenter
- `is_previous_session`: Whether a previous session exists
- `is_next_session`: Whether a next session exists
- `is_playing`: Whether timer is currently running
- `is_glowing`: Whether glow effect is active
- `is_blackout`: Whether blackout mode is active
- `timer`: Current timer value in milliseconds
- `flash_start_time`: Time when flashing starts in milliseconds
- `elapsed_time`: Session elapsed time in milliseconds
- `program_elapsed_time`: Program elapsed time in milliseconds
- `program_time`: Total program duration in milliseconds

**View Section:**
- `presenter_name`: Current presenter name from active session
- `elapsed_time`: Session elapsed in current session (milliseconds)
- `message_text`: Currently displayed message text
- `session_name`: Current session name
- `progress_bar`: Session progress percentage (0-100)
  - 0% = timer complete/elapsed (progress bar hidden)
  - 100% = timer at full duration (progress bar full)
- `session_id`: ID of current session (null if no active session)
- `message_id`: ID of current program message being displayed (null if not showing a program message)
- `is_flashing`: Whether flash effect is currently active
- `is_glowing`: Whether glow effect is currently active

**Settings Section:**
- `brightness`: Display brightness level (0-100)
- `default_flash_start_time`: Default flash start time in seconds
- `default_flash_length`: Default flash duration in seconds
- `view_only_code`: Current view-only access code
- `is_time_up_display`: Whether the time-is-up display is enabled (default: true)

**Sessions Section** (detailed status only):
- `session_list`: Array of session objects with:
  - `id`: Session ID (UUID string)
  - `index`: Session index (0-based)
  - `start_time`: Unix timestamp when session starts (null if not started)
  - `duration`: Session duration in seconds
  - `session_name`: Session name
  - `presenter_name`: Presenter name (optional)
  - `is_playing`: Whether this session's timer is currently active (running or paused)
  - `is_showing`: Whether this session is currently displayed on screen; a session can be playing but not showing if a program message is currently covering it
  - `session_notes`: Session notes/description
  - `timer_mode`: Timer mode — `"countdown"`, `"countup"`, or `"time_of_day"`
  - `flash_start_time_seconds`: When to start flashing (seconds remaining for countdown)
  - `flash_length_seconds`: Length of flash effect in seconds
  - `version`: UUIDv7 for version tracking

**Messages Section** (detailed status only):
- `is_flashing`: Whether message flashing is currently active globally
- `message_list`: Array of message objects with:
  - `id`: Message ID (UUID string)
  - `text`: Message text content
  - `is_showing`: Whether message is currently displayed

### Program Response
```json
{
  "success": true,
  "type": "program",
  "has_program": true,
  "program": {
    "program_id": "prog_001",
    "program_name": "Conference Day 1",
    "version": "0190e2b2-1234-7abc-9876-543210fedcba",
    "sessions": [...],
    "messages": [...],
    "settings": {
      "flash_start_time_seconds": 120,
      "flash_length_seconds": 30
    }
  }
}
```

**Program fields:**
- `program_id`: Program identifier string
- `program_name`: Human-readable program name
- `version`: UUIDv7 for version tracking
- `sessions`: Array of session objects
- `messages`: Array of message objects
- `settings`: Program-level settings (optional)

## Examples

### Starting a Timer

**Request:**
```http
POST http://192.168.1.100:8080/api/command
Content-Type: application/json

{
  "type": "start_timer"
}
```

**Response:**
```json
{
  "success": true,
  "type": "ack",
  "message": "Timer started"
}
```

### Setting Up a New Timer

**Request:**
```http
POST http://192.168.1.100:8080/api/command
Content-Type: application/json

{
  "type": "setup_timer",
  "seconds": 300,
  "mode": "countdown",
  "timer_state": "running",
  "session_id": "evt_001",
  "flash_start_time_seconds": 60,
  "flash_length_seconds": 30
}
```

**Response:**
```json
{
  "success": true,
  "type": "ack",
  "message": "Timer configured and started"
}
```

### Getting Device Status (RESTful-style)

**Request:**
```http
GET http://192.168.1.100:8080/api/status?detailed=true
```

**Response:**
```json
{
  "success": true,
  "type": "status",
  "control_center": {
    "current_session_id": "0190e2b2-1234-7abc-9876-543210fedcba",
    "current_session_index": 0,
    "current_session_name": "Opening Keynote",
    "current_presenter_name": "John Doe",
    "is_playing": true,
    "timer": 150000.0,
    ...
  },
  ...
}
```

### Sending a Complete Program

**Request:**
```http
POST http://192.168.1.100:8080/api/command
Content-Type: application/json

{
  "type": "send_program",
  "program": {
    "program_id": "prog_001",
    "program_name": "Conference Day 1",
    "version": "0190e2b2-1234-7abc-9876-543210fedcba",
    "sessions": [
      {
        "id": "evt_001",
        "name": "Opening Keynote",
        "presenter_name": "John Doe",
        "timer_mode": "countdown",
        "duration_seconds": 1800,
        "flash_start_time_seconds": 120,
        "flash_length_seconds": 30,
        "version": "0190e2b2-1234-7def-9876-543210fedcba"
      }
    ],
    "messages": [],
    "settings": {
      "flash_start_time_seconds": 120,
      "flash_length_seconds": 30
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "type": "ack",
  "message": "Program loaded successfully"
}
```

### Error Response Example

**Request:**
```http
POST http://192.168.1.100:8080/api/command
Content-Type: application/json

{
  "type": "set_brightness",
  "brightness": 150
}
```

**Response:**
```json
{
  "success": false,
  "type": "error",
  "code": "INVALID_PARAMETER",
  "message": "Brightness must be 0-100"
}
```

*Last Updated: June 12, 2026*
