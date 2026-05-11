import { useState } from "react";
import { Plus, Check, X, AlertTriangle, FileText, Sparkles, User, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { editKeyHandler } from "@/lib/editKeys";
import type { ViewItem } from "@/hooks/useOverviewViewModel";
import type { ItemSource } from "@/types";

interface Props {
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  items: ViewItem[];
  emptyText?: string;
  onEdit?: (index: number, newText: string) => void;
  onAdd?: (text: string) => void;
  onRemove?: (index: number) => void;
}

const sourceBadge = (source?: ItemSource) => {
  if (!source) return null;
  switch (source) {
    case "from-docs":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 dark:bg-blue-900/30 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
          <FileText className="h-2.5 w-2.5" />
          From docs
        </span>
      );
    case "inferred":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
          <Sparkles className="h-2.5 w-2.5" />
          Inferred
        </span>
      );
    case "user-added":
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
          <User className="h-2.5 w-2.5" />
          Added
        </span>
      );
  }
};

const PreviewSectionCard = ({
  title,
  subtitle,
  icon,
  items,
  emptyText = "None defined yet",
  onEdit,
  onAdd,
  onRemove,
}: Props) => {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [addDraft, setAddDraft] = useState("");

  const startEdit = (idx: number, text: string) => {
    setEditingIdx(idx);
    setEditDraft(text);
  };

  const saveEdit = () => {
    if (editingIdx !== null && onEdit) {
      if (editDraft.trim()) {
        onEdit(editingIdx, editDraft.trim());
      } else if (onRemove) {
        onRemove(editingIdx);
      }
    }
    setEditingIdx(null);
  };

  const saveAdd = () => {
    if (addDraft.trim() && onAdd) {
      onAdd(addDraft.trim());
    }
    setAddDraft("");
    setAdding(false);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">{icon}</span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{items.length} items</span>
          {onAdd && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setAdding(true)}
              className="h-7 gap-1 text-xs"
            >
              <Plus className="h-3 w-3" /> Add
            </Button>
          )}
        </div>
      </div>

      {items.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic py-2">{emptyText}</p>
      )}

      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="group">
            {editingIdx === i ? (
              <div className="flex gap-2">
                <Input
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={editKeyHandler({ onSave: saveEdit, onCancel: () => setEditingIdx(null) })}
                  autoFocus
                  className="h-8 text-sm flex-1"
                />
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setEditingIdx(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" className="h-8 w-8" onClick={saveEdit}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div
                className="flex items-center gap-2 py-1 px-2 -mx-2 rounded-md hover:bg-surface-2 cursor-pointer transition-colors"
                onClick={() => onEdit && startEdit(i, item.text)}
              >
                {item.source === "inferred" ? (
                  <AlertTriangle className="h-3 w-3 shrink-0 text-amber-500" />
                ) : (
                  <Check className="h-3 w-3 shrink-0 text-success" />
                )}
                <span className="flex-1 text-sm text-foreground">{item.text}</span>
                {sourceBadge(item.source)}
                {onRemove && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                    onClick={(e) => { e.stopPropagation(); onRemove(i); }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
          </li>
        ))}
        {adding && (
          <li>
            <div className="flex gap-2">
              <Input
                value={addDraft}
                onChange={(e) => setAddDraft(e.target.value)}
                onKeyDown={editKeyHandler({ onSave: saveAdd, onCancel: () => { setAdding(false); setAddDraft(""); } })}
                placeholder="Add new item..."
                autoFocus
                className="h-8 text-sm flex-1"
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setAdding(false); setAddDraft(""); }}>
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" className="h-8 w-8" onClick={saveAdd}>
                <Check className="h-3.5 w-3.5" />
              </Button>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
};

export default PreviewSectionCard;
