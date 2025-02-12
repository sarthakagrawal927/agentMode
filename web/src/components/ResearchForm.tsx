"use client";

import { useFormHandler } from "@/hooks/use-form-handler";
import { api } from "@/services/api";
import JsonViewer from "./JsonViewer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

interface ResearchFormData {
  roleTitle: string;
  linkedinUrls: string[];
  industryContext: string;
}

export default function ResearchForm() {
  const {
    formData,
    setFormData,
    isLoading,
    responseData,
    handleSubmit,
  } = useFormHandler<ResearchFormData>({
    initialData: {
      roleTitle: "",
      linkedinUrls: [""],
      industryContext: "",
    },
    validateForm: (data) => {
      if (!data.roleTitle.trim()) return "Role title/description is required";
      return null;
    },
    onSubmit: async (data) => {
      return api.research({
        role_title: data.roleTitle,
        linkedin_urls: data.linkedinUrls.filter(url => url.trim() !== ""),
        industry_context: data.industryContext || null,
      });
    },
    successMessage: "Research data fetched successfully",
  });

  const addLinkedinUrl = () => {
    setFormData({
      ...formData,
      linkedinUrls: [...formData.linkedinUrls, ""],
    });
  };

  const removeLinkedinUrl = (index: number) => {
    setFormData({
      ...formData,
      linkedinUrls: formData.linkedinUrls.filter((_, i) => i !== index),
    });
  };

  const updateLinkedinUrl = (index: number, value: string) => {
    const newUrls = [...formData.linkedinUrls];
    newUrls[index] = value;
    setFormData({
      ...formData,
      linkedinUrls: newUrls,
    });
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
            disabled={isLoading}
          />
        </div>

        <div className="space-y-4">
          <Label>LinkedIn Profile URLs (up to 3)</Label>
          {formData.linkedinUrls.map((url, index) => (
            <div key={index} className="flex gap-2">
              <Input
                value={url}
                onChange={(e) => updateLinkedinUrl(index, e.target.value)}
                placeholder="LinkedIn profile URL"
                disabled={isLoading}
              />
              {formData.linkedinUrls.length > 1 && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => removeLinkedinUrl(index)}
                  disabled={isLoading}
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
              onClick={addLinkedinUrl}
              disabled={isLoading}
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
            disabled={isLoading}
          />
        </div>

        <Button type="submit" disabled={isLoading}>
          {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Submit
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