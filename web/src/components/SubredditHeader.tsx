import Link from "next/link";

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
    <div className="border rounded p-4 bg-white">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-2xl font-semibold">r/{info.name}</div>
          {info.title && <div className="text-sm text-gray-600">{info.title}</div>}
        </div>
        {info.url && (
          <Link href={info.url} target="_blank" className="text-sm text-blue-600 hover:underline">
            Open on Reddit
          </Link>
        )}
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


