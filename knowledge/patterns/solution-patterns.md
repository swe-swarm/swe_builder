# Solution Patterns — Problem-to-Solution Catalog

> **Purpose:** Proactive engineering judgment for `/mcs-research` Phase B Step 2.5. Maps common problem types to proven implementation patterns, catching naive approaches that fail at build time.
>
> **How it works:** During research, each MVP capability's data flow is traced (input → processing → output) and checked against "When to match" conditions below. Matches trigger a recommendation to use the proven pattern instead of the naive approach.
>
> **Decision generation:** When a pattern matches and has 2+ viable implementation tiers (after filtering against customer constraints), research creates a structured `decisions[]` entry — one option per tier. If only 1 tier survives constraint filtering, it's auto-applied with no decision entry. Default recommendation is always Tier 1 unless customer constraints disqualify it.
>
> **Growth:** New patterns are added via `/mcs-retro` (classification: `SOLUTION_PATTERN`, Tier 2). Each pattern tracks `confirmed` builds for confidence weighting.

---

## sp-001: Web Content Extraction

**Naive approach:** HTTP Request connector to fetch URL, pass raw HTML to AI prompt.

**Why it fails:**
- Raw HTML includes navigation, ads, scripts, cookie banners — 80%+ noise
- AI Builder / AI Prompt has ~5,000 char practical context limit — a raw HTML page is 100,000+ chars
- AI hallucinates structure from noisy input, producing unreliable extraction
- Dynamic/JS-rendered pages return empty or partial content via HTTP GET
- Cookie consent banners (EU/UK sites) and anti-bot layers (Cloudflare, Akamai) return consent pages or 403s instead of content
- Power Platform's built-in Content Conversion (HTML-to-Text) strips tags but returns a wall of mixed text (article + nav + ads + footer) with no structure — max 80 char lines
- **This does NOT eliminate per-site rules — it just moves the same problem from Python to prompt engineering.** When news sites redesign their layout, the extraction breaks the same way the customer's current script breaks.

**Proven pattern:** Dedicated content extraction service that returns clean structured article data. Multiple implementation tiers available.

**When to match:**
- Capability mentions "extract from web", "summarize website", "read URL content", or "web scraping"
- Integration lists HTTP connector with a URL-fetching purpose
- Data flow includes: URL input → content extraction → AI processing
- Customer is replacing a per-site scraping script (BeautifulSoup, Scrapy, Cheerio, etc.)

**Implementation tiers (ranked by recommendation):**

| Tier | Option | Deploy Effort | Cost | Handles JS? | Data Residency |
|------|--------|--------------|------|-------------|----------------|
| 1 | **Azure Function + @mozilla/readability + jsdom** | Medium (one-time ~2hr) | ~$0/mo (consumption plan) | No (static HTML only) | Customer tenant |
| 2 | **Jina Reader API** (`r.jina.ai/{url}`) | Low (HTTP call) | $0 (free: 500 RPM) | Yes | Third-party (Jina/Elastic) |
| 3 | **Firecrawl API** | Low-Medium | $0-16/mo | Yes + anti-bot | Third-party (Firecrawl) |
| 4 | **Azure Container App + Playwright + Readability** | High (container) | ~$5-15/mo | Yes | Customer tenant |
| 5 | **Custom MCP Server wrapping Readability** | Medium-High | ~$0 (Azure hosting) | Depends on stack | Customer tenant |

**Recommended default: Tier 1** (Azure Function + Readability). Covers ~90% of news/content sites. If specific sites need JS rendering, upgrade those domains to Tier 4. If customer can't deploy Azure resources, use Tier 2 (Jina Reader — zero deployment, free tier).

**Tier 5 note:** Custom MCP servers in Copilot Studio are in public preview (GA expected April 2026). Viable after GA, but too risky for MVP builds today.

**What the extraction service returns:** `{ title, author/byline, content (clean text), excerpt, siteName, publishedTime, wordCount }` — structured JSON, not raw HTML.

**Integration path to MCS:**
1. Deploy extraction service (Azure Function, Jina API, or Firecrawl)
2. Create custom connector in Power Platform (OpenAPI spec, function key or API key auth)
3. Call from Power Automate flow (Apply to each → HTTP action → extraction endpoint) or add as agent tool
4. Agent receives clean structured data, not raw HTML

**Do NOT recommend:**
- HTTP Request + AI Prompt on raw HTML (the naive approach — will fail and damage credibility)
- Power Automate Content Conversion alone (strips structure, returns mixed text)
- Computer Use Agent for content extraction (wrong tool — designed for UI automation, $0.40-1.20/page, ~80% success rate, 10-30s per page)

**Tags:** `web`, `http`, `content-extraction`, `html`, `azure-function`, `readability`, `jina`, `firecrawl`
**Confirmed builds:** 0
**Last updated:** 2026-03-03
**Decision generation:** 5 tiers available. Min tiers for decision: 2. Default recommendation: Tier 1 (Azure Function + Readability). Common constraint filters: no Azure subscription → eliminates Tier 1,4,5; data residency required → eliminates Tier 2,3.

---

## sp-002: Document Generation

**Naive approach:** Generate document content inline in the agent response (markdown or plain text), tell user to copy-paste.

**Why it fails:**
- Agent responses have length limits (~4000 chars in Teams)
- No formatting control (headers, tables, logos, page breaks)
- User must manually create the document — defeats automation purpose
- Multi-page documents are impossible inline

**Proven pattern:** Power Automate flow with Word Online "Populate a Microsoft Word template" action. Agent collects data → triggers flow → flow fills template → returns SharePoint URL.

**When to match:**
- Capability mentions "generate report", "create document", "produce PDF", "fill template"
- Output is a formatted document (not just a text response)
- Document has a consistent structure (template-able)

**Implementation:**
- Word template with content controls stored in SharePoint
- Power Automate flow: receive JSON data → populate template → save to SharePoint → return URL
- Agent triggers flow via connector action, receives download URL
- For PDF output: add "Convert Word to PDF" action in the flow
- Alternative: If document is simple (< 1 page), use adaptive card with formatted content

**Tags:** `document`, `generation`, `word`, `template`, `power-automate`, `sharepoint`
**Confirmed builds:** 0
**Decision generation:** 2 tiers (Power Automate + Word template vs adaptive card for simple docs). Min tiers for decision: 2. Default recommendation: Power Automate flow. Single-tier auto-apply if document is clearly multi-page or clearly < 1 page.

---

## sp-003: Iterating Over N Items

**Naive approach:** Topic YAML with a loop construct or repeated question nodes to process each item.

**Why it fails:**
- MCS topic YAML has no native loop/iteration construct
- Repeated nodes create exponential complexity (N items = N copies of logic)
- Variable management becomes unwieldy past 3 items
- Topic YAML has node count limits (~200 per topic)

**Proven pattern:** Power Automate flow with "Apply to each" action. Agent collects the list → sends to flow → flow iterates and processes → returns aggregated result.

**When to match:**
- Capability involves processing a list of items (approvals, tickets, records)
- Data flow includes: "for each X, do Y"
- Topic design would require repeating the same logic N times
- User says "batch", "bulk", "multiple", "all items"

**Implementation:**
- Power Automate flow receives array via HTTP trigger or connector
- "Apply to each" processes items (API calls, updates, transformations)
- Flow returns summary array or aggregated result
- Agent presents results in adaptive card table or bulleted list
- For small fixed lists (2-3 items): sequential topic nodes are acceptable

**Tags:** `iteration`, `loop`, `batch`, `power-automate`, `apply-to-each`
**Confirmed builds:** 0
**Decision generation:** Single proven pattern (Power Automate). No decision entry — auto-apply. Exception: fixed small list (2-3 items) where sequential topic nodes are acceptable creates a 2-tier decision.

---

## sp-004: File Upload in Teams Channel

**Naive approach:** Accept file via topic variable, process directly in the agent.

**Why it fails:**
- MCS agents in Teams cannot directly receive file uploads as attachments
- Topic variables don't support binary/file types
- File content isn't accessible to the agent's processing pipeline
- Teams attachment URLs require Graph API auth to download

**Proven pattern:** Stage files to SharePoint first, pass the SharePoint URL to the agent. Or use Power Automate flow triggered by file upload to a specific Teams channel/SharePoint folder.

**When to match:**
- Capability mentions "upload file", "attach document", "send PDF to agent"
- Channel is Teams (web chat file upload works differently)
- Data flow includes: user provides file → agent processes file content

**Implementation:**
- Option A (user-initiated): Instruct users to upload files to a specific SharePoint folder/Teams channel. Agent queries that location via connector.
- Option B (flow-triggered): Power Automate trigger "When a file is created in a folder" → flow extracts content → sends to agent or stores processed result.
- Option C (adaptive card): Card with a link to SharePoint upload page → agent monitors for new files.
- For web chat channel: file upload via attachment API is possible — Teams is the constraint.

**Tags:** `file-upload`, `teams`, `sharepoint`, `attachment`, `binary`
**Confirmed builds:** 0
**Decision generation:** 3 options (user-initiated SharePoint, flow-triggered, adaptive card link). Min tiers for decision: 2. Default recommendation: Option A (user-initiated). Channel determines viability — web chat can accept attachments directly.

---

## sp-005: Complex Data Transformation

**Naive approach:** AI prompt action to transform data (parse CSV, reformat JSON, calculate totals).

**Why it fails:**
- AI models are unreliable at precise numerical calculations
- Structured transformations (CSV parsing, JSON reshaping) hallucinate columns/fields
- Large datasets exceed prompt token limits
- No validation that output matches expected schema

**Proven pattern:** Code interpreter action (if available) or Azure Function / Power Automate expression for deterministic transformations. Use AI only for unstructured-to-structured (e.g., extract fields from free text).

**When to match:**
- Capability requires precise calculations (totals, averages, date math)
- Data flow includes structured format conversion (CSV → JSON, XML → table)
- Output must be deterministic (same input = same output every time)
- Data volume exceeds ~50 rows or ~2000 tokens

**Implementation:**
- For calculations: Power Automate expressions or Azure Function
- For format conversion: Power Automate "Compose" + expressions, or Azure Function
- For field extraction from free text: AI prompt is appropriate (this IS what AI excels at)
- Hybrid: AI extracts fields → deterministic code validates + formats
- Code interpreter (preview): available in some MCS plans for inline code execution

**Tags:** `transformation`, `calculation`, `csv`, `json`, `code-interpreter`, `azure-function`
**Confirmed builds:** 0
**Decision generation:** Multiple options (Power Automate expressions, Azure Function, code interpreter, hybrid). Min tiers for decision: 2. Default recommendation: Power Automate expressions for simple transforms, Azure Function for complex. Auto-apply if transformation type is clearly one category.

---

## sp-006: Scheduled Batch Processing

**Naive approach:** MCS scheduled trigger (Recurrence) to process batches of records at intervals.

**Why it fails:**
- MCS scheduled triggers invoke a conversation — they can't silently process batches
- Each trigger invocation creates a new conversation (no batch context)
- Agent can't iterate over records natively (see sp-003)
- Long-running batch processing exceeds conversation timeout limits
- No error handling or retry logic for individual batch items

**Proven pattern:** Power Automate scheduled flow handles the batch. Agent is invoked only for human-in-the-loop decisions or to report results.

**When to match:**
- Capability mentions "daily report", "weekly sync", "scheduled cleanup", "batch update"
- Processing is headless (no user interaction during processing)
- Data flow: timer → query records → process each → report/store results

**Implementation:**
- Power Automate: Recurrence trigger → query Dataverse/API → Apply to each → process → store results
- Agent's role: user asks "What happened in the last batch?" → agent queries flow run history or result table
- For human-in-the-loop: flow pauses at approval step, sends adaptive card to Teams → user decides → flow continues
- Use Flow Manager (`tools/flow-manager.js`) to create and configure the scheduled flow

**Tags:** `scheduled`, `batch`, `recurrence`, `power-automate`, `headless`
**Confirmed builds:** 0
**Decision generation:** Single proven pattern (Power Automate scheduled flow). No decision entry — auto-apply.

---

## sp-007: Multi-System Orchestration

**Naive approach:** Sequential MCP server or connector calls within a single topic, relying on generative orchestration to chain them.

**Why it fails:**
- Generative orchestration may call systems in wrong order (no explicit ordering)
- If one system call fails, there's no transaction rollback
- Cross-system data mapping (field names differ) requires explicit transformation
- Timeout risk: multiple API calls in one turn can exceed conversation timeout
- Error handling per system is not possible in generative mode

**Proven pattern:** Power Automate flow with explicit action ordering, error handling per step, and transaction compensation. Agent sends the request → flow orchestrates → returns result.

**When to match:**
- Capability requires data from 2+ different systems in a specific order
- Data from system A is needed as input to system B
- Any step failure should prevent subsequent steps (transactional)
- Cross-system field mapping is needed

**Implementation:**
- Power Automate flow: HTTP trigger → System A query → transform → System B update → System C notification → return result
- Each step has "Configure run after" for error handling
- Compensation logic: if step 3 fails, undo step 2
- Agent's role: collect user input → trigger flow → report result
- For simple 2-system reads (no ordering dependency): generative orchestration with 2 MCP tools is acceptable

**Tags:** `orchestration`, `multi-system`, `transaction`, `power-automate`, `chaining`
**Confirmed builds:** 0
**Decision generation:** 2 tiers (Power Automate flow for ordered/transactional, generative orchestration for simple 2-system reads). Min tiers for decision: 2. Default: Power Automate. Auto-apply generative if only 2 systems with no ordering dependency.

---

## sp-008: API with Complex Auth

**Naive approach:** HTTP Request action with auth headers (API key, OAuth token) configured in topic YAML or connector.

**Why it fails:**
- MCS HTTP action doesn't support OAuth refresh token flows
- API keys in topic YAML are visible in the code editor (security risk)
- Multi-step auth (OAuth2 PKCE, SAML, certificate auth) can't be configured in HTTP action
- Token expiration requires refresh logic that topics can't handle

**Proven pattern:** Custom connector with proper auth configuration, or Azure Function as auth proxy. Auth complexity lives outside the agent.

**When to match:**
- Integration requires OAuth2 (authorization code, client credentials, or PKCE)
- API uses certificate-based authentication
- API requires multi-step token exchange
- Integration mentions "SSO", "delegated permissions", or "service account"

**Implementation:**
- Option A (Custom connector): Define OpenAPI spec with security scheme. MCS handles token refresh. Best for REST APIs with standard OAuth2.
- Option B (Azure Function proxy): Function handles auth complexity, exposes simple API key-authenticated endpoint to MCS. Best for non-standard auth flows.
- Option C (Power Automate): Flow handles auth via its 1000+ connectors with built-in auth. Best when a connector already exists.
- For simple API key auth: HTTP action is fine — this pattern is for complex auth only.

**Tags:** `auth`, `oauth`, `custom-connector`, `azure-function`, `security`
**Confirmed builds:** 0
**Decision generation:** 3 options (custom connector, Azure Function proxy, Power Automate). Min tiers for decision: 2. Default recommendation: Custom connector for standard OAuth2, Power Automate when connector exists. Auto-apply if auth type clearly maps to one option.

---

## sp-009: Large Dataset Processing

**Naive approach:** Connector query action that returns all records, process in topic.

**Why it fails:**
- Connector queries have row limits (typically 500-5000 per page)
- Large result sets exceed agent memory / variable size limits
- Topic can't paginate (no loop construct — see sp-003)
- AI prompt can't process thousands of records meaningfully
- Response time degrades linearly with dataset size

**Proven pattern:** Power Automate flow with pagination enabled, server-side filtering, and aggregation. Agent sends query parameters → flow handles pagination + processing → returns summary.

**When to match:**
- Data source has 500+ records that match the query
- Capability mentions "all records", "full report", "complete list", "export"
- Query needs aggregation (count, sum, average) across many records
- User expects a summary, not raw record listing

**Implementation:**
- Power Automate: Connector action with pagination enabled (Settings → Pagination → On, threshold: 100000)
- Server-side filtering: OData $filter, FetchXML, or API query params to reduce dataset before retrieval
- Aggregation in flow: "Select" + "Compose" actions, or inline expressions
- Return summary to agent (totals, top-N, grouped counts) — not raw records
- For small datasets (< 100 records): direct connector query in topic is acceptable

**Tags:** `large-dataset`, `pagination`, `aggregation`, `power-automate`, `performance`
**Confirmed builds:** 0
**Decision generation:** Single proven pattern (Power Automate with pagination). No decision entry — auto-apply. Small datasets (< 100 records) don't match this pattern.

---

## sp-010: Real-Time Notifications

**Naive approach:** Agent polls a data source on schedule to detect changes, then notifies users.

**Why it fails:**
- MCS agents can't run persistent background polling
- Scheduled triggers create conversations — can't silently check and notify
- Polling interval creates delay (changes aren't truly "real-time")
- Polling wastes API calls when no changes occurred (99% of checks)

**Proven pattern:** Power Automate event-triggered flow detects the change → sends proactive message or adaptive card to Teams. Agent handles follow-up conversation.

**When to match:**
- Capability mentions "alert", "notify", "real-time", "when X happens"
- Trigger is an external event (new record, status change, email received)
- User expects notification without asking the agent first

**Implementation:**
- Power Automate: Event trigger (Dataverse "When a row is modified", "When a new email arrives", webhook) → filter condition → post adaptive card to Teams channel or chat
- For proactive agent messages: use Direct Line API from the flow to send a message to the agent conversation
- Agent's role: respond to user follow-up after notification ("Tell me more about this alert")
- For Teams: use "Post card in a chat or channel" action with an adaptive card
- Batching: if events are frequent, accumulate for N minutes then send digest

**Tags:** `notifications`, `real-time`, `event-driven`, `power-automate`, `proactive`
**Confirmed builds:** 0
**Decision generation:** Single proven pattern (Power Automate event-triggered flow). No decision entry — auto-apply. Batching vs immediate is a configuration choice within the pattern, not a separate tier.
