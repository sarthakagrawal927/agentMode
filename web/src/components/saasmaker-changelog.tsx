"use client";

import { ChangelogTimeline } from "@saas-maker/changelog-widget";
import "@saas-maker/changelog-widget/dist/index.css";

const API_KEY = process.env.NEXT_PUBLIC_SAASMAKER_API_KEY ?? "";
const API_BASE = "https://api.sassmaker.com";

export function SaaSMakerChangelog() {
  if (!API_KEY) return null;
  return <ChangelogTimeline projectId={API_KEY} apiBaseUrl={API_BASE} theme="dark" />;
}
