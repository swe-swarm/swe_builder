import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useTerminalStore, registerSessionWs, unregisterSessionWs, type TerminalSession } from "@/stores/terminalStore";

interface XTerminalProps {
  session: TerminalSession;
  visible: boolean;
}

const XTerminal = ({ session, visible }: XTerminalProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const updateStatus = useTerminalStore((s) => s.updateSessionStatus);

  const connect = useCallback(() => {
    if (wsRef.current) return;

    updateStatus(session.id, "connecting");
    const ws = new WebSocket(session.wsUrl);
    wsRef.current = ws;

    // Timeout: if no onopen within 10s, treat as error
    const connectTimeout = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        updateStatus(session.id, "error");
        termRef.current?.writeln(`\r\n\x1b[31m● Connection timed out — is the terminal server running on ${session.wsUrl}?\x1b[0m`);
        try { ws.close(); } catch {}
        wsRef.current = null;
      }
    }, 10000);

    ws.onopen = () => {
      clearTimeout(connectTimeout);
      updateStatus(session.id, "running");
      registerSessionWs(session.id, ws);

      const term = termRef.current;
      const cols = term?.cols ?? 120;
      const rows = term?.rows ?? 30;

      if (session.command) {
        // Send command — server spawns Claude Code and queues the command
        ws.send(JSON.stringify({ type: "command", text: session.command, cols, rows }));
      } else {
        // Just spawn Claude Code
        ws.send(JSON.stringify({ type: "init", cols, rows }));
      }
    };

    ws.onmessage = (event) => {
      termRef.current?.write(event.data);
    };

    ws.onerror = () => {
      clearTimeout(connectTimeout);
      updateStatus(session.id, "error");
      termRef.current?.writeln(`\r\n\x1b[31m● Connection error — is the terminal server running on ${session.wsUrl}?\x1b[0m`);
    };

    ws.onclose = () => {
      clearTimeout(connectTimeout);
      updateStatus(session.id, "stopped");
      termRef.current?.writeln(`\r\n\x1b[33m● Disconnected\x1b[0m`);
      wsRef.current = null;
    };
  }, [session.id, session.wsUrl, updateStatus]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      lineHeight: 1.4,
      theme: {
        background: "#0a0e14",
        foreground: "#b3b1ad",
        cursor: "#e6b450",
        selectionBackground: "#253340",
        black: "#01060e",
        red: "#ea6c73",
        green: "#91b362",
        yellow: "#f9af4f",
        blue: "#53bdfa",
        magenta: "#fae994",
        cyan: "#90e1c6",
        white: "#c7c7c7",
        brightBlack: "#686868",
        brightRed: "#f07178",
        brightGreen: "#c2d94c",
        brightYellow: "#ffb454",
        brightBlue: "#59c2ff",
        brightMagenta: "#ffee99",
        brightCyan: "#95e6cb",
        brightWhite: "#ffffff",
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);

    termRef.current = term;
    fitRef.current = fitAddon;

    // Forward keystrokes from xterm to the WebSocket (PTY)
    term.onData((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Forward binary data (for things like ctrl+c)
    term.onBinary((data) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Initial fit
    requestAnimationFrame(() => {
      try { fitAddon.fit(); } catch {}
    });

    // Connect WebSocket
    connect();

    return () => {
      unregisterSessionWs(session.id);
      wsRef.current?.close();
      wsRef.current = null;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [connect]);

  // Refit on visibility change
  useEffect(() => {
    if (visible && fitRef.current) {
      requestAnimationFrame(() => {
        try { fitRef.current?.fit(); } catch {}
      });
    }
  }, [visible]);

  // Resize observer — refit terminal and notify server of new dimensions
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(() => {
      if (visible && fitRef.current) {
        try {
          fitRef.current.fit();
          // Notify server of new terminal size
          const term = termRef.current;
          const ws = wsRef.current;
          if (term && ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "resize", cols: term.cols, rows: term.rows }));
          }
        } catch {}
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [visible]);

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{ display: visible ? "block" : "none" }}
    />
  );
};

export default XTerminal;
