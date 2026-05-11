# Connector Schemas Cache

Pre-cached Swagger-derived operation schemas for Power Platform connectors.

## How to Populate

Run `schema --cache-all` against a live environment to fetch and cache all top-20 connectors:

```bash
node tools/flow-manager.js schema --cache-all --org https://orgXXX.crm.dynamics.com
```

Or cache a single connector:

```bash
node tools/flow-manager.js schema --connector shared_office365 --org https://orgXXX.crm.dynamics.com --cache
```

## File Format

Each JSON file contains extracted operation schemas for one connector:

```json
{
  "_meta": {
    "connectorId": "shared_office365",
    "displayName": "Office 365 Outlook",
    "source": "arm-api",
    "fetchedAt": "2026-03-09"
  },
  "operations": {
    "SendEmailV2": {
      "displayName": "Send an email (V2)",
      "method": "POST",
      "parameters": { ... },
      "response": { ... }
    }
  }
}
```

## Refresh

Connector schemas are very stable (Microsoft versions operations as V2, V3).
Re-run `--cache-all` every 3-6 months or when you encounter unknown operations.

## Top 20 Connectors

| Connector ID | Name |
|---|---|
| `shared_office365` | Office 365 Outlook |
| `shared_sharepointonline` | SharePoint |
| `shared_commondataserviceforapps` | Dataverse |
| `shared_teams` | Microsoft Teams |
| `shared_microsoftcopilotstudio` | Copilot Studio |
| `shared_planner` | Planner |
| `shared_todo` | Microsoft To-Do |
| `shared_onenote` | OneNote |
| `shared_excelonlinebusiness` | Excel Online |
| `shared_approvals` | Approvals |
| `shared_flowpush` | Notifications |
| `shared_office365users` | Office 365 Users |
| `shared_office365groups` | Office 365 Groups |
| `shared_dynamicscrmonline` | Dynamics 365 |
| `shared_azuread` | Azure AD |
| `shared_azureblob` | Azure Blob Storage |
| `shared_sendmail` | Mail |
| `shared_microsoftforms` | Microsoft Forms |
| `shared_onedriveforbusiness` | OneDrive for Business |
| `shared_flowmanagement` | Flow Management |
