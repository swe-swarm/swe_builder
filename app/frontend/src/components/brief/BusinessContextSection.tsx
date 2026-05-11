import { useState } from "react";
import { Plus, Trash2, Pencil, Check, X } from "lucide-react";
import SectionGuidelines from "./SectionGuidelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Props { data: any; onChange?: (data: any) => void; }

const BusinessContextSection = ({ data, onChange }: Props) => {
  const [editingField, setEditingField] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>("");
  const [editListItem, setEditListItem] = useState<{ key: string; idx: number; value: string } | null>(null);
  const [editCriteria, setEditCriteria] = useState<{ idx: number; data: any } | null>(null);
  const [editStakeholder, setEditStakeholder] = useState<{ idx: number; data: any } | null>(null);

  const update = (partial: any) => onChange?.({ ...data, ...partial });

  const startFieldEdit = (field: string, value: string) => { setEditingField(field); setDraft(value); };
  const saveField = () => { if (editingField) { update({ [editingField]: draft }); setEditingField(null); } };
  const cancelField = () => setEditingField(null);

  const startListEdit = (key: string, idx: number, value: string) => setEditListItem({ key, idx, value });
  const saveListItem = () => {
    if (!editListItem) return;
    const { key, idx, value } = editListItem;
    if (!value.trim()) { update({ [key]: data[key].filter((_: any, i: number) => i !== idx) }); }
    else { const items = [...data[key]]; items[idx] = value; update({ [key]: items }); }
    setEditListItem(null);
  };
  const addListItem = (key: string) => {
    const items = [...data[key], ""];
    update({ [key]: items });
    setEditListItem({ key, idx: items.length - 1, value: "" });
  };
  const removeListItem = (key: string, idx: number) => {
    update({ [key]: data[key].filter((_: any, i: number) => i !== idx) });
    if (editListItem?.key === key && editListItem.idx === idx) setEditListItem(null);
  };

  const addCriteria = () => {
    const item = { metric: "", target: "", current: "" };
    update({ successCriteria: [...data.successCriteria, item] });
    setEditCriteria({ idx: data.successCriteria.length, data: item });
  };
  const saveCriteria = () => {
    if (!editCriteria) return;
    if (!editCriteria.data.metric.trim()) {
      update({ successCriteria: data.successCriteria.filter((_: any, i: number) => i !== editCriteria.idx) });
    } else {
      const items = [...data.successCriteria]; items[editCriteria.idx] = editCriteria.data; update({ successCriteria: items });
    }
    setEditCriteria(null);
  };
  const removeCriteria = (idx: number) => {
    update({ successCriteria: data.successCriteria.filter((_: any, i: number) => i !== idx) });
    if (editCriteria?.idx === idx) setEditCriteria(null);
  };

  const addStakeholder = () => {
    const item = { name: "", role: "", type: "Owner" };
    update({ stakeholders: [...data.stakeholders, item] });
    setEditStakeholder({ idx: data.stakeholders.length, data: item });
  };
  const saveStakeholder = () => {
    if (!editStakeholder) return;
    if (!editStakeholder.data.name.trim()) {
      update({ stakeholders: data.stakeholders.filter((_: any, i: number) => i !== editStakeholder.idx) });
    } else {
      const items = [...data.stakeholders]; items[editStakeholder.idx] = editStakeholder.data; update({ stakeholders: items });
    }
    setEditStakeholder(null);
  };
  const removeStakeholder = (idx: number) => {
    update({ stakeholders: data.stakeholders.filter((_: any, i: number) => i !== idx) });
    if (editStakeholder?.idx === idx) setEditStakeholder(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Business Context</h2>
        <p className="text-xs text-muted-foreground">Problem statement, challenges, and success criteria</p>
        <SectionGuidelines sectionId="business-context" />
      </div>

      {/* Problem Statement */}
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Problem Statement</h3>
        {editingField === "problemStatement" ? (
          <div className="space-y-2">
            <Textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={cancelField}><X className="h-3.5 w-3.5" /></Button>
              <Button size="icon" className="h-7 w-7" onClick={saveField}><Check className="h-3.5 w-3.5" /></Button>
            </div>
          </div>
        ) : (
          <p
            className="text-sm leading-relaxed text-foreground cursor-pointer hover:text-primary transition-colors"
            onClick={() => startFieldEdit("problemStatement", data.problemStatement)}
          >{data.problemStatement}</p>
        )}
      </div>

      {/* Challenges & Benefits */}
      <div className="grid gap-4 md:grid-cols-2">
        {([
          { key: "challenges", label: "Challenges", dot: "bg-destructive" },
          { key: "benefits", label: "Benefits", dot: "bg-success" },
        ] as const).map(({ key, label, dot }) => (
          <div key={key} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
              <Button variant="ghost" size="sm" onClick={() => addListItem(key)} className="h-7 gap-1 text-xs">
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <ul className="space-y-2">
              {data[key].map((item: string, i: number) => (
                <li key={i} className="flex items-center gap-2 text-sm text-foreground group">
                  {editListItem?.key === key && editListItem.idx === i ? (
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
                      <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                      <span
                        className="flex-1 cursor-pointer hover:text-primary transition-colors"
                        onClick={() => startListEdit(key, i, item)}
                      >{item}</span>
                      <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => removeListItem(key, i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Success Criteria */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Success Criteria</h3>
          <Button variant="ghost" size="sm" onClick={addCriteria} className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.successCriteria.map((sc: any, i: number) => (
            <div key={i} className="rounded-md bg-surface-2 p-3 group relative">
              {editCriteria?.idx === i ? (
                <div className="space-y-2">
                  <Input placeholder="Metric" value={editCriteria.data.metric} onChange={(e) => setEditCriteria({ ...editCriteria, data: { ...editCriteria.data, metric: e.target.value } })} className="h-8 text-sm" autoFocus />
                  <Input placeholder="Target (e.g. ≥ 80%)" value={editCriteria.data.target} onChange={(e) => setEditCriteria({ ...editCriteria, data: { ...editCriteria.data, target: e.target.value } })} className="h-8 text-sm" />
                  <Input placeholder="Current" value={editCriteria.data.current} onChange={(e) => setEditCriteria({ ...editCriteria, data: { ...editCriteria.data, current: e.target.value } })} className="h-8 text-sm" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditCriteria(null)}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" className="h-7 w-7" onClick={saveCriteria}><Check className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <div className="cursor-pointer" onClick={() => setEditCriteria({ idx: i, data: { ...sc } })}>
                  <p className="text-xs font-medium text-foreground">{sc.metric}</p>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-bold text-primary">{sc.target}</span>
                    <span className="text-xs text-muted-foreground">from {sc.current}</span>
                  </div>
                  <Button
                    variant="ghost" size="icon"
                    className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={(e) => { e.stopPropagation(); removeCriteria(i); }}
                  ><Trash2 className="h-3 w-3" /></Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stakeholders */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Stakeholders</h3>
          <Button variant="ghost" size="sm" onClick={addStakeholder} className="h-7 gap-1 text-xs">
            <Plus className="h-3 w-3" /> Add
          </Button>
        </div>
        <div className="space-y-2">
          {data.stakeholders.map((s: any, i: number) => (
            <div key={i} className="flex items-center justify-between rounded-md bg-surface-2 px-3 py-2 group">
              {editStakeholder?.idx === i ? (
                <div className="flex-1 space-y-2">
                  <Input placeholder="Name" value={editStakeholder.data.name} onChange={(e) => setEditStakeholder({ ...editStakeholder, data: { ...editStakeholder.data, name: e.target.value } })} className="h-8 text-sm" autoFocus />
                  <Input placeholder="Role" value={editStakeholder.data.role} onChange={(e) => setEditStakeholder({ ...editStakeholder, data: { ...editStakeholder.data, role: e.target.value } })} className="h-8 text-sm" />
                  <Input placeholder="Type (Sponsor, Owner, SME)" value={editStakeholder.data.type} onChange={(e) => setEditStakeholder({ ...editStakeholder, data: { ...editStakeholder.data, type: e.target.value } })} className="h-8 text-sm" />
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setEditStakeholder(null)}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" className="h-7 w-7" onClick={saveStakeholder}><Check className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="cursor-pointer flex-1" onClick={() => setEditStakeholder({ idx: i, data: { ...s } })}>
                    <p className="text-sm font-medium text-foreground hover:text-primary transition-colors">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.role}</p>
                  </div>
                  <span className="text-xs text-primary font-medium">{s.type}</span>
                  <Button
                    variant="ghost" size="icon"
                    className="h-6 w-6 ml-2 opacity-0 group-hover:opacity-100 text-destructive"
                    onClick={() => removeStakeholder(i)}
                  ><Trash2 className="h-3 w-3" /></Button>
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default BusinessContextSection;
