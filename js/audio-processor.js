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

        // Audio analysis buffers
        this.bufferLength = 0;
        this.dataArray = null;
        this.frequencyData = null;

        // Configuration
        this.fftSize = 2048; // Higher FFT size for better frequency resolution
        this.smoothingTimeConstant = 0.3; // Reduced smoothing for faster spike response

        // State
        this.isRunning = false;
        this.currentLevel = 0;

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

            // Create audio source from microphone
            this.microphone = this.audioContext.createMediaStreamSource(this.mediaStream);

            // Create analyser node for FFT analysis
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = this.fftSize;
            this.analyser.smoothingTimeConstant = this.smoothingTimeConstant;

            // Connect microphone to analyser
            this.microphone.connect(this.analyser);

            // Initialize data buffers
            this.bufferLength = this.analyser.frequencyBinCount;
            this.dataArray = new Uint8Array(this.bufferLength);
            this.frequencyData = new Uint8Array(this.bufferLength);

            console.log('Audio processor initialized successfully');
            console.log('Sample Rate:', this.audioContext.sampleRate);
            console.log('FFT Size:', this.fftSize);
            console.log('Buffer Length:', this.bufferLength);

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
     * Cleanup and release resources
     */
    dispose() {
        this.stop();

        if (this.microphone) {
            this.microphone.disconnect();
        }

        if (this.analyser) {
            this.analyser.disconnect();
        }

        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
        }

        if (this.audioContext) {
            this.audioContext.close();
        }

        console.log('Audio processor disposed');
    }
}
