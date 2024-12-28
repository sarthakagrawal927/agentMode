from linkedin_api import Linkedin
from os import getenv
from dotenv import load_dotenv
import json

load_dotenv()
# Authenticate using any Linkedin user account credentials
auth_email = getenv("AUTH_EMAIL")
auth_password = getenv("AUTH_PASSWORD")

if not auth_email or not auth_password:
    raise ValueError("AUTH_EMAIL and AUTH_PASSWORD environment variables must be set")

api = Linkedin(auth_email, auth_password)


class LinkedinProfile:
    def __init__(self, username):
        self.username = username
        self.setProfile()
        self.posts = self.getProfilePosts()

    def setProfile(self):
        # Get the profile using the username
        profile = api.get_profile(self.username)

        # Set the basic attributes
        self.name = profile["firstName"] + " " + profile["lastName"]
        self.industry = profile.get("industryName", "N/A")
        self.location = profile.get("geoLocationName", "N/A")
        self.tag = profile.get("headline", "N/A")
        self.bio = profile.get("summary", "N/A")

        # Collect past experiences
        self.pastexp = []
        for experience in profile.get("experience", []):
            exp_details = {
                "title": experience.get("title", "N/A"),
                "company": experience.get("companyName", "N/A"),
                "location": experience.get("locationName", "N/A"),
                "start_date": experience.get("timePeriod", {}).get("startDate", {}),
                "end_date": experience.get("timePeriod", {}).get("endDate", {}),
                "description": experience.get("description", "N/A"),
            }
            self.pastexp.append(exp_details)

        # Collect education details
        self.education = []
        for edu in profile.get("education", []):
            edu_details = {
                "school": edu.get("schoolName", "N/A"),
                "degree": edu.get("degreeName", "N/A"),
                "field_of_study": edu.get("fieldOfStudy", "N/A"),
                "start_year": edu.get("timePeriod", {})
                .get("startDate", {})
                .get("year", "N/A"),
                "end_year": edu.get("timePeriod", {})
                .get("endDate", {})
                .get("year", "N/A"),
                "activities": edu.get("activities", "N/A"),
            }
            self.education.append(edu_details)

        # Collect skills
        self.skills = [skill["name"] for skill in profile.get("skills", [])]

        # Collect languages
        self.languages = {
            lang["name"]: lang["proficiency"] for lang in profile.get("languages", [])
        }

        # Collect projects
        self.projects = []
        for project in profile.get("projects", []):
            proj_details = {
                "title": project.get("title", "N/A"),
                "description": project.get("description", "N/A"),
                "url": project.get("url", "N/A"),
                "start_date": project.get("timePeriod", {}).get("startDate", {}),
                "end_date": project.get("timePeriod", {}).get("endDate", {}),
            }
            self.projects.append(proj_details)

        # Collect volunteer experience
        self.volunteer = []
        for volunteer in profile.get("volunteer", []):
            volunteer_details = {
                "role": volunteer.get("role", "N/A"),
                "organization": volunteer.get("companyName", "N/A"),
                "start_date": volunteer.get("timePeriod", {}).get("startDate", {}),
                "end_date": volunteer.get("timePeriod", {}).get("endDate", {}),
                "description": volunteer.get("description", "N/A"),
            }
            self.volunteer.append(volunteer_details)

        # Collect additional details if available
        self.profile_picture = (
            profile.get("profilePictureOriginalImage", {})
            .get("com.linkedin.common.VectorImage", {})
            .get("artifacts", [{}])[0]
            .get("fileIdentifyingUrlPathSegment", "N/A")
        )
        self.public_id = profile.get("public_id", "N/A")
        self.languages_spoken = list(self.languages.keys())

    def getProfile(self):
        return {
            "name": self.name,
            "username": self.username,
            "industry": self.industry,
            "location": self.location,
            "tag": self.tag,
            "bio": self.bio,
            "pastexp": self.pastexp,
            "education": self.education,
            "skills": self.skills,
            "languages": self.languages,
            "projects": self.projects,
            "volunteer": self.volunteer,
            "profile_picture": self.profile_picture,
            "public_id": self.public_id,
            "languages_spoken": self.languages_spoken,
        }

    def getProfilePosts(self):
        posts = api.get_profile_posts(self.username)
        posts = list(map(lambda post: post["commentary"]["text"]["text"], posts))
        return posts


profile = LinkedinProfile("sarthakagrawal927")
print(json.dumps(profile.getProfile(), indent=4))