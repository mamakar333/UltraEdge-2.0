# 🚀 Ultra Edge DRS - Launch Guide

This guide shows you how to launch and run the Ultra Edge Cricket DRS system.

---

## 🎯 Quick Start (Easiest Method)

### **macOS (Double-Click Method)**

1. **Navigate to the project folder** in Finder
2. **Double-click** the file: `launch.command`
3. The app will automatically:
   - Start the server
   - Open in your browser
4. **That's it!** The app is now running

To stop: Close the Terminal window that opened.

---

## 📋 Alternative Launch Methods

### **Method 1: Terminal Command**

```bash
# Navigate to project directory
cd /Users/prasanthkomaragiri/Documents/codebase/MacOs/ultra-edge-cricket

# Run the launch script
./launch.sh
```

**To stop:** Press `Ctrl+C` in the terminal

---

### **Method 2: Manual Launch**

```bash
# Navigate to project directory
cd /Users/prasanthkomaragiri/Documents/codebase/MacOs/ultra-edge-cricket

# Start Python server
python3 -m http.server 8001

# Open browser and go to:
# http://localhost:8001/video-mode.html
```

**To stop:** Press `Ctrl+C` in the terminal

---

### **Method 3: Background Server**

```bash
# Start server in background
cd /Users/prasanthkomaragiri/Documents/codebase/MacOs/ultra-edge-cricket
python3 -m http.server 8001 &

# Server will keep running in background
# Access at: http://localhost:8001/video-mode.html

# To stop later:
lsof -ti:8001 | xargs kill
```

---

## 🌐 Accessing the App

Once the server is running, open your browser and go to:

**Main App:**
- http://localhost:8001/video-mode.html (Video Analysis Mode)
- http://localhost:8001/live-mode.html (Live Stream Mode)
- http://localhost:8001/ (Mode Selection)

---

## 🔧 Troubleshooting

### **Problem: "Port 8001 already in use"**

**Solution:**
```bash
# Kill any process using port 8001
lsof -ti:8001 | xargs kill -9

# Then restart the server
./launch.sh
```

---

### **Problem: "Python not found"**

**Solution:**
```bash
# Check if Python 3 is installed
python3 --version

# If not installed, install Python 3:
# macOS: brew install python3
# Or download from: https://www.python.org/downloads/
```

---

### **Problem: Browser shows "This site can't be reached"**

**Solutions:**
1. Make sure the server is running (check terminal for "Serving HTTP")
2. Try: http://127.0.0.1:8001/video-mode.html instead
3. Clear browser cache (Cmd+Shift+R on Mac)
4. Try a different browser (Chrome, Safari, Firefox)

---

### **Problem: "Permission denied" when running scripts**

**Solution:**
```bash
# Make scripts executable
chmod +x launch.sh
chmod +x launch.command
```

---

## 📱 Using the App

### **Video Analysis Mode**
1. Click **"SELECT VIDEO FILE"**
2. Choose a cricket video (MP4, WebM, MOV)
3. Wait for video to load and audio to decode
4. Use controls:
   - Play/Pause
   - Scrub through timeline
   - Adjust sensitivity for spike detection
   - Analyze decisions

### **Live Stream Mode**
1. Allow microphone access when prompted
2. Enable webcam if needed
3. Real-time audio monitoring
4. Spike detection during live play

---

## 🎨 Features

- ✅ **Real-time waveform visualization**
- ✅ **Spike detection** (bat-ball contact)
- ✅ **Frame-by-frame analysis**
- ✅ **Slow-motion playback**
- ✅ **Decision review system**
- ✅ **AI enhancement** (when models available)
- ✅ **Hot-spot overlay**
- ✅ **Ball tracking**

---

## 🛑 Stopping the Server

**If launched with scripts:**
- Press `Ctrl+C` in the terminal
- Or close the Terminal window

**If running in background:**
```bash
lsof -ti:8001 | xargs kill
```

---

## 💡 Tips

1. **Use Chrome or Safari** for best performance
2. **Allow microphone access** for audio analysis
3. **Use videos with clear audio** for better spike detection
4. **Adjust sensitivity slider** if spikes are too sensitive or not detecting
5. **Hard refresh** (Cmd+Shift+R) if changes don't appear

---

## 📦 Next Steps

### **Package as Desktop App** (Advanced)

Want a standalone app? Follow the Electron guide to create:
- macOS .app
- Windows .exe
- Linux AppImage

See: `ELECTRON_BUILD.md` (coming soon)

---

## 🏏 Enjoy Your Cricket Analysis!

The Ultra Edge DRS system is now ready to use. Upload your cricket videos and start analyzing!

For questions or issues, check the main README.md or create an issue.

---

**Happy Analyzing! 🎯📊**
