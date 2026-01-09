/**
 * AI Audio Classifier
 * Uses TensorFlow.js for bat-ball contact sound classification
 * Trained on international cricket video audio data
 */

class AIAudioClassifier {
    constructor() {
        this.model = null;
        this.isModelLoaded = false;
        this.isEnabled = true;

        // Audio feature extraction parameters
        this.sampleRate = 48000;
        this.fftSize = 2048;
        this.melBands = 128;
        this.hopLength = 512;

        // Classification thresholds
        this.batBallThreshold = 0.75;  // Confidence threshold for bat-ball contact
        this.edgeThreshold = 0.70;     // Confidence threshold for edge (bat edge)
        this.padThreshold = 0.65;      // Confidence threshold for pad contact

        // Class labels from training
        this.classLabels = [
            'bat_ball_contact',
            'bat_edge',
            'bat_pad',
            'ball_pad',
            'bat_ground',
            'ball_ground',
            'noise',
            'silence'
        ];

        // Training data statistics for normalization
        this.meanSpectrum = null;
        this.stdSpectrum = null;

        console.log('AI Audio Classifier initialized');
    }

    /**
     * Load pre-trained model from server or CDN
     */
    async loadModel(modelPath = '/models/cricket-audio-classifier/model.json') {
        try {
            console.log('Loading AI audio classification model...');

            // Check if TensorFlow.js is available
            if (typeof tf === 'undefined') {
                console.error('TensorFlow.js not loaded. Please include the library.');
                this.isEnabled = false;
                return false;
            }

            // Load the model
            this.model = await tf.loadLayersModel(modelPath);

            console.log('AI model loaded successfully');
            console.log('Model summary:');
            this.model.summary();

            this.isModelLoaded = true;

            // Load normalization parameters
            await this.loadNormalizationParams();

            return true;
        } catch (error) {
            console.warn('Failed to load AI model:', error);
            console.log('Falling back to traditional spike detection');
            this.isEnabled = false;
            return false;
        }
    }

    /**
     * Load normalization parameters from training
     */
    async loadNormalizationParams() {
        try {
            const response = await fetch('/models/cricket-audio-classifier/normalization.json');
            const params = await response.json();

            this.meanSpectrum = params.mean;
            this.stdSpectrum = params.std;

            console.log('Normalization parameters loaded');
        } catch (error) {
            console.warn('Failed to load normalization params, using defaults');
            // Use default normalization if file not found
            this.meanSpectrum = new Array(this.melBands).fill(0);
            this.stdSpectrum = new Array(this.melBands).fill(1);
        }
    }

    /**
     * Extract mel spectrogram features from audio data
     * @param {Float32Array} audioData - Raw audio samples
     * @returns {Array} Mel spectrogram features
     */
    extractMelSpectrogram(audioData) {
        // Convert to frequency domain using FFT
        const fft = this.performFFT(audioData);

        // Apply mel filterbank
        const melSpectrum = this.applyMelFilterbank(fft);

        // Convert to log scale (dB)
        const logMelSpectrum = melSpectrum.map(val =>
            Math.log10(Math.max(val, 1e-10)) * 10
        );

        // Normalize using training statistics
        const normalized = logMelSpectrum.map((val, i) =>
            (val - this.meanSpectrum[i]) / this.stdSpectrum[i]
        );

        return normalized;
    }

    /**
     * Perform FFT on audio data
     * @param {Float32Array} audioData - Raw audio samples
     * @returns {Float32Array} Magnitude spectrum
     */
    performFFT(audioData) {
        // Simple magnitude spectrum calculation
        // In production, use a proper FFT library
        const spectrum = new Float32Array(this.fftSize / 2);

        for (let i = 0; i < spectrum.length; i++) {
            let real = 0;
            let imag = 0;

            for (let n = 0; n < audioData.length; n++) {
                const angle = (2 * Math.PI * i * n) / audioData.length;
                real += audioData[n] * Math.cos(angle);
                imag += audioData[n] * Math.sin(angle);
            }

            spectrum[i] = Math.sqrt(real * real + imag * imag);
        }

        return spectrum;
    }

    /**
     * Apply mel filterbank to frequency spectrum
     * @param {Float32Array} spectrum - Frequency spectrum
     * @returns {Array} Mel-scale spectrum
     */
    applyMelFilterbank(spectrum) {
        const melFilters = this.createMelFilterbank();
        const melSpectrum = new Array(this.melBands).fill(0);

        for (let i = 0; i < this.melBands; i++) {
            for (let j = 0; j < spectrum.length; j++) {
                melSpectrum[i] += spectrum[j] * melFilters[i][j];
            }
        }

        return melSpectrum;
    }

    /**
     * Create mel filterbank
     * @returns {Array} Mel filterbank matrix
     */
    createMelFilterbank() {
        // Simplified mel filterbank creation
        // In production, use librosa-style mel filters
        const filters = [];
        const maxFreq = this.sampleRate / 2;
        const freqPerBin = maxFreq / (this.fftSize / 2);

        for (let i = 0; i < this.melBands; i++) {
            const filter = new Array(this.fftSize / 2).fill(0);
            const centerFreq = this.melToHz((i + 1) * (this.hzToMel(maxFreq) / this.melBands));
            const centerBin = Math.floor(centerFreq / freqPerBin);

            // Triangular filter
            const width = 20;
            for (let j = Math.max(0, centerBin - width); j < Math.min(filter.length, centerBin + width); j++) {
                const distance = Math.abs(j - centerBin);
                filter[j] = Math.max(0, 1 - distance / width);
            }

            filters.push(filter);
        }

        return filters;
    }

    /**
     * Convert Hz to Mel scale
     */
    hzToMel(hz) {
        return 2595 * Math.log10(1 + hz / 700);
    }

    /**
     * Convert Mel to Hz scale
     */
    melToHz(mel) {
        return 700 * (Math.pow(10, mel / 2595) - 1);
    }

    /**
     * Classify audio segment using trained model
     * @param {Uint8Array} waveformData - Audio waveform data
     * @returns {Object} Classification results with probabilities
     */
    async classifyAudio(waveformData) {
        if (!this.isModelLoaded || !this.isEnabled) {
            return null;
        }

        try {
            // Convert Uint8Array to Float32Array (-1 to 1 range)
            const audioFloat = new Float32Array(waveformData.length);
            for (let i = 0; i < waveformData.length; i++) {
                audioFloat[i] = (waveformData[i] - 128) / 128;
            }

            // Extract features
            const features = this.extractMelSpectrogram(audioFloat);

            // Create tensor from features
            const inputTensor = tf.tensor2d([features], [1, this.melBands]);

            // Run inference
            const predictions = this.model.predict(inputTensor);
            const probabilities = await predictions.data();

            // Clean up tensors
            inputTensor.dispose();
            predictions.dispose();

            // Get top prediction
            let maxProb = 0;
            let maxIndex = 0;
            for (let i = 0; i < probabilities.length; i++) {
                if (probabilities[i] > maxProb) {
                    maxProb = probabilities[i];
                    maxIndex = i;
                }
            }

            const result = {
                class: this.classLabels[maxIndex],
                confidence: maxProb,
                probabilities: {},
                isBatBallContact: false,
                isEdge: false,
                isPad: false
            };

            // Map probabilities to class labels
            for (let i = 0; i < this.classLabels.length; i++) {
                result.probabilities[this.classLabels[i]] = probabilities[i];
            }

            // Determine contact types
            result.isBatBallContact = probabilities[0] > this.batBallThreshold;
            result.isEdge = probabilities[1] > this.edgeThreshold;
            result.isPad = probabilities[2] > this.padThreshold || probabilities[3] > this.padThreshold;

            return result;
        } catch (error) {
            console.error('Error during audio classification:', error);
            return null;
        }
    }

    /**
     * Detect bat-ball contact with AI
     * @param {Object} audioData - Audio data from processor
     * @returns {Object|null} Detection result
     */
    async detectContact(audioData) {
        const classification = await this.classifyAudio(audioData.waveform);

        if (!classification) {
            return null;
        }

        // Only return detection if it's actual bat-ball contact
        if (classification.isBatBallContact) {
            return {
                timestamp: audioData.timestamp,
                frame: audioData.frame,
                type: classification.class,
                confidence: classification.confidence,
                probabilities: classification.probabilities,
                isEdge: classification.isEdge,
                isPad: classification.isPad,
                isAIDetected: true
            };
        }

        return null;
    }

    /**
     * Enable/disable AI classification
     */
    setEnabled(enabled) {
        this.isEnabled = enabled && this.isModelLoaded;
    }

    /**
     * Get classifier status
     */
    getStatus() {
        return {
            modelLoaded: this.isModelLoaded,
            enabled: this.isEnabled,
            classes: this.classLabels.length,
            thresholds: {
                batBall: this.batBallThreshold,
                edge: this.edgeThreshold,
                pad: this.padThreshold
            }
        };
    }

    /**
     * Set classification thresholds
     */
    setThresholds(batBall, edge, pad) {
        if (batBall) this.batBallThreshold = batBall;
        if (edge) this.edgeThreshold = edge;
        if (pad) this.padThreshold = pad;
    }

    /**
     * Export model info
     */
    exportModelInfo() {
        return {
            status: this.getStatus(),
            architecture: this.model ? {
                inputShape: this.model.inputs[0].shape,
                outputShape: this.model.outputs[0].shape,
                layers: this.model.layers.length
            } : null,
            features: {
                melBands: this.melBands,
                fftSize: this.fftSize,
                sampleRate: this.sampleRate
            }
        };
    }
}
