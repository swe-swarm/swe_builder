/**
 * Guidelines content for each brief section.
 * Displayed in a collapsible panel to educate customers on best practices.
 */

export interface SectionGuidelineData {
  what: string;
  bestPractices: string[];
  commonMistakes: string[];
  tip?: string;
}

export const sectionGuidelines: Record<string, SectionGuidelineData> = {
  "business-context": {
    what: "Why this agent exists — the business problem, who's affected, and how success is measured.",
    bestPractices: [
      "Quantify the problem (volume, cost, time wasted)",
      "Define measurable success criteria with specific targets",
      "Identify all stakeholder roles and their relationship to the problem",
      "Describe the current process and its pain points",
    ],
    commonMistakes: [
      "Vague problem statements like \"improve efficiency\"",
      "Missing success metrics — without them, we can't measure impact",
      "Forgetting secondary users (managers, admins, approvers)",
    ],
  },
  "agent-identity": {
    what: "The agent's name, personality, and who it serves.",
    bestPractices: [
      "Name should be clear and professional — users see this first",
      "Description should be 1-2 sentences a user would see in a directory",
      "Persona affects tone — be specific (\"concise, uses bullet points\" not just \"helpful\")",
      "List all distinct user groups who will interact with the agent",
    ],
    commonMistakes: [
      "Generic names like \"AI Assistant\" — make it domain-specific",
      "No persona guidance — the agent defaults to generic tone",
      "Missing target audience — the agent can't tailor responses",
    ],
  },
  architecture: {
    what: "How the agent is structured — single agent or multi-agent with specialists.",
    bestPractices: [
      "Start with single-agent unless 3+ complexity factors apply",
      "Multi-agent adds latency — only split when domains truly need isolation",
      "Choose channels based on where users already work (Teams, web, M365 Copilot)",
      "Select triggers that match how users phrase requests",
    ],
    commonMistakes: [
      "Over-engineering into multi-agent when a single agent suffices",
      "Missing channel selection — defaults may not fit the audience",
      "Ignoring channel limitations (e.g., M365 Copilot strips URLs from responses)",
    ],
  },
  instructions: {
    what: "The system prompt that controls agent behavior — how it responds, what it handles, and what it refuses.",
    bestPractices: [
      "Use three-part structure: Constraints + Response Format + Guidance",
      "Describe knowledge sources generically — never hardcode URLs",
      "Include follow-up question guidance to keep conversations productive",
      "State the target audience so tone and complexity adjust automatically",
    ],
    commonMistakes: [
      "Hardcoding URLs — they get stripped in M365 Copilot channel",
      "Listing all tools explicitly — the orchestrator already knows its tools",
      "Relying on instructions alone for hard boundaries — use dedicated topics instead",
    ],
    tip: "Instructions are lowest priority for routing. If the agent routes to the wrong topic, fix the topic description first — not the instructions.",
  },
  capabilities: {
    what: "What the agent can do — each feature it supports.",
    bestPractices: [
      "Each capability should map to either a knowledge source or a custom topic",
      "Tag MVP vs Future clearly — this controls what gets built now",
      "Include the data source or system needed for each capability",
      "Write capability names as user-facing actions (\"Check order status\" not \"Order lookup\")",
    ],
    commonMistakes: [
      "Capabilities with no knowledge source or topic to back them",
      "Unclear MVP/Future boundaries — delays the build",
      "Overlapping capabilities that confuse routing",
    ],
  },
  tools: {
    what: "External systems the agent connects to — connectors, MCP servers, APIs, and Power Automate flows.",
    bestPractices: [
      "Prefer MCP servers over individual connector actions when available",
      "Note the auth method for each tool (OAuth, API key, service account)",
      "Verify connector availability in your environment before committing",
      "Describe what each tool does in one line — the orchestrator uses this to decide when to call it",
    ],
    commonMistakes: [
      "Assuming a connector exists without checking the environment",
      "Missing auth setup requirements — blocks the build at configuration time",
      "Adding tools the agent doesn't actually need — increases latency and confusion",
    ],
  },
  "knowledge-sources": {
    what: "Data the agent searches to answer questions — SharePoint sites, uploaded files, websites, and Dataverse tables.",
    bestPractices: [
      "Provide specific SharePoint URLs or site paths — not just \"SharePoint\"",
      "Describe what each source contains and its scope (e.g., \"HR policies for US employees\")",
      "Set status honestly: available, needs-setup, or blocked",
      "Limit to sources the agent actually needs — quality over quantity",
    ],
    commonMistakes: [
      "Vague scope like \"all company docs\" — too broad for good retrieval",
      "Missing URLs — blocks the build since we can't configure without them",
      "Too many sources without descriptions — orchestrator can't choose the right one",
    ],
    tip: "With 25+ knowledge sources, the orchestrator uses descriptions to filter. Make them specific enough to distinguish between sources.",
  },
  "conversation-topics": {
    what: "Structured conversation flows — when the agent needs to follow specific steps rather than free-form answers.",
    bestPractices: [
      "Use custom topics for multi-step workflows and structured data collection",
      "Use generative orchestration (not custom topics) for simple Q&A",
      "Write strong topic descriptions — they're the #1 signal for routing",
      "Define trigger phrases that match how real users phrase requests",
    ],
    commonMistakes: [
      "Making everything a custom topic — overkill for simple Q&A",
      "Vague topic descriptions — the orchestrator can't route correctly",
      "Missing fallback topic customization — users hit dead ends",
    ],
  },
  "scope-boundaries": {
    what: "What the agent handles, politely declines, and hard refuses.",
    bestPractices: [
      "Be specific about decline redirects (\"Contact your HR Business Partner\" not \"Contact support\")",
      "Hard refuses need dedicated topics with fixed responses — instructions alone aren't reliable",
      "Every decline should include a helpful redirect or alternative",
      "Group related items to avoid overlap between handle/decline categories",
    ],
    commonMistakes: [
      "Overlapping handle/decline categories — confuses routing",
      "Missing redirect targets in declines — users get stuck",
      "No \"out\" for truly unknown queries — always have a graceful fallback",
    ],
  },
  "eval-sets": {
    what: "Organized test suites that verify everything about the agent — safety, capabilities, integrations, conversations, and regression.",
    bestPractices: [
      "Critical set (100% pass required): every boundary decline/refuse needs a test here",
      "Functional set: at least one happy-path test per MVP capability",
      "Integration set: verify connectors return real data, tools are actually invoked",
      "Link tests to capabilities — this powers per-capability pass rate tracking",
      "Aim for 15-25 total tests across all sets",
    ],
    commonMistakes: [
      "Empty critical set — safety and boundaries go untested",
      "All tests in one set — loses the tiered pass/fail structure",
      "No capability links — can't track which features are passing or failing",
      "Unrealistic expected responses — tests should match what the agent actually says",
    ],
    tip: "The 5 default sets (Critical, Functional, Integration, Conversational, Regression) cover most agents. Add custom sets for domain-specific requirements like compliance or accessibility.",
  },
  "open-questions": {
    what: "Unresolved items that need stakeholder input before the build can proceed.",
    bestPractices: [
      "Mark build blockers clearly — they determine what can be built now",
      "Provide a suggested default for each question to speed up decisions",
      "Answer questions promptly — unanswered questions delay the entire build",
      "Include impact context: what happens if this isn't resolved",
    ],
    commonMistakes: [
      "Leaving questions open without assessing their impact on the build",
      "Missing suggested defaults — stakeholders don't know what's reasonable",
      "Not distinguishing blockers from nice-to-haves — everything looks urgent",
    ],
  },
};
