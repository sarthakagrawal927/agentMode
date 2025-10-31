"use client";

import ResearchForm from "@/components/ResearchForm";
import SubredditForm from "@/components/SubredditForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function OldResearchHome() {
  return (
    <main className="container mx-auto p-8">
      <h1 className="text-4xl font-bold mb-8">Research Assistant (Archived)</h1>

      <Tabs defaultValue="research" className="w-full">
        <TabsList>
          <TabsTrigger value="research">Role Research</TabsTrigger>
          <TabsTrigger value="subreddit">Subreddit Research</TabsTrigger>
        </TabsList>

        <TabsContent value="research">
          <div className="mt-4">
            <ResearchForm />
          </div>
        </TabsContent>

        <TabsContent value="subreddit">
          <div className="mt-4">
            <SubredditForm />
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}


