import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOverviewViewModel } from "@/hooks/useOverviewViewModel";
import OverviewSummary from "./OverviewSummary";
import type { BriefData, WorkflowPhase } from "@/types";

interface Props {
  data: any;
  onChange?: (data: any) => void;
  context?: {
    briefData?: BriefData;
    onGeneratePreview?: () => void;
    onUpdateSection?: (sectionId: string, data: any) => void;
    onNavigateToSection?: (sectionId: string) => void;
  };
}

const OverviewSection = ({ data, onChange, context }: Props) => {
  const briefData = context?.briefData;
  const workflow = briefData?.workflow;
  const phase: WorkflowPhase = workflow?.phase ?? "preview";
  const previewGenerated = !!workflow?.previewGeneratedAt;

  const viewModel = useOverviewViewModel(briefData ?? null);

  // Before preview is generated, show empty state + generate CTA
  if (!previewGenerated) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border-2 border-dashed border-border bg-surface-1 p-8 text-center">
          <Search className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground mb-1">
            Let's start by understanding what this agent should do
          </h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-md mx-auto">
            We'll scan your documents and draft a summary in plain language.
            You can review and edit everything before running research.
          </p>
          {context?.onGeneratePreview && (
            <Button className="gap-2" onClick={context.onGeneratePreview}>
              <Search className="h-4 w-4" />
              Generate Preview
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Once preview exists, always show the summary — it progressively enriches
  if (!viewModel || !briefData) return null;

  return (
    <OverviewSummary
      viewModel={viewModel}
      data={briefData}
      phase={phase}
      onChange={onChange ? (d: any) => onChange(d) : () => {}}
      onUpdateSection={context?.onUpdateSection}
      onNavigateToSection={context?.onNavigateToSection}
    />
  );
};

export default OverviewSection;
