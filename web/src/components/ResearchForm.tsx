"use client";

import { useState } from "react";
import { toast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { api } from "@/services/api";
import JsonViewer from "./JsonViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

interface FormData {
  roleTitle: string;
  linkedinUrls: string[];
  industryContext: string;
}

export default function ResearchForm() {
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
    <div className="max-w-2xl mx-auto p-6">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Research Parameters</h1>
        <p className="text-muted-foreground mt-2">
          Enter details about the persona you want to research
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="roleTitle">Role Title/Description</Label>
          <Input
            id="roleTitle"
            value={formData.roleTitle}
            onChange={(e) => setFormData({ ...formData, roleTitle: e.target.value })}
            placeholder="e.g., Senior Software Engineer"
            required
          />
        </div>

        <div className="space-y-4">
          <Label>LinkedIn Profile URLs (up to 3)</Label>
          {formData.linkedinUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => handleLinkedInUrlChange(index, e.target.value)}
                placeholder="LinkedIn profile URL"
              />
              {index > 0 && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => removeLinkedInUrl(index)}
                >
                  Remove
                </Button>
              )}
            </div>
          ))}
          {formData.linkedinUrls.length < 3 && (
            <Button
              type="button"
              variant="outline"
              onClick={addLinkedInUrl}
              className="w-full"
            >
              Add LinkedIn URL
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="industryContext">Industry Context (Optional)</Label>
          <Textarea
            id="industryContext"
            value={formData.industryContext}
            onChange={(e) => setFormData({ ...formData, industryContext: e.target.value })}
            placeholder="Add any relevant industry context..."
            rows={4}
          />
        </div>

        <Button type="submit" disabled={isLoading} className="w-full">
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Processing...
            </>
          ) : (
            "Submit"
          )}
        </Button>
      </form>

      {responseData && (
        <div className="mt-8">
          <JsonViewer data={responseData} title="Research Results" />
        </div>
      )}
    </div>
  );
}