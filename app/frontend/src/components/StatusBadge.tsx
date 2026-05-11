import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusStyles: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  "in-progress": "bg-info/15 text-info",
  researched: "bg-info/15 text-info",
  ready: "bg-success/15 text-success",
  building: "bg-warning/15 text-warning",
  built: "bg-success/15 text-success",
  connected: "bg-success/15 text-success",
  pending: "bg-warning/15 text-warning",
  "not-started": "bg-muted text-muted-foreground",
  indexed: "bg-success/15 text-success",
  open: "bg-warning/15 text-warning",
  resolved: "bg-success/15 text-success",
  MVP: "bg-primary/15 text-primary",
  Future: "bg-muted text-muted-foreground",
};

const StatusBadge = ({ status, className }: StatusBadgeProps) => (
  <span className={cn(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize",
    statusStyles[status] || "bg-muted text-muted-foreground",
    className
  )}>
    {status.replace("-", " ")}
  </span>
);

export default StatusBadge;
