<!-- CACHE METADATA
last_verified: 2026-02-13
sources: [MS Learn, Power Platform connector catalog, MS Learn Salesforce connector reference, WebSearch]
confidence: high
refresh_trigger: before_architecture
-->
# Power Platform Connectors for MCS

## Connector Types

| Type | License | Examples |
|------|---------|---------|
| Standard | Included with MCS | SharePoint, Outlook, Teams, OneDrive, Dataverse |
| Premium | Premium license required | HTTP, SQL Server, Azure services, Salesforce |
| Custom | Built by org | Custom API connectors (OpenAPI-based) |

## Commonly Used Connectors in MCS Agents

### M365 / Productivity
| Connector | Key Actions | MCP Alternative? |
|-----------|-------------|-----------------|
| SharePoint | Get items, Create item, Get file content | Yes — prefer SharePoint/OneDrive MCP |
| Outlook 365 | Send email, Get events, Search mail | Yes — prefer Outlook Calendar/Mail MCP |
| Microsoft Teams | Post message, Get channels, Create meeting | Yes — prefer Teams MCP |
| OneDrive for Business | Get file, Create file, List folder | Yes — prefer SharePoint/OneDrive MCP |
| Planner | Create task, List tasks, Update task | No MCP — use connector |
| Excel Online | Get rows, Add row, Update row | No MCP — use connector |

### Data & Integration
| Connector | Key Actions | Notes |
|-----------|-------------|-------|
| Dataverse | CRUD operations on tables | MCP available (preview) |
| SQL Server | Execute query, Get rows | Premium |
| HTTP | Send HTTP request (any REST API) | Premium; flexible fallback |
| Azure Blob Storage | Upload/download blobs | Premium |

### Third-Party
| Connector | Key Actions | Notes |
|-----------|-------------|-------|
| Salesforce | Get Account/Contact/Opportunity/Lead/Case/Product/User records, Execute SOQL query, Execute SOSL search, Create/Update/Delete/Upsert record, Send HTTP request, Bulk job operations, **MCP server action** (`mcp_SalesforceManagement`) | Premium. OAuth 2.0 (Salesforce login). API v58.0. Rate limit: 900 calls/60s/connection. Also a supported **Real-Time Knowledge** source (preview). |
| ServiceNow | Create/update incidents, queries | Premium; also a supported Real-Time Knowledge source (preview) |
| Jira | Create/update issues | Premium; on-prem needs data gateway |
| Confluence | Create/update pages | Premium; on-prem needs data gateway; also Real-Time Knowledge (preview, Cloud only) |
| Adobe PDF Services | Extract text, convert, merge | Premium |
| Encodian | Document generation, conversion | Premium |
| Zendesk | Ticket management, search | Premium; also Real-Time Knowledge (preview) |
| Snowflake | Query data | Premium; also Real-Time Knowledge (preview) |
| Oracle Database | Query/CRUD | Premium; also Real-Time Knowledge (preview) |
| SAP OData | Read/write SAP data | Premium; also Real-Time Knowledge (preview) |

### Connector-Embedded MCP Servers (Feb 2026 discovery)

Some Power Platform connectors now include MCP server actions as operations. These are NOT separate MCS catalog MCP servers -- they are accessed as connector actions.

| Connector | MCP Operation ID | Description |
|-----------|-----------------|-------------|
| Salesforce | `mcp_SalesforceManagement` | MCP server for Salesforce management. JSON-RPC interface. Accessed as a connector action, not through Add Tool > MCP. |

Note: More connectors may have embedded MCP server actions. Check the connector reference page for `mcp_` operation IDs.

### AI & Automation
| Connector | Key Actions | Notes |
|-----------|-------------|-------|
| AI Builder | Prompt actions, extraction | Premium |
| Power Automate | Trigger flows | Standard |
| Azure OpenAI | Custom completions | Premium |

## How to Add a Connector

Requires Playwright (no API alternative for tool attachment):
1. Go to Tools section → "Add tool"
2. Search for connector name
3. Select specific action(s)
4. Create connection (may require auth popup)
5. "Add and configure"

## Refresh Notes

- Full connector catalog: https://learn.microsoft.com/en-us/connectors/connector-reference/
- New connectors appear monthly — search "new Power Platform connectors" for updates
- Check if a connector now has an MCP server (prefer MCP when available)
- On-premises connectors require an on-premises data gateway
