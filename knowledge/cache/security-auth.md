<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI, PPAC docs, WebSearch Feb 2026]
confidence: high
refresh_trigger: before_architecture
-->
# MCS Security & Authentication — Quick Reference

## Three Auth Modes

| Mode | Channels | Variables Available | Access Control |
|------|----------|-------------------|----------------|
| No authentication | All | None | Anyone with link (cannot restrict) |
| Authenticate with Microsoft | Teams + M365 only | DisplayName, Email, FirstName, LastName, Id, IsLoggedIn, PrincipalName | Share with groups/org |
| Authenticate manually | All channels | All above + **AccessToken** | Share with groups/org (Entra ID); cannot restrict (Generic OAuth) |

**Manual auth providers**: Entra ID V2 with federated credentials (recommended), Entra ID V2 with certificates, Entra ID V2 with client secrets, Entra ID (v1), Generic OAuth 2

## SSO Channel Support

| Channel | SSO | Channel | SSO |
|---------|-----|---------|-----|
| Custom Website | Yes | Teams | Yes (1:1 only, NOT group/meeting) |
| SharePoint | Yes | Omnichannel | Yes |
| Demo Website | No | Facebook/Mobile | No |

## Required Scopes

- **Base**: `profile openid`
- **SharePoint knowledge**: `Sites.Read.All Files.Read.All`
- **Graph Connector**: `ExternalItem.Read.All`
- **Dataverse**: `https://[OrgURL]/user_impersonation`

## DLP Connector Names (PPAC)

| Connector | Controls |
|-----------|----------|
| Chat without Microsoft Entra ID authentication | Require auth |
| Knowledge source with SharePoint and OneDrive | Block SharePoint knowledge |
| Knowledge source with public websites and data | Block web knowledge |
| Knowledge source with documents | Block file knowledge |
| HTTP | Block HTTP (endpoint filtering supported) |
| Microsoft Teams + M365 Channel | Block Teams |
| Direct Line channels / Facebook / SharePoint / Omnichannel / WhatsApp | Block channels |
| Microsoft Copilot Studio | Block event triggers / evals |
| Application Insights | Block telemetry |

## Content Moderation (5 Levels)

| Level | Default For | Risk |
|-------|-------------|------|
| Lowest | — | Highest (may allow severe harm) |
| Low | — | High |
| Moderate | Prompt actions | Medium |
| **High** | **Agents (default)** | Low |
| Highest | — | Lowest (fewest answers) |

**Dual-pass**: checks user input AND agent output. Protections: jailbreak, prompt injection, XPIA, copyright.

## Threat Protection (Feb 2026)

| Feature | Status | Details |
|---------|--------|---------|
| **Strengthen security with additional threat protection** | **GA (Feb 2026)** | Enhanced threat detection and prevention for agent conversations, including advanced prompt injection detection and content safety filters |

## Web Channel Security

- Direct Line: 2 secrets (rotate without downtime), generate short-lived tokens
- Token: `POST directline.botframework.com/v3/directline/tokens/generate` with `Bearer <SECRET>`
- Propagation: up to **2 hours** after enabling, no publish needed

## PPAC Controls Summary

**Tenant**: Disable GenAI publishing, author security groups, tenant isolation, self-service trials
**Environment**: Security groups, DLP policies, IP firewall (GA, Managed Envs only), VNET, Global Secure Access, maker credentials, CMK, data movement
**Agent**: Auth mode, web security, moderation, agent connections, sharing

## Key Gotchas

- **"Require users to sign in"** creates read-only system topic; cannot be customized
- **Federated credentials** (recommended) — no secret expiration management
- **IP firewall does NOT enforce on**: Teams, M365 Copilot, Facebook, Omnichannel
- **Connected agent types**: MCS agents (GA), Foundry/Fabric/SDK/A2A (preview)
- **Conversation history** can be passed or blocked per connected agent
- **Audit**: Purview (maker logs), Sentinel (runtime monitoring), App Insights (KQL)
- **Never expose `User.AccessToken`** in Message nodes
- **Configure triggers with end-user credentials** (GA Feb 2026) — triggers can authenticate as end user
