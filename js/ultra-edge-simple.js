/**
 * Ultra Edge DRS - Simplified Audio Spike Detection
 *
 * ARCHITECTURE:
 * - Clean two-column interface: Video (left) + Waveform (right)
 * - Real-time audio analysis using Web Audio API
 * - High-frequency impact detection for bat-ball contact
 * - Synchronized waveform visualization
 *
 * FUTURE ENHANCEMENTS:
 * - Live stream support via MediaStream API (YouTube, OBS)
 * - WebRTC integration for remote streaming
 * - Real-time broadcast analysis
 */

class UltraEdgeSimple {
    constructor() {
        // DOM Elements
        this.video = document.getElementById('videoPlayer');
        this.canvas = document.getElementById('waveformCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.uploadOverlay = document.getElementById('uploadOverlay');
        this.videoControls = document.getElementById('videoControls');
        this.playPauseBtn = document.getElementById('playPauseBtn');
        this.timelineSlider = document.getElementById('timelineSlider');
        this.loadingOverlay = document.getElementById('loadingOverlay');

        // Status displays
        this.audioLevelDisplay = document.getElementById('audioLevel');
        this.peakFreqDisplay = document.getElementById('peakFreq');
        this.spikeIndicator = document.getElementById('spikeIndicator');
        this.currentTimeDisplay = document.getElementById('currentTime');
        this.durationDisplay = document.getElementById('duration');

        // Scrubbing state
        this.isScrubbing = false;
        this.currentSpeed = 1.0;

        // Audio Analysis (Web Audio API)
        this.audioContext = null;
        this.audioSource = null;
        this.analyser = null;
        this.dataArray = null;
        this.bufferLength = null;
        this.frequencyData = null;

        // Waveform visualization
        this.animationId = null;
        this.isAnalyzing = false;

        // Spike detection parameters
        this.spikeThreshold = 0.7; // Normalized threshold (0-1)
        this.highFreqThreshold = 3000; // Hz - bat-ball impacts are high frequency
        this.spikeHistory = [];
        this.maxSpikeHistory = 100;

        // Canvas setup
        this.setupCanvas();

        // Event listeners
        this.initEventListeners();

        console.log('🏏 Ultra Edge DRS initialized');
    }

    setupCanvas() {
        // High-DPI canvas setup
        const rect = this.canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        this.canvas.width = rect.width * dpr;
        this.canvas.height = rect.height * dpr;
        this.ctx.scale(dpr, dpr);

        this.canvasWidth = rect.width;
        this.canvasHeight = rect.height;

        // Resize listener
        window.addEventListener('resize', () => this.setupCanvas());
    }

    initEventListeners() {
        // File upload
        document.getElementById('videoFileInput').addEventListener('change', (e) => {
            this.loadVideo(e.target.files[0]);
        });

        // Play/Pause
        this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());

        // Timeline slider - scrubbing with audio
        this.timelineSlider.addEventListener('mousedown', () => this.startScrubbing());
        this.timelineSlider.addEventListener('touchstart', () => this.startScrubbing());
        this.timelineSlider.addEventListener('mouseup', () => this.endScrubbing());
        this.timelineSlider.addEventListener('touchend', () => this.endScrubbing());
        document.addEventListener('mouseup', () => this.endScrubbing());

        this.timelineSlider.addEventListener('input', (e) => {
            if (this.video.duration && !isNaN(this.video.duration)) {
                const time = (e.target.value / 100) * this.video.duration;
                this.video.currentTime = time;
            }
        });

        // Speed controls
        document.querySelectorAll('.speed-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setSpeed(e.target));
        });

        // Video events
        this.video.addEventListener('loadedmetadata', () => this.onVideoLoaded());
        this.video.addEventListener('play', () => this.onPlay());
        this.video.addEventListener('pause', () => this.onPause());
        this.video.addEventListener('timeupdate', () => this.onTimeUpdate());
        this.video.addEventListener('ended', () => this.onEnded());
        this.video.addEventListener('ratechange', () => this.onRateChange());

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (e.code === 'Space') {
                e.preventDefault();
                this.togglePlayPause();
            }
        });
    }

    startScrubbing() {
        this.isScrubbing = true;
        console.log('🎯 Started scrubbing');
        // Keep audio context active for scrubbing audio
    }

    endScrubbing() {
        this.isScrubbing = false;
        console.log('🎯 Ended scrubbing');
    }

    setSpeed(button) {
        const speed = parseFloat(button.dataset.speed);
        this.currentSpeed = speed;
        this.video.playbackRate = speed;

        // Update active button
        document.querySelectorAll('.speed-btn').forEach(btn => btn.classList.remove('active'));
        button.classList.add('active');

        console.log(`⏱ Speed set to ${speed}x`);
    }

    onRateChange() {
        console.log(`📊 Playback rate: ${this.video.playbackRate}x`);
    }

    async loadVideo(file) {
        if (!file) return;

        console.log('📹 Loading video:', file.name);
        this.loadingOverlay.classList.add('active');

        // Create object URL for video
        const videoURL = URL.createObjectURL(file);
        this.video.src = videoURL;

        // Wait for video to load
        this.video.onloadeddata = async () => {
            console.log('✅ Video loaded');
            await this.initAudioAnalysis();
            this.loadingOverlay.classList.remove('active');
        };
    }

    async initAudioAnalysis() {
        try {
            console.log('🎵 Initializing audio analysis...');

            // Create Audio Context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create source from video element
            this.audioSource = this.audioContext.createMediaElementSource(this.video);

            // Create analyser node
            this.analyser = this.audioContext.createAnalyser();

            // CRITICAL PARAMETERS for sharp spike detection
            this.analyser.fftSize = 4096; // Higher resolution for better frequency analysis
            this.analyser.smoothingTimeConstant = 0.0; // No smoothing for instant spike response
            this.analyser.minDecibels = -90;
            this.analyser.maxDecibels = -10;

            // Connect audio graph: Video -> Analyser -> Destination (speakers)
            this.audioSource.connect(this.analyser);
            this.analyser.connect(this.audioContext.destination);

            // Setup data arrays
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength); // Time domain
            this.frequencyData = new Uint8Array(this.bufferLength); // Frequency domain

            console.log('✅ Audio analysis initialized');
            console.log(`   FFT Size: ${this.analyser.fftSize}`);
            console.log(`   Frequency bins: ${this.bufferLength}`);
            console.log(`   Sample rate: ${this.audioContext.sampleRate} Hz`);

            // Hide upload overlay, show controls
            this.uploadOverlay.style.display = 'none';
            this.videoControls.style.display = 'block';

            // Start analysis immediately
            this.startAnalysis();

        } catch (error) {
            console.error('❌ Audio analysis initialization failed:', error);
            alert('Failed to initialize audio analysis. Please try again.');
        }
    }

    onVideoLoaded() {
        const duration = this.video.duration;
        this.durationDisplay.textContent = this.formatTime(duration);
        console.log(`📊 Video duration: ${duration.toFixed(2)}s`);
    }

    togglePlayPause() {
        if (this.video.paused) {
            this.video.play();
        } else {
            this.video.pause();
        }
    }

    onPlay() {
        this.playPauseBtn.textContent = '⏸';
        if (this.audioContext) {
            this.audioContext.resume(); // Resume audio context
        }
        this.startAnalysis();
    }

    onPause() {
        this.playPauseBtn.textContent = '▶';
        // Don't stop analysis on pause - keep waveform active
        // this.stopAnalysis();
    }

    onEnded() {
        this.playPauseBtn.textContent = '▶';
        this.stopAnalysis();
    }

    onTimeUpdate() {
        // Update timeline slider (only if not scrubbing to avoid jitter)
        if (!this.isScrubbing && this.video.duration && !isNaN(this.video.duration)) {
            const progress = (this.video.currentTime / this.video.duration) * 100;
            this.timelineSlider.value = progress;
        }

        // Update time display
        this.currentTimeDisplay.textContent = this.formatTime(this.video.currentTime);
    }


    startAnalysis() {
        if (this.isAnalyzing) return;

        this.isAnalyzing = true;
        console.log('▶️ Starting real-time audio analysis');
        this.analyze();
    }

    stopAnalysis() {
        this.isAnalyzing = false;
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        console.log('⏸ Stopped audio analysis');
    }

    analyze() {
        if (!this.isAnalyzing) return;

        // Get audio data
        this.analyser.getByteTimeDomainData(this.dataArray); // Waveform (time domain)
        this.analyser.getByteFrequencyData(this.frequencyData); // Spectrum (frequency domain)

        // Analyze for spikes
        const audioMetrics = this.analyzeAudioData();

        // Update displays
        this.updateDisplays(audioMetrics);

        // Draw waveform
        this.drawWaveform(audioMetrics);

        // Detect spikes (bat-ball impact)
        this.detectSpike(audioMetrics);

        // Continue animation loop
        this.animationId = requestAnimationFrame(() => this.analyze());
    }

    analyzeAudioData() {
        // Calculate RMS (Root Mean Square) for overall level
        let sum = 0;
        for (let i = 0; i < this.dataArray.length; i++) {
            const normalized = (this.dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / this.dataArray.length);

        // Calculate peak frequency and high-frequency energy
        let peakFreqBin = 0;
        let peakFreqValue = 0;
        let highFreqEnergy = 0;

        // Analyze frequency spectrum
        const nyquist = this.audioContext.sampleRate / 2;
        const freqPerBin = nyquist / this.bufferLength;

        for (let i = 0; i < this.frequencyData.length; i++) {
            const freq = i * freqPerBin;
            const magnitude = this.frequencyData[i];

            // Track peak frequency
            if (magnitude > peakFreqValue) {
                peakFreqValue = magnitude;
                peakFreqBin = i;
            }

            // Sum high-frequency energy (above threshold)
            // Bat-ball impacts have strong high-frequency components
            if (freq > this.highFreqThreshold) {
                highFreqEnergy += magnitude;
            }
        }

        const peakFrequency = peakFreqBin * freqPerBin;

        // Normalize high-frequency energy (0-1 range)
        const highFreqNormalized = Math.min(highFreqEnergy / 25500, 1.0); // 255 * 100 bins

        return {
            rms,
            peakFrequency,
            peakFreqValue,
            highFreqEnergy: highFreqNormalized,
            timestamp: this.video.currentTime
        };
    }

    detectSpike(metrics) {
        // SPIKE DETECTION ALGORITHM:
        // A bat-ball impact has:
        // 1. Sudden increase in amplitude (high RMS)
        // 2. Strong high-frequency content (>3kHz)
        // 3. Brief duration (transient)

        const isSpike = metrics.highFreqEnergy > this.spikeThreshold && metrics.rms > 0.3;

        if (isSpike) {
            // Visual indication
            this.spikeIndicator.classList.add('active');

            // Log spike
            console.log(`🔴 SPIKE DETECTED at ${metrics.timestamp.toFixed(2)}s - HF Energy: ${(metrics.highFreqEnergy * 100).toFixed(1)}%`);

            // Add to history
            this.spikeHistory.push({
                timestamp: metrics.timestamp,
                energy: metrics.highFreqEnergy,
                frequency: metrics.peakFrequency
            });

            // Limit history size
            if (this.spikeHistory.length > this.maxSpikeHistory) {
                this.spikeHistory.shift();
            }

            // Auto-remove active class after brief moment
            setTimeout(() => {
                this.spikeIndicator.classList.remove('active');
            }, 200);
        }
    }

    updateDisplays(metrics) {
        // Update audio level (convert RMS to dB)
        const dB = 20 * Math.log10(metrics.rms + 0.001);
        this.audioLevelDisplay.textContent = `${dB.toFixed(1)} dB`;

        // Update peak frequency
        this.peakFreqDisplay.textContent = `${Math.round(metrics.peakFrequency)} Hz`;
    }

    drawWaveform(metrics) {
        // Clear canvas
        this.ctx.fillStyle = '#000000';
        this.ctx.fillRect(0, 0, this.canvasWidth, this.canvasHeight);

        // Draw grid
        this.drawGrid();

        // Draw oscilloscope-style waveform
        this.drawOscilloscope();

        // Draw frequency spectrum overlay
        this.drawSpectrum();

        // Draw spike markers
        this.drawSpikeMarkers();
    }

    drawGrid() {
        this.ctx.strokeStyle = '#1a1a1a';
        this.ctx.lineWidth = 1;

        // Horizontal lines
        const gridLines = 8;
        for (let i = 0; i <= gridLines; i++) {
            const y = (i / gridLines) * this.canvasHeight;
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.canvasWidth, y);
            this.ctx.stroke();
        }

        // Vertical lines
        for (let i = 0; i <= gridLines; i++) {
            const x = (i / gridLines) * this.canvasWidth;
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.canvasHeight);
            this.ctx.stroke();
        }

        // Center line (stronger)
        this.ctx.strokeStyle = '#2a2a2a';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(0, this.canvasHeight / 2);
        this.ctx.lineTo(this.canvasWidth, this.canvasHeight / 2);
        this.ctx.stroke();
    }

    drawOscilloscope() {
        // Waveform in time domain (oscilloscope style)
        this.ctx.strokeStyle = '#00ff41';
        this.ctx.lineWidth = 2.5;
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#00ff41';

        this.ctx.beginPath();

        const sliceWidth = this.canvasWidth / this.dataArray.length;
        let x = 0;

        for (let i = 0; i < this.dataArray.length; i++) {
            // Normalize and amplify for visibility
            const v = ((this.dataArray[i] - 128) / 128.0) * 1.5;
            const y = (this.canvasHeight / 2) + (v * this.canvasHeight / 2);

            if (i === 0) {
                this.ctx.moveTo(x, y);
            } else {
                this.ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        this.ctx.stroke();
        this.ctx.shadowBlur = 0;
    }

    drawSpectrum() {
        // Frequency spectrum overlay (subtle bars in background)
        const barWidth = this.canvasWidth / this.frequencyData.length;
        let x = 0;

        for (let i = 0; i < this.frequencyData.length; i++) {
            const barHeight = (this.frequencyData[i] / 255) * (this.canvasHeight * 0.3);

            // Color based on frequency (high freq = red, low freq = blue)
            const hue = (i / this.frequencyData.length) * 120; // 0-120 (red to green)
            this.ctx.fillStyle = `hsla(${hue}, 100%, 50%, 0.1)`;

            this.ctx.fillRect(x, this.canvasHeight - barHeight, barWidth, barHeight);
            x += barWidth;
        }
    }

    drawSpikeMarkers() {
        // Draw recent spike markers on timeline
        this.ctx.fillStyle = '#ff3333';
        this.ctx.shadowBlur = 10;
        this.ctx.shadowColor = '#ff3333';

        for (const spike of this.spikeHistory) {
            // Calculate relative position
            const relativeTime = this.video.currentTime - spike.timestamp;

            // Only show spikes from last 5 seconds
            if (Math.abs(relativeTime) < 5) {
                // Position spike marker
                const xPos = this.canvasWidth / 2 - (relativeTime / 5) * (this.canvasWidth / 2);

                if (xPos >= 0 && xPos <= this.canvasWidth) {
                    this.ctx.beginPath();
                    this.ctx.arc(xPos, this.canvasHeight / 2, 5, 0, Math.PI * 2);
                    this.ctx.fill();
                }
            }
        }

        this.ctx.shadowBlur = 0;
    }

    formatTime(seconds) {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const app = new UltraEdgeSimple();
    window.ultraEdge = app; // Expose globally for debugging
});

/**
 * FUTURE ENHANCEMENTS - Live Stream Support
 *
 * To adapt this for live streams (YouTube, OBS, etc.):
 *
 * 1. MediaStream API Integration:
 *    - Replace video.src with getUserMedia() or getDisplayMedia()
 *    - Capture screen/window containing the live stream
 *    - Or capture direct audio stream from system audio
 *
 * 2. WebRTC for Remote Streams:
 *    - Connect to remote broadcast via RTCPeerConnection
 *    - Receive real-time media stream
 *    - Apply same audio analysis pipeline
 *
 * 3. YouTube Live Integration:
 *    - Use YouTube IFrame API to embed player
 *    - Capture audio via Web Audio API (may need CORS workaround)
 *    - Or use browser extension for system audio capture
 *
 * 4. OBS Integration:
 *    - OBS Browser Source can load this page
 *    - Use OBS audio routing to feed audio to analyser
 *    - Real-time overlay on live broadcast
 *
 * Example code structure for live stream:
 *
 * async initLiveStream() {
 *     // Capture screen/audio
 *     const stream = await navigator.mediaDevices.getDisplayMedia({
 *         video: true,
 *         audio: true
 *     });
 *
 *     // Create audio context from stream
 *     const audioSource = this.audioContext.createMediaStreamSource(stream);
 *     audioSource.connect(this.analyser);
 *
 *     // Set video source to stream
 *     this.video.srcObject = stream;
 * }
 */
