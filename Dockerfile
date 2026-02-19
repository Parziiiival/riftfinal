FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose port (Fly.io uses 8080 by default)
EXPOSE 8080

# Run the application (PORT set by platform: Fly=8080, Render/Railway=$PORT)
CMD python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8080}
