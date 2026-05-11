import { useState } from "react";
import { Shield, AlertTriangle, XCircle, Plus, Trash2, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import SectionGuidelines from "./SectionGuidelines";

interface Props { data: any; onChange?: (data: any) => void; }

type ListKey = "handles" | "politelyDeclines" | "hardRefuses";

const sections: { key: ListKey; label: string; icon: React.ElementType; color: string; dot: string }[] = [
  { key: "handles", label: "Handles", icon: Shield, color: "text-success", dot: "bg-success" },
  { key: "politelyDeclines", label: "Politely Declines", icon: AlertTriangle, color: "text-warning", dot: "bg-warning" },
  { key: "hardRefuses", label: "Hard Refuses", icon: XCircle, color: "text-destructive", dot: "bg-destructive" },
];

const ScopeBoundariesSection = ({ data, onChange }: Props) => {
  const [editState, setEditState] = useState<{ key: ListKey; idx: number; value: string } | null>(null);

  const updateList = (key: ListKey, items: string[]) => onChange?.({ ...data, [key]: items });

  const add = (key: ListKey) => {
    const items = [...data[key], ""];
    updateList(key, items);
    setEditState({ key, idx: items.length - 1, value: "" });
  };

  const save = () => {
    if (!editState) return;
    const { key, idx, value } = editState;
    if (!value.trim()) {
      // Remove empty
      updateList(key, data[key].filter((_: string, i: number) => i !== idx));
    } else {
      const items = [...data[key]];
      items[idx] = value;
      updateList(key, items);
    }
    setEditState(null);
  };

  const remove = (key: ListKey, idx: number) => {
    updateList(key, data[key].filter((_: string, i: number) => i !== idx));
    if (editState?.key === key && editState.idx === idx) setEditState(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Scope & Boundaries</h2>
        <p className="text-xs text-muted-foreground">What the agent handles, declines, and refuses</p>
        <SectionGuidelines sectionId="scope-boundaries" />
      </div>

      {sections.map(({ key, label, icon: Icon, color, dot }) => (
        <div key={key} className="rounded-lg border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${color}`} />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{label}</h3>
            </div>
            <Button variant="ghost" size="sm" onClick={() => add(key)} className="h-7 gap-1 text-xs">
              <Plus className="h-3 w-3" /> Add
            </Button>
          </div>
          <ul className="space-y-1.5">
            {(data[key] as string[]).map((item: string, i: number) => (
              <li key={i} className="text-sm text-foreground flex items-center gap-2 group">
                {editState?.key === key && editState.idx === i ? (
                  <div className="flex-1 flex gap-2">
                    <Input
                      value={editState.value}
                      onChange={(e) => setEditState({ ...editState, value: e.target.value })}
                      onKeyDown={(e) => e.key === "Enter" && save()}
                      autoFocus
                      className="h-8 text-sm"
                    />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditState(null)}><X className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" className="h-8 w-8" onClick={save}><Check className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : (
                  <>
                    <span className={`mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
                    <span
                      className="flex-1 cursor-pointer hover:text-primary transition-colors"
                      onClick={() => setEditState({ key, idx: i, value: item })}
                    >{item}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive" onClick={() => remove(key, i)}>
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
  );
};

export default ScopeBoundariesSection;
