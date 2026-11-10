FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies first (caching)
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire backend folder (this fixes the missing 'permissions' and any other modules)
COPY backend/ ./backend/

# Create uploads folder if your app needs it
RUN mkdir -p uploads

EXPOSE 8080

# Run from the backend folder so relative imports work correctly
WORKDIR /app/backend

# Important: uvicorn looks for server:app inside the current working directory
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080} \
    --timeout-keep-alive 300 \
    --limit-max-requests 1000
