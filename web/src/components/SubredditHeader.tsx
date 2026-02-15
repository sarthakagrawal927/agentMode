import Link from "next/link";
import { ExternalLink, Users, Activity, Calendar } from "lucide-react";

type SubredditInfo = {
  name: string;
  title?: string;
  description?: string;
  subscribers?: number;
  activeUsers?: number;
  created?: string;
  nsfw?: boolean;
  url?: string;
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export default function SubredditHeader({ info }: { info: SubredditInfo }) {
  const createdText = info?.created ? new Date(info.created).toLocaleDateString() : undefined;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg shrink-0">
          {(info.name || 'r')[0].toUpperCase()}
        </div>
        <div className="min-w-0">
          {info.url ? (
            <Link
              href={info.url}
              target="_blank"
              aria-label={`Open r/${info.name} on Reddit`}
              className="inline-flex items-center gap-1.5 group"
            >
              <h1 className="text-2xl font-bold tracking-tight group-hover:underline">r/{info.name}</h1>
              <ExternalLink size={16} className="text-muted-foreground group-hover:text-foreground transition-colors" />
            </Link>
          ) : (
            <h1 className="text-2xl font-bold tracking-tight">r/{info.name}</h1>
          )}
          {info.title && <p className="text-sm text-muted-foreground truncate">{info.title}</p>}
        </div>
      </div>

      {info.description && (
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{info.description}</p>
      )}

      <div className="flex flex-wrap gap-4 text-sm">
        {typeof info.subscribers === "number" && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Users size={14} />
            <span>{formatNumber(info.subscribers)} members</span>
          </div>
        )}
        {typeof info.activeUsers === "number" && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Activity size={14} />
            <span>{formatNumber(info.activeUsers)} online</span>
          </div>
        )}
        {createdText && (
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar size={14} />
            <span>Created {createdText}</span>
          </div>
        )}
        {info.nsfw && (
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded-full">NSFW</span>
        )}
      </div>
    </div>
  );
}
