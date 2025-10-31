import { api } from "@/services/api";
import { useFormHandler } from "@/hooks/use-form-handler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";

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
      router.push(`/r/${data.subreddit}`);
    },
    successMessage: "Redirecting to subreddit...",
  });

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">Subreddit Research</CardTitle>
        <CardDescription>
          Enter a subreddit name to analyze its content and statistics
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="subreddit" className="text-sm font-medium">
              Subreddit Name <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-2.5 text-gray-500">r/</span>
              <Input
                type="text"
                id="subreddit"
                className="pl-7"
                placeholder="programming"
                value={formData.subreddit}
                onChange={(e) => setFormData({ subreddit: e.target.value })}
                disabled={isLoading}
              />
            </div>
            <p className="text-sm text-gray-500">
              Enter the name without "r/" prefix
            </p>
          </div>

          <Button 
            type="submit" 
            disabled={isLoading}
            className="w-full"
          >
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isLoading ? 'Analyzing...' : 'Analyze Subreddit'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default SubredditForm;
