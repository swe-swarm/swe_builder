import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import TerminalPanel from "./components/terminal/TerminalPanel";

// Lazy-loaded route components for code splitting
const Index = lazy(() => import("./pages/Index"));
const ProjectPage = lazy(() => import("./pages/ProjectPage"));
const BriefEditor = lazy(() => import("./pages/BriefEditor"));
const DocumentViewer = lazy(() => import("./pages/DocumentViewer"));
const NotFound = lazy(() => import("./pages/NotFound"));

const App = () => (
  <TooltipProvider>
    <Toaster />
    <Sonner />
    <BrowserRouter>
      <Suspense fallback={<div className="flex h-screen items-center justify-center text-muted-foreground text-sm">Loading...</div>}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/project/:id" element={<ProjectPage />} />
          <Route path="/project/:projectId/agent/:agentId" element={<BriefEditor />} />
          <Route path="/project/:projectId/doc/:docId" element={<DocumentViewer />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
      <TerminalPanel />
    </BrowserRouter>
  </TooltipProvider>
);

export default App;
