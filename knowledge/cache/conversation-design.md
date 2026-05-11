<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI, community]
confidence: high
refresh_trigger: weekly
-->
# MCS Conversation Design & Teams — Quick Reference

## Flow Control Nodes

| Node | Function |
|------|----------|
| **Redirect** | Call subtopic (returns when done). Input/output vars supported. |
| **End current topic** | Ends current only. Returns to caller if redirected. |
| **End all topics** | Ends ALL. Does NOT clear globals. |
| **End Conversation** | Triggers CSAT survey. |
| **Transfer conversation** | Handoff to live agent. |
| **Clear variable values** | Resets globals. |

**MCS does NOT use Bot Framework terms**: Redirect = BeginDialog, End current = EndDialog, End all = EndConversation. No ReplaceDialog equivalent.

## Built-in Entity Types

**String**: Person name, Organization, Email, Phone, URL, City, State, Country, Continent, Street address, Zip, Point of interest, Event, Language, Color
**Number**: Number, Integer, Ordinal, Money, Percentage, Age, Speed, Temperature, Weight
**Other**: Boolean, DateTime, Choice (multiple-choice), User's entire response (String)

**Custom**: Closed List (with smart matching/fuzzy logic) or Regex (NLU/CLU: .NET syntax; NLU+: JavaScript)

## Slot Filling

- **Proactive**: user gives multiple values at once → agent auto-maps
- Filled slots skip questions by default (configurable: "Ask every time")
- Question node accepts up to **5 different entity types**

## Error Handling

- **OnError** system topic: error code, conversation ID, timestamp
- Key codes: 2000 (infinite loop), 2001 (invalid content), 2002 (Dataverse), 2003 (flow), 2007 (too much content)
- Connected agent: `AuthMismatch`, `BotNotPublished`, `ChainingNotSupported`
- Fallback: max **2 questions** before handoff, **3+ message variations** to avoid robotic feel

## Escalation

**Implicit** (agent detects "talk to agent") or **Explicit** (Transfer conversation node).

Context passed: `va_Scope`, `va_LastTopic`, `va_Topics`, `va_LastPhrases`, `va_ConversationId`, `va_AgentMessage`, all topic variables.

Hubs: Dynamics 365 Omnichannel (native), LivePerson, Generic adapter.

## Multi-Agent Decision

**Use connected agents when**: >30-40 tools/topics, similar descriptions confusing planner, different teams/publishing/ALM, reusable across parents.
**Use child agents when**: single team, same auth, no independent publishing needed.
**Multi-level chaining NOT supported.** Global vars NOT shared across agents.

## Teams Integration

- Deploy: publish → add Teams channel → install → share → admin approval
- **Personal chat**: full features, SSO supported
- **Team channels**: @mention, needs "everyone in org" security
- **Group/meeting chats**: no manual auth + SSO (use "Authenticate with Microsoft")
- **Conversation Start**: runs ONCE per user install; "start over" forces latest version
- **Admin**: only icon/description changes need re-approval; content changes do not

### Teams SSO

1:1 chats only. "Authenticate with Microsoft" is simplest. Manual: set URI to `api://botid-{teamsbotid}`.

## Proactive Messaging (Teams)

Power Automate flow → personal chat only. Can send text + Adaptive Cards. Agent must be installed by recipient. **Billing**: counts as Copilot Credits even without user response. NOT logged in transcripts/analytics.

## Quick Replies

Send message (default), Open URL, Make a call, Send hidden message. Rich types: Text, Image, Video, Basic Card, Adaptive Card, Speech override, Message variations (random selection prevents repetition).

## Design Checklist

- [ ] Welcome message with capabilities + suggested actions
- [ ] Fallback with 3+ message variations
- [ ] DECLINE/REFUSE boundary topics
- [ ] Error handling for API failures
- [ ] Confirmation before destructive actions
- [ ] Multi-turn escape paths ("cancel", "start over")
- [ ] Escalation path to human
