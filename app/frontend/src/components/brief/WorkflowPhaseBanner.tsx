import { Check, Loader2, Eye, Microscope, ListChecks, Hammer } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { WorkflowPhase } from "@/types";

interface Props {
  phase: WorkflowPhase;
  previewGeneratedAt: string | null;
  researchCompletedAt: string | null;
  isGenerating?: boolean;
  isResearching?: boolean;
  pendingDecisionCount: number;
  onGeneratePreview?: () => void;
  onRunResearch?: () => void;
  onReviewDecisions?: () => void;
  onApproveAndBuild?: () => void;
  onBuild?: () => void;
}

// Consistent with ProjectPage PIPELINE_COLORS
const STEPS = [
  { key: "preview", label: "Preview", icon: Eye, color: "violet" },
  { key: "research", label: "Research", icon: Microscope, color: "blue" },
  { key: "decisions", label: "Decisions", icon: ListChecks, color: "blue" },
  { key: "ready_to_build", label: "Build", icon: Hammer, color: "amber" },
] as const;

const STEP_STYLES: Record<string, { active: string; done: string }> = {
  violet: { active: "bg-violet-500/10 text-violet-600 dark:text-violet-400", done: "text-violet-500 dark:text-violet-400" },
  blue:   { active: "bg-blue-500/10 text-blue-600 dark:text-blue-400", done: "text-blue-500 dark:text-blue-400" },
  amber:  { active: "bg-amber-500/10 text-amber-600 dark:text-amber-400", done: "text-amber-500 dark:text-amber-400" },
};

const phaseIndex = (phase: WorkflowPhase): number =>
  STEPS.findIndex((s) => s.key === phase);

const WorkflowPhaseBanner = ({
  phase,
  previewGeneratedAt,
  researchCompletedAt,
  isGenerating,
  isResearching,
  pendingDecisionCount,
  onGeneratePreview,
  onRunResearch,
  onReviewDecisions,
  onApproveAndBuild,
  onBuild,
}: Props) => {
  const currentIdx = phaseIndex(phase);

  let bannerText = "";
  let bannerCta: React.ReactNode = null;

  if (phase === "preview") {
    if (isGenerating) {
      bannerText = "Scanning your docs...";
      bannerCta = <Loader2 className="h-4 w-4 animate-spin text-violet-500" />;
    } else if (!previewGeneratedAt) {
      bannerText = "Let's define what this agent should do";
      bannerCta = (
        <Button size="sm" className="h-7 text-xs gap-1.5 bg-violet-600 hover:bg-violet-700 text-white" onClick={onGeneratePreview}>
          <Eye className="h-3.5 w-3.5" />
          Generate Preview
        </Button>
      );
    } else {
      bannerText = "Review your agent summary, then run research when ready";
      bannerCta = (
        <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={onRunResearch}>
          <Microscope className="h-3.5 w-3.5" />
          Run Research
        </Button>
      );
    }
  } else if (phase === "research") {
    if (isResearching) {
      bannerText = "Designing the best approach...";
      bannerCta = <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
    } else if (researchCompletedAt) {
      bannerText = "Your agent plan is ready";
      bannerCta = (
        <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={onReviewDecisions}>
          <ListChecks className="h-3.5 w-3.5" />
          Review decisions
        </Button>
      );
    } else {
      bannerText = "Ready for deep research";
      bannerCta = (
        <Button size="sm" className="h-7 text-xs gap-1.5 bg-blue-600 hover:bg-blue-700 text-white" onClick={onRunResearch}>
          <Microscope className="h-3.5 w-3.5" />
          Run Research
        </Button>
      );
    }
  } else if (phase === "decisions") {
    bannerText = pendingDecisionCount > 0
      ? `${pendingDecisionCount} decision${pendingDecisionCount > 1 ? "s" : ""} to make`
      : "All decisions confirmed";
    bannerCta = (
      <Button
        size="sm"
        className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
        onClick={onApproveAndBuild}
        disabled={pendingDecisionCount > 0}
      >
        <Check className="h-3.5 w-3.5" />
        Approve and build
      </Button>
    );
  } else if (phase === "ready_to_build") {
    bannerText = "Ready to build";
    bannerCta = (
      <Button size="sm" className="h-7 text-xs gap-1.5 bg-amber-600 hover:bg-amber-700 text-white" onClick={onBuild}>
        <Hammer className="h-3.5 w-3.5" />
        Build
      </Button>
    );
  }

  return (
    <div className="mb-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1 mb-3">
        {STEPS.map((step, i) => {
          const StepIcon = step.icon;
          const isCompleted = i < currentIdx;
          const isCurrent = i === currentIdx;
          const styles = STEP_STYLES[step.color];
          return (
            <div key={step.key} className="flex items-center gap-1">
              {i > 0 && (
                <div className={`h-px w-6 ${isCompleted ? "bg-current opacity-30" : "bg-border"}`} style={isCompleted ? { color: "inherit" } : undefined} />
              )}
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  isCurrent
                    ? styles.active
                    : isCompleted
                    ? styles.done
                    : "bg-surface-2 text-muted-foreground/40"
                }`}
              >
                {isCompleted ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <StepIcon className="h-3 w-3" />
                )}
                {step.label}
              </div>
            </div>
          );
        })}
      </div>

      {bannerText && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 px-4 py-2.5">
          <p className="text-sm text-foreground">{bannerText}</p>
          <div>{bannerCta}</div>
        </div>
      )}
    </div>
  );
};

export default WorkflowPhaseBanner;
