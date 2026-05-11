# MCS Topic YAML Patterns

Reusable YAML patterns for Copilot Studio topic authoring via the built-in code editor.

## Usage

1. Build skills generate topic YAML from brief.json (conversations.topics[]) using these patterns
2. Playwright opens the MCS topic code editor
3. Generated YAML is pasted into the code editor
4. Saved — no canvas clicking required

## Pattern Files

| Pattern | Use Case |
|---------|----------|
| `greeting.yaml` | Conversation start / welcome message |
| `faq-knowledge.yaml` | Knowledge-grounded Q&A with generative answers |
| `branching.yaml` | Conditional logic with multiple paths |
| `adaptive-card.yaml` | Display data in adaptive card format |
| `http-request.yaml` | Call external REST API |
| `escalation.yaml` | Hand off to human / decline gracefully |
| `multi-turn.yaml` | Multi-step conversation with variable collection |
| `form-collect.yaml` | Collect multiple inputs then take action |
| `auto-start.yaml` | Auto-execute topic at conversation start |
| `ai-builder-model.yaml` | Invoke AI Builder model with input/output bindings |

## Related References

- **YAML syntax rules**: `knowledge/patterns/yaml-reference.md` (action types, entity catalog, binding rules)
- **Schema validation (primary)**: `tools/om-cli/om-cli.exe validate -f <file.yaml>`
- **Schema validation (legacy fallback)**: `python tools/schema-lookup.py validate <file.yaml>`
- **Trigger types**: `knowledge/cache/triggers.md`
- **Playwright workflow**: `knowledge/patterns/playwright-patterns.md`

## YAML Rules

- Root element is always `kind: AdaptiveDialog`
- IDs must be unique across all nodes (use descriptive prefixes)
- PowerFx expressions start with `=` prefix
- Variables: `Topic.varName` (topic-scoped), `System.User.DisplayName` (system)
- Use `init:Topic.varName` to declare a new variable in SetVariable
- Trigger types: `OnRecognizedIntent`, `OnConversationStart`, `OnUnknownIntent`
