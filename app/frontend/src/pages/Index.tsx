import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Loader2 } from "lucide-react";
import Layout from "@/components/Layout";
import ProjectCard from "@/components/ProjectCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useProjectsStore } from "@/stores/projectsStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const Index = () => {
  const navigate = useNavigate();
  const { projects, loading, load, createProject, deleteProject } = useProjectsStore();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const id = await createProject(name.trim());
      setName("");
      setDescription("");
      setOpen(false);
      navigate(`/project/${id}`);
    } catch {
      // Toast or error handling could go here
    } finally {
      setCreating(false);
    }
  };

  return (
    <Layout>
      <div className="px-6 py-8">
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Projects</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Design and build AI agents for Microsoft Copilot Studio
            </p>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New Project
          </Button>
        </div>

        {loading && projects.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Loading projects...
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20 text-muted-foreground text-sm">
            <p>No projects yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} onDelete={deleteProject} />
            ))}
          </div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Project</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Project Name</label>
              <Input
                placeholder="e.g. Customer Support Agent"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Description</label>
              <Textarea
                placeholder="What will this agent do?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} disabled={!name.trim() || creating}>
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Create Project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
};

export default Index;
