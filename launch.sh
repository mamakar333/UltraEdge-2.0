#!/bin/bash

# UltraEdge - Launch Script
# Starts the local server and opens the app in browser

echo "🏏 UltraEdge - Cricket Analysis System"
echo "=========================================="
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Kill any existing server on port 8001
echo "🔍 Checking for existing servers..."
lsof -ti:8001 | xargs kill -9 2>/dev/null
sleep 1

# Start the server
echo "🚀 Starting server on http://localhost:8001"
echo ""
python3 serve.py 8001 &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Open in default browser
echo "🌐 Opening UltraEdge in your browser..."
echo ""

# Detect OS and open browser accordingly
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open http://localhost:8001/
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open http://localhost:8001/ 2>/dev/null || \
    sensible-browser http://localhost:8001/ 2>/dev/null || \
    firefox http://localhost:8001/ 2>/dev/null
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    # Windows (Git Bash)
    start http://localhost:8001/
fi

echo ""
echo "✅ Server is running!"
echo "📱 Access the app at: http://localhost:8001/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Keep server running and handle Ctrl+C
trap "echo ''; echo '🛑 Shutting down server...'; kill $SERVER_PID 2>/dev/null; exit 0" INT

# Wait for server process
wait $SERVER_PID
