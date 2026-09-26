#!/bin/bash

# UltraEdge - macOS Double-Click Launcher
# Double-click this file to launch the app

# Get the directory where this script is located
cd "$(dirname "$0")"

# Kill existing servers
lsof -ti:8001 | xargs kill -9 2>/dev/null

# Start server
echo "🏏 Starting UltraEdge..."
python3 serve.py 8001 &
sleep 2

# Open browser
open http://localhost:8001/ultraedge.html

echo "✅ UltraEdge is running!"
echo "Close this window to stop the server"

# Keep running
wait
