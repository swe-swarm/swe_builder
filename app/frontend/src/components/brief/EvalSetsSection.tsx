import { useState } from "react";
import {
  Plus, Trash2, Pencil, Check, X, ChevronDown, ChevronRight,
  CheckCircle2, XCircle, Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import SectionGuidelines from "./SectionGuidelines";
import type { EvalSet, EvalTest } from "@/types";

interface Props {
  data: { sets: EvalSet[]; config: { targetPassRate: number; maxIterationsPerCapability: number; maxRegressionRounds: number } };
  onChange?: (data: any) => void;
}

const emptyTest: EvalTest = { question: "", expected: "", lastResult: null };

/** Compute pass rate for a set. */
function setPassRate(set: EvalSet): { total: number; passed: number; rate: number | null } {
  const tested = set.tests.filter((t) => t.lastResult != null);
  if (tested.length === 0) return { total: set.tests.length, passed: 0, rate: null };
  const passed = tested.filter((t) => t.lastResult?.pass).length;
  return { total: set.tests.length, passed, rate: Math.round((passed / tested.length) * 100) };
}

/** Format method display. */
function methodLabel(m: { type: string; score?: number; mode?: string }): string {
  if (m.score != null) return `${m.type} (${m.score}%)`;
  if (m.mode) return `${m.type} (${m.mode})`;
  return m.type;
}

/** Status color for pass rate vs threshold. */
function rateColor(rate: number | null, threshold: number): string {
  if (rate === null) return "text-muted-foreground";
  if (rate >= threshold) return "text-success";
  if (rate >= threshold * 0.7) return "text-warning";
  return "text-destructive";
}

const EvalSetsSection = ({ data, onChange }: Props) => {
  const [expandedSet, setExpandedSet] = useState<string | null>(data.sets[0]?.name ?? null);
  const [editingTest, setEditingTest] = useState<{ setName: string; idx: number } | null>(null);
  const [draft, setDraft] = useState<EvalTest | null>(null);

  const updateSets = (sets: EvalSet[]) => onChange?.({ ...data, sets });

  const toggleSet = (name: string) => {
    setExpandedSet(expandedSet === name ? null : name);
    cancelEdit();
  };

  const startEdit = (setName: string, idx: number, test: EvalTest) => {
    setEditingTest({ setName, idx });
    setDraft({ ...test });
  };

  const saveEdit = () => {
    if (!editingTest || !draft?.question.trim()) return;
    const sets = data.sets.map((s) => {
      if (s.name !== editingTest.setName) return s;
      const tests = [...s.tests];
      tests[editingTest.idx] = draft;
      return { ...s, tests };
    });
    updateSets(sets);
    cancelEdit();
  };

  const cancelEdit = () => {
    setEditingTest(null);
    setDraft(null);
  };

  const removeTest = (setName: string, idx: number) => {
    const sets = data.sets.map((s) => {
      if (s.name !== setName) return s;
      return { ...s, tests: s.tests.filter((_, i) => i !== idx) };
    });
    updateSets(sets);
    if (editingTest?.setName === setName && editingTest.idx === idx) cancelEdit();
  };

  const addTest = (setName: string) => {
    const sets = data.sets.map((s) => {
      if (s.name !== setName) return s;
      return { ...s, tests: [...s.tests, { ...emptyTest }] };
    });
    updateSets(sets);
    const set = data.sets.find((s) => s.name === setName);
    const newIdx = set ? set.tests.length : 0;
    setEditingTest({ setName, idx: newIdx });
    setDraft({ ...emptyTest });
    setExpandedSet(setName);
  };

  // Aggregate stats
  const totalTests = data.sets.reduce((sum, s) => sum + s.tests.length, 0);
  const totalPassed = data.sets.reduce((sum, s) => {
    const tested = s.tests.filter((t) => t.lastResult != null);
    return sum + tested.filter((t) => t.lastResult?.pass).length;
  }, 0);
  const totalTested = data.sets.reduce(
    (sum, s) => sum + s.tests.filter((t) => t.lastResult != null).length, 0
  );
  const overallRate = totalTested > 0 ? Math.round((totalPassed / totalTested) * 100) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Eval Sets</h2>
          <p className="text-xs text-muted-foreground">
            {totalTests} tests across {data.sets.length} sets
            {overallRate !== null && (
              <span className={`ml-2 font-medium ${rateColor(overallRate, data.config.targetPassRate)}`}>
                {overallRate}% overall
              </span>
            )}
          </p>
          <SectionGuidelines sectionId="eval-sets" />
        </div>
      </div>

      <div className="space-y-3">
        {data.sets.map((set) => {
          const { total, passed, rate } = setPassRate(set);
          const isExpanded = expandedSet === set.name;
          const meetsThreshold = rate !== null && rate >= set.passThreshold;

          return (
            <div key={set.name} className="rounded-lg border border-border bg-card overflow-hidden">
              {/* Set header */}
              <button
                onClick={() => toggleSet(set.name)}
                className="w-full flex items-center gap-3 p-4 hover:bg-surface-2 transition-colors text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}

                {/* Status indicator */}
                {rate === null ? (
                  <Minus className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : meetsThreshold ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 shrink-0 text-destructive" />
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground capitalize">{set.name}</span>
                    <span className="text-[11px] text-muted-foreground">
                      {total} test{total !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{set.description}</p>
                </div>

                {/* Pass rate + threshold */}
                <div className="shrink-0 text-right">
                  {rate !== null ? (
                    <span className={`text-sm font-semibold ${rateColor(rate, set.passThreshold)}`}>
                      {rate}%
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">No results</span>
                  )}
                  <p className="text-[10px] text-muted-foreground">target: {set.passThreshold}%</p>
                </div>
              </button>

              {/* Expanded content */}
              {isExpanded && (
                <div className="border-t border-border">
                  {/* Methods bar */}
                  <div className="px-4 py-2 bg-surface-2 flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Methods:</span>
                    {set.methods.map((m, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px] font-normal">
                        {methodLabel(m)}
                      </Badge>
                    ))}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      Run: {set.runWhen.replace(/-/g, " ")}
                    </span>
                  </div>

                  {/* Progress bar */}
                  {rate !== null && (
                    <div className="px-4 py-2">
                      <Progress value={rate} className="h-1.5" />
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {passed}/{total} passed
                      </p>
                    </div>
                  )}

                  {/* Tests list */}
                  <div className="divide-y divide-border">
                    {set.tests.map((test, idx) => {
                      const isEditing = editingTest?.setName === set.name && editingTest?.idx === idx;
                      return (
                        <div key={idx} className="px-4 py-3">
                          {isEditing && draft ? (
                            <div className="space-y-2">
                              <Textarea
                                placeholder="Question (what to ask the agent)"
                                value={draft.question}
                                onChange={(e) => setDraft({ ...draft, question: e.target.value })}
                                className="min-h-[50px] text-xs"
                              />
                              <Textarea
                                placeholder="Expected response (what the answer should contain)"
                                value={draft.expected ?? ""}
                                onChange={(e) => setDraft({ ...draft, expected: e.target.value })}
                                className="min-h-[50px] text-xs"
                              />
                              <Input
                                placeholder="Capability (optional — links to capability name)"
                                value={draft.capability ?? ""}
                                onChange={(e) => setDraft({ ...draft, capability: e.target.value || undefined })}
                                className="text-xs"
                              />
                              <div className="flex gap-2 justify-end">
                                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                                <Button size="sm" onClick={saveEdit}>
                                  <Check className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-start gap-2">
                              {/* Result indicator */}
                              <div className="shrink-0 mt-0.5">
                                {test.lastResult == null ? (
                                  <Minus className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : test.lastResult.pass ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-destructive" />
                                )}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-foreground">"{test.question}"</p>
                                {test.expected && (
                                  <p className="text-[11px] text-muted-foreground mt-0.5 italic">
                                    Expected: "{test.expected}"
                                  </p>
                                )}
                                {test.capability && (
                                  <Badge variant="outline" className="text-[10px] mt-1 font-normal">
                                    {test.capability}
                                  </Badge>
                                )}
                                {test.lastResult && !test.lastResult.pass && test.lastResult.actual && (
                                  <p className="text-[11px] text-destructive mt-1">
                                    Got: "{test.lastResult.actual.substring(0, 120)}
                                    {test.lastResult.actual.length > 120 ? "..." : ""}"
                                  </p>
                                )}
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6"
                                  onClick={() => startEdit(set.name, idx, test)}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  variant="ghost" size="icon" className="h-6 w-6 text-destructive"
                                  onClick={() => removeTest(set.name, idx)}
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Add test button */}
                  <div className="px-4 py-2 border-t border-border">
                    <Button
                      variant="ghost" size="sm"
                      className="gap-1.5 text-xs"
                      onClick={() => addTest(set.name)}
                    >
                      <Plus className="h-3 w-3" /> Add test
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EvalSetsSection;
