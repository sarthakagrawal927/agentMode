'use client';

import { PostHogProvider } from '@saas-maker/posthog-client';

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  return <PostHogProvider>{children}</PostHogProvider>;
}
