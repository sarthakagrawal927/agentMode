import csv
from jobspy import scrape_jobs
import pandas as pd
import os


# can do linkedin jobs via their api
# can do indeed - https://github.com/Eben001/IndeedJobScraper
def scrapeJobByRole(role: str):
    """
    Scrapes job listings for a given role from multiple job sites.

    Args:
        role (str): The job role to search for.

    Returns:
        list: A list of job listings matching the search criteria.

    The function uses the `scrape_jobs` function to fetch job listings from the following sites:
    - Indeed
    - LinkedIn
    - Glassdoor
    - Google

    Parameters for the `scrape_jobs` function:
    - site_name (list): List of job sites to scrape.
    - search_term (str): The job role to search for.
    - google_search_term (str): The job role to search for on Google.
    - results_wanted (int): Number of job listings to fetch.
    - enforce_annual_salary (bool): Whether to enforce annual salary in the results.
    - hours_old (int): Maximum age of job listings in hours.
    - linkedin_fetch_description (bool): Whether to fetch job descriptions from LinkedIn.
    """
    return scrape_jobs(
        site_name=["indeed", "linkedin", "glassdoor", "google"],
        search_term=role,
        google_search_term=role,
        # location="San Francisco, CA",
        results_wanted=20,
        enforce_annual_salary=True,
        hours_old=168,
        linkedin_fetch_description=True,
        # country_indeed="USA",
        # linkedin_fetch_description=True # gets more info such as description, direct job url (slower)
        # proxies=["208.195.175.46:65095", "208.195.175.45:65095", "localhost"],
    )


def seedJobsToExcel(roles):
    for role in roles:
        jobs = scrapeJobByRole(role)
        print(f"Found {len(jobs)} jobs")
        print(jobs)
        jobs.to_csv(
            f"job_{role}.csv",
            quoting=csv.QUOTE_NONNUMERIC,
            escapechar="\\",
            index=False,
        )  # to_excel


# "id", "site", "job_url", "job_url_direct", "title", "company", "location", "date_posted", "job_type", "salary_source", "interval", "min_amount", "max_amount", "currency", "is_remote", "job_level", "job_function", "listing_type", "emails", "description", "company_industry", "company_url", "company_logo", "company_url_direct", "company_addresses", "company_num_employees", "company_revenue", "company_description"
def readJobsFromExcel(role):
    jobs = pd.read_csv(f"job_{role}.csv")
    # find jobs that have description
    jobDescriptions = []
    for index, row in jobs.iterrows():
        if row["description"]:
            jobDescriptions.append(row["description"])

    return jobDescriptions


# seedJobsToExcel(["Software Engineer", "Product Manager"])


def getJobDescriptions(roles):
    seedJobsToExcel(roles)
    jobDescriptions = {role: [] for role in roles}
    for role in roles:
        jobDescriptions[role] = readJobsFromExcel(role)
    # delete the csv files
    # for role in roles:
    #     os.remove(f"job_{role}.csv")
    return jobDescriptions
