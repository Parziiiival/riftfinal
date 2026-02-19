"""
Vercel serverless function entry point for FastAPI app.
Uses Mangum to adapt FastAPI (ASGI) to Vercel's serverless function format.
"""
import sys
import os

# Add parent directory to path so we can import backend modules
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.main import app
from mangum import Mangum

# Wrap FastAPI app with Mangum for Vercel serverless functions
handler = Mangum(app, lifespan="off")
