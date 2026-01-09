#!/bin/bash

# Ultra Edge DRS - Simplified Version Launch Script
# Starts the server and opens the clean, focused interface

echo "🏏 Ultra Edge DRS - Simplified Audio Spike Detection"
echo "====================================================="
echo ""

# Check if Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3 first."
    exit 1
fi

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Kill existing servers
echo "🔍 Checking for existing servers..."
lsof -ti:8001 | xargs kill -9 2>/dev/null
sleep 1

# Start server
echo "🚀 Starting server on http://localhost:8001"
echo ""
python3 -m http.server 8001 &
SERVER_PID=$!

# Wait for server
sleep 2

# Open simplified version
echo "🌐 Opening Ultra Edge DRS (Simplified)..."
echo ""

if [[ "$OSTYPE" == "darwin"* ]]; then
    open http://localhost:8001/ultra-edge-simple.html
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    xdg-open http://localhost:8001/ultra-edge-simple.html 2>/dev/null
elif [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "win32" ]]; then
    start http://localhost:8001/ultra-edge-simple.html
fi

echo ""
echo "✅ Server is running!"
echo "📱 Access at: http://localhost:8001/ultra-edge-simple.html"
echo ""
echo "Features:"
echo "  • Clean two-column layout (Video + Waveform)"
echo "  • Real-time audio spike detection"
echo "  • High-frequency impact analysis"
echo "  • Sharp spike visualization"
echo ""
echo "Press Ctrl+C to stop"
echo ""

trap "echo ''; echo '🛑 Shutting down...'; kill $SERVER_PID 2>/dev/null; exit 0" INT

wait $SERVER_PID
