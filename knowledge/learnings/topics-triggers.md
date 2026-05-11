# Topic & Trigger Learnings

Lessons learned about topic YAML, trigger types, generative orchestration, adaptive cards. Consulted during `/mcs-research` Phase D, `/mcs-build` Step 4, and `/mcs-fix` Step 2.

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

ID format: tt-NNN (topics-triggers)
-->

### Question entity must use flat string format {#tt-001} -- 2026-02-19
**Context:** Topic Engineer constrained generation test, Order Lookup topic
**Tried:** Nested object format for entity: `entity:\n  entityType: StringPrebuiltEntity`
**Result:** om-cli rejected with `UnknownElementError` — the nested format is not valid
**Better approach:** Use flat string format: `entity: StringPrebuiltEntity`. Consistent with all existing topic patterns.
**Confirmed:** 1 build(s) | Last confirmed: 2026-02-19
**Related cache:** knowledge/patterns/topic-patterns/multi-turn.yaml
**Tags:** #yaml #question #entity #validation
