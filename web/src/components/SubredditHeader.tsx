import Link from "next/link";
import { ExternalLink } from "lucide-react";

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

export default function SubredditHeader({ info }: { info: SubredditInfo }) {
  const createdText = info?.created ? new Date(info.created).toLocaleDateString() : undefined;
  return (
    <div>
      <div className="flex items-start">
        <div>
          {info.url ? (
            <Link
              href={info.url}
              target="_blank"
              aria-label={`Open r/${info.name} on Reddit`}
              className="inline-flex items-center gap-2 group"
            >
              <span className="text-2xl font-semibold group-hover:underline">r/{info.name}</span>
              <ExternalLink size={18} className="text-gray-500 group-hover:text-gray-700" />
            </Link>
          ) : (
            <div className="text-2xl font-semibold">r/{info.name}</div>
          )}
          {info.title && <div className="text-sm text-gray-600">{info.title}</div>}
        </div>
      </div>
      {info.description && (
        <p className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{info.description}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-600">
        {typeof info.subscribers === "number" && <span>Subscribers: {info.subscribers.toLocaleString()}</span>}
        {typeof info.activeUsers === "number" && <span>Active: {info.activeUsers.toLocaleString()}</span>}
        {createdText && <span>Created: {createdText}</span>}
        {info.nsfw && <span className="text-red-600">NSFW</span>}
      </div>
    </div>
  );
}


