<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn Built-in MCP catalog, Agent 365 tooling overview, WebSearch, Dynamics 365 MCP docs]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Built-in MCP Servers

## What Are MCP Servers in MCS?

MCP (Model Context Protocol) servers provide rich, multi-tool access to services. **When a connector also has an MCP server, always prefer the MCP server** — it gives the agent broader capability with a single connection.

MCP went GA in Copilot Studio in May 2025. MCP resources support added in public preview Nov 2025.

## Custom MCP Servers

| Feature | Details |
|---------|---------|
| Status | **Public preview Mar 2026, GA Apr 2026** |
| Transport | **Streamable HTTP only** (SSE deprecated after Aug 2025) |
| Auth | API key or OAuth 2.0 |
| Capabilities | Tools + Resources (prompts NOT yet supported) |
| Requirement | **Generative Orchestration must be enabled** |
| Limitation | **Topics cannot call MCP servers directly** — only orchestrator can route to MCP tools |

## Official Built-in MCP Servers Catalog (Feb 2026)

Source: https://learn.microsoft.com/en-us/microsoft-copilot-studio/mcp-microsoft-mcp-servers (last updated Feb 4 2026)

**Note:** The catalog states "This list isn't exhaustive. New MCP connectors are added regularly."

### Category 1: Dataverse

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Dataverse MCP Server** | CRUD operations on Dataverse tables, list/describe tables, search, FetchXML queries. Natural language data access. | GA |

### Category 2: Dynamics 365

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Dynamics 365 Sales** | List leads, retrieve lead summaries, qualify leads, get/send outreach emails. Cross-functional with Service and ERP. | Preview |
| **Dynamics 365 Finance** | Finance and operations data and business logic via ERP MCP framework. | GA |
| **Dynamics 365 Supply Chain** | Supply chain management data and operations via ERP MCP framework. | GA |
| **Dynamics 365 Service (Customer Service)** | Case management, knowledge articles, omnichannel capabilities. Old D365 Service MCP is deprecated — use new version. | Preview |
| **Dynamics 365 ERP** | Dynamic framework for F&O apps — data operations + business logic. Adaptive tools, analytics-ready. Replaces older 13-static-tool version. | GA |
| **Dynamics 365 Contact Center** | Omnichannel and supervisor capabilities for service operations. | Preview |

*Note: Dynamics 365 Commerce MCP Server expected in preview Feb 2026 — catalog, pricing, promotions, inventory, carts, orders, fulfillment.*

### Category 3: Microsoft Fabric

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Fabric** | Connect to Fabric Data Agents for analytics and insights. Multi-agent orchestration — Copilot Studio delegates data queries to Fabric agent. | Preview |

### Category 4: Office 365 Outlook

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Office 365 Outlook — Contact Management** | Manage Outlook contacts. | GA |
| **Office 365 Outlook — Email Management** | Email composition, management, search, filter via KQL/OData. | GA |
| **Office 365 Outlook — Meeting Management** | Create, read, update, delete events. Free/busy slots, meeting invitations. | GA |

### Category 5: Kusto Query

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Kusto Query** | Run KQL queries against Azure Data Explorer clusters. Schema discovery, natural language to KQL (NL2KQL). Real-time data access. | Preview |

### Category 6: Learn Docs MCP

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Learn docs MCP** | Search Microsoft Learn documentation, fetch complete articles, search code samples. Free, no auth required. Streamable HTTP transport. Native in Copilot Studio since Aug 2025. | GA |

### Category 7: Box.com

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Box.com** | Cloud content management — file access, search, sharing via Box platform. Third-party certified MCP connector. | GA |

### Category 8: Gieni Actions

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Gieni Actions for fetching answers** | Third-party MCP connector for fetching answers/insights. ISV-certified connector. | GA |

### Category 9: Microsoft MCP Servers (Agent 365)

These are enterprise-grade MCP servers under the Agent 365 umbrella. Require Microsoft 365 Copilot license + Frontier program enrollment for full access.

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Microsoft Outlook Mail MCP** | Create, update, delete messages. Reply, reply-all. Semantic search with KQL-style queries and OData. | GA |
| **Microsoft 365 User Profile MCP** | Get user profiles, manager/direct report relationships, search users. | GA |
| **Microsoft Outlook Calendar MCP** | Create, list, update, delete events. Accept/decline. Resolve conflicts. Find free/busy slots. | GA |
| **Microsoft Teams MCP** | Create, update, delete chats. Add members. Post messages. Channel operations. | GA |
| **Microsoft SharePoint and OneDrive MCP** | Upload files, get metadata, search files/folders. File and folder management. | GA |
| **Microsoft SharePoint Lists MCP** | Create lists, columns, items. Query with filters and pagination. | GA |
| **Microsoft 365 Admin Center MCP** | Admin-focused capabilities for Microsoft 365 administration. | GA |
| **Microsoft Word MCP** | Create/read documents, add comments, reply to comments. | GA |
| **Microsoft 365 Copilot (Search) MCP** | Chat with M365 Copilot, multi-turn conversations, ground responses with files. Cross-tenant search. | GA |

### Also Available (Agent 365 Tooling Platform)

| MCP Server | Description | Status |
|------------|-------------|--------|
| **Microsoft MCP Management Server** | Create, update, delete, and publish custom MCP servers programmatically. API-first — no UI needed. Uses connectors, Graph APIs, REST, Dataverse custom APIs. | Preview |

## Microsoft MCP Connectors (Direct Integration)

These are the Microsoft-published MCP connectors available directly in Copilot Studio:

| Connector | Description |
|-----------|-------------|
| **Dataverse** | Full CRUD on Dataverse tables |
| **D365 Customer Service** | Case management and knowledge |
| **D365 Sales** | Lead and opportunity management |
| **Outlook/Mail** | Email operations |
| **GitHub (via Azure)** | Repository and issue management |

## News / Bing Search MCP Server

**As of Feb 2026, there is NO dedicated Bing News, MSN News, Bing Search, or news-focused MCP server in the Copilot Studio built-in catalog.**

Alternatives for news/web search capabilities:
- **Microsoft 365 Copilot (Search) MCP** can ground responses with web content (via M365 Copilot's Bing grounding)
- **Bing Search connector** (classic Power Platform connector, not MCP) provides web/news/image search
- **Custom MCP server** — build one wrapping Bing Search API or any news API
- **Knowledge sources** — add web URLs as knowledge in agent settings

## Timeline: MCP Servers Added Late 2025 / Early 2026

| Timeframe | What Was Added |
|-----------|---------------|
| **May 2025** | MCP GA in Copilot Studio. Initial servers: Outlook Mail, Calendar, SharePoint/OneDrive, Teams |
| **Jul-Aug 2025** | Learn docs MCP added natively (no custom connector needed). |
| **Sep 2025** | MCP onboarding wizard, connector certification pipeline |
| **Oct 2025** | Dynamics 365 Sales MCP (GA). Dynamics 365 ERP MCP (new dynamic version). |
| **Nov 2025 (Ignite)** | MCP resources support (preview). Dataverse MCP advances. Agent 365 servers expanded (Word, SharePoint Lists, Admin Center, User Profile, M365 Copilot Search). Dynamics 365 Service MCP (new, old deprecated). Fabric MCP. Box.com, Gieni, Kusto added to catalog. MCP Management Server preview. |
| **Dec 2025** | Dynamics 365 Contact Center MCP. Supply Chain / Finance MCP improvements. |
| **Jan 2026** | Agent 365 tooling servers overview published. Frontier program enrollment for full Agent 365 access. |
| **Feb 2026** | Dynamics 365 Commerce MCP expected in preview. Catalog at 25+ servers. |
| **Mar 2026** | Custom MCP servers public preview |
| **Apr 2026** | Custom MCP servers GA |

## How to Add an MCP Server

Requires Playwright (no API alternative):
1. Go to Tools section → "Add tool"
2. Select "Model Context Protocol" filter
3. Search for the MCP server name
4. Select → "Add to agent" or "Add and configure"
5. Create connection if prompted (handle auth popup)

## MCP vs Connector Decision

| Factor | Prefer MCP | Prefer Connector |
|--------|-----------|-----------------|
| Breadth of access | Need multiple operations | Need one specific action |
| Setup complexity | Single connection | May need per-action setup |
| Capability | Richer context for AI, dynamic tools | Specific, predictable action |
| Availability | Check MCS UI catalog (~25 servers) | Larger catalog (1,400+ connectors) |
| Custom servers | Build scenario-focused MCP servers via MCP Management Server | Use Power Platform custom connectors |

## Connector-Embedded MCP Servers (Feb 2026 Discovery)

Some Power Platform connectors now include MCP server actions as built-in operations. These are **distinct from the MCS catalog MCP servers** listed above. They appear as actions on the connector reference page with `mcp_` prefixed operation IDs.

| Connector | MCP Operation ID | Description |
|-----------|-----------------|-------------|
| **Salesforce** | `mcp_SalesforceManagement` | MCP server for Salesforce management via JSON-RPC. Uses same Salesforce connector auth. |

This is a new pattern where Microsoft embeds MCP server endpoints inside existing connectors. More connectors may have these -- check connector reference pages for `mcp_` operations.

Source: https://learn.microsoft.com/en-us/connectors/salesforce/ (Actions section)

## Key Facts

- MCP went GA in May 2025 in Copilot Studio
- MCP resources support added Nov 2025 (preview)
- SSE transport deprecated — only Streamable HTTP supported after Aug 2025
- **Custom MCP servers: public preview Mar 2026, GA Apr 2026**
- Custom MCP auth: API key or OAuth 2.0
- MCP supports tools + resources (prompts NOT yet supported)
- Generative Orchestration must be enabled to use MCP
- **Topics cannot call MCP servers directly** — only the orchestrator routes to MCP tools
- Agent 365 servers require M365 Copilot license + Frontier program for full access
- Custom MCP servers: use MCP onboarding wizard or create custom connector in Power Apps
- ISVs can certify and publish MCP servers to the catalog
- MCP Management Server enables programmatic creation of custom MCP servers
- Some connectors now embed MCP server actions (e.g., Salesforce `mcp_SalesforceManagement`) — these are accessed as connector actions, not via the MCP catalog

## Refresh Notes

- New MCP servers appear in MCS UI before documentation
- Check "Add tool" → "Model Context Protocol" section for current list
- The official catalog at learn.microsoft.com/microsoft-copilot-studio/mcp-microsoft-mcp-servers is the authoritative source
- Search community sources for MCP servers for non-M365 systems
- Agent 365 tooling servers overview: learn.microsoft.com/microsoft-agent-365/tooling-servers-overview
