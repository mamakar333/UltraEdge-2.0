/**
 * AI Training Data Pipeline
 * Collects and processes cricket video data for model training
 * Handles data from international cricket videos for Ultra Edge audio and ball tracking
 */

class AITrainingPipeline {
    constructor() {
        this.trainingData = [];
        this.audioSamples = [];
        this.videoFrames = [];

        // Data collection state
        this.isCollecting = false;
        this.currentLabel = null;

        // Storage
        this.storageKey = 'cricket_training_data';

        // Statistics
        this.stats = {
            batBallSamples: 0,
            edgeSamples: 0,
            padSamples: 0,
            noiseSamples: 0,
            ballFrames: 0,
            totalSamples: 0
        };

        this.loadStoredData();
        console.log('AI Training Pipeline initialized');
    }

    /**
     * Start collecting training data with specific label
     * @param {string} label - Label for the data (bat_ball_contact, edge, pad, noise, etc.)
     */
    startCollecting(label) {
        this.isCollecting = true;
        this.currentLabel = label;
        console.log(`Started collecting training data for: ${label}`);
    }

    /**
     * Stop collecting training data
     */
    stopCollecting() {
        this.isCollecting = false;
        console.log('Stopped collecting training data');
        this.saveData();
    }

    /**
     * Add audio sample to training dataset
     * @param {Object} audioData - Audio data with waveform and features
     * @param {string} label - Classification label
     */
    addAudioSample(audioData, label = null) {
        if (!this.isCollecting && !label) return;

        const sampleLabel = label || this.currentLabel;

        const sample = {
            waveform: Array.from(audioData.waveform),
            timestamp: audioData.timestamp || Date.now(),
            label: sampleLabel,
            rms: audioData.rms,
            frequency: audioData.frequency ? Array.from(audioData.frequency) : null,
            metadata: {
                sampleRate: 48000,
                fftSize: 2048,
                dateCollected: new Date().toISOString()
            }
        };

        this.audioSamples.push(sample);
        this.updateStats(sampleLabel);

        console.log(`Added audio sample: ${sampleLabel}`);
    }

    /**
     * Add video frame with ball position annotation
     * @param {ImageData} frameData - Video frame image data
     * @param {Object} ballPosition - Ball bounding box {x, y, width, height}
     */
    addVideoFrame(frameData, ballPosition) {
        if (!this.isCollecting) return;

        const frame = {
            width: frameData.width,
            height: frameData.height,
            data: Array.from(frameData.data), // RGBA pixel data
            ballPosition: ballPosition,
            timestamp: Date.now(),
            metadata: {
                dateCollected: new Date().toISOString()
            }
        };

        this.videoFrames.push(frame);
        this.stats.ballFrames++;

        console.log('Added video frame with ball annotation');
    }

    /**
     * Process cricket video to extract training samples
     * @param {HTMLVideoElement} video - Video element
     * @param {Array} annotations - Array of {time, label, ballBox} annotations
     */
    async processVideo(video, annotations) {
        console.log('Processing cricket video for training data...');

        for (const annotation of annotations) {
            // Seek to annotated timestamp
            video.currentTime = annotation.time;

            await new Promise(resolve => {
                video.addEventListener('seeked', resolve, { once: true });
            });

            // If it's an audio annotation
            if (annotation.audioLabel) {
                // Audio extraction happens via AudioContext during playback
                console.log(`Audio annotation at ${annotation.time}s: ${annotation.audioLabel}`);
            }

            // If it's a ball position annotation
            if (annotation.ballBox) {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);

                const frameData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                this.addVideoFrame(frameData, annotation.ballBox);
            }
        }

        console.log('Video processing complete');
        this.saveData();
    }

    /**
     * Import annotations from CSV file
     * CSV format: timestamp,label,x,y,width,height
     * @param {File} file - CSV file with annotations
     */
    async importAnnotations(file) {
        const text = await file.text();
        const lines = text.split('\n');
        const annotations = [];

        for (let i = 1; i < lines.length; i++) { // Skip header
            const line = lines[i].trim();
            if (!line) continue;

            const parts = line.split(',');
            const annotation = {
                time: parseFloat(parts[0]),
                audioLabel: parts[1] || null,
                ballBox: parts.length > 3 ? {
                    x: parseFloat(parts[2]),
                    y: parseFloat(parts[3]),
                    width: parseFloat(parts[4]),
                    height: parseFloat(parts[5])
                } : null
            };

            annotations.push(annotation);
        }

        console.log(`Imported ${annotations.length} annotations`);
        return annotations;
    }

    /**
     * Export training data in TensorFlow.js compatible format
     */
    exportForTraining() {
        const exportData = {
            audio: {
                samples: this.audioSamples,
                features: this.extractAudioFeatures(),
                labels: this.generateAudioLabels(),
                stats: this.stats
            },
            video: {
                frames: this.videoFrames.map(f => ({
                    // Compress frame data for export
                    width: f.width,
                    height: f.height,
                    ballPosition: f.ballPosition,
                    timestamp: f.timestamp
                })),
                ballBoxes: this.videoFrames.map(f => f.ballPosition)
            },
            metadata: {
                exportDate: new Date().toISOString(),
                totalSamples: this.audioSamples.length,
                totalFrames: this.videoFrames.length,
                version: '1.0'
            }
        };

        return exportData;
    }

    /**
     * Extract features from audio samples for training
     */
    extractAudioFeatures() {
        return this.audioSamples.map(sample => {
            // Calculate basic features
            const features = {
                rms: sample.rms,
                zeroCrossings: this.calculateZeroCrossings(sample.waveform),
                spectralCentroid: this.calculateSpectralCentroid(sample.frequency),
                spectralRolloff: this.calculateSpectralRolloff(sample.frequency),
                energy: this.calculateEnergy(sample.waveform)
            };

            return features;
        });
    }

    /**
     * Generate one-hot encoded labels for audio samples
     */
    generateAudioLabels() {
        const labelMap = {
            'bat_ball_contact': 0,
            'bat_edge': 1,
            'bat_pad': 2,
            'ball_pad': 3,
            'bat_ground': 4,
            'ball_ground': 5,
            'noise': 6,
            'silence': 7
        };

        return this.audioSamples.map(sample => {
            const oneHot = new Array(8).fill(0);
            const index = labelMap[sample.label] || 6; // Default to noise
            oneHot[index] = 1;
            return oneHot;
        });
    }

    /**
     * Calculate zero crossings in waveform
     */
    calculateZeroCrossings(waveform) {
        let count = 0;
        for (let i = 1; i < waveform.length; i++) {
            const prev = waveform[i - 1] - 128;
            const curr = waveform[i] - 128;
            if ((prev >= 0 && curr < 0) || (prev < 0 && curr >= 0)) {
                count++;
            }
        }
        return count;
    }

    /**
     * Calculate spectral centroid
     */
    calculateSpectralCentroid(spectrum) {
        if (!spectrum) return 0;

        let weightedSum = 0;
        let sum = 0;

        for (let i = 0; i < spectrum.length; i++) {
            weightedSum += i * spectrum[i];
            sum += spectrum[i];
        }

        return sum > 0 ? weightedSum / sum : 0;
    }

    /**
     * Calculate spectral rolloff
     */
    calculateSpectralRolloff(spectrum, threshold = 0.85) {
        if (!spectrum) return 0;

        const totalEnergy = spectrum.reduce((sum, val) => sum + val, 0);
        const targetEnergy = totalEnergy * threshold;

        let cumEnergy = 0;
        for (let i = 0; i < spectrum.length; i++) {
            cumEnergy += spectrum[i];
            if (cumEnergy >= targetEnergy) {
                return i;
            }
        }

        return spectrum.length - 1;
    }

    /**
     * Calculate energy of waveform
     */
    calculateEnergy(waveform) {
        let sum = 0;
        for (let i = 0; i < waveform.length; i++) {
            const normalized = (waveform[i] - 128) / 128;
            sum += normalized * normalized;
        }
        return sum / waveform.length;
    }

    /**
     * Generate synthetic training data with augmentation
     */
    augmentData() {
        console.log('Augmenting training data...');

        const augmented = [];

        for (const sample of this.audioSamples) {
            // Original sample
            augmented.push(sample);

            // Add noise
            const noisyVersion = {
                ...sample,
                waveform: this.addNoise(sample.waveform, 0.05),
                metadata: { ...sample.metadata, augmentation: 'noise' }
            };
            augmented.push(noisyVersion);

            // Time stretch
            const stretchedVersion = {
                ...sample,
                waveform: this.timeStretch(sample.waveform, 1.1),
                metadata: { ...sample.metadata, augmentation: 'stretch' }
            };
            augmented.push(stretchedVersion);

            // Pitch shift
            const shiftedVersion = {
                ...sample,
                waveform: this.pitchShift(sample.waveform, 1.05),
                metadata: { ...sample.metadata, augmentation: 'pitch_shift' }
            };
            augmented.push(shiftedVersion);
        }

        console.log(`Augmented from ${this.audioSamples.length} to ${augmented.length} samples`);
        return augmented;
    }

    /**
     * Add Gaussian noise to waveform
     */
    addNoise(waveform, noiseLevel) {
        return waveform.map(val => {
            const noise = (Math.random() - 0.5) * noiseLevel * 255;
            return Math.max(0, Math.min(255, val + noise));
        });
    }

    /**
     * Time stretch waveform (simple resampling)
     */
    timeStretch(waveform, factor) {
        const newLength = Math.floor(waveform.length / factor);
        const stretched = new Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * factor;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, waveform.length - 1);
            const fraction = srcIndex - srcIndexFloor;

            stretched[i] = waveform[srcIndexFloor] * (1 - fraction) +
                          waveform[srcIndexCeil] * fraction;
        }

        return stretched;
    }

    /**
     * Pitch shift waveform (simplified)
     */
    pitchShift(waveform, semitones) {
        // This is a simplified pitch shift - in production use proper DSP
        const factor = Math.pow(2, semitones / 12);
        return this.timeStretch(waveform, factor);
    }

    /**
     * Update statistics
     */
    updateStats(label) {
        this.stats.totalSamples++;

        switch (label) {
            case 'bat_ball_contact':
                this.stats.batBallSamples++;
                break;
            case 'bat_edge':
                this.stats.edgeSamples++;
                break;
            case 'bat_pad':
            case 'ball_pad':
                this.stats.padSamples++;
                break;
            case 'noise':
            case 'silence':
                this.stats.noiseSamples++;
                break;
        }
    }

    /**
     * Save training data to localStorage
     */
    saveData() {
        try {
            const data = {
                audioSamples: this.audioSamples.slice(-1000), // Keep last 1000
                stats: this.stats,
                lastSaved: new Date().toISOString()
            };

            localStorage.setItem(this.storageKey, JSON.stringify(data));
            console.log('Training data saved to localStorage');
        } catch (error) {
            console.error('Failed to save training data:', error);
        }
    }

    /**
     * Load training data from localStorage
     */
    loadStoredData() {
        try {
            const stored = localStorage.getItem(this.storageKey);
            if (stored) {
                const data = JSON.parse(stored);
                this.audioSamples = data.audioSamples || [];
                this.stats = data.stats || this.stats;
                console.log(`Loaded ${this.audioSamples.length} training samples from storage`);
            }
        } catch (error) {
            console.error('Failed to load training data:', error);
        }
    }

    /**
     * Export training data to file
     */
    downloadTrainingData() {
        const data = this.exportForTraining();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `cricket-training-data-${Date.now()}.json`;
        a.click();

        URL.revokeObjectURL(url);
        console.log('Training data downloaded');
    }

    /**
     * Get statistics
     */
    getStats() {
        return {
            ...this.stats,
            audioSamples: this.audioSamples.length,
            videoFrames: this.videoFrames.length
        };
    }

    /**
     * Clear all training data
     */
    clearData() {
        if (confirm('Are you sure you want to clear all training data?')) {
            this.audioSamples = [];
            this.videoFrames = [];
            this.stats = {
                batBallSamples: 0,
                edgeSamples: 0,
                padSamples: 0,
                noiseSamples: 0,
                ballFrames: 0,
                totalSamples: 0
            };

            localStorage.removeItem(this.storageKey);
            console.log('Training data cleared');
        }
    }
}
