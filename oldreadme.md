# Agentic Data agregator

## Tools Used
- openai
- jobspy (jobs)
- praw (reddit)
- linkedin_api
- lovable (web)

Tried & discarded many other tools (mostly in scraping)

## Planned tools for search
- https://github.com/Nv7-GitHub/googlesearch
- https://github.com/MarioVilas/googlesearch
- serpapi
- https://github.com/searxng/searxng

## Views
- The code is pretty badly written, but it works.
- Since this is essentially an optimization problems - it is best to rely on tools that are already optimized for the task. Specially if that is not the moat and time is of essence.
- A lot (way more) data can be asked, collected, preprocessed (sub gpt calls maybe) before making the final call. This is just a basic MVP.

## How to Run

### Install dependencies
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt


cd web
nvm use 20 && npm install
```

Create & fill the .env

### Running
```bash
uvicorn main:app --reload

cd web && npm run dev
```

## Sample Input
```json
{
  "roleTitleDescription": "Sales Rep",
  "linkedinProfileUrls": [
    "https://www.linkedin.com/in/stephenbklein/",
    "https://www.linkedin.com/in/abhishekkumariiima/",
    "https://www.linkedin.com/in/udayparmar/"
  ],
  "industryContext": "Sales & Marketing"
}
```

## Sample Output
```json
{
  "status": "success",
  "message": "Research request received",
  "data": {
    "role_context": {
      "title": "CEO",
      "seniority": "Executive",
      "typical_company_sizes": [
        "Small",
        "Medium",
        "Large"
      ],
      "common_departments": [
        "Product Development",
        "Sales",
        "Marketing"
      ]
    },
    "background": {
      "typical_experience_years": "15+",
      "required_skills": [
        "Leadership",
        "Strategic Planning",
        "Data Analysis",
        "Sales and Marketing"
      ],
      "common_previous_roles": [
        "Co-Founder",
        "C-Level Executive",
        "Marketing Director"
      ]
    },
    "daily_work": {
      "primary_responsibilities": [
        "Oversee company strategy",
        "Build partnerships",
        "Manage overall operations",
        "Drive sales and marketing initiatives"
      ],
      "key_stakeholders": [
        "Investors",
        "Employees",
        "Clients",
        "Partners"
      ],
      "common_meetings": [
        "Board meetings",
        "Sales strategy sessions",
        "Product development reviews"
      ],
      "typical_deliverables": [
        "Business growth reports",
        "Strategic plans",
        "Marketing campaigns"
      ]
    },
    "challenges": {
      "hair_on_fire_problems": [
        "Navigating rapid market changes",
        "Recruiting and retaining talent",
        "Building a cohesive company culture"
      ],
      "common_frustrations": [
        "Slow decision-making from stakeholders",
        "Misalignment within departments",
        "Dealing with financial constraints"
      ],
      "time_sinks": [
        "Endless meetings with limited outcomes",
        "Administrative tasks overshadowing strategic planning",
        "Client retention and relationship management"
      ]
    },
    "tools": {
      "core_stack": [
        "CRM Software (e.g., Salesforce)",
        "Project Management Tools (e.g., Asana)",
        "Data Analytics Tools (e.g., Tableau)"
      ],
      "common_workflows": [
        "Lead generation and conversion",
        "Client relationship management",
        "Sales forecasting and analysis"
      ],
      "tool_pain_points": [
        "Complexity in CRM usage",
        "Overlapping tools leading to confusion",
        "Difficulty in tracking team performance"
      ]
    },
    "communication": {
      "common_phrases": [
        "Let's think outside the box",
        "Data-driven decisions",
        "Aligning our vision for success"
      ],
      "technical_terms": [
        "KPIs",
        "ROI",
        "Market Segmentation",
        "Lead Conversion Rate"
      ],
      "writing_style_notes": [
        "Conversational yet professional tone",
        "Use of informal anecdotes to connect with audience",
        "Clear and concise with actionable insights"
      ]
    },
    "source_metadata": {
      "research_timestamp": "2023-10-01",
      "sources_analyzed": [
        "LinkedIn Posts",
        "Job Descriptions",
        "Industry-specific Reddit Discussions"
      ],
      "confidence_score": "High"
    }
  }
}
```

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
