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
        this.bandPassFilter = null;   // Stage 2: Focus on bat-ball freq range
        this.notchFilter = null;      // Stage 3: Notch out voice fundamentals
        this.compressor = null;       // Stage 4: Noise gate / dynamic compression

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
                this.buildFilterChain();
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
                this.buildFilterChain();
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
     * Chain: source → highPass(1500Hz) → notch(300Hz) → bandPass(2-8kHz) → compressor → analyser
     *
     * Stage 1 — High-pass (1500 Hz): Removes crowd rumble, bass, and low-freq noise
     * Stage 2 — Notch (300 Hz): Cuts voice fundamental frequencies
     * Stage 3 — Band-pass (2-8 kHz): Isolates the "crack" range of bat-ball impact
     * Stage 4 — Compressor: Acts as noise gate, suppressing quiet background sounds
     */
    buildFilterChain() {
        const ctx = this.audioContext;

        // Stage 1: High-pass — cut everything below 1500 Hz
        this.highPassFilter = ctx.createBiquadFilter();
        this.highPassFilter.type = 'highpass';
        this.highPassFilter.frequency.value = 1500;
        this.highPassFilter.Q.value = 0.7;

        // Stage 2: Notch — suppress voice fundamental (200-400 Hz range)
        this.notchFilter = ctx.createBiquadFilter();
        this.notchFilter.type = 'notch';
        this.notchFilter.frequency.value = 300;
        this.notchFilter.Q.value = 2;

        // Stage 3: Band-pass — focus on bat-ball impact range (2-8 kHz)
        this.bandPassFilter = ctx.createBiquadFilter();
        this.bandPassFilter.type = 'bandpass';
        this.bandPassFilter.frequency.value = 4500; // Center of 2-8 kHz
        this.bandPassFilter.Q.value = 0.8; // Wide enough to capture the range

        // Stage 4: Compressor acting as noise gate
        // High threshold means only loud transients pass through
        this.compressor = ctx.createDynamicsCompressor();
        this.compressor.threshold.value = -30;  // dB — signals below this are suppressed
        this.compressor.knee.value = 5;
        this.compressor.ratio.value = 12;       // Heavy compression of quiet sounds
        this.compressor.attack.value = 0.001;   // 1ms — let fast transients through
        this.compressor.release.value = 0.05;   // 50ms — quick release

        // Connect chain: source → highPass → notch → bandPass → compressor → analyser
        this.microphone.connect(this.highPassFilter);
        this.highPassFilter.connect(this.notchFilter);
        this.notchFilter.connect(this.bandPassFilter);
        this.bandPassFilter.connect(this.compressor);
        this.compressor.connect(this.analyser);

        console.log('Multi-stage filter chain built:');
        console.log('  1. High-pass: 1500 Hz (removes crowd rumble, bass)');
        console.log('  2. Notch: 300 Hz (suppresses voice fundamentals)');
        console.log('  3. Band-pass: 2-8 kHz (bat-ball impact range)');
        console.log('  4. Compressor: threshold -30dB, ratio 12:1 (noise gate)');
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
        if (this.bandPassFilter) this.bandPassFilter.disconnect();
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
