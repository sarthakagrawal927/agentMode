import os
import json
from openai import AsyncOpenAI
from typing import List
from pydantic import BaseModel


class RoleContext(BaseModel):
    title: str
    seniority: str
    typical_company_sizes: List[str]
    common_departments: List[str]


class Background(BaseModel):
    typical_experience_years: str
    required_skills: List[str]
    common_previous_roles: List[str]


class DailyWork(BaseModel):
    primary_responsibilities: List[str]
    key_stakeholders: List[str]
    common_meetings: List[str]
    typical_deliverables: List[str]


class Challenges(BaseModel):
    hair_on_fire_problems: List[str]
    common_frustrations: List[str]
    time_sinks: List[str]


class Tools(BaseModel):
    core_stack: List[str]
    common_workflows: List[str]
    tool_pain_points: List[str]


class Communication(BaseModel):
    common_phrases: List[str]
    technical_terms: List[str]
    writing_style_notes: List[str]


class SourceMetadata(BaseModel):
    research_timestamp: str
    sources_analyzed: List[str]
    confidence_score: str


class Persona(BaseModel):
    role_context: RoleContext
    background: Background
    daily_work: DailyWork
    challenges: Challenges
    tools: Tools
    communication: Communication
    source_metadata: SourceMetadata


client = AsyncOpenAI(
    api_key=os.environ.get("OPENAI_API_KEY"),  # This is the default and can be omitted
)


async def execute_chat_completion(userPrompt: str):
    print("Executing chat completion")
    resp = await client.beta.chat.completions.parse(
        messages=[
            {
                "role": "system",
                "content": "You are a consultant, great at analyzing data and finding patterns. I want you to analyze few linkedin profiles with their posts, some relevant job descriptions and some reddit posts related to an industry to create a persona to understand their problems and behaviour.",
                "additionalProperties": False,
            },
            {"role": "user", "content": userPrompt},
        ],
        model="gpt-4o-mini",
        response_format=Persona,
    )
    print("Chat completion executed")
    return json.loads(resp.choices[0].message.content)
