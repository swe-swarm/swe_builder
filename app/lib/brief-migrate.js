/**
 * Brief v1 → v2 migration.
 *
 * Port of _migrate_brief() from server.py.
 * Converts step1-4 schema to named-sections schema.
 */

function migrateBrief(brief) {
  if (!brief) return brief;
  if (brief._schema === "2.0" || "agent" in brief) return brief;

  // Deep-copy to avoid mutating the original
  brief = JSON.parse(JSON.stringify(brief));

  const s1 = brief.step1 || {};
  const s2 = brief.step2 || {};
  const s3 = brief.step3 || {};
  const s4 = brief.step4 || {};
  const oldMvp = brief.mvp || {};

  delete brief.step1;
  delete brief.step2;
  delete brief.step3;
  delete brief.step4;
  delete brief.mvp;

  // Section 1: business
  if (!brief.business) {
    brief.business = {
      useCase: "",
      problemStatement: s1.problem || "",
      challenges: [],
      benefits: [],
      successCriteria: [],
      stakeholders: { sponsor: "", owner: "", users: "" },
    };
  }

  // Section 2: agent
  brief.agent = {
    name: s1.agentName || "",
    description: "",
    persona: "",
    responseFormat: "",
    primaryUsers: (s1.users || {}).primary || "",
    secondaryUsers: (s1.users || {}).secondary || "",
  };

  // Section 3: capabilities
  const capsText = s2.capabilities || "";
  const caps = [];
  if (capsText) {
    for (let line of capsText.trim().split("\n")) {
      line = line.trim().replace(/^-\s*/, "").trim();
      if (line) {
        caps.push({ name: line, phase: "mvp", reason: "", dataSources: [] });
      }
    }
  }
  brief.capabilities = caps;

  // Section 4: integrations
  brief.integrations = (s3.systems || []).map((s) => ({
    name: s.name || "",
    type: s.toolType || "connector",
    purpose: s.purpose || "",
    dataProvided: "",
    authMethod: "",
    status: s.status || "available",
    phase: "mvp",
    notes: s.notes || "",
  }));

  // Section 5: knowledge
  brief.knowledge = (s3.knowledge || []).map((k) => ({
    name: k.name || "",
    type: k.type || "SharePoint",
    purpose: "",
    scope: k.scope || "",
    status: k.status || "available",
    phase: "mvp",
  }));

  // Section 6: conversations
  brief.conversations = {
    topics: (s3.topics || []).map((t) => ({
      name: t.name || "",
      schemaName: "",
      description: t.description || "",
      triggerType: t.triggerType || "agent-chooses",
      triggerPhrases: [],
      topicType: "custom",
      phase: "mvp",
      implements: [],
      variables: [],
      connectedIntegrations: [],
      outputFormat: "text",
      yaml: t.yaml || undefined,
    })),
  };

  // Section 7: boundaries
  const handle = s2.handle || "";
  let handleList;
  if (typeof handle === "string") {
    handleList = handle
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean);
  } else {
    handleList = handle || [];
  }

  const declineText = s2.decline || "";
  let declineList = [];
  if (declineText) {
    const items = typeof declineText === "string" ? declineText.split("\n") : [];
    declineList = items
      .filter((d) => d.trim())
      .map((d) => ({ topic: d.trim(), redirect: "" }));
  }

  const refuseText = s2.refuse || "";
  let refuseList = [];
  if (refuseText) {
    const items = typeof refuseText === "string" ? refuseText.split("\n") : [];
    refuseList = items
      .filter((r) => r.trim())
      .map((r) => ({ topic: r.trim(), reason: "" }));
  }

  brief.boundaries = {
    handle: handleList,
    decline: declineList,
    refuse: refuseList,
  };

  // Section 8: architecture
  brief.architecture = {
    type: s4.architectureRecommendation || "",
    reason: s4.architectureReason || "",
    score: s4.architectureScore || 0,
    model: s4.model || "",
    modelReason: s4.modelReason || "",
    triggers: (s4.triggers || []).map((t) => ({ type: t, description: "" })),
    channels: (s4.channels || []).map((c) => ({ name: c, reason: "" })),
    children: s4.children || [],
  };

  // Section 9: scenarios
  brief.scenarios = (s2.scenarios || []).map((sc, i) => ({
    name: `Scenario ${i + 1}`,
    category: "happy-path",
    userSays: sc.userSays || "",
    agentDoes: sc.agentShould || "",
    capabilities: [],
  }));

  // mvpSummary
  brief.mvpSummary = {
    now: oldMvp.now || [],
    future: oldMvp.later || [],
    blockers: [],
  };

  brief._schema = "2.0";
  return brief;
}

module.exports = { migrateBrief };
