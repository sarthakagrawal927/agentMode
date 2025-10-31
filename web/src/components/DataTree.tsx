"use client";

interface DataTreeProps {
  data: any;
  title?: string;
}

function isPlainObject(value: any) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatPrimitive(value: any) {
  if (value === null) return <span className="text-gray-500 italic">null</span>;
  const type = typeof value;
  if (type === "string") return <span className="text-green-700">"{value}"</span>;
  if (type === "number") return <span className="text-blue-700">{value}</span>;
  if (type === "boolean") return <span className="text-purple-700">{String(value)}</span>;
  return <span className="text-gray-700">{String(value)}</span>;
}

function TreeNode({ value, name, isRoot = false }: { value: any; name?: string; isRoot?: boolean }) {
  if (isPlainObject(value)) {
    const entries = Object.entries(value as Record<string, any>);
    return (
      <details className="my-1" open={isRoot}>
        <summary className="cursor-pointer select-none font-mono text-sm text-gray-800">
          {name ? (
            <span className="text-gray-600">{name}: </span>
          ) : null}
          {"{"}
          <span className="text-gray-500">{entries.length}</span>
          {"}"}
        </summary>
        <div className="pl-4 ml-1 border-l border-gray-200">
          {entries.map(([key, val]) => (
            <TreeNode key={key} value={val} name={key} />
          ))}
        </div>
      </details>
    );
  }

  if (Array.isArray(value)) {
    const items = value as any[];
    return (
      <details className="my-1" open={isRoot}>
        <summary className="cursor-pointer select-none font-mono text-sm text-gray-800">
          {name ? (
            <span className="text-gray-600">{name}: </span>
          ) : null}
          [<span className="text-gray-500">{items.length}</span>]
        </summary>
        <div className="pl-4 ml-1 border-l border-gray-200">
          {items.map((item, idx) => (
            <TreeNode key={idx} value={item} name={String(idx)} />
          ))}
        </div>
      </details>
    );
  }

  return (
    <div className="font-mono text-sm text-gray-800 break-words whitespace-pre-wrap">
      {name ? <span className="text-gray-600">{name}: </span> : null}
      {formatPrimitive(value)}
    </div>
  );
}

export default function DataTree({ data, title }: DataTreeProps) {
  if (!data) return null;

  return (
    <div className="mt-6">
      <div className="flex items-center mb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>

      <div className="bg-gray-50 p-4 rounded border border-gray-200">
        <TreeNode value={data} isRoot />
      </div>
    </div>
  );
}


