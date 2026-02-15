'use client';

import { useFormHandler } from "@/hooks/use-form-handler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowRight, Loader2 } from "lucide-react";
import { useRouter } from 'next/navigation';

interface SubredditFormData {
  subreddit: string;
}

const SubredditForm = () => {
  const router = useRouter();
  const {
    formData,
    setFormData,
    isLoading,
    handleSubmit,
  } = useFormHandler<SubredditFormData>({
    initialData: { subreddit: "" },
    validateForm: (data) => {
      if (!data.subreddit.trim()) return "Subreddit name is required";
      return null;
    },
    onSubmit: async (data) => {
      router.push(`/r/${data.subreddit}/week`);
    },
    successMessage: "Redirecting to subreddit...",
  });

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2">
      <div className="relative flex-1">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">r/</span>
        <Input
          type="text"
          id="subreddit"
          className="pl-8 h-12 text-base rounded-xl border-2 focus-visible:ring-2"
          placeholder="Python, wallstreetbets, fitness..."
          value={formData.subreddit}
          onChange={(e) => setFormData({ subreddit: e.target.value })}
          disabled={isLoading}
        />
      </div>
      <Button
        type="submit"
        disabled={isLoading}
        size="lg"
        className="h-12 px-6 rounded-xl"
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
      </Button>
    </form>
  );
};

export default SubredditForm;
