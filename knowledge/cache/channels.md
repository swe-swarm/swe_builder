<!-- CACHE METADATA
last_verified: 2026-02-19
sources: [MS Learn, MCS UI snapshot, WebSearch Feb 2026]
confidence: high
refresh_trigger: weekly
-->
# MCS Deployment Channels

## Available Channels

| Channel | Status | Setup Complexity | Notes |
|---------|--------|-----------------|-------|
| Microsoft Teams + M365 Copilot | GA | Low | Default for M365 orgs; auto-publish |
| SharePoint | GA | Low | Embed in SharePoint pages |
| Demo Website | GA | None | Built-in test/demo page |
| Custom Website (iframe) | GA | Low | Embed via iframe code snippet |
| Custom canvas (Web SDK) | GA | Medium | Full UI customization with Bot Framework Web Chat |
| Mobile app | GA | Medium | Via Bot Framework SDK integration |
| **WhatsApp** | **GA** (Sep 2025) | Medium | Uses Azure Communication Services |
| Facebook Messenger | GA | Medium | Requires Facebook page + app |
| Direct Line | GA | Low | REST API for custom integrations and testing |
| Slack | GA (via Azure Bot Service) | Medium | Requires Slack app configuration |
| Telegram | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| Twilio (SMS) | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| Line | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| Kik | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| GroupMe | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| Direct Line Speech | GA (via Azure Bot Service) | High | Voice integration |
| Email | GA (via Azure Bot Service) | Medium | Azure Bot Service channel |
| Cortana | Deprecated (via Azure Bot Service) | — | Legacy channel |
| Telephony (voice) | GA | High | Azure Communication Services integration |

## WhatsApp Channel Details

| Feature | Support |
|---------|---------|
| Status | **GA (Sep 2025)** |
| Provider | Azure Communication Services |
| Adaptive Cards | **Very limited** — only `Action.Submit` (max 3), `Input.ChoiceSet`, `Action.OpenUrl` |
| Rich media | Images, documents supported |
| Auth | No SSO — manual auth if needed |

## Channel Selection

| Audience | Recommended Channel | Why |
|----------|-------------------|-----|
| Internal employees (M365) | Teams | Zero friction, SSO, already installed |
| External customers (web) | Custom website or canvas | Branded experience, no login required |
| External customers (mobile) | Mobile app or custom canvas | Responsive, native feel |
| External customers (WhatsApp) | WhatsApp | Familiar messaging platform, GA |
| Voice/phone support | Telephony | Azure Communication Services |
| Testing / automation | Direct Line | API-based, scriptable |

## Teams Deployment

- Publish the agent → auto-available in Teams app catalog
- Admin can pin the agent to Teams sidebar for all users
- SSO with Azure AD — no separate login

## Web Channel

- MCS provides iframe embed code in Settings → Channels → Custom website
- Direct Line token used for custom integrations and testing
- Web channel security settings control access

## Refresh Notes

- Check MCS Settings → Channels for new channel options
- Search "Copilot Studio channels" on MS Learn for updates
- WhatsApp is GA — adaptive card support is limited (only 3 card types)
- Azure Bot Service channels provide broad reach but may have feature limitations
