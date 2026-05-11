# Instruction Writing Learnings

Lessons learned about agent instructions — what patterns work, what to avoid, Custom Prompt usage, length management. Consulted during `/mcs-research` Phase C (Prompt Engineer) and `/mcs-fix` Step 2.

<!--
Entry format:
### [Title] {#id} — [Date]
**Context:** [Customer/project, what was being built]
**Tried:** [Initial approach]
**Result:** [What happened]
**Better approach:** [What worked or was recommended]
**Confirmed:** [N] build(s) | Last confirmed: [YYYY-MM-DD]
**Related cache:** [cache file(s) if applicable]
**Tags:** #tag1 #tag2

ID format: in-NNN (instructions)
-->

### Hardcoded URLs and tool listing in instructions produce weak agents {#in-001} — 2026-02-20
**Context:** CDW Legal & HR Policy Advisor — policy Q&A agent with SharePoint knowledge, custom topics, M365 Copilot channel
**Tried:** Instructions with a "Key Resources" section listing 6 hardcoded URLs (CDW Way Code of Conduct, Ethics Helpline, Service Central, etc.), no follow-up question guidance, no audience specification, no examples, professional tone specified (which is default)
**Result:** Instructions were only 2006 chars (well under limit) but quality was poor:
- Hardcoded URLs waste char budget and get stripped by M365 Copilot channel
- No routing hints for custom topics (COI Inquiry, High-Risk Guidance)
- No follow-up question guidance → dead-end answers
- Missing audience ("for CDW coworkers") → generic tone
- No examples for complex COI/escalation workflows
- Boundary enforcement via instructions only (no dedicated topics mentioned)
- Per MS best practices: "Avoid naming specific knowledge sources directly. Describe capabilities generically."
**Better approach:** Use MS three-part structure (Constraints + Response Format + Guidance). Describe knowledge generically ("search policy documents") instead of hardcoding URLs. Include audience, follow-up guidance, and 2-3 examples. Rely on dedicated topics for hard boundaries, not instructions alone. Topic descriptions drive routing more than instructions (priority: description > name > parameters > instructions).
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-20
**Related cache:** instructions-authoring.md, generative-orchestration.md
**Tags:** #instructions #urls #anti-pattern #follow-up #audience #three-part-structure #boundaries
