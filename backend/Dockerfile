# Use the official Python image from the Docker Hub
FROM python:3.12-slim

# Set the working directory in the container
WORKDIR /app

# Install system dependencies and Poetry
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
RUN curl -sSL https://install.python-poetry.org | python3 - && \
    ln -s /root/.local/bin/poetry /usr/local/bin/poetry

# Copy Poetry files and install deps
COPY pyproject.toml ./
COPY poetry.lock* ./
RUN poetry install --no-interaction --no-ansi --no-root

# Copy application code
COPY . .

# Document container port for runtime/proxy
EXPOSE 8000

# Run app via Poetry
CMD ["poetry", "run", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]