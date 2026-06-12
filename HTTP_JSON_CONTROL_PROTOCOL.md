# HTTP JSON Control Protocol

A simplified, unauthenticated JSON-based control protocol for CueTime Display over HTTP.

## Overview

**Protocol:** HTTP/1.1 (or HTTP/2)
**Format:** JSON (request body and response)
**Base URL:** `http://<device-ip>:8080/api` (default)
**Port:** 8080 (default)
**Authentication:** None (unauthenticated mode)
**Current Version:** 1

## Architecture

### Single Endpoint Design

All commands are sent to a single endpoint using HTTP POST:

```
POST http://<device-ip>:8080/api/command
Content-Type: application/json

{"type": "start_timer"}
```

This design maintains consistency with the existing RAW JSON and Protobuf/WebSocket protocols, using the same JSON structure with a `type` field to identify the command.

### HTTP Method Usage

- **POST**: All commands (timer control, display control, configuration, program management)
- **GET**: Queries and status requests (for alternative RESTful-style access)

While POST is the primary method for all commands, a RESTful-style alternative is also supported for query operations:

```
GET http://<device-ip>:8080/api/status?detailed=false
GET http://<device-ip>:8080/api/program
```

### Authentication

This protocol runs in unauthenticated mode, similar to the RAW JSON protocol. For authenticated access, use the WebSocket/Protobuf protocol which supports OTC-based claim verification.

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
  "seconds": 300,
  "mode": "countdown",
  "timer_state": "running",
  "event_id": "evt_001",
  "flash_start_time_seconds": 120,
  "flash_length_seconds": 30
}
```

Fields:

- `seconds` (required): Timer duration in seconds
- `mode` (optional): "countdown", "countup", or "time_of_day" (default: "countdown")
- `timer_state` (optional): "running", "paused", or "stopped" (default: "stopped")
- `event_id` (optional): Event identifier
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

### Status and Program

#### Request Status

```http
POST /api/command
Content-Type: application/json

{
  "type": "request_status",
  "detailed": false
}
```

Alternative RESTful-style access:

```http
GET /api/status?detailed=false
```

The `detailed` parameter controls how much information is returned:

- `detailed: false` (default): Returns minimal status (control_center, view, settings sections only)
- `detailed: true`: Returns full status (includes sessions, messages lists)

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

Session fields:

- `id` (required): Unique identifier for the session
- `name` (required): Session name/title
- `session_notes` (optional): Session notes/description
- `presenter_name` (optional): Name of the speaker/presenter
- `timer_mode` (optional): "countdown", "countup", or "time_of_day" (default: "countdown")
- `duration_seconds` (required): Timer duration in seconds
- `flash_start_time_seconds` (optional): When to start flashing (seconds remaining for countdown, default: 0)
- `flash_length_seconds` (optional): Length of flash effect in seconds (default: 0)
- `started_at_timestamp` (optional): Unix timestamp in milliseconds when session was started
- `version` (required): UUIDv7 for version tracking and conflict resolution

#### Navigate to Next Event

```http
POST /api/command
Content-Type: application/json

{
  "type": "navigate_next_event"
}
```

#### Navigate to Previous Event

```http
POST /api/command
Content-Type: application/json

{
  "type": "navigate_previous_event"
}
```

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

- `session_id` (required): ID of the session to move up

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

- `session_id` (required): ID of the session to move down

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

- `message_id` (required): ID of the message to delete

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

- `message_id` (required): ID of the message to update
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

- `message_id` (required): ID of the message to display
- `flash` (optional): Enable 1Hz blinking effect (default: false)

Requires an active program to be loaded. Returns error if message ID not found.

Transitions display to message mode. Message persists until replaced by another display command.

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
		"current_session_id": 0,
		"current_session_name": "Opening Keynote",
		"current_presenter_name": "John Doe",
		"is_previous_session": false,
		"is_next_session": true,
		"is_playing": true,
		"is_glowing": false,
		"is_blackout": false,
		"timer": 150000.0,
		"flash_timer": 120000,
		"elapsed_time": 0,
		"program_time": 3600000
	},
	"view": {
		"presenter_name": "John Doe",
		"elapsed_time": 0,
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
		"view_only_code": "ABC123"
	}
}
```

**Full Status** (detailed: true):

```json
{
	"success": true,
	"type": "status",
	"control_center": {
		"current_session_id": 0,
		"current_session_name": "Opening Keynote",
		"current_presenter_name": "John Doe",
		"is_previous_session": false,
		"is_next_session": true,
		"is_playing": true,
		"is_glowing": false,
		"is_blackout": false,
		"timer": 150000.0,
		"flash_timer": 120000,
		"elapsed_time": 0,
		"program_time": 3600000
	},
	"view": {
		"presenter_name": "John Doe",
		"elapsed_time": 0,
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
		"view_only_code": "ABC123"
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
				"is_playing": true
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
}
```

**Control Center Section:**

- `current_session_id`: Index (0-based) of current session in session list
- `current_session_name`: Name of current session
- `current_presenter_name`: Name of current presenter
- `is_previous_session`: Whether a previous session exists
- `is_next_session`: Whether a next session exists
- `is_playing`: Whether timer is currently running
- `is_glowing`: Whether glow effect is active
- `is_blackout`: Whether blackout mode is active
- `timer`: Current timer value in milliseconds
- `flash_timer`: Time when flashing starts in milliseconds
- `elapsed_time`: Total elapsed time in milliseconds
- `program_time`: Total program duration in milliseconds

**View Section:**

- `presenter_name`: Current presenter name from active session
- `elapsed_time`: Time elapsed in current session (milliseconds)
- `message_text`: Currently displayed message text
- `session_name`: Current session name
- `progress_bar`: Session progress percentage (0-100)
- `session_id`: ID of current session (null if no active session)
- `message_id`: ID of current program message being displayed (null if not showing a program message)
- `is_flashing`: Whether flash effect is currently active
- `is_glowing`: Whether glow effect is currently active

**Settings Section:**

- `brightness`: Display brightness level (0-100)
- `default_flash_start_time`: Default flash start time in seconds
- `default_flash_length`: Default flash duration in seconds
- `view_only_code`: Current view-only access code

**Sessions Section** (detailed status only):

- `session_list`: Array of session objects with:
  - `id`: Session ID
  - `index`: Session index (0-based)
  - `start_time`: Unix timestamp when session starts (null if not started)
  - `duration`: Session duration in seconds
  - `session_name`: Session name
  - `presenter_name`: Presenter name (optional)
  - `is_playing`: Whether this session is currently playing

**Messages Section** (detailed status only):

- `is_flashing`: Whether message flashing is currently active globally
- `message_list`: Array of message objects with:
  - `id`: Message ID
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
  "event_id": "evt_001",
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
    "current_session_id": 0,
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

## Comparison with Other Protocols

| Feature               | HTTP JSON              | RAW JSON (TCP)        | Protobuf/WebSocket |
| --------------------- | ---------------------- | --------------------- | ------------------ |
| Transport             | HTTP/1.1 or HTTP/2     | Plain TCP             | WebSocket          |
| Message Format        | JSON                   | JSON (STX/ETX framed) | Protobuf binary    |
| Authentication        | None                   | None                  | OTC-based claim    |
| Endpoint              | Single `/api/command`  | Port 9001             | WebSocket path     |
| Framing               | HTTP content-length    | STX + JSON + ETX      | WebSocket frames   |
| Statefulness          | Stateless              | Connection-based      | Session-based      |
| RESTful Access        | Optional (GET queries) | No                    | No                 |
| Connection Management | Per-request            | Persistent            | Persistent         |

---

_Last Updated: February 2, 2026_
