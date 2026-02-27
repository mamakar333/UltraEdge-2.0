# VDO.ninja SDK Mode Setup Guide

## Overview

The **SDK Mode** is the **recommended way** to connect VDO.ninja streams to Ultra Edge DRS. It provides:

✅ **Direct MediaStream access** - no tab capture needed
✅ **Full audio extraction** - real-time audio analysis from the stream
✅ **Full video capture** - instant replay of actual video feed
✅ **No permission prompts** - seamless connection
✅ **No screen recording** - only captures the actual stream

## How It Works

### Traditional iframe Mode (OLD - Not Recommended)
```
Phone → VDO.ninja Server → Browser iframe → Tab Capture → Audio Analysis
                                ↓
                          Shows entire screen recording ❌
```

### SDK Mode (NEW - Recommended)
```
Phone → VDO.ninja Server → WebRTC P2P → Direct MediaStream → Audio Analysis
                                   ↓
                             Actual video feed ✅
```

## Setup Instructions

### Step 1: On Your Phone (Samsung with Saramonic Mic)

1. Open a browser on your phone
2. Go to: `https://vdo.ninja/?push=cricket-match-1&label=StumpMic`
3. Replace `cricket-match-1` with any room name you want
4. Grant microphone and camera permissions
5. The phone will start pushing audio+video to the room

**Phone URL Format:**
```
https://vdo.ninja/?push=ROOMNAME&label=STREAMLABEL
```

**Parameters:**
- `push=ROOMNAME` - The room name (must match on both phone and laptop)
- `label=STREAMLABEL` - Optional label for the stream
- Add `&webcam` if you want to use front/back camera
- Add `&screenshare` if you want to share screen instead

### Step 2: On Your Laptop

1. Open Ultra Edge DRS: `http://localhost:8001/live-mode.html`
2. Click **"SELECT SOURCE"** button
3. Choose **"VDO.ninja Remote Stream"**
4. **SDK Mode is selected by default** (recommended)
5. Enter the **same room name** as your phone (e.g., `cricket-match-1`)
6. Click **"Join Room"**
7. Wait for connection (you'll see "Waiting for phone to push...")
8. Once phone starts pushing, you'll see the video appear
9. Click **"START MONITORING"** to begin audio analysis

### Step 3: Using the Application

Once connected via SDK mode:

- **Video Display**: Live video from phone appears in the main video container
- **Audio Analysis**: Real-time waveform visualization and spike detection
- **DVR Scrubbing**: Drag the slider backward to review footage
- **Instant Replay**: Click the button to see last 2 minutes of actual video (not screen recording!)
- **No Tab Capture**: No browser permissions needed

## Comparison: SDK Mode vs iframe Mode

| Feature | SDK Mode ✅ | iframe Mode ❌ |
|---------|-----------|--------------|
| **Setup** | Enter room name | Paste full URL |
| **Permission Prompt** | None | Tab capture prompt |
| **Audio Access** | Direct | Via tab capture |
| **Video Access** | Direct stream | Screen recording |
| **Instant Replay** | Actual video feed | Browser tab recording |
| **Performance** | Better (P2P) | Slower (iframe overhead) |
| **Recommended** | ✅ YES | ⚠️ Legacy only |

## Troubleshooting

### "SDK stream not ready" Error
**Solution:** Make sure your phone is actually pushing to the room. Check that:
1. Phone URL has `?push=ROOMNAME` (not `?view=`)
2. Room name matches exactly on phone and laptop
3. Phone has granted camera/microphone permissions
4. Phone browser is still open and active

### No Video Appears
**Solution:**
1. Check browser console for errors (F12 → Console tab)
2. Verify both phone and laptop are on the same network (or have internet)
3. Try refreshing both phone and laptop pages
4. Try a different room name

### Audio Not Detected
**Solution:**
1. Make sure you clicked **"START MONITORING"** after connection
2. Check that your phone's microphone is working
3. Verify the Saramonic mic is connected properly to the phone
4. Check audio levels in the waveform visualizer

### Still Want to Use iframe Mode?
If you need to use iframe mode (legacy):

1. Click **"iframe Mode (Legacy)"** button in the source selection
2. On phone, use: `https://vdo.ninja/?view=STREAMID` or get the view link
3. Paste the full URL on laptop
4. Click "Connect"
5. When you start monitoring, you'll see the tab capture permission prompt
6. Select "Current Tab" and check "Share audio"

## Phone URL Examples

### Basic Push (Recommended)
```
https://vdo.ninja/?push=room123&label=StumpMic
```

### Push with Quality Settings
```
https://vdo.ninja/?push=room123&label=StumpMic&quality=1&audiobitrate=256
```

### Push with Specific Camera
```
https://vdo.ninja/?push=room123&webcam&rear
```

### Push Audio Only (No Video)
```
https://vdo.ninja/?push=room123&audioonly&label=StumpMic
```

## Technical Details

### What is the VDO.ninja SDK?

The SDK is a JavaScript library that handles WebRTC peer-to-peer connections directly in your browser without needing an iframe. It's the official way to integrate VDO.ninja into web applications.

**SDK Documentation:** https://sdk.vdo.ninja/

### How Does It Get the MediaStream?

1. Phone publishes stream to VDO.ninja signaling server
2. Laptop SDK joins the same room via WebRTC
3. Signaling server establishes P2P connection
4. Phone's MediaStream tracks flow directly to laptop
5. SDK fires 'track' events with audio/video tracks
6. Ultra Edge DRS receives the MediaStream and uses it for analysis

### Room Names and Privacy

- Room names are ephemeral - they exist only while someone is in them
- Use random/unique room names for privacy (e.g., `cricket-match-20260214-xyz`)
- No authentication needed - anyone with the room name can join
- Streams are end-to-end encrypted (DTLS/SRTP)

## Summary

**Use SDK Mode for the best experience:**
- ✅ No tab capture prompts
- ✅ Direct audio extraction
- ✅ Actual video instant replay
- ✅ Better performance
- ✅ Simpler setup

**Phone:** `https://vdo.ninja/?push=ROOMNAME`
**Laptop:** Enter same `ROOMNAME` in SDK mode and click "Join Room"

That's it! 🚀
