import { useState } from "react";
import {
  Pencil, Check, X, Plus, Trash2, Bot, Network, Link, FolderTree,
} from "lucide-react";
import SectionGuidelines from "./SectionGuidelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { scaffoldChildren } from "@/lib/api";

interface ArchitectureContext {
  projectId?: string;
  agents?: Array<{ id: string; name: string }>;
}

interface Props {
  data: any;
  onChange?: (data: any) => void;
  context?: ArchitectureContext;
}

const emptyAgent = { name: "", role: "", routingRule: "", model: "", agentFolderId: "" };
const emptyTrigger = { type: "user-initiated", description: "" };
const emptyChannel = { name: "", reason: "" };

const TRIGGER_TYPES = ["User-initiated", "Scheduled", "Event-driven"];
const CHANNEL_OPTIONS = [
  "Microsoft Teams", "M365 Copilot", "Web chat", "Direct Line", "Slack", "Mobile app",
];
const MODEL_OPTIONS = [
  "gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano",
  "o1", "o1-mini", "o3-mini", "DeepSeek-R1",
];

const ARCH_TYPES = [
  { value: "single-agent", label: "Single Agent", icon: Bot, desc: "One agent handles everything" },
  { value: "multi-agent", label: "Multi-Agent", icon: Network, desc: "Orchestrator routes to specialists" },
  { value: "connected-agent", label: "Connected Agent", icon: Link, desc: "Agents linked across solutions" },
] as const;

const ArchitectureSection = ({ data, onChange, context }: Props) => {
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState<any>(null);
  const [editAgentIdx, setEditAgentIdx] = useState<number | null>(null);
  const [agentDraft, setAgentDraft] = useState<any>(null);
  const [editScoreIdx, setEditScoreIdx] = useState<number | null>(null);
  const [scoreDraft, setScoreDraft] = useState<any>(null);
  const [scaffolding, setScaffolding] = useState(false);

  const update = (partial: any) => onChange?.({ ...data, ...partial });

  const startMetaEdit = () => {
    setMetaDraft({
      pattern: data.pattern,
      patternReasoning: data.patternReasoning || "",
    });
    setEditingMeta(true);
  };

  const saveMeta = () => {
    update(metaDraft);
    setEditingMeta(false);
    setMetaDraft(null);
  };

  // --- Triggers ---
  const triggers = data.triggers || [];
  const [editTriggerIdx, setEditTriggerIdx] = useState<number | null>(null);
  const [triggerDraft, setTriggerDraft] = useState<any>(null);

  const addTrigger = () => {
    update({ triggers: [...triggers, { ...emptyTrigger }] });
    setEditTriggerIdx(triggers.length);
    setTriggerDraft({ ...emptyTrigger });
  };
  const saveTrigger = () => {
    if (editTriggerIdx === null) return;
    const items = [...triggers];
    items[editTriggerIdx] = triggerDraft;
    update({ triggers: items });
    setEditTriggerIdx(null);
    setTriggerDraft(null);
  };
  const removeTrigger = (i: number) => {
    update({ triggers: triggers.filter((_: any, idx: number) => idx !== i) });
    if (editTriggerIdx === i) { setEditTriggerIdx(null); setTriggerDraft(null); }
  };

  // --- Channels ---
  const channels = data.channels || [];
  const [editChannelIdx, setEditChannelIdx] = useState<number | null>(null);
  const [channelDraft, setChannelDraft] = useState<any>(null);

  const addChannel = () => {
    update({ channels: [...channels, { ...emptyChannel }] });
    setEditChannelIdx(channels.length);
    setChannelDraft({ ...emptyChannel });
  };
  const saveChannel = () => {
    if (editChannelIdx === null) return;
    const items = [...channels];
    items[editChannelIdx] = channelDraft;
    update({ channels: items });
    setEditChannelIdx(null);
    setChannelDraft(null);
  };
  const removeChannel = (i: number) => {
    update({ channels: channels.filter((_: any, idx: number) => idx !== i) });
    if (editChannelIdx === i) { setEditChannelIdx(null); setChannelDraft(null); }
  };

  // --- Child Agents ---
  const childAgents = data.childAgents || [];

  const addChildAgent = () => {
    update({ childAgents: [...childAgents, { ...emptyAgent }] });
    setEditAgentIdx(childAgents.length);
    setAgentDraft({ ...emptyAgent });
  };
  const saveChildAgent = () => {
    if (editAgentIdx === null || !agentDraft.name.trim()) return;
    const items = [...childAgents];
    items[editAgentIdx] = agentDraft;
    update({ childAgents: items });
    setEditAgentIdx(null);
    setAgentDraft(null);
  };
  const removeChildAgent = (i: number) => {
    update({ childAgents: childAgents.filter((_: any, idx: number) => idx !== i) });
    if (editAgentIdx === i) { setEditAgentIdx(null); setAgentDraft(null); }
  };

  // --- Scaffold ---
  const unlinkedCount = childAgents.filter((c: any) => !c.agentFolderId).length;

  const handleScaffold = async () => {
    if (!context?.projectId) return;
    // Find the parent agent id from the URL — we need the current agent's ID
    const pathParts = window.location.pathname.split("/");
    const agentIdx = pathParts.indexOf("agent");
    const agentId = agentIdx >= 0 ? pathParts[agentIdx + 1] : undefined;
    if (!agentId) return;

    setScaffolding(true);
    try {
      const result = await scaffoldChildren(context.projectId, agentId);
      if (result.created?.length) {
        // Reload the page to pick up new agents and updated brief
        window.location.reload();
      }
    } catch (e) {
      console.error("Scaffold failed:", e);
    } finally {
      setScaffolding(false);
    }
  };

  // --- Scoring ---
  const startScoreEdit = (i: number) => { setEditScoreIdx(i); setScoreDraft({ ...data.scoring[i] }); };
  const saveScore = () => {
    if (editScoreIdx === null) return;
    const scoring = [...data.scoring];
    scoring[editScoreIdx] = scoreDraft;
    update({ scoring });
    setEditScoreIdx(null);
  };

  const isMultiAgent = data.pattern === "multi-agent";
  const selectedType = ARCH_TYPES.find((t) => t.value === data.pattern);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Architecture</h2>
        <p className="text-xs text-muted-foreground">How the agent is structured — type, channels, triggers, and specialist agents</p>
        <SectionGuidelines sectionId="architecture" />
      </div>

      {/* Architecture Type — visual card selector */}
      {editingMeta && metaDraft ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {ARCH_TYPES.map((t) => {
              const Icon = t.icon;
              const selected = metaDraft.pattern === t.value;
              return (
                <button
                  key={t.value}
                  onClick={() => setMetaDraft({ ...metaDraft, pattern: t.value })}
                  className={`rounded-lg border-2 p-4 text-center transition-all ${
                    selected
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-primary/40"
                  }`}
                >
                  <Icon className={`h-6 w-6 mx-auto mb-2 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                  <p className={`text-sm font-medium ${selected ? "text-primary" : "text-foreground"}`}>{t.label}</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{t.desc}</p>
                </button>
              );
            })}
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Why this type?</label>
            <Textarea rows={2} placeholder="Reasoning for architecture choice" value={metaDraft.patternReasoning} onChange={(e) => setMetaDraft({ ...metaDraft, patternReasoning: e.target.value })} />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="sm" onClick={() => { setEditingMeta(false); setMetaDraft(null); }}><X className="h-3.5 w-3.5" /></Button>
            <Button size="sm" onClick={saveMeta}><Check className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      ) : (
        <div className="cursor-pointer" onClick={startMetaEdit}>
          {selectedType ? (
            <div className="rounded-lg border-2 border-primary/30 bg-primary/5 p-4 hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-3">
                <selectedType.icon className="h-6 w-6 text-primary" />
                <div>
                  <p className="text-base font-semibold text-primary">{selectedType.label}</p>
                  <p className="text-xs text-muted-foreground">{selectedType.desc}</p>
                </div>
              </div>
              {data.patternReasoning && <p className="text-xs text-muted-foreground mt-2 pl-9">{data.patternReasoning}</p>}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border bg-card p-4 hover:border-primary/40 transition-colors text-center">
              <p className="text-sm text-muted-foreground">Click to select architecture type</p>
            </div>
          )}
        </div>
      )}

      {/* Triggers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Triggers</h3>
          <Button variant="outline" size="sm" onClick={addTrigger} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
        <div className="space-y-2">
          {triggers.map((t: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              {editTriggerIdx === i && triggerDraft ? (
                <div className="space-y-3">
                  <Select value={triggerDraft.type} onValueChange={(v) => setTriggerDraft({ ...triggerDraft, type: v })}>
                    <SelectTrigger><SelectValue placeholder="Trigger type" /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_TYPES.map((tt) => (
                        <SelectItem key={tt} value={tt}>{tt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Description (e.g. which events, schedule details)" value={triggerDraft.description} onChange={(e) => setTriggerDraft({ ...triggerDraft, description: e.target.value })} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => { setEditTriggerIdx(null); setTriggerDraft(null); }}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" onClick={saveTrigger}><Check className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{typeof t === "string" ? t : t.type}</p>
                    {typeof t !== "string" && t.description && <p className="text-xs text-muted-foreground">{t.description}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditTriggerIdx(i); setTriggerDraft(typeof t === "string" ? { type: t, description: "" } : { ...t }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeTrigger(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Channels */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Channels</h3>
          <Button variant="outline" size="sm" onClick={addChannel} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
        </div>
        <div className="space-y-2">
          {channels.map((ch: any, i: number) => (
            <div key={i} className="rounded-lg border border-border bg-card p-4">
              {editChannelIdx === i && channelDraft ? (
                <div className="space-y-3">
                  <Select value={channelDraft.name} onValueChange={(v) => setChannelDraft({ ...channelDraft, name: v })}>
                    <SelectTrigger><SelectValue placeholder="Select channel" /></SelectTrigger>
                    <SelectContent>
                      {CHANNEL_OPTIONS.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Why this channel? (e.g. primary workspace for users)" value={channelDraft.reason} onChange={(e) => setChannelDraft({ ...channelDraft, reason: e.target.value })} />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="sm" onClick={() => { setEditChannelIdx(null); setChannelDraft(null); }}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="sm" onClick={saveChannel}><Check className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-foreground">{typeof ch === "string" ? ch : ch.name}</p>
                    {typeof ch !== "string" && ch.reason && <p className="text-xs text-muted-foreground">{ch.reason}</p>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditChannelIdx(i); setChannelDraft(typeof ch === "string" ? { name: ch, reason: "" } : { ...ch }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeChannel(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {channels.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">No channels defined. Add where this agent will be deployed.</p>
          )}
        </div>
      </div>

      {/* Child Agents (multi-agent only) */}
      {isMultiAgent && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Specialist Agents</h3>
            <div className="flex gap-2">
              {unlinkedCount > 0 && context?.projectId && (
                <Button variant="outline" size="sm" onClick={handleScaffold} disabled={scaffolding} className="gap-1.5">
                  <FolderTree className="h-3.5 w-3.5" />
                  {scaffolding ? "Scaffolding..." : `Scaffold Folders (${unlinkedCount})`}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={addChildAgent} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
            </div>
          </div>
          <div className="space-y-2">
            {childAgents.map((agent: any, i: number) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                {editAgentIdx === i && agentDraft ? (
                  <div className="space-y-3">
                    <Input placeholder="Agent name" value={agentDraft.name} onChange={(e) => setAgentDraft({ ...agentDraft, name: e.target.value })} />
                    <Input placeholder="Role / responsibility" value={agentDraft.role} onChange={(e) => setAgentDraft({ ...agentDraft, role: e.target.value })} />
                    <Textarea rows={2} placeholder="Routing rule — when should the orchestrator route to this agent?" value={agentDraft.routingRule} onChange={(e) => setAgentDraft({ ...agentDraft, routingRule: e.target.value })} />
                    <Select value={agentDraft.model || ""} onValueChange={(v) => setAgentDraft({ ...agentDraft, model: v })}>
                      <SelectTrigger><SelectValue placeholder="Model preference" /></SelectTrigger>
                      <SelectContent>
                        {MODEL_OPTIONS.map((m) => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex gap-2 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => { setEditAgentIdx(null); setAgentDraft(null); }}><X className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" onClick={saveChildAgent}><Check className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Bot className="h-4 w-4 text-primary shrink-0" />
                        <p className="text-sm font-medium text-foreground">{agent.name}</p>
                        {agent.agentFolderId ? (
                          <span className="text-[10px] font-medium bg-success/15 text-success border border-success/30 rounded px-1.5 py-0.5">linked</span>
                        ) : (
                          <span className="text-[10px] font-medium bg-muted text-muted-foreground border border-border rounded px-1.5 py-0.5">unlinked</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 pl-6">{agent.role}</p>
                      {agent.routingRule && (
                        <p className="text-[11px] text-muted-foreground mt-1 pl-6">
                          <span className="font-medium">Route:</span> {agent.routingRule}
                        </p>
                      )}
                      {agent.model && (
                        <p className="text-[11px] text-muted-foreground pl-6">
                          <span className="font-medium">Model:</span> {agent.model}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { setEditAgentIdx(i); setAgentDraft({ ...emptyAgent, ...agent }); }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => removeChildAgent(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Complexity Scoring */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Complexity Scoring</h3>
        <div className="space-y-3">
          {(data.scoring || []).map((s: any, i: number) => (
            <div key={i}>
              {editScoreIdx === i && scoreDraft ? (
                <div className="flex items-center gap-3">
                  <Input className="w-36 h-8 text-xs" value={scoreDraft.factor} onChange={(e) => setScoreDraft({ ...scoreDraft, factor: e.target.value })} />
                  <div className="flex-1">
                    <Slider value={[scoreDraft.score]} min={1} max={10} step={1} onValueChange={([v]) => setScoreDraft({ ...scoreDraft, score: v })} />
                  </div>
                  <span className="text-xs font-mono text-foreground w-6 text-right">{scoreDraft.score}</span>
                  <Input className="w-40 h-8 text-[11px]" value={scoreDraft.notes} onChange={(e) => setScoreDraft({ ...scoreDraft, notes: e.target.value })} />
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditScoreIdx(null)}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" className="h-7 w-7" onClick={saveScore}><Check className="h-3.5 w-3.5" /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-3 cursor-pointer hover:bg-surface-2 rounded-md px-1 -mx-1 py-0.5 transition-colors" onClick={() => startScoreEdit(i)}>
                  <span className="w-36 text-xs text-muted-foreground shrink-0">{s.factor}</span>
                  <div className="flex-1 h-2 rounded-full bg-surface-3 overflow-hidden">
                    <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${s.score * 10}%` }} />
                  </div>
                  <span className="text-xs font-mono text-foreground w-6 text-right">{s.score}</span>
                  <span className="text-[11px] text-muted-foreground w-40 truncate">{s.notes}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ArchitectureSection;
