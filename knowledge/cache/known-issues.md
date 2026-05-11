<!-- CACHE METADATA
last_verified: 2026-03-23
sources: [skills-for-copilot-studio repo, ObjectModel repo, Elevate repo, build experience, MS Learn, community reports, MS Learn M365 Copilot extensibility known-issues, 2025 Wave 2 change history, WebSearch Mar 2026]
confidence: high
refresh_trigger: before_build
-->
# MCS Known Issues & YAML Gotchas

Documented issues with mitigations. Categories: YAML syntax, publish failures, connector issues, channel quirks, Dataverse API.

---

## YAML Syntax Issues

### AdaptiveCardPrompt requires literal block scalar
**Issue:** Inline JSON in `card:` property causes parse errors.
**Mitigation:** Always use `card: |` (literal block scalar), never inline JSON.
```yaml
# WRONG
card: { "type": "AdaptiveCard", ... }

# CORRECT
card: |
  {
    "type": "AdaptiveCard",
    ...
  }
```

### AdaptiveCardPrompt requires output/outputType even for display-only cards
**Issue:** Omitting `output.binding` or `outputType.properties` causes silent failure — card renders but submit does nothing.
**Mitigation:** Always include `output.binding`, `outputType.properties`, and `Action.Submit` — even for info-only cards. Use a dummy "OK" button and minimal binding.

### aIModelId must come AFTER input/output in InvokeAIBuilderModelAction
**Issue:** Placing `aIModelId` before `input`/`output` causes validation failure.
**Mitigation:** Always place `aIModelId` as the last property.

### Input binding needs `=` prefix, output binding must NOT have `=`
**Issue:** Swapping these causes silent data loss — variables appear empty.
**Mitigation:** Data IN: `fieldName: =Topic.var` (with `=`). Data OUT: `fieldName: Topic.var` (no `=`).

### TextSegment uses `value` not `text` in ObjectModel JSON
**Issue:** Using `text` property in TextSegment causes validation failure.
**Mitigation:** Use `value` property: `{ "$kind": "TextSegment", "value": "Hello" }`.

### Question `variable` is a string, not an object
**Issue:** Wrapping `variable` in an object causes parse error.
**Mitigation:** `variable: init:Topic.userName` (plain string).

### Intent needs `$kind: "Intent"` wrapper in ObjectModel JSON
**Issue:** Omitting `$kind` wrapper causes intent to be ignored.
**Mitigation:** Always wrap: `{ "$kind": "Intent", "displayName": "...", ... }`.

---

## Publish Failures

### triggerQueries may block publish on generative orchestration agents
**Issue:** Adding `triggerQueries` to `OnRecognizedIntent` on a gen orchestration agent can cause publish failure.
**Mitigation:** Use "by agent" trigger (displayName only, no triggerQueries) for gen orchestration. Use `modelDescription` on the dialog for better routing.

### OnConversationStart does NOT fire on M365 Copilot channel
**Issue:** Topics using `OnConversationStart` trigger never fire when the agent is used via M365 Copilot or embedded surfaces.
**Mitigation:** Use `OnActivity` with `type: Message` and `=IsBlank()` guard for initialization patterns. See `knowledge/patterns/topic-patterns/conversation-init.yaml`.

### Agent description max length
**Issue:** `botcomponent.description` column has a max length; exceeding it silently truncates.
**Mitigation:** Keep agent descriptions under 1,024 characters. `cr3f1_stagedescription` has MaxLength = 100.

### Missing CreateSearchQuery degrades multi-turn search
**Issue:** Passing raw `System.Activity.Text` to `SearchAndSummarizeContent.userInput` loses conversational context. Follow-ups like "tell me more about that" search literally instead of resolving the reference.
**Mitigation:** Always use `CreateSearchQuery` before `SearchAndSummarizeContent` or `SearchKnowledgeSources`. Access the optimized query via `Topic.SearchQuery.SearchQuery`.

### OnOutgoingMessage trigger does not fire
**Issue:** `OnOutgoingMessage` exists in the schema but does NOT fire at runtime (as of 2026-03-15).
**Mitigation:** Do not use this trigger. Use `OnGeneratedResponse` to intercept AI responses before sending.

### Child agent completion setting does NOT prevent direct messaging
**Issue:** The "completion setting" on a child agent only determines what the parent does AFTER the child finishes. It does NOT prevent the child from sending messages directly to the user via `SendMessageTool`.
**Mitigation:** Add explicit instructions to child agent: "DO NOT call SendMessageTool. ONLY populate output variables."

### Topic output status messages kill orchestrator chaining
**Issue:** Topics that output status messages like "Your complaint has been submitted!" instead of data cause the orchestrator to assume the task is complete — downstream actions never fire.
**Mitigation:** If a topic prepares data for an action, output the DATA itself as a topic output variable. Only use SendActivity status messages for self-contained topics.

---

## Knowledge Architecture

### UniversalSearchTool 25 knowledge source limit
**Issue:** `UniversalSearchTool` supports up to 25 sources. If agent has >25, orchestrator selects best 25 based on source `# Name:` and description comments.
**Mitigation:** Keep sources ≤25. Write clear descriptions for every source. For precise control, use `triggerCondition: =false` on sources + `OnKnowledgeRequested` routing.

### SharePoint knowledge sources cannot return full file content
**Issue:** `SharePointSearchSource` uses semantic search returning text chunks, not complete files. Breaks JIT glossary, config loading, template processing.
**Mitigation:** Store files in Dataverse for full content retrieval. Or use Agent Flow with SharePoint connector's "Get file content" action.

### PublicSiteSearchSource max URL depth: 2 levels
**Issue:** URLs deeper than 2 path levels beyond the domain are silently ignored.
**Mitigation:** Keep URLs to 2 levels max: `https://docs.example.com/en-us/azure` (OK), `https://microsoft.com/en-us/microsoft-365/business` (too deep, ignored).

### triggerCondition supports full Power Fx but UI shows on/off only
**Issue:** `triggerCondition` in YAML accepts any Power Fx expression (e.g., `=Global.UserCounty = "Armstrong"`), but the Copilot Studio UI only shows it as an on/off toggle. Setting it via UI resets complex expressions.
**Mitigation:** Set `triggerCondition` in YAML only. Do not edit in UI if using Power Fx expressions.

### SharePoint files with null characters in file name return no results
**Issue:** If a SharePoint file used as a knowledge source contains null characters in the file name, the agent returns no results based on that knowledge source.
**Mitigation:** Rename the file to remove null characters. No workaround within MCS.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

### SharePoint knowledge fails silently without Copilot license
**Issue:** Declarative agents grounded in SharePoint knowledge sources provision successfully but fail at runtime with "Sorry, I wasn't able to respond." SharePoint and OneDrive knowledge sources require an active M365 Copilot license. CDX demo tenants without Copilot license can create/publish agents but grounded retrieval fails silently.
**Mitigation:** Ensure signed-in user has M365 Copilot license (or M365 Copilot Developer License for testing). Verify user has Read permissions on the SharePoint site. Use User authentication (service principals not supported for SP grounding).
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

---

## Declarative Agent Issues

### Power Automate Flows unreliable as DA actions
**Issue:** Power Automate Flows as actions in declarative agents might not run reliably and might not return results. Newly created flows may not appear in the Add Action interface even if the action counter reflects their presence.
**Mitigation:** Edit the description on the flow details page outside of Copilot Studio to improve trigger success. No workaround for flows not returning results.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

### Custom metadata prompts not supported
**Issue:** Prompts to get a list of items based on custom metadata are not supported (e.g., "Get ServiceNow tickets assigned to me" where "Assigned To" is custom metadata not mapped to connection schema label properties).
**Mitigation:** Get items based on matches with the title or description of the connector item instead.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

### URLs disappear in @mention responses in M365 Copilot
**Issue:** When invoking a declarative agent through @mention, URLs may be removed, hidden, or downgraded to plain text. The @mention pipeline applies stricter output sanitization.
**Mitigation:** Use Markdown link formatting or angle-bracket notation. Return URLs inside structured JSON fields in API plugin responses. Provide navigational text instead of bare URLs.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

### Sharing agents via M365 Copilot can fail with distribution groups
**Issue:** When sharing an agent via the "Specific users in your organization" option, search results may include distribution groups. Sharing with a distribution group causes the share to fail.
**Mitigation:** Share with individual users or security groups, not distribution groups.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

### API plugin OpenAPI limitations
**Issue:** Nested objects in request bodies/parameters, polymorphic references (oneOf/allOf/anyOf), circular references, API keys in custom headers/query/cookies, dual auth flows, and multiple response semantics are not supported for API plugins.
**Mitigation:** Use flattened schemas. Use single auth flow per endpoint.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

---

## Connector Issues

### M365 Users connector requires user authentication
**Issue:** The Office 365 Users connector returns 401 if user is not authenticated.
**Mitigation:** Ensure "Authenticate with Microsoft" is enabled in agent settings. The connector uses the signed-in user's identity.

### CRITICAL: `UserGet_V2` is NOT a valid operationId — use `MyProfile_V2`
**Issue:** `UserGet_V2` does not exist on the Office 365 Users connector. Using it in `InvokeConnectorAction` causes the connector action to spin infinitely at runtime. No publish error — the failure is silent.
**Mitigation:** Use `operationId: MyProfile_V2` for the signed-in user's profile. Use `operationId: UserProfile_V2` for looking up a specific user by UPN. Always verify operationIds against the connector's actual schema.
**Discovered:** 2026-03-20, CDW Legal & HR Policy Advisor build.

### Azure AD profile fields may be blank
**Issue:** Fields like `country`, `department`, `jobTitle` are optional in Azure AD and may be null.
**Mitigation:** Always use fallback: `=If(IsBlank(Topic.M365Profile.country), "Unknown", Topic.M365Profile.country)`.

---

## Channel Quirks

### Action.Execute not supported in Web Chat
**Issue:** Using `Action.Execute` in adaptive cards causes silent failure in Web Chat.
**Mitigation:** Always use `Action.Submit` instead.

### Teams adaptive card size limit ~28KB
**Issue:** Cards exceeding ~28KB return HTTP 413 error in Teams.
**Mitigation:** Keep card payloads under 28KB. For large data sets, paginate or link to external content.

### WhatsApp has very limited adaptive card support
**Issue:** Most adaptive card features don't render on WhatsApp.
**Mitigation:** Use plain text `SendActivity` for WhatsApp channels. Check channel before sending cards.

---

## Dataverse API Issues

### OData `$filter` with `_parentbotid_value` is unreliable
**Issue:** Filtering botcomponents by `_parentbotid_value` via OData returns incomplete results.
**Mitigation:** Use FetchXML with `parentbotid` for reliable filtering.

### `$select=data` on botcomponents returns empty
**Issue:** Selecting only the `data` column returns empty results.
**Mitigation:** Query the full entity (no `$select`) or select additional columns alongside `data`.

### Raw POST to `/botcomponents` creates records MCS doesn't see
**Issue:** Records created via direct Dataverse POST exist in the table but don't appear in MCS UI.
**Mitigation:** Use Island Gateway API `BotComponentInsert` for new topics. Use LSP push for updates to existing components.

### LSP push reports "0 changes" on new agents
**Issue:** First push to a new agent reports 0 changes even though content was sent.
**Mitigation:** `verifyAndPatchBody()` in `mcs-lsp.js` has a fallback that patches via Dataverse. Verify by querying Dataverse after push.

---

## PowerFx Issues

### No regex support in PowerFx
**Issue:** PowerFx has no native regex functions for string manipulation.
**Mitigation:** Use nested `Substitute()` for pattern removal (e.g., citation stripping). For validation, use adaptive card `regex` property on Input fields.

### System.* variables need assignment to Topic.* first
**Issue:** Some `System.*` variables can't be used directly in PowerFx expressions or card templates.
**Mitigation:** Assign to a `Topic.*` variable first, then reference the topic variable.

---

## Testing & Tooling Issues

### Direct Line tests silently timeout when agent requires auth
**Issue:** When an agent has "Authenticate with Microsoft" enabled, the first bot response is an OAuthCard attachment with no text. `direct-line-test.js` previously timed out with no explanation.
**Mitigation:** `direct-line-test.js` now detects OAuthCard and SigninCard attachments during polling. Returns `[SIGN_IN_REQUIRED]` with card type and connection name. Stops the test run early since all tests will fail for the same reason.

### CopilotStudio Client SDK requires Entra ID app registration
**Issue:** `copilotstudio-test.js` (SDK transport) needs an app registration with `CopilotStudio.Copilots.Invoke` delegated permission. Direct Line (`direct-line-test.js`) only needs a token endpoint URL.
**Mitigation:** Use Direct Line for quick testing. Use CopilotStudio SDK for production-grade testing that mirrors real user auth flows. SDK setup: create app reg, add API permission, configure .env with `COPILOT_STUDIO_*` variables.

---

## Removed/Deprioritized Features (Not Bugs — But Build-Relevant)

### "Test and debug agent actions" will NOT be delivered
**Issue:** This feature was on the 2025 Wave 2 release plan but was deprioritized and removed on Feb 12, 2026. There is no planned native UI for testing individual agent actions in isolation.
**Mitigation:** Use Copilot Studio Kit test automation, Direct Line testing, or the VS Code extension for action debugging.

### "SSO for non-Entra ID connections" will NOT be delivered
**Issue:** This feature was deprioritized and removed on Feb 27, 2026. SSO only works with Entra ID connections.
**Mitigation:** For non-Entra ID OAuth, use manual authentication flows. No SSO shortcut available.

---

## Custom Engine Agent Limitations (M365 Copilot)

### Multiple UX limitations for custom engine agents in M365 Copilot
**Issue:** Custom engine agents (built with M365 Agents Toolkit/SDK) running in M365 Copilot have significant limitations: no file attachments, no proactive notifications, no editable messages, limited rich card support (no Hero/Thumbnail/Connector/Animation/Audio/Receipt cards), Adaptive Cards with Action.Execute don't persist refreshed content, no sensitivity labels, and no support in Outlook/Word/Excel/PowerPoint/Edge.
**Mitigation:** Use standard Copilot Studio agents for full feature support. Custom engine agents are best for Teams-only scenarios with simple text interactions.
**Source:** MS Learn M365 Copilot extensibility known issues (Mar 2026).

---

## Refresh Notes

- New issues should be added with category headers
- Remove issues confirmed fixed in newer MCS releases
- Cross-reference with `knowledge/learnings/` for build-specific issues
- Check MS Learn release notes monthly for resolved issues
- Check M365 Copilot extensibility known issues page for DA/plugin issues
