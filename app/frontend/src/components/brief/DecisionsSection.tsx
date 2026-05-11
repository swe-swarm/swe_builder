import { useState } from "react";
import {
  Check, X, ChevronDown, ChevronUp,
  Plug, Network, Bot, Server, MessageSquare, Star,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Decision, DecisionOption, DecisionCategory, DecisionStatus, ConfidenceLevel } from "@/types";

interface Props {
  data: { items: Decision[] };
  onChange?: (data: { items: Decision[] }) => void;
}

// ─── Sub-components ──────────────────────────────────────────────

const CATEGORY_CONFIG: Record<DecisionCategory, { color: string; bg: string; icon: React.ElementType }> = {
  integration: { color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30", icon: Plug },
  architecture: { color: "text-purple-600", bg: "bg-purple-100 dark:bg-purple-900/30", icon: Network },
  model: { color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30", icon: Bot },
  infrastructure: { color: "text-orange-600", bg: "bg-orange-100 dark:bg-orange-900/30", icon: Server },
  "topic-implementation": { color: "text-teal-600", bg: "bg-teal-100 dark:bg-teal-900/30", icon: MessageSquare },
};

const STATUS_CONFIG: Record<DecisionStatus, { label: string; className: string }> = {
  pending: { label: "Pending", className: "border border-yellow-400 text-yellow-700 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" },
  confirmed: { label: "Confirmed", className: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" },
  overridden: { label: "Overridden", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
};

const CONFIDENCE_CONFIG: Record<ConfidenceLevel, { color: string; label: string }> = {
  high: { color: "text-green-600", label: "High" },
  medium: { color: "text-yellow-600", label: "Medium" },
  low: { color: "text-red-500", label: "Low" },
};

function CategoryBadge({ category }: { category: DecisionCategory }) {
  const config = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.integration;
  const Icon = config.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${config.bg} ${config.color}`}>
      <Icon className="h-3 w-3" />
      {category}
    </span>
  );
}

function StatusBadge({ status }: { status: DecisionStatus }) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.pending;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${config.className}`}>
      {config.label}
    </span>
  );
}

function ConfidenceDot({ confidence }: { confidence: ConfidenceLevel }) {
  const config = CONFIDENCE_CONFIG[confidence] ?? CONFIDENCE_CONFIG.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] ${config.color}`}>
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
      {config.label}
    </span>
  );
}

function OptionCard({
  option,
  isRecommended,
  isSelected,
  isConfirmed,
  onPick,
}: {
  option: DecisionOption;
  isRecommended: boolean;
  isSelected: boolean;
  isConfirmed: boolean;
  onPick: () => void;
}) {
  const [expanded, setExpanded] = useState(!isConfirmed || isSelected);

  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        isSelected
          ? "border-green-500 bg-green-50/50 dark:bg-green-900/10"
          : "border-border bg-card"
      }`}
    >
      {/* Option header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium text-foreground">{option.label}</h4>
            {isRecommended && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                <Star className="h-2.5 w-2.5" /> Recommended
              </span>
            )}
            {isSelected && (
              <span className="inline-flex items-center gap-0.5 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
                <Check className="h-2.5 w-2.5" /> Selected
              </span>
            )}
          </div>
          {expanded && (
            <p className="text-xs text-muted-foreground mt-1">{option.summary}</p>
          )}
        </div>
        {isConfirmed && !isSelected && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="shrink-0 p-1 text-muted-foreground hover:text-foreground"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="mt-3 space-y-3">
          {/* Pros/Cons */}
          {(option.pros.length > 0 || option.cons.length > 0) && (
            <div className="grid grid-cols-2 gap-3">
              {option.pros.length > 0 && (
                <div className="space-y-1">
                  {option.pros.map((pro, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <Check className="h-3 w-3 shrink-0 mt-0.5 text-green-600" />
                      <span className="text-foreground">{pro}</span>
                    </div>
                  ))}
                </div>
              )}
              {option.cons.length > 0 && (
                <div className="space-y-1">
                  {option.cons.map((con, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs">
                      <X className="h-3 w-3 shrink-0 mt-0.5 text-red-500" />
                      <span className="text-foreground">{con}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
            {option.cost && <span>Cost: <span className="text-foreground font-medium">{option.cost}</span></span>}
            {option.effort && <span>Effort: <span className="text-foreground font-medium">{option.effort}</span></span>}
            <ConfidenceDot confidence={option.confidence} />
            {option.source && <span className="truncate max-w-[200px]">Source: {option.source}</span>}
          </div>

          {/* Requirements */}
          {option.requirements.length > 0 && (
            <div className="text-[11px] text-muted-foreground">
              Requires: <span className="text-foreground">{option.requirements.join(", ")}</span>
            </div>
          )}

          {/* Pick button */}
          {!isSelected && (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" className="text-xs gap-1.5" onClick={onPick}>
                <Check className="h-3 w-3" /> Pick
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DecisionCard({
  decision,
  onSelect,
}: {
  decision: Decision;
  onSelect: (optionId: string) => void;
}) {
  const isConfirmed = decision.status !== "pending";

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      {/* Decision header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <CategoryBadge category={decision.category} />
            <StatusBadge status={decision.status} />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{decision.title}</h3>
          {decision.context && (
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{decision.context}</p>
          )}
        </div>
      </div>

      {/* Options */}
      <div className="space-y-3">
        {decision.options.map((option, i) => (
          <OptionCard
            key={option.id}
            option={option}
            isRecommended={option.id === decision.recommendedOptionId}
            isSelected={option.id === decision.selectedOptionId}
            isConfirmed={isConfirmed}
            onPick={() => onSelect(option.id)}
          />
        ))}
      </div>

      {/* Resolution info */}
      {decision.resolvedAt && (
        <p className="text-[10px] text-muted-foreground">
          Resolved {decision.resolvedBy ? `by ${decision.resolvedBy}` : ""} on{" "}
          {new Date(decision.resolvedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

// ─── Main Section ────────────────────────────────────────────────

const DecisionsSection = ({ data, onChange }: Props) => {
  const items = data.items ?? [];
  const confirmedCount = items.filter((d) => d.status !== "pending").length;

  const handleSelect = (decisionId: string, optionId: string) => {
    const updated = items.map((d) => {
      if (d.id !== decisionId) return d;
      const isOverride = optionId !== d.recommendedOptionId;
      return {
        ...d,
        selectedOptionId: optionId,
        status: (isOverride ? "overridden" : "confirmed") as Decision["status"],
        resolvedAt: new Date().toISOString(),
        resolvedBy: "user",
      };
    });
    onChange?.({ items: updated });
  };

  // Sort: pending first, then confirmed/overridden
  const sorted = [...items].sort((a, b) => {
    if (a.status === "pending" && b.status !== "pending") return -1;
    if (a.status !== "pending" && b.status === "pending") return 1;
    return 0;
  });

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Decisions</h2>
        <p className="text-xs text-muted-foreground">
          Review research findings and choose the best approach for each decision point.
        </p>
      </div>

      {/* Summary banner */}
      {items.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-1 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span>{confirmedCount}</span>
            <span className="text-muted-foreground font-normal">of</span>
            <span>{items.length}</span>
            <span className="text-muted-foreground font-normal">decisions confirmed</span>
          </div>
          {items.length > 0 && confirmedCount === items.length && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 dark:bg-green-900/30 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400">
              <Check className="h-2.5 w-2.5" /> All resolved
            </span>
          )}
        </div>
      )}

      {/* Decision cards */}
      {sorted.length > 0 ? (
        <div className="space-y-4">
          {sorted.map((decision) => (
            <DecisionCard
              key={decision.id}
              decision={decision}
              onSelect={(optionId) => handleSelect(decision.id, optionId)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-card p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No decisions needed — research found a clear best approach for each component.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Decisions appear here when research identifies multiple viable options that require your input.
          </p>
        </div>
      )}
    </div>
  );
};

export default DecisionsSection;
