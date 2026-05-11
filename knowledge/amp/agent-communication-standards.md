# AMP-ACS 1.0 -- Agent Communication Standards
Draft wire-level conventions for AMP inter-agent messages, broadcasts, inbox delivery, and handoff.

## Table of contents

- [Status](#status)
- [Motivation](#motivation)
- [Goals](#goals)
- [Non-goals](#non-goals)
- [Identity model](#identity-model)
- [Message envelope](#message-envelope)
- [Reserved message types](#reserved-message-types)
- [Channels](#channels)
- [Broadcast transport options](#broadcast-transport-options)
- [Inbox delivery](#inbox-delivery)
- [Handoff handshake](#handoff-handshake)
- [Error semantics](#error-semantics)
- [Correlation rules](#correlation-rules)
- [Heartbeat](#heartbeat)
- [Versioning](#versioning)
- [Conformance](#conformance)
- [Security considerations](#security-considerations)
- [Future work](#future-work)
- [Appendix A: Envelope JSON Schema](#appendix-a-envelope-json-schema)
- [Appendix B: Example exchange transcripts](#appendix-b-example-exchange-transcripts)

## Status

Draft / Proposed.

AMP-ACS 1.0 is the initial Agent Communication Standards draft for AMP agents. It is intended to stabilize the message envelope and minimum control messages before transport-specific routers, dashboards, and orchestrators add richer behavior.

## Motivation

AMP agents must interoperate across languages, processes, and machines. A TypeScript agent may need to hand work to a Python evaluator. A Go agent may need to broadcast status to a supervising process. A local orchestrator may need to deliver an inbox prompt to an agent that was generated from the same AMP manifest but runs in a separate terminal.

AMP-ACS defines the wire-level conventions for inter-agent communication, status broadcasting, work handoff, and inbox delivery. The standard is intentionally small. It defines an envelope, reserved message types, payload shapes, correlation rules, and transport guidance. It does not define agent reasoning behavior or replace the Copilot SDK session protocol.

The default transport is stdout JSONL because it is cheap, observable, process-friendly, and easy to capture in single-host orchestrated environments. More durable or distributed transports can use the same envelope over append-only files or websockets.

## Goals

1. Language-agnostic: agents generated in TypeScript, Python, and Go use the same envelope.
2. Transport-agnostic: the envelope works over stdio, files, websockets, or future transports.
3. Correlation-friendly: handoffs, replies, errors, and results share explicit `correlationId` values.
4. Reproducible: every message has a stable schema and can round-trip through JSON serialization.
5. Cheap: the default transport is stdout JSONL with one envelope per line.

## Non-goals

- AMP-ACS is not a replacement for MCP. MCP remains the tool and resource protocol for model-to-tool interactions.
- AMP-ACS is not a transport. It sits on top of stdio, file, websocket, or another configured transport.
- AMP-ACS is not an authentication or authorization scheme. Deployments must secure transports and files out-of-band.
- AMP-ACS does not define payload schemas for every business domain. It defines reserved control payloads and leaves application payloads as arbitrary JSON.

## Identity model

Every AMP agent declares `communication.id` in its manifest. The value can be UUID-like or human-readable. Examples include `agent-A`, `reviewer`, `eval-worker-01`, or `123e4567-e89b-12d3-a456-426614174000`.

Messages always carry `agentId`. `agentId` is the sender identity and must match the configured communication identity unless a host router explicitly rewrites or signs messages. Messages may also carry `instanceId` to disambiguate replicas, restarts, workers, or parallel runs of the same logical agent.

Recommended identity fields:

| Field | Required | Description |
| --- | --- | --- |
| `agentId` | yes | Stable sender identity from `communication.id`. |
| `instanceId` | no | Runtime instance identifier for replicas or restarts. |

An orchestrator should route based on `agentId` and use `instanceId` for diagnostics. A receiver should not assume that a missing `instanceId` means the sender is single-instance.

## Message envelope

The canonical JSON envelope shape is:

```json
{
  "v": "1.0",
  "ts": "<ISO 8601 UTC>",
  "id": "<message uuid>",
  "agentId": "<sender>",
  "instanceId": "<optional>",
  "channel": "<channel name>",
  "type": "<event type>",
  "correlationId": "<optional, ties replies to requests>",
  "payload": {}
}
```

Field rules:

| Field | Required | Rule |
| --- | --- | --- |
| `v` | yes | AMP-ACS version string. For this spec, use `1.0`. |
| `ts` | yes | UTC timestamp in ISO 8601 format. Prefer RFC 3339 compatible strings. |
| `id` | yes | Globally unique message identifier. UUID values are recommended. |
| `agentId` | yes | Sender identity. |
| `instanceId` | no | Sender instance identity. |
| `channel` | yes | Opaque channel label. |
| `type` | yes | Event type string. Reserved types are listed below. |
| `correlationId` | conditional | Required for `handoff.*` and reply-style messages. Optional for broadcasts. |
| `payload` | yes | JSON object. Use an empty object when there is no payload. |

Agents should emit one complete envelope at a time. For JSONL transports, an envelope must not contain unescaped newline characters outside JSON strings.

## Reserved message types

Receivers must accept these reserved message types. Receivers may ignore unknown types, but they should log a warning when the type appears to be reserved by a newer minor version.

### status

Use `status` to announce current state without implying progress on a particular handoff.

Expected payload:

```json
{
  "state": "idle",
  "summary": "Waiting for work",
  "details": {},
  "severity": "info"
}
```

Rules:

- `state` is required and should be a short string such as `idle`, `busy`, `blocked`, `degraded`, or `stopping`.
- `summary` is optional but recommended.
- `details` is optional arbitrary JSON.
- `severity` is optional and should be `debug`, `info`, `warning`, or `error`.

### progress

Use `progress` to announce work advancement. It may be tied to a handoff or standalone task.

Expected payload:

```json
{
  "stage": "testing",
  "message": "Running unit tests",
  "current": 2,
  "total": 5,
  "percent": 40
}
```

Rules:

- `stage` is optional but recommended.
- `message` is optional human-readable text.
- `current`, `total`, and `percent` are optional numeric hints.
- If progress is part of a handoff, `correlationId` must match the handoff request.

### result

Use `result` for reply-style responses that are not handoff completions.

Expected payload:

```json
{
  "ok": true,
  "summary": "Work completed",
  "data": {}
}
```

Rules:

- `ok` is required and boolean.
- `summary` is optional.
- `data` is optional arbitrary JSON.
- `correlationId` is required when this is a reply.

### error

Use `error` for recoverable or terminal failures. Full semantics are defined in [Error semantics](#error-semantics).

Expected payload:

```json
{
  "code": "E_TOOL_FAILED",
  "message": "The tool returned a non-zero exit code.",
  "recoverable": true,
  "retryAfterMs": 1000,
  "details": {}
}
```

### handoff.request

Use `handoff.request` to ask another agent to accept work.

Expected payload:

```json
{
  "task": {
    "title": "Review generated code",
    "instructions": "Review the diff and return blocking issues only.",
    "inputs": {}
  },
  "deadlineTs": "2025-01-01T12:00:00Z",
  "replyChannel": "review.findings"
}
```

Rules:

- `correlationId` is required.
- `payload.task` is required and must be an object.
- `task.title` and `task.instructions` are recommended.
- `replyChannel` is optional. If omitted, replies use the request channel.

### handoff.accept

Use `handoff.accept` to accept a handoff request.

Expected payload:

```json
{
  "acceptedBy": "agent-B",
  "etaMs": 60000,
  "message": "Accepted for review."
}
```

Rules:

- `correlationId` must match the request.
- `acceptedBy` is optional when it matches envelope `agentId`.
- `etaMs` is optional.

### handoff.reject

Use `handoff.reject` to reject a handoff request.

Expected payload:

```json
{
  "reason": "capacity",
  "message": "No worker is available.",
  "retryAfterMs": 300000
}
```

Rules:

- `correlationId` must match the request.
- `reason` is required and should be a short machine-readable string.
- `retryAfterMs` is optional.

### handoff.complete

Use `handoff.complete` to finish an accepted handoff.

Expected payload:

```json
{
  "ok": true,
  "summary": "Review complete",
  "result": {
    "findings": []
  }
}
```

Rules:

- `correlationId` must match the request.
- `ok` is required and boolean.
- `summary` is recommended.
- `result` is arbitrary JSON.

### inbox.deliver

Use `inbox.deliver` for prompts written into an agent inbox.

Expected payload:

```json
{
  "prompt": "Run the validation suite and report failures.",
  "metadata": {},
  "ackPath": "ack.jsonl"
}
```

Rules:

- `payload.prompt` is required unless a host explicitly maps another field to a prompt.
- `metadata` is optional.
- `ackPath` is optional when the inbox configuration already defines an ack file.

### inbox.ack

Use `inbox.ack` to confirm completion of an inbox delivery.

Expected payload:

```json
{
  "deliveredId": "<message uuid>",
  "ok": true,
  "summary": "Prompt accepted and sent to the session."
}
```

Rules:

- `deliveredId` should match the `id` of the `inbox.deliver` envelope.
- `ok` is required and boolean.
- `correlationId` should match the delivered message when present.

### heartbeat

Use `heartbeat` to announce liveness while idle. Full guidance is in [Heartbeat](#heartbeat).

Expected payload:

```json
{
  "uptimeSec": 360,
  "pendingHandoffs": 0
}
```

## Channels

Implementations must treat channel names as opaque strings. A channel is a label, not a transport topic by default.

Suggested conventions:

- Lowercase names.
- Dot-separated namespaces such as `review.findings`, `test.results`, or `build.status`.
- Stable names that do not include secrets or transient file paths.

Channels are not pub/sub topics unless a host transport explicitly adds fan-out semantics. A stdout-jsonl host can route by channel. A file transport can write all channels to one file. A websocket router can choose to map channels to websocket subscriptions, but that behavior is transport-specific and outside AMP-ACS 1.0.

## Broadcast transport options

AMP-ACS defines four broadcast transport labels.

### stdout-jsonl

One envelope per line is written to stdout. The host process captures and routes messages. This is recommended for single-host and orchestrated environments.

Properties:

- Cheap and easy to inspect.
- Works with process supervisors and terminal sessions.
- Not durable unless the host captures output.
- Backpressure is controlled by the host process and stdout stream.

### file

One envelope per line is appended to a configured JSONL file. The path is a config field. This is useful for crash-survivable logs and simple local routers.

Properties:

- Durable as long as the filesystem is durable.
- Multiple writers require host-level coordination or append-safe file handling.
- Readers should tolerate partial lines during writes.

### websocket

The agent connects to a configured websocket URL and sends envelopes. Implementations must be backpressure-safe and should pause or buffer sends when the socket is not writable. This is used when an upstream router is co-located or when multiple agents run across processes.

Properties:

- Suitable for real-time routing.
- Requires connection lifecycle management.
- Requires out-of-band TLS and bearer-token security when used beyond localhost.

### none

No broadcast is emitted. The agent runs silently except for normal logs and SDK behavior.

Properties:

- Appropriate for tests and privacy-sensitive local runs.
- Handoff and inbox can still be configured separately if the implementation supports them.

## Inbox delivery

The inbox is a JSONL file tailed by the agent. Each line is one AMP-ACS envelope. New lines are read, parsed, and dispatched as user prompts through the generated session send path. The canonical message type for inbound prompts is `inbox.deliver`.

Expected directory layout:

```text
<inbox-dir>/in.jsonl
<inbox-dir>/ack.jsonl
```

Behavior:

1. The host appends an `inbox.deliver` envelope to `<inbox-dir>/in.jsonl`.
2. The agent tails the file and parses newly appended complete lines.
3. The agent extracts `payload.prompt` and dispatches it as a user prompt, usually through `session.send` or the language equivalent.
4. On completion, the agent appends an `inbox.ack` envelope to `<inbox-dir>/ack.jsonl`.
5. If dispatch fails, the agent appends an `error` envelope with the same `correlationId` when available.

Inbox readers should track byte offset. If the file is truncated or rotated and the observed size becomes smaller than the stored offset, readers should reset the offset to zero and continue. Readers should skip blank lines and emit an error for invalid JSON only after a line is complete.

Inbox delivery is at-least-once by default. A receiver should make prompt handling idempotent when possible, using message `id` or `correlationId` to detect duplicate deliveries.

## Handoff handshake

Handoff uses a four-step protocol.

1. Initiator sends `handoff.request` with `correlationId` and `payload.task`.
2. Receiver replies with `handoff.accept` or `handoff.reject` using the same `correlationId`.
3. On accept, work proceeds. Intermittent `progress` envelopes carry the same `correlationId`.
4. Final `handoff.complete` carries the result. Either side may send `error` at any time.

Requirements:

- `correlationId` is mandatory on all `handoff.*` envelopes.
- Receivers must not send `handoff.complete` before sending `handoff.accept`.
- Initiators should treat `handoff.reject` as terminal unless `retryAfterMs` is present.
- If a receiver cannot parse or execute the task, it should send `error`, not silently drop the request.
- `progress` updates should be lightweight and must not contain secrets.

Recommended `correlationId` format is a UUID, but any stable string is allowed. A host orchestrator may generate the correlation ID or the initiator may generate it before sending.

## Error semantics

The `error` payload has mandatory fields.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `code` | string | yes | Machine-readable error code. |
| `message` | string | yes | Human-readable explanation. |
| `recoverable` | boolean | yes | Whether retrying may succeed. |
| `retryAfterMs` | integer | no | Minimum wait before retry. |
| `details` | object | no | Additional structured context. |

Recipients should respect `recoverable` before retrying. If `recoverable` is false, retries should require a new request or human intervention. If `recoverable` is true and `retryAfterMs` is present, the retry should wait at least that long.

Error codes should be stable within an implementation. Recommended prefixes include `E_TRANSPORT_`, `E_INBOX_`, `E_HANDOFF_`, `E_SCHEMA_`, and `E_RUNTIME_`.

## Correlation rules

`correlationId` is mandatory for `handoff.*` and any reply-style message. Reply-style messages include `result`, `error`, `inbox.ack`, and progress tied to a requested task.

For broadcasts such as `status`, `progress`, and `heartbeat`, `correlationId` is optional unless the broadcast is tied to a request. If an envelope is emitted because of another envelope, use the same `correlationId`.

Rules of thumb:

- One handoff request gets one correlation ID.
- All accept, reject, progress, complete, and error messages for that handoff reuse the same ID.
- A nested task may either reuse the parent ID or create a child ID carried in payload metadata. AMP-ACS 1.0 does not define a parent correlation field.

## Heartbeat

Agents should emit `heartbeat` envelopes every 30 seconds when idle. Heartbeats are not required while the agent is actively emitting progress messages for a correlated task.

Heartbeat payload:

```json
{
  "uptimeSec": 120,
  "pendingHandoffs": 1
}
```

Rules:

- `uptimeSec` is required and should count from process start.
- `pendingHandoffs` is required and must be an integer count.
- Heartbeat channels should use a stable status channel such as `agent.status` or the default broadcast channel.
- Receivers should treat missing heartbeats as a signal for investigation, not automatic proof of failure.

A router may define liveness thresholds, but AMP-ACS does not require a specific timeout.

## Versioning

AMP-ACS uses semantic versioning.

| Change type | Meaning |
| --- | --- |
| Major | Breaking envelope or reserved type changes. |
| Minor | New reserved types or optional fields. |
| Patch | Wording clarifications and non-normative examples. |

For AMP-ACS 1.0, `v` must be `1.0`. Receivers must tolerate unknown reserved types and should drop them with a warning instead of failing the entire stream. Receivers should preserve unknown payload fields when forwarding envelopes.

A future AMP-ACS 1.1 may add reserved types without changing the envelope. A future AMP-ACS 2.0 may change required fields, correlation rules, or transport requirements.

## Conformance

An implementation conforms to AMP-ACS 1.0 if it can meet all three requirements.

1. Emit envelopes that round-trip through `JSON.parse(JSON.stringify(env))` losslessly for JSON-compatible values.
2. Read an inbox JSONL file produced by another conformant agent and dispatch `inbox.deliver` prompts.
3. Honor the handoff handshake when both peers are configured.

Additional conformance expectations:

- Required envelope fields are present.
- Reserved payload shapes include required fields.
- Invalid JSONL lines are reported without stopping the reader.
- Unknown message types are tolerated.
- Correlation IDs are preserved across replies.

Conformance does not require a specific SDK language, transport implementation, or routing topology.

## Security considerations

AMP-ACS does not specify authentication or authorization. When using `websocket`, deployments are responsible for TLS and bearer-token authentication out-of-band. When using `file` or `stdout-jsonl`, the host filesystem and process boundaries are the trust boundary.

Security guidance:

- Do not include secrets in `channel`, `summary`, `message`, or broad status payloads.
- Treat inbox files as command input. Only trusted writers should be able to append to an inbox.
- Treat ack files and broadcast logs as potentially sensitive operational records.
- Validate payloads before invoking tools or mutating state.
- Prefer least-privilege filesystem permissions for inbox and ack directories.
- For websocket deployments, use TLS, bearer tokens, short-lived credentials, and router-side authorization.

A receiver should not trust `agentId` by itself. Identity is an envelope claim unless the transport or host verifies it.

## Future work

- Pub/sub fan-out semantics for channels.
- Schema registry for `payload` values.
- Optional binary protocol such as msgpack or cbor for high-throughput links.
- Parent-child correlation fields for nested tasks.
- Router discovery and health protocol.
- Delivery receipts beyond basic `inbox.ack`.

## Appendix A: Envelope JSON Schema

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://swe-builder.dev/schemas/amp-acs-envelope-1.0.json",
  "title": "AMP-ACS 1.0 Envelope",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "v",
    "ts",
    "id",
    "agentId",
    "channel",
    "type",
    "payload"
  ],
  "properties": {
    "v": {
      "type": "string",
      "const": "1.0"
    },
    "ts": {
      "type": "string",
      "format": "date-time"
    },
    "id": {
      "type": "string",
      "minLength": 1
    },
    "agentId": {
      "type": "string",
      "minLength": 1
    },
    "instanceId": {
      "type": "string",
      "minLength": 1
    },
    "channel": {
      "type": "string",
      "minLength": 1
    },
    "type": {
      "type": "string",
      "minLength": 1
    },
    "correlationId": {
      "type": "string",
      "minLength": 1
    },
    "payload": {
      "type": "object",
      "additionalProperties": true
    }
  },
  "allOf": [
    {
      "if": {
        "properties": {
          "type": {
            "pattern": "^handoff\\."
          }
        },
        "required": ["type"]
      },
      "then": {
        "required": ["correlationId"]
      }
    },
    {
      "if": {
        "properties": {
          "type": {
            "enum": ["result", "inbox.ack"]
          }
        },
        "required": ["type"]
      },
      "then": {
        "required": ["correlationId"]
      }
    }
  ]
}
```

## Appendix B: Example exchange transcripts

The following JSONL transcript shows a three-turn handoff from `agent-A` to `agent-B`: request, accept with progress, and complete.

```jsonl
{"v":"1.0","ts":"2025-01-01T00:00:00Z","id":"11111111-1111-4111-8111-111111111111","agentId":"agent-A","channel":"handoff.review","type":"handoff.request","correlationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","payload":{"task":{"title":"Review patch","instructions":"Review the generated diff for blocking issues only.","inputs":{"branch":"feature/amp-docs"}},"replyChannel":"review.findings"}}
{"v":"1.0","ts":"2025-01-01T00:00:01Z","id":"22222222-2222-4222-8222-222222222222","agentId":"agent-B","channel":"review.findings","type":"handoff.accept","correlationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","payload":{"acceptedBy":"agent-B","etaMs":60000,"message":"Accepted for review."}}
{"v":"1.0","ts":"2025-01-01T00:00:20Z","id":"33333333-3333-4333-8333-333333333333","agentId":"agent-B","channel":"review.findings","type":"progress","correlationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","payload":{"stage":"analysis","message":"Reviewed generator and documentation changes.","percent":70}}
{"v":"1.0","ts":"2025-01-01T00:00:40Z","id":"44444444-4444-4444-8444-444444444444","agentId":"agent-B","channel":"review.findings","type":"handoff.complete","correlationId":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","payload":{"ok":true,"summary":"Review complete. No blocking findings.","result":{"findings":[]}}}
```

The following JSONL transcript shows an inbox delivery and ack.

```jsonl
{"v":"1.0","ts":"2025-01-01T01:00:00Z","id":"55555555-5555-4555-8555-555555555555","agentId":"orchestrator","channel":"agent.inbox","type":"inbox.deliver","correlationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","payload":{"prompt":"Run tests and report failures.","metadata":{"suite":"unit"},"ackPath":"ack.jsonl"}}
{"v":"1.0","ts":"2025-01-01T01:00:05Z","id":"66666666-6666-4666-8666-666666666666","agentId":"agent-A","channel":"agent.inbox","type":"inbox.ack","correlationId":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","payload":{"deliveredId":"55555555-5555-4555-8555-555555555555","ok":true,"summary":"Prompt accepted and sent to the session."}}
```
