from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl, constr
from typing import List, Optional
from fastapi.middleware.cors import CORSMiddleware
from linkedinProfileExtractor import LinkedinProfile
from urllib.parse import urlparse
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
        # Here you would typically:
        # 1. Process the input
        # 2. Extract data from LinkedIn profiles
        # 3. Generate research results

        # For now, we'll just echo back the received data
        linkedInProfiles = []
        for url in request.linkedin_urls:
            profile = LinkedinProfile(url.split("/")[4]).getProfile()
            linkedInProfiles.append(profile)
            print(json.dumps(profile))
        return {
            "status": "success",
            "message": "Research request received",
            "data": linkedInProfiles,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Test endpoint
@app.get("/")
async def read_root():
    return {"status": "API is running"}
