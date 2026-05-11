/**
 * Terminal session store — manages the right-side terminal panel.
 *
 * Sessions are per-agent (one tab per project+agent combo).
 * Research/Build/Evaluate buttons send commands to the agent's existing session.
 */
import { create } from "zustand";
import type { TerminalSession } from "@/types";
import { getTerminalWsUrl, getCopilotTerminalWsUrl } from "@/lib/api";

export type { TerminalSession } from "@/types";

// Registry of live WebSocket refs — XTerminal registers on connect, unregisters on unmount.
const wsRegistry = new Map<string, WebSocket>();
// Pending commands — queued when sendCommand is called before the WS is open.
const pendingCommands = new Map<string, string>();

export function registerSessionWs(sessionId: string, ws: WebSocket) {
  wsRegistry.set(sessionId, ws);
  // Flush any command that was queued before the WS opened
  const queued = pendingCommands.get(sessionId);
  if (queued && ws.readyState === WebSocket.OPEN) {
    pendingCommands.delete(sessionId);
    ws.send(JSON.stringify({ type: "command", text: queued }));
  }
}

export function unregisterSessionWs(sessionId: string) {
  wsRegistry.delete(sessionId);
  pendingCommands.delete(sessionId);
}

export function getSessionWs(sessionId: string): WebSocket | undefined {
  return wsRegistry.get(sessionId);
}

function createDefaultSession(): TerminalSession {
  // wsUrl will be resolved asynchronously before first use
  const port = parseInt(window.location.port || "8000", 10);
  return {
    id: "main-" + crypto.randomUUID(),
    label: "Terminal",
    type: "system" as const,
    projectId: "system",
    agentName: "Terminal",
    status: "connecting" as const,
    wsUrl: `ws://localhost:${port + 1}/ws`,
  };
}

interface TerminalStore {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  panelOpen: boolean;
  panelWidth: number;
  addSession: (session: TerminalSession) => void;
  removeSession: (id: string) => void;
  setActiveSession: (id: string) => void;
  /** Find existing session for a project+agent. Returns session ID or null. */
  findSession: (projectId: string, agentId: string) => string | null;
  updateSessionStatus: (id: string, status: TerminalSession["status"]) => void;
  setPanelOpen: (open: boolean) => void;
  setPanelWidth: (width: number) => void;
  openOrCreate: () => void;
  /** Open or create a Copilot CLI terminal session. */
  openOrCreateCopilot: () => void;
  /** Send a command to an existing session's WebSocket. */
  sendCommand: (sessionId: string, command: string) => void;
}

const defaultSession = createDefaultSession();

export const useTerminalStore = create<TerminalStore>((set, get) => ({
  sessions: [defaultSession],
  activeSessionId: defaultSession.id,
  panelOpen: false,
  panelWidth: 500,

  addSession: (session) =>
    set((s) => ({
      sessions: [...s.sessions, session],
      activeSessionId: session.id,
      panelOpen: true,
    })),

  findSession: (projectId, agentId) => {
    const key = `${projectId}-${agentId}`;
    const existing = get().sessions.find((s) => s.id.startsWith(key));
    return existing?.id ?? null;
  },

  removeSession: (id) => {
    wsRegistry.delete(id);
    set((s) => {
      const sessions = s.sessions.filter((sess) => sess.id !== id);
      const activeSessionId =
        s.activeSessionId === id
          ? sessions[sessions.length - 1]?.id ?? null
          : s.activeSessionId;
      return {
        sessions,
        activeSessionId,
        panelOpen: sessions.length > 0 ? s.panelOpen : false,
      };
    });
  },

  setActiveSession: (id) => set({ activeSessionId: id }),

  updateSessionStatus: (id, status) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, status } : sess
      ),
    })),

  setPanelOpen: (open) => {
    if (open) {
      get().openOrCreate();
    } else {
      set({ panelOpen: false });
    }
  },

  setPanelWidth: (width) => set({ panelWidth: Math.max(300, Math.min(900, width)) }),

  openOrCreate: () => {
    const { sessions } = get();
    if (sessions.length === 0) {
      const session = createDefaultSession();
      // Resolve actual terminal URL asynchronously and patch the session
      getTerminalWsUrl().then((url) => {
        set((s) => ({
          sessions: s.sessions.map((sess) =>
            sess.id === session.id ? { ...sess, wsUrl: url } : sess
          ),
        }));
      });
      set({ sessions: [session], activeSessionId: session.id, panelOpen: true });
    } else {
      set({ panelOpen: true });
    }
  },

  openOrCreateCopilot: () => {
    getCopilotTerminalWsUrl().then((url) => {
      const session: TerminalSession = {
        id: "copilot-" + crypto.randomUUID(),
        label: "Copilot",
        type: "copilot" as const,
        projectId: "system",
        agentName: "Copilot",
        status: "connecting" as const,
        wsUrl: url,
      };
      set((s) => ({
        sessions: [...s.sessions, session],
        activeSessionId: session.id,
        panelOpen: true,
      }));
    });
  },

  sendCommand: (sessionId, command) => {
    const ws = wsRegistry.get(sessionId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "command", text: command }));
    } else {
      // WS not open yet — queue so it's sent when registerSessionWs fires
      pendingCommands.set(sessionId, command);
    }
  },
}));
