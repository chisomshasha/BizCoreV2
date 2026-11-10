FROM python:3.11-slim

WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY . .

# Railway assigns its own port via $PORT — default to 8080 for local/non-Railway runs.
ENV PORT=8080
EXPOSE 8080

# Run the app (shell form so $PORT is expanded at container start)
CMD uvicorn server:app --host 0.0.0.0 --port ${PORT}
