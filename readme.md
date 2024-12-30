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