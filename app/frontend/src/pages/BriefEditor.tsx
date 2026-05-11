import { useParams, useNavigate } from "react-router-dom";
import { useState, useEffect, useCallback } from "react";
import {
  Briefcase, Bot, FileText, Zap, Plug, Database,
  MessageSquare, Shield, Network, TestTube, HelpCircle,
  Check, Circle, Download, FileDown, Loader2,
} from "lucide-react";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import ReadinessRing from "@/components/ReadinessRing";
import { BRIEF_SECTIONS } from "@/config/briefSections";
import { useBriefStore } from "@/stores/briefStore";
import { useProjectStore } from "@/stores/projectStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BusinessContextSection from "@/components/brief/BusinessContextSection";
import AgentIdentitySection from "@/components/brief/AgentIdentitySection";
import InstructionsSection from "@/components/brief/InstructionsSection";
import CapabilitiesSection from "@/components/brief/CapabilitiesSection";
import IntegrationsSection from "@/components/brief/IntegrationsSection";
import KnowledgeSourcesSection from "@/components/brief/KnowledgeSourcesSection";
import ConversationTopicsSection from "@/components/brief/ConversationTopicsSection";
import ScopeBoundariesSection from "@/components/brief/ScopeBoundariesSection";
import ArchitectureSection from "@/components/brief/ArchitectureSection";
import EvalSetsSection from "@/components/brief/EvalSetsSection";
import OpenQuestionsSection from "@/components/brief/OpenQuestionsSection";
import { generateBriefReport, downloadFile } from "@/lib/reportGenerator";
import { generateBriefPDF } from "@/lib/pdfReportGenerator";

const iconMap: Record<string, React.ElementType> = {
  Briefcase, Bot, FileText, Zap, Plug, Database,
  MessageSquare, Shield, Network, TestTube, HelpCircle,
};

const sectionComponents: Record<string, React.ComponentType<{ data: any; onChange?: (data: any) => void; context?: any }>> = {
  "business-context": BusinessContextSection,
  "agent-identity": AgentIdentitySection,
  instructions: InstructionsSection,
  capabilities: CapabilitiesSection,
  tools: IntegrationsSection,
  "knowledge-sources": KnowledgeSourcesSection,
  "conversation-topics": ConversationTopicsSection,
  "scope-boundaries": ScopeBoundariesSection,
  architecture: ArchitectureSection,
  "eval-sets": EvalSetsSection,
  "open-questions": OpenQuestionsSection,
};

const BriefEditor = () => {
  const { projectId, agentId } = useParams();
  const navigate = useNavigate();
  const agents = useProjectStore((s) => s.agents);
  const projectName = useProjectStore((s) => s.projectName);
  const loadProject = useProjectStore((s) => s.loadProject);
  const {
    data, agentName, completion, loading, saving, dirty, error,
    load: loadBrief, updateSection, save, poll,
  } = useBriefStore();

  const [activeSection, setActiveSection] = useState(BRIEF_SECTIONS[0].id);

  // Load project + brief on mount
  useEffect(() => {
    if (projectId) loadProject(projectId);
  }, [projectId, loadProject]);

  useEffect(() => {
    if (projectId && agentId) loadBrief(projectId, agentId);
  }, [projectId, agentId, loadBrief]);

  // Poll for server changes every 5s (paused when tab is hidden)
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, 5000);
    return () => clearInterval(interval);
  }, [poll]);

  const handleSectionChange = (sectionId: string, newData: any) => {
    updateSection(sectionId, newData);
  };

  const completedCount = Object.values(completion).filter(Boolean).length;
  const readiness = BRIEF_SECTIONS.length > 0
    ? Math.round((completedCount / BRIEF_SECTIONS.length) * 100)
    : 0;

  const ActiveComponent = sectionComponents[activeSection];
  const sectionData = data?.[activeSection as keyof typeof data];

  // Build a fake Agent object for the report generators
  const agentForReport = {
    id: agentId ?? "",
    name: agentName,
    description: "",
    status: "draft" as const,
    readiness,
    sectionCompletion: completion,
  };

  if (loading) {
    return (
      <Layout breadcrumbs={[
        { label: projectName || projectId || "", href: `/project/${projectId}` },
        { label: "Loading..." },
      ]}>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading brief...
        </div>
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[
      { label: projectName || projectId || "", href: `/project/${projectId}` },
      { label: agentName || agentId || "" },
    ]}>
      <div className="flex h-[calc(100vh-3.5rem)]">
        {/* Sidebar */}
        <aside className="w-64 shrink-0 border-r border-border bg-surface-1 overflow-y-auto">
          <div className="p-4 border-b border-border">
            <Select value={agentId} onValueChange={(val) => navigate(`/project/${projectId}/agent/${val}`)}>
              <SelectTrigger className="h-8 text-xs mb-3">
                <Bot className="h-3.5 w-3.5 mr-1.5 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.id} value={a.id} className="text-xs">
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-3">
              <ReadinessRing value={readiness} size={44} />
              <div>
                <p className="text-xs font-semibold text-foreground">{completedCount}/{BRIEF_SECTIONS.length} complete</p>
                <p className="text-[11px] text-muted-foreground">
                  {saving ? "Saving..." : dirty ? "Unsaved changes" : "Brief readiness"}
                </p>
              </div>
            </div>
          </div>
          <nav className="p-2">
            {BRIEF_SECTIONS.map((section) => {
              const Icon = iconMap[section.icon];
              const isActive = activeSection === section.id;
              const isComplete = completion[section.id] ?? false;
              return (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-xs transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
                  }`}
                >
                  {isComplete ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                  ) : (
                    <Circle className="h-3.5 w-3.5 shrink-0" />
                  )}
                  <span className="flex-1 truncate">{section.title}</span>
                  {Icon && <Icon className="h-3.5 w-3.5 shrink-0 opacity-50" />}
                </button>
              );
            })}
          </nav>
          <div className="p-3 border-t border-border space-y-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => {
                if (!data) return;
                const md = generateBriefReport(agentForReport, data as unknown as Record<string, any>);
                const filename = `${agentName.replace(/\s+/g, "_")}_Brief.md`;
                downloadFile(md, filename);
              }}
            >
              <Download className="h-3.5 w-3.5" />
              Export Markdown
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2 text-xs"
              onClick={() => {
                if (!data) return;
                generateBriefPDF(agentForReport, data as unknown as Record<string, any>);
              }}
            >
              <FileDown className="h-3.5 w-3.5" />
              Export PDF
            </Button>
          </div>
        </aside>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="mx-auto max-w-3xl animate-fade-in">
            {error && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {ActiveComponent && sectionData && (
              <ActiveComponent
                data={sectionData}
                onChange={(d: any) => handleSectionChange(activeSection, d)}
                {...(activeSection === "architecture" ? {
                  context: {
                    projectId,
                    agents: agents.map((a) => ({ id: a.id, name: a.name })),
                  },
                } : {})}
              />
            )}
            {!data && !loading && (
              <div className="text-center py-20 text-muted-foreground text-sm">
                No brief data yet. Run <code>/mcs-research</code> to generate the brief.
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default BriefEditor;
