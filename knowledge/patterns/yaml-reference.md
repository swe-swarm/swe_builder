# MCS Code Editor YAML Reference

## Overview

Topics in Microsoft Copilot Studio can be authored via the built-in code editor using YAML. This approach replaces 10+ clicks per topic node with a single paste operation.

**Schema Validation (primary):** Use `tools/om-cli/om-cli.exe` for full YAML validation — catches unknown nodes, missing required fields, and structural issues across 357 types. Run `tools/om-cli/om-cli.exe validate -f <file>` before pasting.

**Semantic Validation:** Use `python tools/semantic-gates.py <file.yaml> --brief <brief.json>` for 5 additional checks beyond structural validation: PowerFx functions, topic cross-references, variable flow, channel compatibility, and connector references.

**Schema Validation (legacy fallback):** If .NET 10 is unavailable, use `python tools/schema-lookup.py` for kind-value and entity reference checks only.

## YAML Rules

- Root element: `kind: AdaptiveDialog`
- IDs must be unique across all nodes in the topic
- PowerFx expressions start with `=`
- Variables: `Topic.varName` (topic-scoped), `System.User.DisplayName` (system)
- New variables: use `init:Topic.varName` in SetVariable
- `suggestedActions` create quick-reply buttons
- `activity.text` is an array (use `- "text"` format)

## Trigger Types

See `knowledge/cache/triggers.md` for full trigger reference.

Common triggers:
- `OnRecognizedIntent` — user says a phrase or AI chooses topic
- `OnConversationStart` — conversation begins
- `OnUnknownIntent` — fallback / no topic matched

## Available Topic Patterns

Reusable YAML templates in `knowledge/patterns/topic-patterns/`:

| Pattern | File | Use For |
|---------|------|---------|
| Greeting | `greeting.yaml` | Conversation start message |
| FAQ/Knowledge | `faq-knowledge.yaml` | Knowledge-grounded generative answers |
| Branching | `branching.yaml` | Conditional logic with multiple paths |
| Adaptive Card | `adaptive-card.yaml` | Display structured data in cards |
| HTTP Request | `http-request.yaml` | Call external REST APIs |
| Escalation | `escalation.yaml` | Hand off / decline / refuse |
| Multi-Turn | `multi-turn.yaml` | Multi-step variable collection |
| Form Collection | `form-collect.yaml` | Adaptive card form input |
| Auto-Start | `auto-start.yaml` | Auto-execute topic at conversation start |
| AI Builder Model | `ai-builder-model.yaml` | Invoke AI Builder model with input/output bindings |

## How to Use (Code Editor Workflow)

1. Generate topic YAML from spec using patterns above
2. **Validate:** `tools/om-cli/om-cli.exe validate -f <file.yaml>` — catches unknown nodes, missing required fields, structural issues
3. Playwright: Navigate to Topics tab → Create blank topic
4. Playwright: Click "..." → "Open code editor"
5. Playwright: Paste generated YAML into code editor
6. Playwright: Save

## Limitation

Microsoft warns: "Designing a topic entirely in the code editor and pasting complex topics isn't fully supported." For very complex topics (deep nesting, many nodes), consider building the skeleton in the visual canvas first, then switching to code editor for refinement.

## Action Type Reference (9 Types)

### 1. SendActivity / SendMessage — Send text to user
```yaml
# Simple
- kind: SendActivity
  id: sendMsg
  activity: "Text with {Topic.variable} interpolation"

# Complex (text + speech)
- kind: SendActivity
  id: sendComplexMsg
  activity:
    text:
      - Message line 1
      - Message line 2
    speak:
      - Speech version of message
```

### 2. SetVariable — Assign a variable
```yaml
- kind: SetVariable
  id: setVar
  variable: Topic.myVariable        # no = prefix
  value: ="some value or expression" # = prefix for expressions
```

### 3. Question — Ask user for input
```yaml
- kind: Question
  id: askName
  variable: init:Topic.userName
  prompt: "What is your name?"
  entity: StringPrebuiltEntity  # REQUIRED — see entity catalog below
```

### 4. ConditionGroup — If/else branching
```yaml
- kind: ConditionGroup
  id: checkCondition
  conditions:
    - id: condition1
      condition: =!IsBlank(Topic.variable)
      actions:
        - kind: SendActivity
          id: sendIfTrue
          activity: "Variable has value"
  elseActions:
    - kind: SendActivity
      id: sendFallback
      activity: "No match"
```
Common expressions: `=!IsBlank(Topic.var)`, `=Topic.var = "value"`, `=Topic.var > 10`, `=And(cond1, cond2)`

### 5. InvokeAIBuilderModelAction — Call AI Builder model
```yaml
- kind: InvokeAIBuilderModelAction
  id: invokeModel
  input:
    binding:
      document_content: =Topic.document   # input: WITH = prefix
  output:
    binding:
      predictionOutput: Topic.result       # output: NO = prefix
  aIModelId: ba733cc8-4cc6-4e8b-979c-...  # MUST come AFTER input/output
```
Use plain `binding:` — no `kind:` property inside.

### 6. AdaptiveCardPrompt — Collect form data via card
```yaml
- kind: AdaptiveCardPrompt
  id: collectForm
  card: |
    { "type": "AdaptiveCard", "version": "1.5", ... }
  output:
    binding:
      fieldId: Topic.variable  # output: NO = prefix
  outputType:
    properties:
      fieldId:
        type: String
```
Input.Text styles: `"Email"`, `"Tel"`, `"Url"`, or omit for plain text.

### 7. BeginDialog — Redirect to another topic (returns)
```yaml
- kind: BeginDialog
  id: redirectToTopic
  dialog: TopicSchemaName
```

### 8. ReplaceDialog — Switch to another topic (no return)
```yaml
- kind: ReplaceDialog
  id: switchToTopic
  dialog: TopicSchemaName
```

### 9. EndDialog — End current topic
```yaml
- kind: EndDialog
  id: endDialog
  value: =Topic.result  # optional — return value
```

## Binding Direction Rules

**This is a common source of errors.** The `=` prefix means different things depending on context:

| Context | Syntax | `=` Prefix? |
|---------|--------|-------------|
| Variable assignment `value:` | `value: ="expression"` | Yes |
| Condition expression | `condition: =Topic.var = "x"` | Yes |
| Input binding (to model/action) | `inputField: =Topic.var` | **Yes** |
| Output binding (from model/action) | `outputField: Topic.var` | **No** |
| Variable reference in `variable:` | `variable: Topic.myVar` | No |
| New variable declaration | `variable: init:Topic.myVar` | No |

## Prebuilt Entity Catalog

Every `Question` and `AutomaticTaskInput` MUST have an `entity` property. **Entities must be string references — never inline definitions.**

### Text & Numbers
| Entity | Use For |
|--------|---------|
| `StringPrebuiltEntity` | Any text input (default choice) |
| `NumberPrebuiltEntity` | Numeric values |
| `BooleanPrebuiltEntity` | Yes/No, True/False |

### Contact Information
| Entity | Use For |
|--------|---------|
| `EmailPrebuiltEntity` | Email addresses (auto-validated) |
| `PhoneNumberPrebuiltEntity` | Phone numbers (auto-validated) |
| `URLPrebuiltEntity` | Web URLs |

### Location
| Entity | Use For |
|--------|---------|
| `CityPrebuiltEntity` | City names |
| `CountryOrRegionPrebuiltEntity` | Countries |
| `StatePrebuiltEntity` | US states |
| `ZipCodePrebuiltEntity` | ZIP/postal codes |
| `StreetAddressPrebuiltEntity` | Street addresses |

### Time & Dates
| Entity | Use For |
|--------|---------|
| `DatePrebuiltEntity` | Dates |
| `DateTimePrebuiltEntity` | Date and time |
| `DurationPrebuiltEntity` | Time durations |

### Other
| Entity | Use For |
|--------|---------|
| `MoneyPrebuiltEntity` | Currency amounts |
| `AgePrebuiltEntity` | Age values |
| `PercentagePrebuiltEntity` | Percentage values |
| `ColorPrebuiltEntity` | Color names |

**Prefer specific entities** for automatic validation: `EmailPrebuiltEntity` over `StringPrebuiltEntity` when collecting email.

## Schema Lookup Tool

Query the full MCS authoring schema without loading 200KB+ into context:

```bash
python tools/schema-lookup.py lookup Question       # Get definition
python tools/schema-lookup.py search "Card"          # Find matching definitions
python tools/schema-lookup.py resolve SendActivity    # Expand all $refs
python tools/schema-lookup.py kinds                   # List all 433 valid kind values
python tools/schema-lookup.py entities                # List all prebuilt entities
python tools/schema-lookup.py validate topic.yaml     # Validate kind + entity values
```

## Common Compile Errors

| Error | Fix |
|-------|-----|
| Missing entity | Add `entity: StringPrebuiltEntity` to Question/AutomaticTaskInput |
| Inline entity definition | Use string reference (`entity: StringPrebuiltEntity`), not inline `kind: ClosedListEntity` |
| Condition syntax error | Ensure `=` prefix: `condition: =Topic.variable = "value"` |
| BeginDialog reference error | Use simple string: `dialog: TopicSchemaName` |
| aIModelId placement | Move `aIModelId` AFTER `input`/`output` sections |
| Input binding missing `=` | Input bindings need `=` prefix: `fieldName: =Topic.var` |
| Output binding has `=` | Output bindings must NOT have `=`: `fieldName: Topic.var` |
