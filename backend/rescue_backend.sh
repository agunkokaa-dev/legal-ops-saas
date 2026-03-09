#!/bin/bash

echo "🚀 Starting Diagnostic Rescue for FastAPI Backend..."

# 1. Update and install required system packages
echo "📦 Installing python3-pip and python3-venv..."
sudo apt-update
sudo apt install -y python3-pip python3-venv

# 2. Re-create virtual environment to fix any broken paths
echo "♻️ Re-creating Virtual Environment..."
rm -rf venv
python3 -m venv venv

# 3. Activate the virtual environment
echo "🔌 Activating Virtual Environment..."
source venv/bin/activate

# 4. Install requirements including FastAPI and Uvicorn
echo "📥 Installing dependencies from requirements.txt..."
pip install -r requirements.txt
pip install fastapi uvicorn

# 5. Start the backend server
echo "✅ Starting FastAPI server..."
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
