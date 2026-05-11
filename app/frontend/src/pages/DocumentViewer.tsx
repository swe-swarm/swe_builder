import { useParams, Link } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import Layout from "@/components/Layout";
import { useProjectStore } from "@/stores/projectStore";

const DocumentViewer = () => {
  const { projectId, docId } = useParams();
  const { documents, docContent, projectName, loadProject } = useProjectStore();

  useEffect(() => {
    if (projectId) loadProject(projectId);
  }, [projectId, loadProject]);

  const doc = documents.find((d) => d.id === docId);
  const content = doc ? docContent[doc.id] ?? "" : "";

  const renderCSV = (csv: string) => {
    const lines = csv.trim().split("\n");
    const headers = lines[0].split(",");
    const rows = lines.slice(1).map((l) => l.split(","));

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 hover:bg-surface-2">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 text-xs text-foreground">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  const renderMarkdown = (md: string) => {
    const lines = md.split("\n");
    return (
      <div className="prose-invert max-w-none space-y-2">
        {lines.map((line, i) => {
          if (line.startsWith("# "))
            return <h1 key={i} className="text-xl font-bold text-foreground mt-6 mb-2">{line.slice(2)}</h1>;
          if (line.startsWith("## "))
            return <h2 key={i} className="text-lg font-semibold text-foreground mt-5 mb-2">{line.slice(3)}</h2>;
          if (line.startsWith("### "))
            return <h3 key={i} className="text-sm font-semibold text-foreground mt-4 mb-1">{line.slice(4)}</h3>;
          if (line.startsWith("| ")) {
            const cells = line.split("|").filter(Boolean).map((c) => c.trim());
            if (cells.every((c) => /^-+$/.test(c))) return null;
            return (
              <div key={i} className="flex gap-4 text-xs text-muted-foreground border-b border-border/30 py-1">
                {cells.map((c, j) => (
                  <span key={j} className="flex-1">{c}</span>
                ))}
              </div>
            );
          }
          if (line.startsWith("- "))
            return <p key={i} className="text-sm text-muted-foreground pl-4">{line.slice(2)}</p>;
          if (line.trim() === "") return <div key={i} className="h-2" />;
          return <p key={i} className="text-sm leading-relaxed text-muted-foreground">{line}</p>;
        })}
      </div>
    );
  };

  if (!doc) {
    return (
      <Layout breadcrumbs={[{ label: projectName, href: `/project/${projectId}` }, { label: "Not Found" }]}>
        <div className="px-6 py-8 text-center">
          <p className="text-sm text-muted-foreground">Document not found.</p>
          <Link to={`/project/${projectId}`} className="text-sm text-primary hover:underline mt-2 inline-block">Back to project</Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout breadcrumbs={[
      { label: projectName, href: `/project/${projectId}` },
      { label: doc.name },
    ]}>
      <div className="px-6 py-8">
        <div className="mx-auto max-w-4xl">
          <div className="mb-6 flex items-center gap-3">
            <Link
              to={`/project/${projectId}`}
              className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{doc.name}</h1>
              <p className="text-xs text-muted-foreground">{doc.size}</p>
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-6">
            {content ? (
              doc.type === "csv" ? renderCSV(content) : renderMarkdown(content)
            ) : (
              <p className="text-sm text-muted-foreground">No content preview available.</p>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default DocumentViewer;
