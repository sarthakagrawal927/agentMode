import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api";
import { JsonViewer } from "./JsonViewer";

const SubredditForm = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [subreddit, setSubreddit] = useState("");
  const [responseData, setResponseData] = useState<JSON>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!subreddit.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Subreddit name is required",
      });
      return;
    }

    setIsLoading(true);

    try {
      const data = await api.subredditResearch({
        subreddit_name: subreddit,
      });

      setResponseData(data);

      toast({
        title: "Success",
        description: "Subreddit data fetched successfully",
      });

      // Reset form
      setSubreddit("");
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to fetch subreddit data",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="form-container">
      <div>
        <h1 className="form-title">Subreddit Research</h1>
        <p className="form-subtitle">
          Enter a subreddit name to analyze its content
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="form-group">
          <label htmlFor="subreddit" className="form-label">
            Subreddit Name<span className="required-star">*</span>
          </label>
          <input
            type="text"
            id="subreddit"
            className="form-input"
            placeholder="e.g. programming"
            value={subreddit}
            onChange={(e) => setSubreddit(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="submit-button"
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="animate-spin inline-block mr-2 h-4 w-4" />
              Processing...
            </>
          ) : (
            "Analyze Subreddit"
          )}
        </button>
      </form>

      {responseData && (
        <JsonViewer data={responseData} />
      )}
    </div>
  );
};

export default SubredditForm;
