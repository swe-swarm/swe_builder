<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, Adaptive Cards docs, direct testing, WebSearch Feb 2026]
confidence: high
refresh_trigger: on_error
-->
# MCS Adaptive Cards — Quick Reference

## Schema Versions by Channel

| Channel | Max Version | Key Limitations |
|---------|-------------|----------------|
| Web Chat | 1.6 | No `Action.Execute` |
| Teams | 1.5 | No `Action.Execute`, no standalone Image/Video/Basic cards (`ContentFiltered`) |
| Omnichannel | 1.5 | Input selections NOT visible to human agent on escalation |
| **WhatsApp** | **Very limited** | **Only `Action.Submit` (max 3), `Input.ChoiceSet`, `Action.OpenUrl`** — no other card elements supported |
| M365 Copilot | Limited | No `Action.Execute`, no Basic/Video cards |

**Safe default: use version `"1.5"` for cross-channel compatibility.**

**WhatsApp card design rules:** Keep cards extremely simple. Max 3 submit buttons. Use `Input.ChoiceSet` for selections. `Action.OpenUrl` for links. No images, no complex layouts, no tables.

## Action Types

| Action | Supported? | Notes |
|--------|-----------|-------|
| `Action.Submit` | **Yes** (primary) | Gathers all inputs, sends to agent |
| `Action.OpenUrl` | Yes | Opens external URL |
| `Action.ShowCard` | Yes | Inputs inside ShowCard NOT gathered by parent submit |
| `Action.ToggleVisibility` | Yes (v1.2+) | Show/hide elements by ID |
| `Action.Execute` | **No** | Not supported in Web Chat, Teams, or MCS |

## Input Elements

`Input.Text` (single/multiline, regex validation), `Input.Number` (min/max), `Input.Date`, `Input.Time`, `Input.Toggle` (boolean), `Input.ChoiceSet` (dropdown/radio/checkbox, filtered style v1.5+)

All inputs support: `isRequired`, `errorMessage`, `label` (v1.3+)

## Body Elements

`TextBlock`, `Image`, `Container`, `ColumnSet`/`Column`, `FactSet`, `ImageSet`, `ActionSet` (v1.2), `RichTextBlock` (v1.2), `Table` (v1.5)

## Size Limits

| Channel | Limit |
|---------|-------|
| Teams | **~28 KB** practical (413 error above) |
| General | ~40 KB including headers |
| Max actions | 6 recommended |

## Card Data Flow (Action.Submit)

1. User clicks Submit → all input values gathered
2. In Question node: stored in `Topic.formData`
3. Access fields: `Topic.formData.fieldId`
4. In "Ask with Adaptive Card" node: auto-creates output variables per input `id`

## PowerFx in Cards

- `cardContent: |-` with `=` prefix enables PowerFx
- Variable binding: `text: Topic.userName` (no quotes)
- Formatting: `Text(Topic.date, "MMM dd, yyyy")`
- Dynamic arrays: `ForAll(Topic.items, { type: "TextBlock", text: ThisRecord.Name })`
- `'$schema'` needs single quotes (special character)

## Key Gotchas

- **Formula mode is irreversible** — save JSON copy before switching
- **System.* can't be used in card JSON** — assign to Topic variable first
- **Action.ShowCard inputs** not gathered by parent card's submit button
- **Carousel**: multiple `AdaptiveCardTemplate` attachments in one message node
- **Reprompt**: "Ask with Adaptive Card" retries up to 2x if user sends text instead of submitting
- **Fallback** (v1.2+): `"fallback": "drop"` to silently remove unsupported elements
- **Images**: URL-based or data URI/base64 (v1.2+). In Teams, use Adaptive Card for images (standalone Image nodes = `ContentFiltered`)
- **WhatsApp**: Only 3 card element types supported — design separate simplified cards for WhatsApp channel
