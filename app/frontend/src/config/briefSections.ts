/**
 * Brief section definitions — moved from mockData.ts.
 * These define the sidebar navigation and section ordering.
 */
import type { BriefSection } from "@/types";

export const BRIEF_SECTIONS: BriefSection[] = [
  { id: "business-context", title: "Business Context", icon: "Briefcase", complete: false },
  { id: "agent-identity", title: "Agent Identity", icon: "Bot", complete: false },
  { id: "architecture", title: "Architecture", icon: "Network", complete: false },
  { id: "instructions", title: "Instructions", icon: "FileText", complete: false },
  { id: "capabilities", title: "Capabilities", icon: "Zap", complete: false },
  { id: "tools", title: "Tools", icon: "Plug", complete: false },
  { id: "knowledge-sources", title: "Knowledge", icon: "Database", complete: false },
  { id: "conversation-topics", title: "Topics", icon: "MessageSquare", complete: false },
  { id: "scope-boundaries", title: "Scope & Boundaries", icon: "Shield", complete: false },
  { id: "eval-sets", title: "Eval Sets", icon: "TestTube", complete: false },
  { id: "open-questions", title: "Open Questions", icon: "HelpCircle", complete: false },
];
