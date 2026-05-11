import { useState } from "react";
import {
  Zap, ShieldAlert, Users, MessageCircle,
  Database, HelpCircle, Check, X, Pencil, ArrowRight,
  Plus, Trash2, Plug, TestTube, ListChecks,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { editKeyHandler } from "@/lib/editKeys";
import PreviewSectionCard from "./PreviewSectionCard";
import type { OverviewViewModel, ViewItem, BoundaryItem } from "@/hooks/useOverviewViewModel";
import type { BriefData, ItemSource, OpenQuestion, WorkflowPhase } from "@/types";

// --- Response Style Presets ---

const TONE_OPTIONS = [
  { id: "professional", label: "Professional & formal", desc: "Business language, no slang" },
  { id: "friendly", label: "Friendly & approachable", desc: "Warm, conversational, uses contractions" },
  { id: "technical", label: "Technical & precise", desc: "Domain-specific terminology, detailed" },
  { id: "empathetic", label: "Empathetic & supportive", desc: "Acknowledges feelings, patient" },
  { id: "concise", label: "Brief & to the point", desc: "Short answers, no filler" },
];

const FORMAT_OPTIONS = [
  { id: "bullets", label: "Bullet points", desc: "Organized lists for clarity" },
  { id: "short", label: "Short paragraphs", desc: "2-3 sentence responses" },
  { id: "steps", label: "Step-by-step", desc: "Numbered instructions for procedures" },
  { id: "cite", label: "Cites sources", desc: "References documents or data" },
  { id: "confirm", label: "Confirms before acting", desc: "Asks for confirmation before changes" },
  { id: "followup", label: "Asks follow-up questions", desc: "Clarifies before answering" },
];

interface Props {
  viewModel: OverviewViewModel;
  data: BriefData;
  phase: WorkflowPhase;
  onChange: (data: any) => void;
  onUpdateSection?: (sectionId: string, data: any) => void;
  onNavigateToSection?: (sectionId: string) => void;
}

const OverviewSummary = ({ viewModel, data, phase, onChange, onUpdateSection, onNavigateToSection }: Props) => {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");

  const ov = data.overview;
  const researchDone = !!data.workflow?.researchCompletedAt;

  const startEdit = (field: string, value: string) => {
    setFieldDraft(value);
    setEditingField(field);
  };

  const saveField = (field: string) => {
    onChange({ ...ov, [field]: fieldDraft });
    setEditingField(null);
  };

  // --- Capability handlers ---
  const capabilityHandlers = {
    onEdit: (displayIdx: number, text: string) => {
      const item = viewModel.capabilities[displayIdx];
      if (!item || !onUpdateSection) return;
      const items = [...(data.capabilities?.items ?? [])];
      if (items[item.editPath.index]) {
        items[item.editPath.index] = { ...items[item.editPath.index], name: text };
        onUpdateSection("capabilities", { items });
      }
    },
    onAdd: (text: string) => {
      if (!onUpdateSection) return;
      const items = [...(data.capabilities?.items ?? []), {
        name: text, description: "", phase: "MVP",
        implementationType: "prompt", source: "user-added" as ItemSource,
      }];
      onUpdateSection("capabilities", { items });
    },
    onRemove: (displayIdx: number) => {
      const item = viewModel.capabilities[displayIdx];
      if (!item || !onUpdateSection) return;
      const items = (data.capabilities?.items ?? []).filter((_, i) => i !== item.editPath.index);
      onUpdateSection("capabilities", { items });
    },
  };

  // --- Audience handlers ---
  const audienceHandlers = {
    onAdd: (text: string) => {
      onChange({ ...ov, targetUsers: [...(ov.targetUsers ?? []), text] });
    },
    onEdit: (idx: number, text: string) => {
      const users = [...(ov.targetUsers ?? [])];
      users[idx] = text;
      onChange({ ...ov, targetUsers: users });
    },
    onRemove: (idx: number) => {
      onChange({ ...ov, targetUsers: (ov.targetUsers ?? []).filter((_, i) => i !== idx) });
    },
  };

  // Filter boundaries to only refuses + declines for the "not do" list
  const notDoBoundaries = viewModel.boundaries
    .filter((b) => b.boundaryType === "refuse" || b.boundaryType === "decline");

  const notDoItems: ViewItem[] = notDoBoundaries.map((b) => ({
    text: b.boundaryType === "decline" ? `${b.text}${b.redirect ? ` → ${b.redirect}` : ""}` : b.text,
    source: b.source,
    editPath: b.editPath,
  }));

  // --- Boundary handlers ---
  const notDoHandlers = {
    onEdit: (displayIdx: number, text: string) => {
      const item = notDoBoundaries[displayIdx];
      if (!item || !onUpdateSection) return;
      const bounds = data["scope-boundaries"];
      if (item.boundaryType === "refuse") {
        const refuses = [...(bounds?.hardRefuses ?? [])];
        if (refuses[item.editPath.index]) {
          refuses[item.editPath.index] = { ...refuses[item.editPath.index], topic: text };
          onUpdateSection("scope-boundaries", { ...bounds, hardRefuses: refuses });
        }
      } else if (item.boundaryType === "decline") {
        const declines = [...(bounds?.politelyDeclines ?? [])];
        if (declines[item.editPath.index]) {
          declines[item.editPath.index] = { ...declines[item.editPath.index], topic: text };
          onUpdateSection("scope-boundaries", { ...bounds, politelyDeclines: declines });
        }
      }
    },
    onAdd: (text: string) => {
      if (!onUpdateSection) return;
      const bounds = data["scope-boundaries"];
      const refuses = [...(bounds?.hardRefuses ?? []), { topic: text, reason: "", source: "user-added" as ItemSource }];
      onUpdateSection("scope-boundaries", { ...bounds, hardRefuses: refuses });
    },
    onRemove: (displayIdx: number) => {
      const item = notDoBoundaries[displayIdx];
      if (!item || !onUpdateSection) return;
      const bounds = data["scope-boundaries"];
      if (item.boundaryType === "refuse") {
        const refuses = (bounds?.hardRefuses ?? []).filter((_, i) => i !== item.editPath.index);
        onUpdateSection("scope-boundaries", { ...bounds, hardRefuses: refuses });
      } else if (item.boundaryType === "decline") {
        const declines = (bounds?.politelyDeclines ?? []).filter((_, i) => i !== item.editPath.index);
        onUpdateSection("scope-boundaries", { ...bounds, politelyDeclines: declines });
      }
    },
  };

  // --- Response style chip logic ---
  const personaLower = (ov.persona ?? "").toLowerCase();
  const formatLower = (ov.responseFormat ?? "").toLowerCase();

  const selectedTones = TONE_OPTIONS.filter((o) =>
    personaLower.includes(o.label.toLowerCase().split(" ")[0])
  ).map((o) => o.id);

  const selectedFormats = FORMAT_OPTIONS.filter((o) =>
    formatLower.includes(o.label.toLowerCase().split(" ")[0])
  ).map((o) => o.id);

  const toggleTone = (id: string) => {
    const current = new Set(selectedTones);
    if (current.has(id)) current.delete(id); else current.add(id);
    const labels = TONE_OPTIONS.filter((o) => current.has(o.id)).map((o) => o.label);
    onChange({ ...ov, persona: labels.join(", ") });
  };

  const toggleFormat = (id: string) => {
    const current = new Set(selectedFormats);
    if (current.has(id)) current.delete(id); else current.add(id);
    const labels = FORMAT_OPTIONS.filter((o) => current.has(o.id)).map((o) => o.label);
    onChange({ ...ov, responseFormat: labels.join(", ") });
  };

  // --- Research findings data ---
  const caps = data.capabilities?.items ?? [];
  const tools = data.tools?.items ?? [];
  const evalSets = data["eval-sets"]?.sets ?? [];
  const decisions = data.decisions?.items ?? [];
  const pendingDecisions = decisions.filter((d) => d.status === "pending");
  const totalTests = evalSets.reduce((sum, s) => sum + (s.tests?.length ?? 0), 0);
  const arch = data.architecture;

  return (
    <div className="space-y-6">
      {/* 1. Agent identity */}
      <div>
        <EditableText
          value={viewModel.agentName}
          placeholder="Untitled Agent"
          editing={editingField === "name"}
          onStartEdit={() => startEdit("name", ov.name)}
          onSave={() => saveField("name")}
          onCancel={() => setEditingField(null)}
          draft={fieldDraft}
          onDraftChange={setFieldDraft}
          className="text-xl font-bold text-foreground"
        />
        <EditableText
          value={viewModel.whatItDoes}
          placeholder="No description yet — click to add one."
          editing={editingField === "description"}
          onStartEdit={() => startEdit("description", ov.description)}
          onSave={() => saveField("description")}
          onCancel={() => setEditingField(null)}
          draft={fieldDraft}
          onDraftChange={setFieldDraft}
          multiline
          className="text-sm text-muted-foreground leading-relaxed mt-1"
        />
      </div>

      {/* 2. Research findings — shown after research completes */}
      {researchDone && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Research findings</h3>
          <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
            <FindingCard
              icon={<Zap className="h-3.5 w-3.5" />}
              label="Capabilities"
              value={caps.filter((c) => c.name).length}
              detail={`${caps.filter((c) => c.phase === "MVP").length} MVP`}
              onClick={onNavigateToSection ? () => onNavigateToSection("capabilities") : undefined}
            />
            <FindingCard
              icon={<Plug className="h-3.5 w-3.5" />}
              label="Tools"
              value={tools.filter((t) => t.name).length}
              detail={arch?.pattern?.replace("-", " ") ?? ""}
              onClick={onNavigateToSection ? () => onNavigateToSection("tools") : undefined}
            />
            <FindingCard
              icon={<TestTube className="h-3.5 w-3.5" />}
              label="Eval tests"
              value={totalTests}
              detail={`${evalSets.length} sets`}
              onClick={onNavigateToSection ? () => onNavigateToSection("eval-sets") : undefined}
            />
            <FindingCard
              icon={<ListChecks className="h-3.5 w-3.5" />}
              label="Decisions"
              value={pendingDecisions.length}
              detail={pendingDecisions.length > 0 ? "pending" : "all confirmed"}
              highlight={pendingDecisions.length > 0}
              onClick={onNavigateToSection ? () => onNavigateToSection("decisions") : undefined}
            />
          </div>
          {/* Architecture badges */}
          {(arch?.pattern || arch?.solutionType || data.instructions?.systemPrompt) && (
            <div className="flex flex-wrap gap-2">
              {arch?.pattern && <StatusBadge label="Architecture" value={arch.pattern.replace("-", " ")} />}
              {arch?.solutionType && <StatusBadge label="Solution" value={arch.solutionType} />}
              {data.instructions?.systemPrompt && <StatusBadge label="Instructions" value="Generated" ok />}
              {totalTests > 0 && <StatusBadge label="Evals" value={`${totalTests} tests`} ok />}
            </div>
          )}
        </div>
      )}

      {/* 3. Who it's for */}
      <PreviewSectionCard
        title="Who it's for"
        subtitle="The people this agent is designed to help"
        icon={<Users className="h-4 w-4" />}
        items={viewModel.audience.map((u, i) => ({
          text: u,
          editPath: { section: "overview", index: i, field: "targetUsers" },
        }))}
        emptyText="No target users defined yet"
        onEdit={(idx, text) => audienceHandlers.onEdit(idx, text)}
        onAdd={audienceHandlers.onAdd}
        onRemove={(idx) => audienceHandlers.onRemove(idx)}
      />

      {/* 4. What it can do */}
      <PreviewSectionCard
        title="What it can do"
        subtitle="The main tasks this agent should handle"
        icon={<Zap className="h-4 w-4" />}
        items={viewModel.capabilities}
        emptyText="No capabilities defined yet"
        onEdit={capabilityHandlers.onEdit}
        onAdd={capabilityHandlers.onAdd}
        onRemove={capabilityHandlers.onRemove}
      />

      {/* 5. What it should NOT do */}
      <PreviewSectionCard
        title="What it should not do"
        subtitle="Boundaries and limitations"
        icon={<ShieldAlert className="h-4 w-4" />}
        items={notDoItems}
        emptyText="No boundaries defined yet — research will identify these"
        onEdit={notDoHandlers.onEdit}
        onAdd={notDoHandlers.onAdd}
        onRemove={notDoHandlers.onRemove}
      />

      {/* 5b. Test golden sets — shown when eval stubs exist */}
      {totalTests > 0 && !researchDone && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TestTube className="h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Test golden sets</h3>
                <p className="text-[11px] text-muted-foreground">Auto-generated from capabilities and boundaries</p>
              </div>
            </div>
            {onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("eval-sets")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                Review & edit <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="grid gap-2 grid-cols-3">
            {evalSets.map((set) => (
              <div key={set.name} className="rounded-md border border-border bg-surface-1 p-2.5 text-center">
                <p className="text-xs font-medium text-foreground capitalize">{set.name}</p>
                <p className="text-lg font-bold text-foreground">{set.tests?.length ?? 0}</p>
                <p className="text-[10px] text-muted-foreground">target: {set.passThreshold}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. How it should respond */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <div>
            <h3 className="text-sm font-semibold text-foreground">How it should respond</h3>
            <p className="text-[11px] text-muted-foreground">Pick the styles that match your needs</p>
          </div>
        </div>
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Tone</label>
            <div className="flex flex-wrap gap-2">
              {TONE_OPTIONS.map((opt) => {
                const selected = selectedTones.includes(opt.id);
                return (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => toggleTone(opt.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${
                      selected
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-surface-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2/80"
                    }`}
                    title={opt.desc}
                  >
                    {selected && <Check className="h-3 w-3" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Response format</label>
            <div className="flex flex-wrap gap-2">
              {FORMAT_OPTIONS.map((opt) => {
                const selected = selectedFormats.includes(opt.id);
                return (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => toggleFormat(opt.id)}
                    className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors border ${
                      selected
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "bg-surface-2 border-transparent text-muted-foreground hover:text-foreground hover:bg-surface-2/80"
                    }`}
                    title={opt.desc}
                  >
                    {selected && <Check className="h-3 w-3" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 7. Knowledge sources */}
      {viewModel.knowledgeSources.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Knowledge sources</h3>
                <p className="text-[11px] text-muted-foreground">Information the agent relies on</p>
              </div>
            </div>
            {onNavigateToSection && (
              <button
                onClick={() => onNavigateToSection("knowledge-sources")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                Edit <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {viewModel.knowledgeSources.map((name, i) => (
              <span key={i} className="inline-flex items-center rounded-md bg-surface-2 px-2.5 py-1 text-xs text-foreground">
                {name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 8. Open questions */}
      <OpenQuestionsEditor
        questions={data["open-questions"]?.items ?? []}
        onUpdate={(items) => onUpdateSection?.("open-questions", { items })}
      />
    </div>
  );
};

// --- Helper components ---

function EditableText({
  value,
  placeholder,
  editing,
  onStartEdit,
  onSave,
  onCancel,
  draft,
  onDraftChange,
  multiline,
  className = "",
}: {
  value: string;
  placeholder: string;
  editing: boolean;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  draft: string;
  onDraftChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
}) {
  if (editing) {
    const InputComp = multiline ? Textarea : Input;
    return (
      <div className="space-y-2 mt-1">
        <InputComp
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={editKeyHandler({ onSave, onCancel, multiline })}
          autoFocus
          rows={multiline ? 3 : undefined}
          className="text-sm"
        />
        <div className="flex gap-2 justify-end">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onCancel}>
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" className="h-7 w-7" onClick={onSave}>
            <Check className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }
  return (
    <p
      className={`cursor-pointer hover:text-primary transition-colors group ${className}`}
      onClick={onStartEdit}
    >
      {value || <span className="text-muted-foreground italic">{placeholder}</span>}
      <Pencil className="inline h-3 w-3 ml-1.5 opacity-0 group-hover:opacity-50" />
    </p>
  );
}

function FindingCard({
  icon,
  label,
  value,
  detail,
  highlight,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-lg border p-2.5 text-left transition-colors ${
        highlight
          ? "border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-900/10"
          : "border-border bg-surface-1"
      } ${onClick ? "hover:border-primary/30 cursor-pointer" : ""}`}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{detail}</span>
        {onClick && <ArrowRight className="h-2.5 w-2.5 text-muted-foreground" />}
      </div>
    </Wrapper>
  );
}

function StatusBadge({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
      ok
        ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
        : "bg-surface-2 text-foreground"
    }`}>
      {ok && <Check className="h-2.5 w-2.5" />}
      <span className="text-muted-foreground">{label}:</span> {value}
    </span>
  );
}

function OpenQuestionsEditor({
  questions,
  onUpdate,
}: {
  questions: OpenQuestion[];
  onUpdate: (items: OpenQuestion[]) => void;
}) {
  const [editingQuestion, setEditingQuestion] = useState<{ idx: number; text: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");

  const updateQuestion = (idx: number, patch: Partial<OpenQuestion>) => {
    const items = [...questions];
    items[idx] = { ...items[idx], ...patch };
    onUpdate(items);
  };

  const removeQuestion = (idx: number) => {
    onUpdate(questions.filter((_, i) => i !== idx));
  };

  const addQuestion = () => {
    if (!addDraft.trim()) return;
    onUpdate([...questions, {
      question: addDraft.trim(),
      status: "open",
      notes: "",
      resolution: "",
      impact: "",
      section: "",
      suggestedDefault: "",
      source: "user-added",
    }]);
    setAddDraft("");
    setAdding(false);
  };

  const startEditQuestion = (idx: number) => {
    setEditingQuestion({ idx, text: questions[idx].question });
  };

  const saveEditQuestion = () => {
    if (!editingQuestion) return;
    if (!editingQuestion.text.trim()) {
      removeQuestion(editingQuestion.idx);
    } else {
      updateQuestion(editingQuestion.idx, { question: editingQuestion.text.trim() });
    }
    setEditingQuestion(null);
  };

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10 p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <HelpCircle className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold text-amber-800 dark:text-amber-300">
            Things to confirm
          </h3>
          {questions.length > 0 && (
            <span className="text-xs text-amber-600 dark:text-amber-400">
              {questions.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAdding(true)}
          className="h-7 gap-1 text-xs text-amber-700 dark:text-amber-400"
        >
          <Plus className="h-3 w-3" /> Add
        </Button>
      </div>

      {questions.length === 0 && !adding && (
        <p className="text-xs text-amber-600/70 italic py-2">No open questions — add one if something needs clarification</p>
      )}

      <ul className="space-y-3">
        {questions.map((q, i) => {
          if (editingQuestion?.idx === i) {
            return (
              <li key={i} className="flex gap-2">
                <Input
                  value={editingQuestion.text}
                  onChange={(e) => setEditingQuestion({ ...editingQuestion, text: e.target.value })}
                  onKeyDown={editKeyHandler({ onSave: saveEditQuestion, onCancel: () => setEditingQuestion(null) })}
                  autoFocus
                  className="h-8 text-sm flex-1"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingQuestion(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" className="h-8 w-8" onClick={saveEditQuestion}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </li>
            );
          }

          return (
            <li key={i} className="group rounded-md border border-amber-200/50 dark:border-amber-800/50 p-3">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span
                  className="flex-1 text-sm cursor-pointer hover:text-foreground transition-colors text-amber-800 dark:text-amber-200"
                  onClick={() => startEditQuestion(i)}
                >
                  {q.question}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                  onClick={() => removeQuestion(i)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {q.suggestedDefault && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400 italic mb-1.5 ml-5.5">
                  Suggested: {q.suggestedDefault}
                </p>
              )}
              <div className="ml-5.5">
                <textarea
                  value={q.resolution || q.notes || ""}
                  onChange={(e) => {
                    updateQuestion(i, { resolution: e.target.value, notes: e.target.value });
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  placeholder="Type your answer or notes..."
                  rows={1}
                  className="w-full resize-none overflow-hidden rounded-md border border-input bg-white/50 dark:bg-zinc-900/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  style={{ minHeight: "36px" }}
                  ref={(el) => {
                    if (el) {
                      el.style.height = "auto";
                      el.style.height = el.scrollHeight + "px";
                    }
                  }}
                />
              </div>
            </li>
          );
        })}

        {adding && (
          <li className="flex gap-2">
            <Input
              value={addDraft}
              onChange={(e) => setAddDraft(e.target.value)}
              onKeyDown={editKeyHandler({ onSave: addQuestion, onCancel: () => { setAdding(false); setAddDraft(""); } })}
              placeholder="What needs to be confirmed?"
              autoFocus
              className="h-8 text-sm flex-1"
            />
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setAdding(false); setAddDraft(""); }}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" className="h-8 w-8" onClick={addQuestion}>
              <Check className="h-3.5 w-3.5" />
            </Button>
          </li>
        )}
      </ul>
    </div>
  );
}

export default OverviewSummary;
