import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { FolderOpen, ChevronRight, Bug, Lightbulb, Terminal } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { useTerminalStore } from "@/stores/terminalStore";
import FeedbackDialog from "@/components/FeedbackDialog";

interface LayoutProps {
  children: React.ReactNode;
  breadcrumbs?: { label: string; href?: string }[];
}

const Layout = ({ children, breadcrumbs }: LayoutProps) => {
  const location = useLocation();
  const { panelOpen, panelWidth, setPanelOpen, sessions } = useTerminalStore();
  const [feedbackType, setFeedbackType] = useState<"bug" | "suggestion">("bug");
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex h-14 items-center px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <img src="/mcs_builder.png" alt="MCS Agent Builder" className="h-[26px] w-[26px]" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              MCS Agent Builder
            </span>
          </Link>

          {breadcrumbs && breadcrumbs.length > 0 && (
            <nav className="ml-6 flex items-center gap-1.5 text-sm">
              {breadcrumbs.map((crumb, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                  {crumb.href ? (
                    <Link to={crumb.href} className="text-muted-foreground transition-colors hover:text-foreground">
                      {crumb.label}
                    </Link>
                  ) : (
                    <span className="text-foreground">{crumb.label}</span>
                  )}
                </span>
              ))}
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => { setFeedbackType("bug"); setFeedbackOpen(true); }}
            >
              <Bug className="h-3.5 w-3.5" /> Bug
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-warning"
              onClick={() => { setFeedbackType("suggestion"); setFeedbackOpen(true); }}
            >
              <Lightbulb className="h-3.5 w-3.5" /> Suggest
            </Button>
            <Button
              variant={panelOpen ? "secondary" : "ghost"}
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setPanelOpen(!panelOpen)}
            >
              <Terminal className="h-3.5 w-3.5" />
              Terminal
              {sessions.length > 0 && (
                <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-[10px] font-medium text-primary">
                  {sessions.length}
                </span>
              )}
            </Button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main
        className="animate-fade-in transition-[margin] duration-200"
        style={{ marginRight: panelOpen ? panelWidth : 0 }}
      >
        {children}
      </main>

      <FeedbackDialog type={feedbackType} open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
};

export default Layout;
