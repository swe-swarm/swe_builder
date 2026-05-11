import { useState } from "react";
import { Plus, Trash2, Check, X } from "lucide-react";
import SectionGuidelines from "./SectionGuidelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Props { data: any; onChange?: (data: any) => void; }

const AgentIdentitySection = ({ data, onChange }: Props) => {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [editListItem, setEditListItem] = useState<{ idx: number; value: string } | null>(null);

  const update = (partial: any) => onChange?.({ ...data, ...partial });

  const startFieldEdit = (field: string, value: string) => { setEditingField(field); setDraft(value); };
  const saveField = () => { if (editingField) { update({ [editingField]: draft }); setEditingField(null); } };
  const cancelField = () => setEditingField(null);

  const startListEdit = (idx: number, value: string) => setEditListItem({ idx, value });
  const saveListItem = () => {
    if (!editListItem) return;
    const { idx, value } = editListItem;
    if (!value.trim()) { update({ targetUsers: data.targetUsers.filter((_: any, i: number) => i !== idx) }); }
    else { const items = [...data.targetUsers]; items[idx] = value; update({ targetUsers: items }); }
    setEditListItem(null);
  };
  const addUser = () => {
    const items = [...data.targetUsers, ""];
    update({ targetUsers: items });
    setEditListItem({ idx: items.length - 1, value: "" });
  };
  const removeUser = (idx: number) => {
    update({ targetUsers: data.targetUsers.filter((_: any, i: number) => i !== idx) });
    if (editListItem?.idx === idx) setEditListItem(null);
  };

  const renderEditable = (field: string, value: string, isTextarea = false) => {
    if (editingField === field) {
      const InputComp = isTextarea ? Textarea : Input;
      return (
        <div className="space-y-2">
          <InputComp value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus rows={isTextarea ? 3 : undefined} />
          <div className="flex gap-2 justify-end">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelField}><X className="h-3.5 w-3.5" /></Button>
            <Button size="icon" className="h-7 w-7" onClick={saveField}><Check className="h-3.5 w-3.5" /></Button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Agent Identity</h2>
        <p className="text-xs text-muted-foreground">Name, persona, and target users</p>
        <SectionGuidelines sectionId="agent-identity" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Agent Name</h3>
          {editingField === "name" ? renderEditable("name", data.name) : (
            <p
              className="text-xl font-bold text-foreground cursor-pointer hover:text-primary transition-colors"
              onClick={() => startFieldEdit("name", data.name)}
            >{data.name}</p>
          )}
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Description</h3>
          {editingField === "description" ? renderEditable("description", data.description, true) : (
            <p
              className="text-sm text-foreground leading-relaxed cursor-pointer hover:text-primary transition-colors"
              onClick={() => startFieldEdit("description", data.description)}
            >{data.description}</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Persona</h3>
        {editingField === "persona" ? renderEditable("persona", data.persona, true) : (
          <p
            className="text-sm text-foreground leading-relaxed italic cursor-pointer hover:text-primary transition-colors"
            onClick={() => startFieldEdit("persona", data.persona)}
          >"{data.persona}"</p>
        )}
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Target Users</h3>
          <Button variant="ghost" size="sm" onClick={addUser} className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
        <ul className="space-y-2">
          {data.targetUsers.map((u: string, i: number) => (
            <li key={i} className="flex items-center gap-2 text-sm text-foreground group">
              {editListItem?.idx === i ? (
                <div className="flex-1 flex gap-2">
                  <Input
                    value={editListItem.value}
                    onChange={(e) => setEditListItem({ ...editListItem, value: e.target.value })}
                    onKeyDown={(e) => e.key === "Enter" && saveListItem()}
                    autoFocus
                    className="h-8 text-sm"
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditListItem(null)}><X className="h-3.5 w-3.5" /></Button>
                  <Button size="icon" className="h-8 w-8" onClick={saveListItem}><Check className="h-3.5 w-3.5" /></Button>
                </div>
              ) : (
                <>
                  <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  <span
                    className="flex-1 cursor-pointer hover:text-primary transition-colors"
                    onClick={() => startListEdit(i, u)}
                  >{u}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => removeUser(i)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
};

export default AgentIdentitySection;
