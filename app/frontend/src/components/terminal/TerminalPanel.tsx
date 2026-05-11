import { useRef, useCallback } from "react";
import { X, Minus, Plus, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTerminalStore, type TerminalSession } from "@/stores/terminalStore";
import { getTerminalWsUrl } from "@/lib/api";
import XTerminal from "./XTerminal";
import { cn } from "@/lib/utils";

const statusColors: Record<string, string> = {
  connecting: "text-warning animate-pulse",
  running: "text-success",
  stopped: "text-muted-foreground",
  error: "text-destructive",
};

const statusLabels: Record<string, string> = {
  connecting: "Connecting...",
  running: "Running",
  stopped: "Stopped",
  error: "Error",
};

const typeColors: Record<string, string> = {
  research: "bg-info/15 text-info",
  build: "bg-warning/15 text-warning",
  evaluate: "bg-success/15 text-success",
  copilot: "bg-emerald-500/15 text-emerald-400",
};

const TerminalPanel = () => {
  const { sessions, activeSessionId, panelOpen, panelWidth, setActiveSession, removeSession, setPanelOpen, setPanelWidth, addSession, openOrCreateCopilot } = useTerminalStore();
  const resizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(0);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      resizing.current = true;
      startX.current = e.clientX;
      startWidth.current = panelWidth;

      const handleMouseMove = (ev: MouseEvent) => {
        if (!resizing.current) return;
        const delta = startX.current - ev.clientX;
        setPanelWidth(startWidth.current + delta);
      };

      const handleMouseUp = () => {
        resizing.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [panelWidth, setPanelWidth]
  );

  if (sessions.length === 0) return null;

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div
      className="fixed top-14 right-0 bottom-0 z-40 flex border-l border-border bg-[#0a0e14] shadow-2xl transition-[width,transform] duration-200"
      style={{
        width: panelWidth,
        transform: panelOpen ? "translateX(0)" : "translateX(100%)",
        pointerEvents: panelOpen ? "auto" : "none",
      }}
    >
      {/* Resize handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/30 transition-colors z-50"
        onMouseDown={handleMouseDown}
      />

      <div className="flex flex-col flex-1 min-w-0">
        {/* Tab bar */}
        <div className="flex items-center border-b border-border/50 bg-[#0d1117]">
          <div className="flex-1 flex items-center overflow-x-auto scrollbar-none">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => setActiveSession(session.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 text-xs border-r border-border/30 shrink-0 transition-colors",
                  session.id === activeSessionId
                    ? "bg-[#0a0e14] text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-[#0a0e14]/50"
                )}
              >
                <Circle className={cn("h-2 w-2 fill-current", statusColors[session.status])} />
                {/* Show type badge for workflow and copilot sessions, not plain Claude terminals */}
                {session.type !== "system" && (
                  <span className={cn("inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium", typeColors[session.type])}>
                    {session.type}
                  </span>
                )}
                <span className="max-w-[100px] truncate">{session.agentName}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); removeSession(session.id); }}
                  className="ml-1 rounded p-0.5 hover:bg-muted/20"
                >
                  <X className="h-3 w-3" />
                </button>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 px-2 shrink-0">
            {activeSession && (
              <span className={cn("text-[10px] mr-2", statusColors[activeSession.status])}>
                {statusLabels[activeSession.status]}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
              onClick={async () => {
                const wsUrl = await getTerminalWsUrl();
                const session: TerminalSession = {
                  id: crypto.randomUUID(),
                  label: "Claude",
                  type: "system",
                  projectId: "system",
                  agentName: "Claude",
                  status: "connecting",
                  wsUrl,
                };
                addSession(session);
              }}
            >
              <Plus className="h-3 w-3" />
              Claude
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[10px] text-emerald-400/80 hover:text-emerald-400 gap-1"
              onClick={() => openOrCreateCopilot()}
            >
              <Plus className="h-3 w-3" />
              Copilot
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              onClick={() => setPanelOpen(false)}
            >
              <Minus className="h-3 w-3" />
            </Button>
          </div>
        </div>

        {/* Terminal area */}
        <div className="flex-1 p-1 overflow-hidden">
          {sessions.map((session) => (
            <XTerminal
              key={session.id}
              session={session}
              visible={session.id === activeSessionId}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default TerminalPanel;
