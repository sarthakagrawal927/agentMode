# Reddit Reels Pipeline

**Created:** 2026-04-07
**Status:** Draft
**Goal:** Automated daily pipeline that fetches top Reddit posts and generates short-form video reels via reel-maker, ready for posting to TikTok/YouTube Shorts/Instagram Reels.

---

## Architecture Decision: Where Does This Live?

**Answer: A new `cli/` directory in reel-maker.**

Reasoning:
- AgentData is a deployed Cloudflare Worker — can't render video, can't run Remotion, wrong runtime entirely
- Reel-maker is a local CLI tool that already has batch generation — this is just a new content source
- The Reddit fetching is trivial (direct Reddit API or scraping) — doesn't need AgentData's infrastructure
- Keeps it simple: one repo, one `bun run reddit` command, one cron job

AgentData stays as the research/analytics tool. Reel-maker gets a new command that fetches Reddit content as input instead of AI-generated stories.

---

## Pipeline Overview

```
cron (daily) 
  → fetch top 5 posts from target subreddits (Reddit API / scraping)
  → filter & score (length, score, humor potential)
  → deduplicate against history (don't re-generate)
  → adapt post text → reel-maker script format
  → run reel-maker batch generation (images + TTS + render)
  → output MP4s to out/ directory
  → (future) auto-upload to platforms
```

---

## Phase 1: Reddit Content Fetcher (MVP)

**New file: `reel-maker/cli/reddit.ts`**

Responsibilities:
- Fetch top/hot posts from a curated list of subreddits
- No Reddit API key needed initially — use public JSON endpoints (`reddit.com/r/{sub}/hot.json`)
- Filter posts by: minimum score, text length (not too short, not too long for a reel), no media-only posts
- Output a `BatchEntry[]` compatible with existing `batch.ts`

Target subreddits (funny/story-driven):
```
r/tifu
r/AmItheAsshole
r/MaliciousCompliance
r/pettyrevenge
r/ProRevenge
r/entitledparents
r/TalesFromRetail
r/TalesFromTechSupport
r/relationship_advice (drama)
r/AskReddit (top-level stories only)
```

Post selection criteria:
- Score > 1000 (proven engagement)
- Text body 200-2000 characters (fits 30-90 second reel)
- Not a link/image/video post (text content only)
- Not already processed (check local history file)

### Script Adaptation

Current reel-maker expects `title` + `topic` → AI generates a 5-scene script. For Reddit posts, we skip the AI story generation and directly use the post content:

- **Title:** Paraphrased/shortened version of the post title (AI rewrites to avoid exact match)
- **Topic/Script:** The post body, paraphrased by AI into a narrative script (not verbatim copy — transforms for legal safety + better narration flow)
- **Scene count:** Dynamic based on post length (not hardcoded 5)

This means a small refactor to `cli.ts`'s `generateStory()` to accept pre-written scripts instead of always generating from scratch. Add a `--script` flag or a `--reddit` mode.

---

## Phase 2: Deduplication & History

**New file: `reel-maker/reddit-history.json`**

Simple JSON file tracking:
```json
{
  "processed": [
    {
      "redditId": "abc123",
      "subreddit": "tifu",
      "title": "...",
      "slug": "...",
      "processedAt": "2026-04-07T00:00:00Z",
      "posted": { "tiktok": false, "youtube": false, "instagram": false }
    }
  ]
}
```

Prevents re-generating reels for posts already processed. Checked before batch generation.

---

## Phase 3: Auto-Upload (Future)

Platform APIs for automated posting:

| Platform | API | Auth | Cost | Difficulty |
|---|---|---|---|---|
| TikTok | Content Posting API | OAuth2 | Free | Medium (approval required) |
| YouTube Shorts | YouTube Data API v3 | OAuth2 | Free (quota-based) | Easy (well-documented) |
| Instagram Reels | Instagram Graph API | Facebook OAuth | Free | Hard (business account required) |

**Recommendation:** Start with YouTube Shorts — best documented API, no approval needed, just quota limits. TikTok second. Instagram last (most friction).

For MVP, skip auto-upload entirely. Generate MP4s locally, post manually. Validate that the content gets views before automating distribution.

---

## Phase 4: Scheduling & Cron

**Local cron (launchd on macOS or simple node-cron):**

```bash
# Daily at 8am: fetch, generate, render
0 8 * * * cd ~/Desktop/reel-maker && bun run reddit --render
```

Or use `node-cron` inside a persistent script if the machine isn't always on.

**Future (if scaling):** Move to a cheap VPS (Hetzner $4/mo) with cron + headless Chromium for Remotion rendering.

---

## Implementation Tasks

### Must-have (get first reels out)
1. [ ] Add `cli/reddit.ts` — fetch top posts from Reddit public JSON endpoints
2. [ ] Add post filtering (score, length, text-only, dedup)
3. [ ] Add AI script adapter — paraphrase Reddit post into narration script (no verbatim copy)
4. [ ] Refactor `generateStory()` to accept pre-written scripts (skip AI story generation step)
5. [ ] Add `bun run reddit` command with `--subreddits`, `--count`, `--render` flags
6. [ ] Add `reddit-history.json` tracking to prevent re-processing
7. [ ] Test end-to-end: Reddit post → script → images → TTS → MP4

### Nice-to-have (after validation)
8. [ ] YouTube Shorts upload via API
9. [ ] TikTok Content Posting API integration
10. [ ] Cron job setup (local launchd or node-cron)
11. [ ] Better TTS (ElevenLabs or Fish Audio) for expressive narration
12. [ ] Post performance tracking (views, likes) to feed back into content selection
13. [ ] A/B test different visual styles (image-only vs i2v vs talking-head)

---

## Cost Estimate (Per Reel)

| Component | Provider | Cost |
|---|---|---|
| Reddit data | Public JSON | $0 |
| Script paraphrasing | Free Gateway (Gemini Flash) | $0 |
| Image generation | HuggingFace FLUX | $0 |
| TTS | Edge TTS | $0 |
| Video rendering | Local Remotion | $0 (CPU time) |
| **Total** | | **$0/reel** |

With upgrades:
- ElevenLabs TTS: ~$0.05-0.10/reel
- i2v video mode: ~$0.25/reel (Modal GPU)

---

## Open Questions

1. **How many reels per day?** Start with 3-5. Scale based on what gets views.
2. **Which platform first?** TikTok has best organic reach for new accounts. YouTube Shorts has best monetization. Post to both.
3. **Manual posting vs auto-upload?** Manual first. Don't build upload infra until you know the content works.
4. **Voice style?** Edge TTS is fine for MVP. If retention is bad because of robotic voice, upgrade to ElevenLabs.
5. **Branding?** No Reddit branding. No attribution. Generic channel name. Separate from AgentData entirely.
