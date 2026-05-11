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

const emptyItem = { name: "", description: "", type: "generative", phase: "MVP", flowDescription: "" };

const ConversationTopicsSection = ({ data, onChange }: Props) => {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const update = (items: any[]) => onChange?.({ ...data, items });
  const startEdit = (i: number) => { setEditIdx(i); setDraft({ ...data.items[i] }); };
  const saveEdit = () => { if (editIdx === null || !draft.name.trim()) return; const items = [...data.items]; items[editIdx] = draft; update(items); setEditIdx(null); setDraft(null); };
  const cancelEdit = () => { setEditIdx(null); setDraft(null); };
  const remove = (i: number) => { update(data.items.filter((_: any, idx: number) => idx !== i)); if (editIdx === i) cancelEdit(); };
  const add = () => { update([...data.items, { ...emptyItem }]); setEditIdx(data.items.length); setDraft({ ...emptyItem }); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Topics</h2>
          <p className="text-xs text-muted-foreground">Conversation flows the agent can run</p>
          <SectionGuidelines sectionId="conversation-topics" />
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5"><Plus className="h-3.5 w-3.5" /> Add</Button>
      </div>
      <div className="space-y-2">
        {data.items.map((item: any, i: number) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            {editIdx === i && draft ? (
              <div className="space-y-3">
                <Input placeholder="Topic name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                <Input placeholder="Description" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
                <div className="grid grid-cols-2 gap-3">
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v })}>
                    <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="generative">Generative</SelectItem>
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={draft.phase} onValueChange={(v) => setDraft({ ...draft, phase: v })}>
                    <SelectTrigger><SelectValue placeholder="Phase" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="MVP">MVP</SelectItem>
                      <SelectItem value="Future">Future</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {draft.type === "custom" && (
                  <Textarea
                    placeholder="Flow description — describe the full conversation design: inputs, logic, outputs, error handling. The Topic Engineer AI uses this to generate the implementation."
                    value={draft.flowDescription || ""}
                    onChange={(e) => setDraft({ ...draft, flowDescription: e.target.value })}
                    rows={5}
                  />
                )}
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={cancelEdit}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" onClick={saveEdit}><Check className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-foreground">{item.name}</p>
                    <span className="text-[11px] font-medium capitalize text-primary">{item.type || "generative"}</span>
                    <span className="text-[11px] text-muted-foreground">{item.phase || "MVP"}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                  {item.type === "custom" && item.flowDescription && (
                    <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2">{item.flowDescription}</p>
                  )}
                </div>
                <div className="flex gap-1 ml-3">
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(i)}><Pencil className="h-3.5 w-3.5" /></Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConversationTopicsSection;
