import { useState } from "react";
import { Copy, Check } from "lucide-react";
import SectionGuidelines from "./SectionGuidelines";
import { Button } from "@/components/ui/button";

const InstructionsSection = ({ data }: { data: any }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(data.systemPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-1">Instructions</h2>
        <p className="text-xs text-muted-foreground">System prompt defining agent behavior ({data.systemPrompt.length} / 8000 chars)</p>
        <SectionGuidelines sectionId="instructions" />
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-2 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">System Prompt</span>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{data.systemPrompt.length} chars</span>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={handleCopy}>
              {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy All"}
            </Button>
          </div>
        </div>
        <pre className="p-4 text-sm leading-relaxed text-foreground whitespace-pre-wrap font-mono text-xs overflow-y-auto max-h-[500px]">
          {data.systemPrompt}
        </pre>
      </div>
    </div>
  );
};

export default InstructionsSection;
