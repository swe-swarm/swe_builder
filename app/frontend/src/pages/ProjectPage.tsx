import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { Bot, Plus, Microscope, Hammer, FlaskConical, Wrench, Trash2, Loader2, Sparkles, Network } from "lucide-react";
import Layout from "@/components/Layout";
import StatusBadge from "@/components/StatusBadge";
import ReadinessRing from "@/components/ReadinessRing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TerminalSession } from "@/types";
import { useProjectStore } from "@/stores/projectStore";
import { useTerminalStore } from "@/stores/terminalStore";
import { getTerminalWsUrl } from "@/lib/api";
import DocumentDropZone from "@/components/DocumentDropZone";

const ProjectPage = () => {
  const { id } = useParams<{ id: string }>();
  const {
    projectName, agents, loading, error, loadProject, removeAgent,
  } = useProjectStore();
  const { addSession: addTerminalSession } = useTerminalStore();
  const [showAgentForm, setShowAgentForm] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");

  useEffect(() => {
    if (id) loadProject(id);
  }, [id, loadProject]);

  // Poll for changes every 10s (paused when tab is hidden)
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        useProjectStore.getState().refresh();
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [id]);

  const skillCommands: Record<string, (projectId: string, agentId: string) => string> = {
    research: (pid, aid) => `/mcs-research ${pid} ${aid}`,
    build: (pid, aid) => `/mcs-build ${pid} ${aid}`,
    evaluate: (pid, aid) => `/mcs-eval ${pid} ${aid}`,
    fix: (pid, aid) => `/mcs-fix ${pid} ${aid}`,
  };

  /** Launch a command in a per-agent terminal tab. */
  const launchTerminal = async (type: "research" | "build" | "evaluate" | "fix", agent: { id: string; name: string }) => {
    if (!id) return;
    const store = useTerminalStore.getState();
    const command = skillCommands[type](id, agent.id);

    const existingId = store.findSession(id, agent.id);
    if (existingId) {
      store.setActiveSession(existingId);
      store.setPanelOpen(true);
      store.sendCommand(existingId, command);
      return;
    }

    const wsUrl = await getTerminalWsUrl();
    const session: TerminalSession = {
      id: `${id}-${agent.id}-${Date.now()}`,
      label: agent.name,
      type,
      projectId: id,
      agentName: agent.name,
      status: "connecting",
      wsUrl,
      command,
    };
    addTerminalSession(session);
  };

  /** Launch project-level research (analyzes docs, discovers agents). */
  const launchProjectResearch = async () => {
    if (!id) return;
    const store = useTerminalStore.getState();
    const command = `/mcs-research ${id}`;
    const sessionKey = `${id}-research`;

    // Reuse existing project research session
    const existing = store.sessions.find((s) => s.id.startsWith(sessionKey));
    if (existing) {
      store.setActiveSession(existing.id);
      store.setPanelOpen(true);
      store.sendCommand(existing.id, command);
      return;
    }

    const wsUrl = await getTerminalWsUrl();
    const session: TerminalSession = {
      id: `${sessionKey}-${Date.now()}`,
      label: `${projectName || id} — research`,
      type: "research",
      projectId: id,
      agentName: projectName || id,
      status: "connecting",
      wsUrl,
      command,
    };
    addTerminalSession(session);
  };

  if (loading && agents.length === 0) {
    return (
      <Layout breadcrumbs={[{ label: "Loading..." }]}>
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading project...
        </div>
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[{ label: projectName || id || "" }]}>
      <div className="px-6 py-8">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
        <div className="mb-8 flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">{projectName}</h1>
          <Button size="sm" className="gap-1.5" onClick={launchProjectResearch}>
            <Sparkles className="h-3.5 w-3.5" /> Research
          </Button>
        </div>

        <div className="space-y-8">
          {/* Agents */}
          <div>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Agents ({agents.length})</h2>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs text-muted-foreground" onClick={() => setShowAgentForm(true)}>
                <Plus className="h-3 w-3" /> Add Agent
              </Button>
            </div>

            {showAgentForm && (
              <div className="mb-3 rounded-lg border border-border bg-card p-4 space-y-3">
                <Input placeholder="Agent name" value={agentName} onChange={(e) => setAgentName(e.target.value)} />
                <Input placeholder="Description" value={agentDesc} onChange={(e) => setAgentDesc(e.target.value)} />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={() => { setShowAgentForm(false); setAgentName(""); setAgentDesc(""); }}>Cancel</Button>
                  <Button size="sm" onClick={() => { setShowAgentForm(false); setAgentName(""); setAgentDesc(""); }}>Add</Button>
                </div>
              </div>
            )}

            {agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-xs">
                No agents yet. Upload documents and click Research above.
              </div>
            ) : (
              <div className="space-y-2">
                {(() => {
                  // Build hierarchy: orchestrators → children → standalone
                  const childSet = new Set<string>();
                  const orchestrators = agents.filter((a) =>
                    a.architectureType?.includes("multi") && a.childAgentIds && a.childAgentIds.length > 0
                  );
                  orchestrators.forEach((o) => o.childAgentIds?.forEach((cid) => childSet.add(cid)));

                  const renderAgentCard = (agent: typeof agents[0], indent: boolean, badge?: string) => {
                    const isOrch = badge === "Orchestrator";
                    const AgentIcon = isOrch ? Network : Bot;
                    return (
                      <div
                        key={agent.id}
                        className={`group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:bg-surface-2 ${
                          indent ? "ml-8 border-l-2 border-l-primary/20" : ""
                        } ${badge === "Specialist" ? "bg-surface-1" : ""}`}
                      >
                        <div className="flex items-center gap-4">
                          <Link
                            to={`/project/${id}/agent/${agent.id}`}
                            className="flex items-center gap-4 flex-1 min-w-0"
                          >
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isOrch ? "bg-primary/10" : "bg-surface-3"}`}>
                              <AgentIcon className={`h-5 w-5 ${isOrch ? "text-primary" : "text-primary"}`} />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
                                  {agent.name}
                                </h3>
                                <StatusBadge status={agent.status} />
                                {badge && (
                                  <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${
                                    badge === "Orchestrator"
                                      ? "bg-primary/15 text-primary border border-primary/30"
                                      : "bg-muted text-muted-foreground border border-border"
                                  }`}>
                                    {badge}
                                  </span>
                                )}
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground truncate">{agent.description}</p>
                            </div>
                          </Link>
                          <ReadinessRing value={agent.readiness} size={36} />
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-destructive shrink-0"
                            onClick={(e) => { e.preventDefault(); removeAgent(agent.id); }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        <div className={`mt-3 flex items-center gap-2 ${indent ? "pl-14" : "pl-14"}`}>
                          {(() => {
                            const researched = agent.status === "researched" || agent.status === "built" || agent.status === "ready";
                            const built = agent.status === "built" || agent.status === "ready";
                            const evaluated = agent.status === "ready";
                            const hasFailures = agent.evalPassRate !== null && agent.evalPassRate < 70;
                            return (
                              <>
                                <Button variant="outline" size="sm" className={`h-6 gap-1 text-[11px] ${researched ? "bg-info/15 border-info/40 text-info" : "border-border text-muted-foreground opacity-60"}`} onClick={() => launchTerminal("research", agent)}>
                                  <Microscope className="h-3 w-3" /> Research
                                </Button>
                                <Button variant="outline" size="sm" className={`h-6 gap-1 text-[11px] ${built ? "bg-warning/15 border-warning/40 text-warning" : "border-border text-muted-foreground opacity-60"}`} onClick={() => launchTerminal("build", agent)}>
                                  <Hammer className="h-3 w-3" /> Build
                                </Button>
                                <Button variant="outline" size="sm" className={`h-6 gap-1 text-[11px] ${evaluated ? "bg-success/15 border-success/40 text-success" : "border-border text-muted-foreground opacity-60"}`} onClick={() => launchTerminal("evaluate", agent)}>
                                  <FlaskConical className="h-3 w-3" /> Evaluate
                                </Button>
                                {agent.evalPassRate !== null && (
                                  <span className={`text-[10px] font-medium ${agent.evalPassRate >= 70 ? "text-success" : "text-destructive"}`}>
                                    {agent.evalPassRate}%
                                  </span>
                                )}
                                {hasFailures && (
                                  <Button variant="outline" size="sm" className="h-6 gap-1 text-[11px] bg-destructive/15 border-destructive/40 text-destructive animate-in fade-in" onClick={() => launchTerminal("fix", agent)}>
                                    <Wrench className="h-3 w-3" /> Fix Failures
                                  </Button>
                                )}
                              </>
                            );
                          })()}
                        </div>
                      </div>
                    );
                  };

                  // Render orchestrators with children grouped under them
                  const rendered: React.ReactNode[] = [];
                  for (const orch of orchestrators) {
                    rendered.push(renderAgentCard(orch, false, "Orchestrator"));
                    const childIds = orch.childAgentIds ?? [];
                    for (const cid of childIds) {
                      const child = agents.find((a) => a.id === cid);
                      if (child) {
                        rendered.push(renderAgentCard(child, true, "Specialist"));
                      }
                    }
                  }
                  // Standalone agents (not orchestrators, not children)
                  for (const agent of agents) {
                    if (orchestrators.includes(agent)) continue;
                    if (childSet.has(agent.id)) continue;
                    rendered.push(renderAgentCard(agent, false));
                  }
                  return rendered;
                })()}
              </div>
            )}
          </div>

          {/* Documents */}
          {id && <DocumentDropZone projectId={id} />}
        </div>
      </div>
    </Layout>
  );
};

export default ProjectPage;
