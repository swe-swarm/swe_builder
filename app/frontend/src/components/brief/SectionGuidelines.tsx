import { useState, useEffect } from "react";
import { Lightbulb, ChevronRight, CircleAlert, TriangleAlert } from "lucide-react";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { sectionGuidelines } from "@/config/sectionGuidelines";

const STORAGE_PREFIX = "brief-guidelines-";

interface Props {
  sectionId: string;
}

const SectionGuidelines = ({ sectionId }: Props) => {
  const guide = sectionGuidelines[sectionId];
  if (!guide) return null;

  const storageKey = `${STORAGE_PREFIX}${sectionId}`;

  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      return stored === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(open));
    } catch {
      // localStorage unavailable
    }
  }, [open, storageKey]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer select-none group">
        <Lightbulb className="h-3.5 w-3.5 text-amber-500" />
        <span className="font-medium">Guidelines</span>
        <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${open ? "rotate-90" : ""}`} />
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2">
        <div className="rounded-md border border-border/50 bg-muted/30 px-4 py-3 space-y-3 text-xs">
          {/* What this is */}
          <p className="text-muted-foreground leading-relaxed">{guide.what}</p>

          {/* Best practices */}
          <div>
            <h4 className="font-semibold text-foreground/80 mb-1 flex items-center gap-1">
              <Lightbulb className="h-3 w-3 text-amber-500" />
              Best practices
            </h4>
            <ul className="space-y-0.5 text-muted-foreground">
              {guide.bestPractices.map((bp, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-500/60" />
                  <span className="leading-relaxed">{bp}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Common mistakes */}
          <div>
            <h4 className="font-semibold text-foreground/80 mb-1 flex items-center gap-1">
              <TriangleAlert className="h-3 w-3 text-orange-500" />
              Common mistakes
            </h4>
            <ul className="space-y-0.5 text-muted-foreground">
              {guide.commonMistakes.map((cm, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-orange-500/60" />
                  <span className="leading-relaxed">{cm}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Tip (optional) */}
          {guide.tip && (
            <div className="flex items-start gap-1.5 rounded bg-primary/5 border border-primary/10 px-2.5 py-2">
              <CircleAlert className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
              <p className="text-muted-foreground leading-relaxed">
                <span className="font-semibold text-foreground/80">Tip: </span>
                {guide.tip}
              </p>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};

export default SectionGuidelines;
