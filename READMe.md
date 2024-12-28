Take Home

Overview

A focused tool that generates structured persona data by analyzing public sources, designed specifically to serve as memory/context for AI agents mimicking professional personas. The system takes LinkedIn profiles and role descriptions as seeds, then enriches the persona through targeted web research.

Core Objectives
- Generate comprehensive persona data in a format optimal for AI agent consumption
- Complete MVP within 1 week
- Focus on quality of insights over quantity of sources
- Ensure data structure supports natural agent interactions
MVP Scope

Input Processing 

- Simple input form accepting:
- Role title/description (required)
- 1-3 sample LinkedIn profile URLs (optional)
- Industry context (optional)
- Basic input validation
- Profile text extraction


![](https://paper-attachments.dropboxusercontent.com/s_4E5084F936196446552B6BACEE4E9917B521777B4BE2EBF87B893508DCAEC38E_1734935766367_Screenshot+2024-12-23+at+12.04.31PM.png)


Data Collection

Target sources:

- LinkedIn profiles (via profile URLs)
- Top 3 job sites (Indeed, Glassdoor, LinkedIn Jobs)
- Search APIs
- Reddit (r/jobs, industry-specific subreddits)

Output Generation (Days 4-5)
Generate a structured JSON document with:

    json
    Copy
    {
      "persona": {
        "role_context": {
          "title": "",
          "seniority": "",
          "typical_company_sizes": [],
          "common_departments": []
        },
        "background": {
          "typical_experience_years": "",
          "required_skills": [],
          "common_previous_roles": []
        },
        "daily_work": {
          "primary_responsibilities": [],
          "key_stakeholders": [],
          "common_meetings": [],
          "typical_deliverables": []
        },
        "challenges": {
          "hair_on_fire_problems": [],
          "common_frustrations": [],
          "time_sinks": []
        },
        "tools": {
          "core_stack": [],
          "common_workflows": [],
          "tool_pain_points": []
        },
        "communication": {
          "common_phrases": [],
          "technical_terms": [],
          "writing_style_notes": []
        },
        "source_metadata": {
          "research_timestamp": "",
          "sources_analyzed": [],
          "confidence_score": ""
        }
      }
    }
