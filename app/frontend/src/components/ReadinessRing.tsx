import { cn } from "@/lib/utils";

interface ReadinessRingProps {
  value: number;
  size?: number;
  className?: string;
}

const ReadinessRing = ({ value, size = 40, className }: ReadinessRingProps) => {
  const strokeWidth = 3;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (value / 100) * circumference;

  const color = value >= 80 ? "hsl(var(--success))" : value >= 50 ? "hsl(var(--warning))" : "hsl(var(--muted-foreground))";

  return (
    <div className={cn("relative inline-flex items-center justify-center", className)}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="hsl(var(--border))"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <span className="absolute text-[10px] font-semibold text-foreground">
        {value}%
      </span>
    </div>
  );
};

export default ReadinessRing;
