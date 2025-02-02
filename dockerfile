# Use the official Python image from the Docker Hub
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container
COPY requirements.txt .

# Install the dependencies
RUN pip install --no-cache-dir -r requirements.txt
RUN pip install uvicorn

# Copy the .env file into the container
COPY .env .
COPY jobScraper.py .
COPY main.py .
COPY linkedinProfileExtractor.py .
COPY reddit.py .
COPY llm_api.py .

# Specify the command to run the application
CMD ["uvicorn", "main:app"]