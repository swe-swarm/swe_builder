import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Bug, Lightbulb, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useTerminalStore } from "@/stores/terminalStore";
import { useProjectStore } from "@/stores/projectStore";
import { useBriefStore } from "@/stores/briefStore";

interface FeedbackDialogProps {
  type: "bug" | "suggestion";
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function FeedbackDialog({ type, open, onOpenChange }: FeedbackDialogProps) {
  const [description, setDescription] = useState("");
  const location = useLocation();
  const { openOrCreate, sendCommand, sessions, activeSessionId } = useTerminalStore();
  const { projectId, projectName } = useProjectStore();
  const { agentId, agentName, buildStatus, evalPassRate } = useBriefStore();

  const isBug = type === "bug";
  const title = isBug ? "Report a Bug" : "Suggest a Feature";
  const placeholder = isBug
    ? "What went wrong? Describe what happened and what you expected..."
    : "What would you like to see added or improved?";

  // Build context chips from current app state
  const contextParts: { label: string; value: string }[] = [];
  if (projectName && projectId) {
    contextParts.push({ label: "Project", value: projectName });
  }
  if (agentName && agentId) {
    contextParts.push({ label: "Agent", value: agentName });
  }
  if (location.pathname !== "/") {
    contextParts.push({ label: "Page", value: location.pathname });
  }
  if (buildStatus?.status) {
    contextParts.push({ label: "Build", value: buildStatus.status });
  }
  if (evalPassRate) {
    contextParts.push({ label: "Eval", value: evalPassRate });
  }

  function handleSubmit() {
    if (!description.trim()) return;

    // Build context string for the terminal command
    const parts: string[] = [];
    for (const ctx of contextParts) {
      parts.push(`${ctx.label}: ${ctx.value}`);
    }
    parts.push(`User says: "${description.trim()}"`);
    const contextString = parts.join(" | ");

    const skill = isBug ? "/bug" : "/suggest";
    const command = `${skill} ${contextString}`;

    // Open terminal and send command (queued if WS not open yet)
    openOrCreate();
    const sessionId = useTerminalStore.getState().activeSessionId;
    if (sessionId) {
      sendCommand(sessionId, command);
    }

    // Reset and close
    setDescription("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isBug ? (
              <Bug className="h-4 w-4 text-destructive" />
            ) : (
              <Lightbulb className="h-4 w-4 text-yellow-500" />
            )}
            {title}
          </DialogTitle>
          <DialogDescription>
            {isBug
              ? "Describe the issue and Claude will create an ADO work item."
              : "Describe your idea and Claude will create an ADO work item."}
          </DialogDescription>
        </DialogHeader>

        {contextParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {contextParts.map((ctx) => (
              <Badge key={ctx.label} variant="secondary" className="text-xs">
                {ctx.label}: {ctx.value}
              </Badge>
            ))}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="feedback-description">Description</Label>
          <Textarea
            id="feedback-description"
            placeholder={placeholder}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                handleSubmit();
              }
            }}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!description.trim()}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Send to Terminal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
