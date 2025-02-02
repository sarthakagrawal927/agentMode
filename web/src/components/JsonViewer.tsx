interface JsonViewerProps {
  data: JSON;
  title?: string;
}

export const JsonViewer = ({ data, title = 'Response Data' }: JsonViewerProps) => {
  if (!data) return null;

  return (
    <div className="mt-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-[500px]">
        {JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
};
