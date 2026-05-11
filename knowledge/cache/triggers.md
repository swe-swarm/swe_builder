<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI snapshot, knowledge/patterns/topic-patterns/]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Topic Trigger Types

## All Trigger Types (Generative Orchestration)

### YAML Trigger Kinds

| YAML `kind` | UI Name | Fires When | Needs User Input? |
|-------------|---------|------------|-------------------|
| `OnConversationStart` | Conversation Start | Agent first engages user | No |
| `OnRecognizedIntent` | The agent chooses / User says a phrase | AI matches topic or trigger phrases match | Yes |
| `OnMessageActivity` | A message is received | Any message activity arrives | Yes |
| `OnEventActivity` | A custom client event occurs | Event activity from client app | No |
| `OnActivity` | An activity occurs | Any activity type (broadest) | No |
| `OnConversationUpdateActivity` | The conversation changes | User joins/leaves conversation | No |
| `OnInvokeActivity` | It's invoked | Invoke activity (e.g., Teams extensions) | No |
| `OnSystemRedirect` | It's redirected to | Called explicitly from another topic | No |
| `OnInactivity` | The user is inactive for a while | No interaction after configured time | No |
| `OnUnknownIntent` | Fallback / Conversational boosting | No topic matches user message | Yes |
| `OnError` | On Error | Error during conversation | No |
| `OnSignIn` | Sign in | Auth required | No |
| `OnSelectIntent` | Multiple Topics Matched | Disambiguation needed | Yes |
| `OnEscalate` | Escalate | "Talk to agent" matched | Yes |
| `OnPlanComplete` | A plan completes | Agent finishes all planned steps (generative orchestration) | No |
| `OnGeneratedResponse` | AI-generated response about to be sent | AI composes draft before sending (generative orchestration) | No |

### Hidden/Advanced (YAML-only, not in UI)

| Trigger | How to Enable | Purpose |
|---------|--------------|---------|
| `OnKnowledgeRequested` | Name topic exactly `OnKnowledgeRequested` | Intercept knowledge search, inject custom results |

## Trigger Enhancements (Feb 2026)

| Feature | Status | Details |
|---------|--------|---------|
| **Trigger conditions with PowerFx** | GA | Add PowerFx conditions to any trigger — filter when a topic fires based on variable values or expressions |
| **Trigger priority** | GA | Explicit ordering — set priority when multiple topics could match the same intent |
| **Configure triggers with end-user credentials** | GA (Feb 2026) | Triggers can run authenticated as the end user, enabling user-context-aware trigger logic |

## Key Patterns

### Auto-Execute at Conversation Start (No User Input)

Use `BeginDialog` in the Conversation Start topic to redirect to another topic:

```yaml
kind: AdaptiveDialog
beginDialog:
  kind: OnConversationStart
  id: main
  actions:
    - kind: SendActivity
      id: sendWelcome
      activity:
        text:
          - "Loading your dashboard..."
    - kind: BeginDialog
      id: redirectToDashboard
      dialog: template-content.topic.YourTopicSchemaName
```

### Topic Chaining (Redirect)

Any topic can call another topic using `BeginDialog` or `ReplaceDialog`:

```yaml
# BeginDialog: calls topic, then returns to caller
- kind: BeginDialog
  id: callSubTopic
  dialog: template-content.topic.SubTopicName

# ReplaceDialog: calls topic, does NOT return to caller
- kind: ReplaceDialog
  id: switchToTopic
  dialog: template-content.topic.OtherTopicName
```

### "By Agent" Trigger (Generative Orchestration Default)

No trigger phrases needed. The AI uses topic `displayName` + `description` to decide when to invoke:

```yaml
kind: AdaptiveDialog
beginDialog:
  kind: OnRecognizedIntent
  id: main
  intent:
    displayName: View Progress
    includeInOnSelectIntent: true
```

Set `modelDescription` on the dialog for even better AI routing:

```yaml
dialog:
  modelDescription: >
    This topic displays the user's onboarding progress.
    Use when user wants to see their completion status.
```

### Trigger Conditions (PowerFx)

Add conditions to filter when a trigger fires:

```yaml
kind: AdaptiveDialog
beginDialog:
  kind: OnRecognizedIntent
  id: main
  condition: =Global.UserRole = "Admin"
  intent:
    displayName: Admin Settings
```

### Event Triggers (Autonomous, No User)

Event triggers use Power Automate flows and fire without user input:

```
MCS UI: Add trigger > Schedule / SharePoint / Dataverse / Email
```

These are NOT topic YAML — they're Power Automate flows linked to the agent.

## YAML Node Reference

Key nodes: `SendActivity`/`SendMessage`, `Question`, `ConditionGroup`, `SetVariable`, `BeginDialog` (call subtopic), `ReplaceDialog` (switch, no return), `EndDialog`, `EndConversation`, `SearchAndSummarizeContent`, `OAuthInput`, `HttpRequest`

Variables: see `knowledge/cache/powerfx-variables.md`
