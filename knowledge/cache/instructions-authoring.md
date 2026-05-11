<!-- CACHE METADATA
last_verified: 2026-02-20
sources: [MS Learn authoring-instructions, MS Learn generative-mode-guidance, MCS UI, community blogs]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Instructions Authoring — Quick Reference

## What Instructions Do (Three Purposes)

1. **Resource selection** — which tools/knowledge/topics to call
2. **Input filling** — what values to pass to tools
3. **Response generation** — how to format output for the user

## Routing Priority (Most to Least Important)

| Priority | What | Implication |
|----------|------|-------------|
| 1 | **Tool/topic/knowledge DESCRIPTIONS** | Write excellent descriptions FIRST — they matter most |
| 2 | **Tool/topic/knowledge NAMES** | Use clear, descriptive names |
| 3 | **Input/output parameters** | Well-named parameters help routing |
| 4 | **Agent instructions** | Instructions are LEAST important for routing |

**Key insight:** Instructions influence *response generation* and *disambiguation* more than routing. If routing is wrong, fix topic descriptions first, not instructions.

## Character Limits

| Layer | Scope | Limit |
|-------|-------|-------|
| Agent-level (Overview) | All conversations | 8,000 chars |
| Topic-level (generative answers node) | Specific node only | 8,000 chars (additive) |
| Prompt tool / Custom Prompt action | Specific prompt only | Model token limits |

**BUG (may still exist):** UI may show 8,000 initially but revert to 2,000 after save. Always verify actual char count post-save.

## The Three-Part Structure (MS Recommended)

Microsoft recommends structuring instructions with three elements combined:

### 1. Constraints (What to do / not do)
```
Only respond to requests about educational, legal, wellness, and health benefits for employees.
Do not provide personal medical advice — redirect to HR Benefits team.
```

### 2. Response Format (How to present answers)
```
Respond with benefit types and details in tabular format.
Add a column for available options.
Include insurance provider details and enrollment links.
Use bold and underline for emphasis.
```

### 3. Guidance (How to find answers)
```
Search within country-specific folders relevant to the employee's location.
Use the FAQ documents only if the question is not about Hours, Appointments, or Billing.
```

## Two Proven Instruction Patterns

### Pattern A: Conversational Agent
```markdown
# [Agent Name]

## Role
You are [Name], an AI assistant for [audience] that [core purpose].

## Constraints
- Only respond to [in-scope domains]
- For [out-of-scope topic], say: "[redirect message]"

## Response Format
- [Length]: 3-5 key points per answer
- [Structure]: Numbered steps for procedures, bullets for options
- [Citations]: Name the source document or section
- End every response with a relevant follow-up question or next step

## Guidance
- When the user asks about [ambiguous topic], use /TopicName
- Describe knowledge capabilities generically — do NOT hardcode URLs
- For [sensitive scenario], direct to [escalation resource]
```

### Pattern B: Autonomous / Multi-Step Workflow
```markdown
# OBJECTIVE
[One sentence goal]

# STEPS (follow in order)
1. **[Step Name]**: Use /ToolName to [action]. Transition when [condition].
2. **[Step Name]**: [Next action with /ToolReference].
3. **[Step Name]**: [Final action].

# RESPONSE RULES
- Ask one clarifying question at a time
- Present results as bullet points or tables
- Confirm before completing the workflow

# GUARDRAILS
- Only email [specified recipients]
- Do not [restricted action]
```

## What Instructions CAN and CANNOT Do

### CAN
- Influence post-retrieval summarization (how answers are phrased)
- Disambiguate between similar tools/knowledge with `/` references
- Set persona, tone (only if deviating from default professional), format
- Define workflow steps and tool sequencing for autonomous agents
- Reference variables and Power Fx expressions dynamically
- Guide follow-up question generation
- Set guardrails for what NOT to respond to

### CANNOT
- Control search retrieval (which documents are found)
- Trigger Adaptive Cards (edit card nodes directly)
- Override default fallback message (edit Fallback topic instead)
- Change how documents are shared (system-controlled)
- Guarantee multilingual behavior (not officially supported)

## Anti-Patterns (DO NOT)

| Anti-Pattern | Why It's Bad | Do This Instead |
|-------------|-------------|-----------------|
| **Hardcode URLs in instructions** | Wastes chars, M365 Copilot strips URLs, confuses orchestrator | Describe capabilities generically; let knowledge citations provide links |
| **List all available tools** | Orchestrator already knows them; listing is noise | Only add `/ToolName` for disambiguation |
| **Name specific knowledge sources** | MS: "Describe capabilities generically to avoid incorrect information" | Say "search policy documents" not "search PolicyLibrary.docx" |
| **Add professional tone instructions** | Professional is default; tone instructions are only for deviations | Only specify tone if you want casual, playful, or domain-specific style |
| **Rely on instructions alone for boundaries** | "Add a topic with manually authored response" for hard boundaries | Create dedicated DECLINE/REFUSE topics with fixed messages |
| **Use vague terms** | "Typing box", "be helpful" — ambiguous for the model | Be specific: "respond in 3 bullet points, 20 words max" |
| **Use nested lists** | Confuses the model | Flat lists only |
| **Attempt to control retrieval** | Instructions can't modify search logic | Improve knowledge source descriptions and scoping instead |
| **Skip audience specification** | Agent can't tailor technicality level | Always state who the audience is |

## Best Practices Checklist

### Structure
- [ ] Uses three-part structure: Constraints + Response Format + Guidance
- [ ] Markdown formatting: `#` headers, `1.` ordered steps, `-` bullets, `**bold**`
- [ ] No nested lists
- [ ] Under 8,000 chars (under 2,000 if hitting the save bug)
- [ ] Audience explicitly stated ("for CDW coworkers", "for IT support engineers")

### Content
- [ ] Positive framing ("do X" not "don't do Y") — except for explicit guardrails
- [ ] No hardcoded URLs — describe knowledge capabilities generically
- [ ] No listing of all available tools/knowledge (orchestrator knows)
- [ ] `/` references ONLY for disambiguation or explicit workflow steps
- [ ] Every `/Tool` reference maps to an actually configured tool
- [ ] Every `/Topic` reference maps to an existing topic
- [ ] Agent has an "out" for unknown queries ("respond with 'I could not find...'")
- [ ] Follow-up question guidance included ("end with a relevant follow-up")
- [ ] Few-shot examples for complex behaviors (2-3 varied examples)

### Boundaries
- [ ] Hard boundaries backed by dedicated topics (not instructions alone)
- [ ] DECLINE redirects have corresponding manual-response topics
- [ ] REFUSE scenarios have corresponding manual-response topics

### Orchestration Awareness
- [ ] Topic descriptions are well-written BEFORE instructions (routing priority #1)
- [ ] Instructions focus on response generation and disambiguation
- [ ] If routing fails, fix topic descriptions first — not instructions
- [ ] "Use general knowledge" setting matches follow-up question needs

## "/" Reference Syntax (Lexical Editor)

Type `/` in the instructions editor to insert references:

| Reference | Effect | When to Use |
|-----------|--------|-------------|
| `/Knowledge` | Prioritizes a knowledge source | Disambiguation when multiple sources overlap |
| `/Tool` | Names a specific tool | Disambiguation when multiple similar tools exist, or autonomous step |
| `/Topic` | Routes to a specific topic | Force routing when description alone is ambiguous |
| `/Agent` | Routes to a child agent | Multi-agent workflow steps |
| `/Variable` | Inserts variable value | Dynamic instructions using conversation state |
| `/PowerFx` | Embeds Power Fx expression | Calculated values in instructions |

**Rule:** Only for disambiguation or explicit workflow steps. Never redundantly list all tools.

## Vocabulary for Instructions

| Goal | Verbs |
|------|-------|
| Conditions | when, if, ensure, compare |
| Filter | from, include, exclude, compare, identify |
| Data | provide, retrieve, get, use, analyze, extract |
| Tools | notify, direct, ask, assign |
| Actions | ask, search, send, check, use |

Use **Get/Use** for retrieving data, **From/With** for acting on results.

## Follow-Up Questions

Follow-up questions make agents conversational instead of giving dead-end answers.

**Requirements:**
- "Use general knowledge" must be ON (otherwise follow-ups are suppressed as ungrounded)
- Instructions should reference tools/knowledge/variables so agent generates context-aware follow-ups

**Pattern:**
```
After answering, suggest a relevant follow-up based on available tools and knowledge.
Example: After answering about time-off policy, ask "Would you also like to know how to submit a request in Workday?"
```

## Three Instruction Layers

| Layer | Scope | When to Use |
|-------|-------|-------------|
| **Agent-level** (Overview) | All conversations | Global persona, constraints, response format, guardrails |
| **Topic-level** (generative answers node) | Specific topic only | **Additive** — supplements agent-level for domain-specific guidance |
| **Custom Prompt** (Prompt Builder action) | Specific action only | Summarization, classification, extraction, structured output |

**Decision:** "Should this be agent-level, topic-level, or Custom Prompt?" depends on scope and specificity. Agent-level = global rules. Topic-level = domain narrowing. Custom Prompt = data processing.

## Updating via API

Instructions stored as `botcomponent` type 15 in Dataverse:
```
-- Only PATCH existing instructions (never POST new ones — see build-methods.md bm-002)
PATCH /api/data/v9.2/botcomponents(<id>)
{ "content": "new instructions JSON" }

-- Then publish
pac copilot publish --bot <bot-id>
```
Changes are draft-only until published.

## Security: Trigger Payload Jailbreak Protection

Autonomous agents with triggers are vulnerable to jailbreak via trigger payloads (attacker sends instructions in the payload). Protect by adding to instructions:
- Limit what tools the agent should use after checking knowledge sources
- Limit what parameters the agent should use for tools (e.g., only email specified recipients)
- If content filtering blocks normal behavior, update instructions to indicate the behavior is expected

## Rich Text Email Pattern

For agents that send emails via Power Automate / Outlook connector:
```
Send emails using rich text formatting for the email body content.
```
Add this in both agent instructions AND in the tool description for emphasis.

## Debugging Instructions

If agent stops responding or gives unexpected results:
1. **Remove ALL instructions** and test — does basic Q&A work?
2. **Add back one section at a time**, testing between each
3. **Check topic descriptions** — routing issues are usually description problems, not instruction problems
4. **Verify "Use general knowledge" setting** — OFF suppresses follow-ups
5. **Check for the 2000-char bug** — if instructions save but agent ignores them, re-check actual saved length
