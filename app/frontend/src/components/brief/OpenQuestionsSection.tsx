import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import SectionGuidelines from "./SectionGuidelines";

interface Props { data: any; onChange?: (data: any) => void; }

const emptyItem = { question: "", assignee: "", status: "open", resolution: "" };

const OpenQuestionsSection = ({ data, onChange }: Props) => {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const update = (items: any[]) => onChange?.({ ...data, items });
  const startEdit = (i: number) => { setEditIdx(i); setDraft({ ...data.items[i] }); };
  const saveEdit = () => { if (editIdx === null || !draft.question.trim()) return; const items = [...data.items]; items[editIdx] = draft; update(items); setEditIdx(null); setDraft(null); };
  const cancelEdit = () => { setEditIdx(null); setDraft(null); };
  const remove = (i: number) => { update(data.items.filter((_: any, idx: number) => idx !== i)); if (editIdx === i) cancelEdit(); };
  const add = () => { update([...data.items, { ...emptyItem }]); setEditIdx(data.items.length); setDraft({ ...emptyItem }); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Open Questions</h2>
          <p className="text-xs text-muted-foreground">Unresolved items needing stakeholder input</p>
          <SectionGuidelines sectionId="open-questions" />
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
      </div>
      <div className="space-y-3">
        {data.items.map((item: any, i: number) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            {editIdx === i && draft ? (
              <div className="space-y-3">
                <Textarea placeholder="Question" value={draft.question} onChange={(e) => setDraft({ ...draft, question: e.target.value })} className="min-h-[60px]" />
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Assignee" value={draft.assignee} onChange={(e) => setDraft({ ...draft, assignee: e.target.value })} />
                  <Select value={draft.status} onValueChange={(v) => setDraft({ ...draft, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="open">Open</SelectItem>
                      <SelectItem value="resolved">Resolved</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.status === "resolved" && (
                  <Input placeholder="Resolution" value={draft.resolution || ""} onChange={(e) => setDraft({ ...draft, resolution: e.target.value })} />
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={cancelEdit}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" onClick={saveEdit}><Check className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <p className="text-sm font-medium text-foreground">{item.question}</p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Assigned: <span className="text-foreground">{item.assignee}</span></p>
                {item.resolution && (
                  <div className="mt-2 rounded-md bg-success/10 px-3 py-2">
                    <p className="text-xs text-success">{item.resolution}</p>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default OpenQuestionsSection;
