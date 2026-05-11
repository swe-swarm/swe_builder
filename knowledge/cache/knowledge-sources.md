<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI snapshot, MS Learn real-time connectors, MS Learn web search docs, WebSearch]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Knowledge Source Types

## Available Knowledge Sources

| Type | Description | Setup | Limits |
|------|-------------|-------|--------|
| Public websites | Web pages searched via Bing | Provide URLs. Requires ownership attestation. | **25 URLs** per agent |
| Uploaded files (Documents) | Local files uploaded to Dataverse | Upload .pdf, .docx, .pptx, .txt, .html, .xlsx, .csv | **500 max** per agent, 512 MB per file |
| SharePoint sites | Index SharePoint site content via GraphSearch | Connect to SharePoint URL. Requires Entra ID auth. | **25 URLs**, 1,000 files/50 folders/10 layers per source, 512 MB per file, sync every 4-6h |
| Dataverse tables | Structured data from Dataverse via RAG | Select tables and views. Requires Entra ID auth. | **2 sources**, 15 tables per source |
| Enterprise connectors (Microsoft Search) | Index non-Microsoft data into Graph for semantic search | Setup in M365 admin center. Add via Knowledge > Advanced. | Requires `ExternalItem.Read.All` scope. Semantic labels required. |
| OneDrive | Personal/shared OneDrive files | Select files from OneDrive | See SharePoint limits |
| Salesforce | CRM data as knowledge | Configure via Knowledge > Advanced | Sync every 4-6 hours |
| ServiceNow | IT service management data | Configure via Knowledge > Advanced | Sync every 4-6 hours |
| Confluence | Wiki/documentation content | Configure via Knowledge > Advanced | Cloud only, sync every 4-6 hours |
| Zendesk | Support ticket/article data | Configure via Knowledge > Advanced | Sync every 4-6 hours |
| Web Search (Bing grounding) | Open web search across ALL Bing-indexed sites | Toggle in Generative AI settings or Knowledge > Web Search. | Requires generative orchestration enabled. Uses Grounding with Bing Search API (separate pricing). |
| AI General Knowledge | LLM foundational knowledge | Toggle in Generative AI settings. | Not real-time. Based on model training data. |
| **Tenant graph grounding** | Semantic search across M365 tenant data | Enable in Generative AI settings | **Requires M365 Copilot license**. 10 credits per use. |
| **Real-Time Knowledge connectors (Preview)** | Live API queries to external systems with no data movement | Add via Knowledge > Advanced > Real-time connector. Select tables. | Preview. Metadata-only indexing. Runtime-authenticated per user. |

### Agent-Level Limits

| Constraint | Limit |
|-----------|-------|
| Max knowledge objects per agent | **500** |
| Max different source types per agent | **5** |
| SharePoint list queries | First **2,048 rows** only |

## Real-Time Knowledge Connectors (Preview) -- Supported Systems

Added Feb 2026. These connectors query external systems live at runtime with no data replication.

| Connector | Notes |
|-----------|-------|
| **Salesforce** | Accounts, Contacts, Opportunities, Leads, Cases |
| **ServiceNow** | Supports synonyms and glossary definitions |
| **Azure SQL** | Direct SQL queries |
| **Azure AI Search** | Semantic search |
| **SharePoint** | Also available as standard knowledge source |
| **Dataverse** | Also available as standard knowledge source |
| **Dynamics 365** | CRM data |
| **Snowflake** | Data warehouse queries |
| **Databricks** | Analytics data |
| **Zendesk** | Supports synonyms and glossary definitions |
| **Confluence** | Cloud only |
| **Oracle Database** | Database queries |
| **SAP OData** | SAP system data |
| **Google Sheets** | Spreadsheet data |

Source: https://learn.microsoft.com/en-us/microsoft-copilot-studio/knowledge-real-time-connectors

## Web Search Mechanisms (3 Approaches)

| Mechanism | How It Works | Configuration |
|-----------|-------------|---------------|
| **Specific URLs** | Bing searches only specified domains | Add public website URLs as knowledge sources |
| **Open Web Search** | Bing searches ALL indexed public sites | Enable "Use information from the web" toggle |
| **Bing Custom Search** | Bing searches custom-configured domains | Configure at customsearch.ai, use in generative answers node |

Source: https://learn.microsoft.com/en-us/microsoft-copilot-studio/data-privacy-security-web-search

## File Upload Limits

| Constraint | Limit |
|-----------|-------|
| Max file size | 512 MB per file |
| Max total knowledge | 2 GB per agent |
| Max knowledge objects | 500 per agent |
| Supported formats | PDF, DOCX, PPTX, TXT, HTML, XLSX, CSV |
| Max files per upload | 10 files at once |

## Knowledge Source Selection

| Use Case | Best Source | Why |
|----------|-----------|-----|
| Company policies / SOPs | SharePoint site | Auto-updates when docs change |
| Specific reference docs | Uploaded files | Full control, no dependency |
| Product catalog / inventory | Dataverse table | Structured, queryable |
| FAQ / help articles | Public website | Always current with site |
| Enterprise search data | Graph connector | Broadest reach across M365 |
| M365 tenant-wide context | Tenant graph grounding | Semantic search across all M365 data |
| Live external system data | Real-time connectors (Preview) | No data movement, user-authenticated |

## How to Add Knowledge

### Via Dataverse API (preferred — no browser)
- POST `botcomponents` (type 16) + file upload
- See `knowledge/patterns/dataverse-patterns.md` § 4

### Via Playwright (fallback)
1. Navigate to Knowledge tab
2. Click "Add knowledge"
3. Select source type
4. Configure source (URL, file, table)
5. Save

## Generative Answers

Knowledge sources power the `SearchAndSummarizeContent` node:
- Agent searches configured knowledge when user asks a question
- AI generates a grounded answer with citations
- Moderation levels: Low, Medium, High

## Refresh Notes

- Check MCS UI "Add knowledge" dialog for new source types
- Graph connectors expanding — new data sources added regularly
- Search "Copilot Studio knowledge sources" on MS Learn for updates
- Tenant graph grounding requires M365 Copilot license — verify before recommending
