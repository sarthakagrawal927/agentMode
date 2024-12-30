from dotenv import load_dotenv

load_dotenv()
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl, constr
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from linkedinProfileExtractor import LinkedinProfile
from jobScraper import getJobDescriptions
from reddit import get_top_posts_for_topic
from llm.api import execute_chat_completion
import json

app = FastAPI()

# Enable CORS for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ResearchRequest(BaseModel):
    role_title: str
    linkedin_urls: Optional[List[str]] = []  # Optional list of valid URLs
    industry_context: Optional[str] = None


@app.post("/api/research")
async def create_research(request: ResearchRequest):
    try:
        # find top posts for industry context
        reddit_top_posts = []
        if request.industry_context:
            reddit_top_posts = await get_top_posts_for_topic(request.industry_context)

        # Get LinkedIn profiles
        linkedInProfiles = []
        for url in request.linkedin_urls:
            profile = LinkedinProfile(url.split("/")[4])
            linkedInProfiles.append(profile.getProfile())

        # Get job descriptions
        jobDescriptions = getJobDescriptions([request.role_title])

        return {
            "status": "success",
            "message": "Research request received",
            "data": await execute_chat_completion(
                json.dumps(
                    {
                        "profiles": linkedInProfiles,
                        "jd": jobDescriptions,
                        "reddit": reddit_top_posts,
                    }
                )
            ),
        }
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail=str(e))


# Test endpoint
@app.get("/")
async def read_root():
    return {"status": "API is running"}
