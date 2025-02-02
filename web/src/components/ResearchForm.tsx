import { useState } from "react";
import { useToast } from "@/components/ui/use-toast";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api";
import { JsonViewer } from "./JsonViewer";

interface FormData {
  roleTitle: string;
  linkedinUrls: string[];
  industryContext: string;
}

const ResearchForm = () => {
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<FormData>({
    roleTitle: "",
    linkedinUrls: [""],
    industryContext: "",
  });
  const [responseData, setResponseData] = useState<JSON>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.roleTitle.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Role title/description is required",
      });
      return;
    }

    setIsLoading(true);

    try {
      const data = await api.research({
        role_title: formData.roleTitle,
        linkedin_urls: formData.linkedinUrls.filter(url => url.trim() !== ""),
        industry_context: formData.industryContext || null,
      });
      
      setResponseData(data);

      toast({
        title: "Success",
        description: "Research parameters submitted successfully",
      });

      // Reset form
      setFormData({
        roleTitle: "",
        linkedinUrls: [""],
        industryContext: "",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to submit research parameters",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLinkedInUrlChange = (index: number, value: string) => {
    const newUrls = [...formData.linkedinUrls];
    newUrls[index] = value;
    setFormData({ ...formData, linkedinUrls: newUrls });
  };

  const addLinkedInUrl = () => {
    if (formData.linkedinUrls.length < 3) {
      setFormData({
        ...formData,
        linkedinUrls: [...formData.linkedinUrls, ""],
      });
    }
  };

  const removeLinkedInUrl = (index: number) => {
    const newUrls = formData.linkedinUrls.filter((_, i) => i !== index);
    setFormData({ ...formData, linkedinUrls: newUrls });
  };

  return (
    <div className="form-container">
      <div>
        <h1 className="form-title">Research Parameters</h1>
        <p className="form-subtitle">
          Enter details about the persona you want to research
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="form-group">
          <label htmlFor="roleTitle" className="form-label">
            Role Title/Description<span className="required-star">*</span>
          </label>
          <textarea
            id="roleTitle"
            className="form-textarea"
            placeholder="e.g. Senior Product Manager at B2B SaaS companies"
            value={formData.roleTitle}
            onChange={(e) =>
              setFormData({ ...formData, roleTitle: e.target.value })
            }
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="linkedinUrls" className="form-label">
            LinkedIn Profile URLs (optional)
          </label>
          <textarea
            id="linkedinUrls"
            className="form-textarea"
            placeholder="Enter LinkedIn URLs, one per line"
            value={formData.linkedinUrls.join("\n")}
            onChange={(e) =>
              setFormData({ ...formData, linkedinUrls: e.target.value.split("\n") })
            }
          />
        </div>

        <div className="form-group">
          <label htmlFor="industryContext" className="form-label">
            Industry Context (optional)
          </label>
          <input
            type="text"
            id="industryContext"
            className="form-input"
            placeholder="e.g. Enterprise Software"
            value={formData.industryContext}
            onChange={(e) =>
              setFormData({ ...formData, industryContext: e.target.value })
            }
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
            "Start Research"
          )}
        </button>
      </form>

      {responseData && (
        <JsonViewer data={responseData} />
      )}
    </div>
  );
};

export default ResearchForm;