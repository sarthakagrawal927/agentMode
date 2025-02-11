import { useState } from "react";

interface JsonViewerProps {
  data: any;
  title: string;
}

export default function JsonViewer({ data, title }: JsonViewerProps) {
  const [isFullscreen, setIsFullscreen] = useState(false);

  if (!data) return null;

  return (
    <div className="mt-6">
      <div className="flex justify-between items-center mb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <button
          onClick={() => setIsFullscreen(true)}
          className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
        >
          Expand
        </button>
      </div>

      <pre className="bg-gray-100 p-4 rounded overflow-auto max-h-[500px]">
        {JSON.stringify(data, null, 2)}
      </pre>

      {/* Fullscreen Modal */}
      {isFullscreen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg w-full h-full max-w-7xl max-h-[90vh] flex flex-col p-4">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">{title}</h2>
              <button
                onClick={() => setIsFullscreen(false)}
                className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded transition-colors"
              >
                Close
              </button>
            </div>
            <pre className="bg-gray-100 p-4 rounded overflow-auto flex-grow">
              {JSON.stringify(data, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
