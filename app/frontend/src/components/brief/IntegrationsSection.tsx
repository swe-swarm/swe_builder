import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionGuidelines from "./SectionGuidelines";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Props {
  data: any;
  onChange?: (data: any) => void;
}

const TOOL_TYPES = [
  "Connector",
  "MCP server",
  "Prompt (custom prompt)",
  "Flow (Power Automate)",
  "Computer use (CUA)",
  "REST API (HTTP connector)",
];

const emptyItem = { name: "", type: "", auth: "", notes: "" };

const IntegrationsSection = ({ data, onChange }: Props) => {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState<any>(null);

  const update = (items: any[]) => onChange?.({ ...data, items });

  const startEdit = (i: number) => {
    setEditIdx(i);
    setDraft({ ...data.items[i] });
  };

  const saveEdit = () => {
    if (editIdx === null || !draft.name.trim()) return;
    const items = [...data.items];
    items[editIdx] = draft;
    update(items);
    setEditIdx(null);
    setDraft(null);
  };

  const cancelEdit = () => {
    setEditIdx(null);
    setDraft(null);
  };

  const remove = (i: number) => {
    update(data.items.filter((_: any, idx: number) => idx !== i));
    if (editIdx === i) cancelEdit();
  };

  const add = () => {
    update([...data.items, { ...emptyItem }]);
    setEditIdx(data.items.length);
    setDraft({ ...emptyItem });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground mb-1">Tools</h2>
          <p className="text-xs text-muted-foreground">Connected systems, actions, and services</p>
          <SectionGuidelines sectionId="tools" />
        </div>
        <Button variant="outline" size="sm" onClick={add} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" /> Add
        </Button>
      </div>

      <div className="space-y-2">
        {data.items.map((item: any, i: number) => (
          <div key={i} className="rounded-lg border border-border bg-card p-4">
            {editIdx === i && draft ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input placeholder="Name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v })}>
                    <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                    <SelectContent>
                      {TOOL_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input placeholder="Auth method" value={draft.auth} onChange={(e) => setDraft({ ...draft, auth: e.target.value })} />
                <Input placeholder="Notes" value={draft.notes || ""} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
                <div className="flex gap-2 justify-end">
                  <Button variant="ghost" size="sm" onClick={cancelEdit}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" onClick={saveEdit}><Check className="h-3.5 w-3.5" /></Button>
                </div>
              </div>
            ) : (
                <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{item.name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{item.type}{item.auth ? ` · ${item.auth}` : ''}</p>
                  {item.notes && <p className="text-xs text-muted-foreground/70 mt-0.5">{item.notes}</p>}
                </div>
                <div className="flex gap-1">
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

export default IntegrationsSection;
