/**
 * VideoSync Class
 * Synchronizes video playback with audio analysis and waveform visualization
 * Provides frame-accurate sync between video and audio timeline
 */

class VideoSync {
    constructor(videoElement) {
        this.video = videoElement;
        this.audioContext = null;
        this.audioSource = null;
        this.analyser = null;

        // Sync state
        this.isSynced = false;
        this.syncOffset = 0; // Offset in milliseconds
        this.currentFrame = 0;
        this.totalFrames = 0;
        this.fps = 30; // Default FPS, will be detected

        // Filter chain nodes (same stages as AudioProcessor)
        this.highPassFilter = null;
        this.notchFilter = null;
        this.notchFilter2 = null;
        this.notchFilter3 = null;
        this.bandPassFilter = null;
        this.workletNode = null;
        this.compressor = null;

        // Audio buffers
        this.audioBuffer = null; // Decoded audio buffer for entire video
        this.audioData = new Uint8Array(2048);
        this.frequencyData = new Uint8Array(2048);
        this.offlineAudioBuffer = null; // For scrubbing

        // Callbacks
        this.onTimeUpdate = null;
        this.onFrameUpdate = null;
        this.onAudioData = null;
        this.onSyncStateChange = null;

        // RAF handle
        this.rafId = null;

        // Scrubbing state
        this.isLoading = false;
    }

    /**
     * Initialize video-audio sync
     */
    async initialize() {
        try {
            // Create audio context
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Create media element source from video
            this.audioSource = this.audioContext.createMediaElementSource(this.video);

            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.1; // Reduced for sharper spikes (was 0.3)

            // Build filter chain and connect audio graph
            await this._buildFilterChain();

            // Setup event listeners
            this.setupVideoEventListeners();

            // Detect FPS
            this.detectFPS();

            // Decode video audio for scrubbing
            await this.decodeVideoAudio();

            this.isSynced = true;
            console.log('VideoSync initialized successfully');

            if (this.onSyncStateChange) {
                this.onSyncStateChange(true);
            }

            return true;
        } catch (error) {
            console.error('Failed to initialize VideoSync:', error);
            this.isSynced = false;

            if (this.onSyncStateChange) {
                this.onSyncStateChange(false);
            }

            return false;
        }
    }

    /**
     * Build 7-stage filter chain for bat-ball isolation (same as AudioProcessor).
     * Connects: audioSource → highPass → notch×3 → bandPass → worklet → compressor → analyser → destination
     */
    async _buildFilterChain() {
        const ctx = this.audioContext;

        // Load AudioWorklet voice suppressor (graceful fallback if unavailable)
        let workletLoaded = false;
        try {
            await ctx.audioWorklet.addModule('js/audio-worklet-processor.js');
            workletLoaded = true;
            console.log('VideoSync: AudioWorklet voice suppressor loaded');
        } catch (err) {
            console.warn('VideoSync: AudioWorklet not available, skipping worklet stage:', err.message);
        }

        // Stage 1: High-pass — remove everything below 3000 Hz (crowd + voice fundamentals)
        this.highPassFilter = ctx.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 3000;
        this.highPassFilter.Q.value = 1.5;

        // Stage 2-4: Notch filters — suppress voice harmonics
        this.notchFilter = ctx.createBiquadFilter();
        this.notchFilter.type = 'notch';
        this.notchFilter.frequency.value = 800;
        this.notchFilter.Q.value = 3;

        this.notchFilter2 = ctx.createBiquadFilter();
        this.notchFilter2.type = 'notch';
        this.notchFilter2.frequency.value = 1000;
        this.notchFilter2.Q.value = 3;

        this.notchFilter3 = ctx.createBiquadFilter();
        this.notchFilter3.type = 'notch';
        this.notchFilter3.frequency.value = 2000;
        this.notchFilter3.Q.value = 2.5;

        // Stage 5: Band-pass — focus on bat-ball crack range (3-7 kHz)
        this.bandPassFilter = ctx.createBiquadFilter();
        this.bandPassFilter.type = 'bandpass';
        this.bandPassFilter.frequency.value = 5000;
        this.bandPassFilter.Q.value = 1.2;

        // Stage 7: Compressor / noise gate
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 3;
        this.compressor.ratio.value = 20;
        this.compressor.attack.value = 0.001;
        this.compressor.release.value = 0.03;

        // Stage 6: Transient gate worklet
        if (workletLoaded) {
            this.workletNode = new AudioWorkletNode(ctx, 'voice-suppressor');
        }

        // Wire up the chain
        this.audioSource.connect(this.highPassFilter);
        this.highPassFilter.connect(this.notchFilter);
        this.notchFilter.connect(this.notchFilter2);
        this.notchFilter2.connect(this.notchFilter3);
        this.notchFilter3.connect(this.bandPassFilter);

        if (this.workletNode) {
            this.bandPassFilter.connect(this.workletNode);
            this.workletNode.connect(this.compressor);
        } else {
            this.bandPassFilter.connect(this.compressor);
        }

        this.compressor.connect(this.analyser);
        this.analyser.connect(ctx.destination); // allow video audio to play through

        console.log('VideoSync filter chain active — voice suppressor:', workletLoaded ? 'ON' : 'OFF (fallback)');
    }

    /**
     * Setup video event listeners
     */
    setupVideoEventListeners() {
        this.video.addEventListener('loadedmetadata', () => {
            this.calculateTotalFrames();
            console.log('Video metadata loaded:', {
                duration: this.video.duration,
                fps: this.fps,
                totalFrames: this.totalFrames
            });
        });

        this.video.addEventListener('timeupdate', () => {
            this.updateCurrentFrame();

            if (this.onTimeUpdate) {
                this.onTimeUpdate(this.video.currentTime);
            }
        });

        this.video.addEventListener('play', () => {
            this.startAudioAnalysis();
        });

        this.video.addEventListener('pause', () => {
            this.stopAudioAnalysis();
        });

        this.video.addEventListener('seeked', () => {
            this.updateCurrentFrame();
            // Update waveform when seeking/scrubbing
            this.captureAudioAtCurrentTime();
        });

        this.video.addEventListener('seeking', () => {
            // Update during scrubbing for smooth feedback
            this.captureAudioAtCurrentTime();
        });
    }

    /**
     * Detect video FPS (estimate)
     */
    detectFPS() {
        // Common FPS values
        const commonFPS = [24, 25, 29.97, 30, 50, 59.94, 60];

        // For now, default to 30fps
        // In production, you could use video metadata or frame detection
        this.fps = 30;

        this.calculateTotalFrames();
    }

    /**
     * Calculate total frames in video
     */
    calculateTotalFrames() {
        if (this.video.duration && this.fps) {
            this.totalFrames = Math.floor(this.video.duration * this.fps);
        }
    }

    /**
     * Update current frame number
     */
    updateCurrentFrame() {
        this.currentFrame = Math.floor(this.video.currentTime * this.fps);

        if (this.onFrameUpdate) {
            this.onFrameUpdate(this.currentFrame, this.totalFrames);
        }
    }

    /**
     * Start real-time audio analysis
     */
    startAudioAnalysis() {
        // Resume AudioContext — required in new tabs where no user interaction has
        // occurred yet (browser autoplay policy suspends AudioContext by default)
        if (this.audioContext && this.audioContext.state === 'suspended') {
            this.audioContext.resume().catch(() => {});
        }

        const analyze = () => {
            if (this.video.paused) return;

            // Get audio data
            this.analyser.getByteTimeDomainData(this.audioData);

            // Trigger callback with audio data
            if (this.onAudioData) {
                this.onAudioData({
                    waveform: this.audioData,
                    timestamp: this.video.currentTime,
                    frame: this.currentFrame
                });
            }

            // Continue analysis loop
            this.rafId = requestAnimationFrame(analyze);
        };

        analyze();
    }

    /**
     * Stop audio analysis
     */
    stopAudioAnalysis() {
        if (this.rafId) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
    }

    /**
     * Decode video audio into buffer for scrubbing
     */
    async decodeVideoAudio() {
        try {
            if (this.isLoading) return;
            this.isLoading = true;

            console.log('Decoding video audio for scrubbing support...');

            // Fetch the video file
            const response = await fetch(this.video.src);
            const arrayBuffer = await response.arrayBuffer();

            // Decode audio
            this.offlineAudioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

            console.log('Audio decoded successfully:', {
                duration: this.offlineAudioBuffer.duration,
                sampleRate: this.offlineAudioBuffer.sampleRate,
                channels: this.offlineAudioBuffer.numberOfChannels
            });

            this.isLoading = false;
        } catch (error) {
            console.error('Failed to decode video audio:', error);
            console.log('Scrubbing will use live analyser data (may not be accurate when paused)');
            this.isLoading = false;
        }
    }

    /**
     * Capture audio data at current video position (for scrubbing)
     * This allows waveform to update when user seeks through video
     */
    captureAudioAtCurrentTime() {
        // If we have decoded audio buffer, use it for accurate scrubbing
        if (this.offlineAudioBuffer) {
            this.extractWaveformAtTime(this.video.currentTime);
        } else {
            // Fallback to live analyser (less accurate when paused)
            if (!this.analyser) return;

            this.analyser.getByteTimeDomainData(this.audioData);
            this.analyser.getByteFrequencyData(this.frequencyData);

            const currentRMS = this.calculateRMS(this.audioData);

            if (this.onAudioData) {
                this.onAudioData({
                    waveform: this.audioData,
                    frequency: this.frequencyData,
                    rms: currentRMS,
                    timestamp: this.video.currentTime,
                    frame: this.currentFrame,
                    isScrubbing: true
                });
            }

            if (this.onLevelUpdate) {
                this.onLevelUpdate(currentRMS);
            }
        }
    }

    /**
     * Extract waveform data from decoded audio at specific time
     * @param {number} time - Time in seconds
     */
    extractWaveformAtTime(time) {
        if (!this.offlineAudioBuffer) return;

        const sampleRate = this.offlineAudioBuffer.sampleRate;
        const channels = this.offlineAudioBuffer.numberOfChannels;

        // Calculate sample position
        const startSample = Math.floor(time * sampleRate);
        const samplesToExtract = 2048; // Match FFT size

        // Get channel data (use first channel or mix if stereo)
        const channelData = this.offlineAudioBuffer.getChannelData(0);

        // Extract samples at current time
        const waveformArray = new Uint8Array(samplesToExtract);

        for (let i = 0; i < samplesToExtract; i++) {
            const sampleIndex = startSample + i;

            if (sampleIndex < channelData.length) {
                // Convert from -1..1 to 0..255 (matching analyser output format)
                const normalized = (channelData[sampleIndex] + 1) / 2;
                waveformArray[i] = Math.floor(normalized * 255);
            } else {
                waveformArray[i] = 128; // Silence
            }
        }

        // Calculate RMS from extracted data
        let sum = 0;
        for (let i = 0; i < waveformArray.length; i++) {
            const normalized = (waveformArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / waveformArray.length);

        // Create frequency data (simplified - just for display)
        const frequencyArray = new Uint8Array(1024);
        frequencyArray.fill(0);

        // Trigger callback with extracted waveform
        if (this.onAudioData) {
            this.onAudioData({
                waveform: waveformArray,
                frequency: frequencyArray,
                rms: rms,
                timestamp: time,
                frame: this.currentFrame,
                isScrubbing: true
            });
        }

        if (this.onLevelUpdate) {
            this.onLevelUpdate(rms);
        }
    }

    /**
     * Seek to specific frame
     * @param {number} frameNumber - Frame to seek to
     */
    seekToFrame(frameNumber) {
        const time = frameNumber / this.fps;
        this.video.currentTime = time;
    }

    /**
     * Step forward one frame
     */
    stepForward() {
        this.seekToFrame(this.currentFrame + 1);
    }

    /**
     * Step backward one frame
     */
    stepBackward() {
        this.seekToFrame(Math.max(0, this.currentFrame - 1));
    }

    /**
     * Seek to specific timestamp
     * @param {number} timestamp - Time in seconds
     */
    seekToTime(timestamp) {
        this.video.currentTime = timestamp;
    }

    /**
     * Get current playback state
     * @returns {Object} Playback state
     */
    getPlaybackState() {
        return {
            currentTime: this.video.currentTime,
            duration: this.video.duration,
            currentFrame: this.currentFrame,
            totalFrames: this.totalFrames,
            fps: this.fps,
            isPlaying: !this.video.paused,
            isSynced: this.isSynced
        };
    }

    /**
     * Set playback rate
     * @param {number} rate - Playback rate (0.25, 0.5, 1, 1.5, 2, etc.)
     */
    setPlaybackRate(rate) {
        this.video.playbackRate = rate;
    }

    /**
     * Get audio context time
     * @returns {number} Current audio context time
     */
    getAudioTime() {
        return this.audioContext ? this.audioContext.currentTime : 0;
    }

    /**
     * Sync video to specific audio time
     * @param {number} audioTime - Audio timestamp
     */
    syncToAudioTime(audioTime) {
        const videoTime = audioTime + (this.syncOffset / 1000);
        this.video.currentTime = videoTime;
    }

    /**
     * Set sync offset
     * @param {number} offsetMs - Offset in milliseconds
     */
    setSyncOffset(offsetMs) {
        this.syncOffset = offsetMs;
        console.log('Sync offset set to:', offsetMs, 'ms');
    }

    /**
     * Get video frame as image data
     * @returns {ImageData|null} Frame image data
     */
    captureFrame() {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = this.video.videoWidth;
            canvas.height = this.video.videoHeight;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

            return ctx.getImageData(0, 0, canvas.width, canvas.height);
        } catch (error) {
            console.error('Failed to capture frame:', error);
            return null;
        }
    }

    /**
     * Export frame as blob
     * @param {string} format - Image format (image/png, image/jpeg)
     * @returns {Promise<Blob>} Frame as blob
     */
    async exportFrame(format = 'image/png') {
        return new Promise((resolve, reject) => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = this.video.videoWidth;
                canvas.height = this.video.videoHeight;

                const ctx = canvas.getContext('2d');
                ctx.drawImage(this.video, 0, 0, canvas.width, canvas.height);

                canvas.toBlob(blob => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to create blob'));
                    }
                }, format);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Calculate RMS of audio data
     * @param {Uint8Array} audioData - Audio data
     * @returns {number} RMS value
     */
    calculateRMS(audioData) {
        let sum = 0;
        for (let i = 0; i < audioData.length; i++) {
            const normalized = (audioData[i] - 128) / 128;
            sum += normalized * normalized;
        }
        return Math.sqrt(sum / audioData.length);
    }

    /**
     * Cleanup resources
     */
    dispose() {
        this.stopAudioAnalysis();

        if (this.audioSource) {
            this.audioSource.disconnect();
        }

        if (this.highPassFilter) this.highPassFilter.disconnect();
        if (this.notchFilter) this.notchFilter.disconnect();
        if (this.notchFilter2) this.notchFilter2.disconnect();
        if (this.notchFilter3) this.notchFilter3.disconnect();
        if (this.bandPassFilter) this.bandPassFilter.disconnect();
        if (this.workletNode) this.workletNode.disconnect();
        if (this.compressor) this.compressor.disconnect();

        if (this.analyser) {
            this.analyser.disconnect();
        }

        if (this.audioContext) {
            this.audioContext.close();
        }

        this.isSynced = false;
        console.log('VideoSync disposed');
    }
}
