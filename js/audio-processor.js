/**
 * AudioProcessor Class
 * Handles Web Audio API integration, microphone capture, and FFT analysis
 * Provides real-time audio data for waveform visualization and spike detection
 */

class AudioProcessor {
    constructor() {
        // Web Audio API components
        this.audioContext = null;
        this.analyser = null;
        this.microphone = null;
        this.scriptProcessor = null;
        this.mediaStream = null;

        // Multi-stage filter chain for bat-ball isolation
        this.highPassFilter = null;   // Stage 1: Remove low-freq crowd rumble
        this.notchFilter = null;      // Stage 2: Notch out voice fundamentals
        this.notchFilter2 = null;     // Stage 3: Notch upper voice harmonics (1 kHz)
        this.notchFilter3 = null;     // Stage 4: Notch upper voice harmonics (2 kHz)
        this.bandPassFilter = null;   // Stage 5: Focus on bat-ball freq range
        this.workletNode = null;      // Stage 6: Dual-follower transient gate (voice suppressor)
        this.compressor = null;       // Stage 7: Noise gate / dynamic compression

        // Audio analysis buffers
        this.bufferLength = 0;
        this.dataArray = null;
        this.frequencyData = null;

        // Configuration
        this.fftSize = 2048;
        this.smoothingTimeConstant = 0.2; // Lower = faster spike response

        // Bat-ball filter enabled by default
        this.batBallFilterEnabled = true;

        // State
        this.isRunning = false;
        this.currentLevel = 0;

        // Rolling audio buffer (60 seconds of waveform snapshots)
        this.rollingBuffer = [];
        this.rollingBufferMaxDuration = 60; // seconds
        this.lastSnapshotTime = 0;

        // Callbacks
        this.onAudioData = null; // Callback for waveform data
        this.onLevelUpdate = null; // Callback for audio level updates
    }

    /**
     * Initialize audio context and request microphone access
     * @returns {Promise<boolean>} Success status
     */
    async initialize() {
        try {
            // Create AudioContext (use webkit prefix for Safari compatibility)
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioContext();

            // Request microphone access
            this.mediaStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false, // Disable echo cancellation for accurate detection
                    noiseSuppression: false, // Disable noise suppression
                    autoGainControl: false,  // Disable auto gain for consistent levels
                    sampleRate: 48000        // High sample rate for better quality
                }
            });

            this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);

            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

            if (this.batBallFilterEnabled) {
                await this.buildFilterChain();
            } else {
                this.microphone.connect(this.analyser);
            }

            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            this.frequencyData = new Uint8Array(this.bufferLength);

            console.log('Audio processor initialized. Sample Rate:', this.audioContext.sampleRate);

            return true;
        } catch (error) {
            console.error('Failed to initialize audio processor:', error);

            // Provide user-friendly error messages
            if (error.name === 'NotAllowedError') {
                alert('Microphone access denied. Please allow microphone permissions and reload.');
            } else if (error.name === 'NotFoundError') {
                alert('No microphone found. Please connect a microphone and reload.');
            } else {
                alert('Audio initialization failed: ' + error.message);
            }

            return false;
        }
    }

    /**
     * Initialize from an existing MediaStream (e.g., tab capture via getDisplayMedia)
     * instead of requesting microphone access
     * @param {MediaStream} stream - External MediaStream with audio tracks
     * @returns {Promise<boolean>} Success status
     */
    async initializeFromStream(stream) {
        try {
            const AudioCtx = window.AudioContext || window.webkitAudioContext;
            this.audioContext = new AudioCtx();
            this.mediaStream = stream;

            this.microphone = this.audioContext.createMediaStreamSource(stream);

            // Create analyser
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

            if (this.batBallFilterEnabled) {
                await this.buildFilterChain();
            } else {
                this.microphone.connect(this.analyser);
            }

            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            this.frequencyData = new Uint8Array(this.bufferLength);

            console.log('Audio processor initialized. Sample Rate:', this.audioContext.sampleRate);
            console.log('Bat-ball filter:', this.batBallFilterEnabled ? 'ENABLED (multi-stage)' : 'DISABLED');

            return true;
        } catch (error) {
            console.error('Failed to initialize audio from stream:', error);
            return false;
        }
    }

    /**
     * Build multi-stage filter chain for bat-ball sound isolation.
     *
     * Chain: source → highPass(3kHz) → notch(800Hz) → notch(1kHz) → notch(2kHz)
     *              → bandPass(5kHz) → VoiceSuppressorWorklet → compressor → analyser
     *
     * Stage 1 — High-pass (3000 Hz): Removes crowd rumble, bass, and all voice fundamentals
     * Stage 2-4 — Notch filters (800 Hz, 1 kHz, 2 kHz): Cuts voice harmonics that leak through
     * Stage 5 — Band-pass (3-7 kHz): Isolates the "crack" range of bat-ball impact
     * Stage 6 — AudioWorklet transient gate: Fast/slow RMS dual-follower — passes impulses
     *            (bat-ball crack), suppresses sustained signals (voice, crowd hum)
     * Stage 7 — Compressor: Final noise gate; only LOUD transients survive
     */
    async buildFilterChain() {
        const ctx = this.audioContext;

        // Load the AudioWorklet processor module (voice suppressor)
        // Falls back gracefully if worklets are not supported
        let workletLoaded = false;
        try {
            await ctx.audioWorklet.addModule('js/audio-worklet-processor.js');
            workletLoaded = true;
            console.log('AudioWorklet voice suppressor loaded');
        } catch (err) {
            console.warn('AudioWorklet not available, skipping worklet stage:', err.message);
        }

        // Stage 1: Aggressive High-pass — cut everything below 3000 Hz
        // Removes crowd noise, ground rumble, bass, and all human voice fundamentals
        this.highPassFilter = ctx.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 3000;
        this.highPassFilter.Q.value = 1.5; // Sharper cutoff

        // Stage 2: Notch — suppress voice harmonic at 800 Hz
        this.notchFilter = ctx.createBiquadFilter();
        this.notchFilter.type = 'notch';
        this.notchFilter.frequency.value = 800;
        this.notchFilter.Q.value = 3;

        // Stage 3: Notch — suppress upper voice harmonic at 1000 Hz
        this.notchFilter2 = ctx.createBiquadFilter();
        this.notchFilter2.type = 'notch';
        this.notchFilter2.frequency.value = 1000;
        this.notchFilter2.Q.value = 3;

        // Stage 4: Notch — suppress upper voice harmonic at 2000 Hz
        this.notchFilter3 = ctx.createBiquadFilter();
        this.notchFilter3.type = 'notch';
        this.notchFilter3.frequency.value = 2000;
        this.notchFilter3.Q.value = 2.5;

        // Stage 5: Tight Band-pass — focus ONLY on bat-ball "crack" (3-7 kHz)
        this.bandPassFilter = ctx.createBiquadFilter();
        this.bandPassFilter.type = 'bandpass';
        this.bandPassFilter.frequency.value = 5000;
        this.bandPassFilter.Q.value = 1.2;

        // Stage 7: Strong Compressor/Noise Gate
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -20;
        this.compressor.knee.value = 3;
        this.compressor.ratio.value = 20;
        this.compressor.attack.value = 0.001;  // 1ms — let transients through
        this.compressor.release.value = 0.03;  // 30ms

        // Stage 6: AudioWorklet transient gate (dual-follower voice suppressor)
        if (workletLoaded) {
            this.workletNode = new AudioWorkletNode(ctx, 'voice-suppressor');
        }

        // Connect chain
        this.microphone.connect(this.highPassFilter);
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

        console.log('Multi-stage Noise Filter Built:');
        console.log('  1. High-pass: 3000 Hz (cuts crowd noise + all voice fundamentals)');
        console.log('  2. Notch: 800 Hz (removes voice harmonic)');
        console.log('  3. Notch: 1000 Hz (removes voice harmonic)');
        console.log('  4. Notch: 2000 Hz (removes voice harmonic)');
        console.log('  5. Band-pass: 3-7 kHz (bat-ball crack range)');
        console.log('  6. Transient gate worklet:', workletLoaded ? 'ACTIVE' : 'SKIPPED (not supported)');
        console.log('  7. Compressor: -20dB threshold, 20:1 ratio');
    }

    /**
     * Start audio processing loop
     */
    start() {
        if (!this.audioContext || !this.analyser) {
            console.error('Audio processor not initialized');
            return;
        }

        // Resume audio context if suspended (required for autoplay policies)
        if (this.audioContext.state === 'suspended') {
            this.audioContext.resume();
        }

        this.isRunning = true;
        this.processAudio();

        console.log('Audio processing started');
    }

    /**
     * Stop audio processing
     */
    stop() {
        this.isRunning = false;
        console.log('Audio processing stopped');
    }

    /**
     * Main audio processing loop using requestAnimationFrame
     * Runs at ~60fps for smooth visualization
     */
    processAudio() {
        if (!this.isRunning) return;

        // Get waveform data (time domain)
        this.analyser.getByteTimeDomainData(this.dataArray);

        // Get frequency data for additional analysis
        this.analyser.getByteFrequencyData(this.frequencyData);

        // Calculate current audio level (RMS)
        this.currentLevel = this.calculateRMS(this.dataArray);

        // Store snapshot in rolling buffer
        const now = this.audioContext.currentTime;
        if (now - this.lastSnapshotTime >= 1 / 60) {
            this.addToRollingBuffer(now);
            this.lastSnapshotTime = now;
        }

        // Trigger callbacks with audio data
        if (this.onAudioData) {
            this.onAudioData({
                waveform: this.dataArray,
                frequency: this.frequencyData,
                rms: this.currentLevel,
                timestamp: this.audioContext.currentTime
            });
        }

        if (this.onLevelUpdate) {
            this.onLevelUpdate(this.currentLevel);
        }

        // Continue processing loop
        requestAnimationFrame(() => this.processAudio());
    }

    /**
     * Calculate Root Mean Square (RMS) of audio signal
     * Provides a measure of overall audio energy/loudness
     * @param {Uint8Array} dataArray - Time domain audio data
     * @returns {number} RMS value (0-1)
     */
    calculateRMS(dataArray) {
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            // Normalize to -1 to 1 range
            const normalized = (dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        return rms;
    }

    /**
     * Calculate peak amplitude in current buffer
     * @param {Uint8Array} dataArray - Time domain audio data
     * @returns {number} Peak value (0-1)
     */
    calculatePeak(dataArray) {
        let max = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const value = Math.abs((dataArray[i] - 128) / 128);
            if (value > max) max = value;
        }
        return max;
    }

    /**
     * Get dominant frequency in current audio
     * Useful for filtering out specific frequency ranges
     * @returns {number} Frequency in Hz
     */
    getDominantFrequency() {
        if (!this.frequencyData) return 0;

        let maxIndex = 0;
        let maxValue = 0;

        for (let i = 0; i < this.frequencyData.length; i++) {
            if (this.frequencyData[i] > maxValue) {
                maxValue = this.frequencyData[i];
                maxIndex = i;
            }
        }

        // Convert bin index to frequency
        const nyquist = this.audioContext.sampleRate / 2;
        const frequency = (maxIndex * nyquist) / this.bufferLength;

        return frequency;
    }

    /**
     * Get current audio context sample rate
     * @returns {number} Sample rate in Hz
     */
    getSampleRate() {
        return this.audioContext ? this.audioContext.sampleRate : 0;
    }

    /**
     * Get current audio context time
     * @returns {number} Time in seconds
     */
    getCurrentTime() {
        return this.audioContext ? this.audioContext.currentTime : 0;
    }

    /**
     * Add current waveform data to the rolling buffer
     */
    addToRollingBuffer(timestamp) {
        const snapshot = {
            timestamp: timestamp,
            wallTime: Date.now(),
            rms: this.currentLevel,
            peak: this.calculatePeak(this.dataArray),
            waveformSample: this.downsampleWaveform(this.dataArray, 8)
        };

        this.rollingBuffer.push(snapshot);

        // Trim buffer to maxDuration
        const oldestAllowed = timestamp - this.rollingBufferMaxDuration;
        while (this.rollingBuffer.length > 0 && this.rollingBuffer[0].timestamp < oldestAllowed) {
            this.rollingBuffer.shift();
        }
    }

    /**
     * Downsample waveform data to reduce memory usage
     */
    downsampleWaveform(data, factor) {
        const length = Math.ceil(data.length / factor);
        const result = new Uint8Array(length);
        for (let i = 0; i < length; i++) {
            result[i] = data[i * factor];
        }
        return result;
    }

    /**
     * Extract audio data from the rolling buffer around a specific timestamp
     * @param {number} timestamp - Center timestamp (AudioContext time in seconds)
     * @param {number} windowHalf - Half-window size in seconds (e.g., 0.1 for +/- 100ms)
     */
    getAudioWindowAroundTimestamp(timestamp, windowHalf = 0.1) {
        const startTime = timestamp - windowHalf;
        const endTime = timestamp + windowHalf;

        const windowSnapshots = this.rollingBuffer.filter(
            s => s.timestamp >= startTime && s.timestamp <= endTime
        );

        if (windowSnapshots.length === 0) {
            return { snapshots: [], avgRms: 0, maxPeak: 0, startTime, endTime, empty: true };
        }

        const avgRms = windowSnapshots.reduce((sum, s) => sum + s.rms, 0) / windowSnapshots.length;
        const maxPeak = Math.max(...windowSnapshots.map(s => s.peak));

        return {
            snapshots: windowSnapshots,
            avgRms,
            maxPeak,
            startTime,
            endTime,
            sampleCount: windowSnapshots.length,
            empty: false
        };
    }

    /**
     * Get the current duration of data in the rolling buffer
     */
    getRollingBufferDuration() {
        if (this.rollingBuffer.length < 2) return 0;
        return this.rollingBuffer[this.rollingBuffer.length - 1].timestamp - this.rollingBuffer[0].timestamp;
    }

    /**
     * Set rolling buffer max duration
     */
    setRollingBufferDuration(seconds) {
        this.rollingBufferMaxDuration = Math.max(5, Math.min(120, seconds));
    }

    /**
     * Update analyser settings
     * @param {Object} settings - Settings object
     */
    updateSettings(settings) {
        if (settings.fftSize && this.analyser) {
            this.analyser.fftSize = settings.fftSize;
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            this.frequencyData = new Uint8Array(this.bufferLength);
        }

        if (settings.smoothingTimeConstant !== undefined && this.analyser) {
            this.analyser.smoothingTimeConstant = settings.smoothingTimeConstant;
        }
    }

    /**
     * Enable or disable bat-ball impact frequency filter
     * When enabled, filters audio to focus on 2-8 kHz range (bat-ball impacts)
     * When disabled, analyzes full frequency spectrum
     * @param {boolean} enabled - Whether to enable the filter
     */
    setBatBallFilterEnabled(enabled) {
        this.batBallFilterEnabled = enabled;

        if (this.bandPassFilter) {
            if (enabled) {
                console.log('Bat-ball filter enabled - focusing on impact frequencies (2-8 kHz)');
            } else {
                console.log('Bat-ball filter disabled - analyzing full audio spectrum');
            }
        }

        // If already initialized, need to restart to apply changes
        if (this.audioContext && this.microphone) {
            console.warn('Filter change requires restarting monitoring to take effect');
        }
    }

    /**
     * Get current filter status
     */
    getFilterConfig() {
        return {
            enabled: this.batBallFilterEnabled,
            stages: this.batBallFilterEnabled ? [
                { type: 'highpass', freq: '1500 Hz' },
                { type: 'notch', freq: '300 Hz' },
                { type: 'bandpass', freq: '2-8 kHz' },
                { type: 'compressor', threshold: '-30 dB' }
            ] : []
        };
    }

    /**
     * Cleanup and release resources
     */
    dispose() {
        this.stop();

        if (this.microphone) {
            this.microphone.disconnect();
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

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext) {
            this.audioContext.close();
        }

        this.rollingBuffer = [];

        console.log('Audio processor disposed');
    }
}
