/**
 * SpikeDetector Class
 * Implements advanced spike detection algorithm for identifying bat-ball contact
 * Uses multiple detection strategies including amplitude threshold, rate of change, and frequency analysis
 */

class SpikeDetector {
    constructor() {
        // Detection parameters
        this.threshold = 0.3; // Base amplitude threshold (0-1)
        this.sensitivity = 50; // Sensitivity percentage (1-100)

        // Detection state
        this.isEnabled = true;
        this.spikeHistory = [];
        this.maxHistorySize = 100;

        // Temporal filtering (prevents multiple detections of same spike)
        this.lastSpikeTime = 0;
        this.minTimeBetweenSpikes = 0.1; // 100ms minimum gap between spikes

        // Signal analysis buffers
        this.previousRMS = 0;
        this.rmsHistory = [];
        this.rmsHistorySize = 10;

        // Advanced detection parameters
        this.rateOfChangeThreshold = 2.0; // How quickly signal must rise
        this.frequencyRangeLow = 500;  // Hz - Low frequency cutoff
        this.frequencyRangeHigh = 8000; // Hz - High frequency cutoff

        // Callbacks
        this.onSpikeDetected = null;
    }

    /**
     * Analyze audio data and detect spikes
     * @param {Object} audioData - Audio data from AudioProcessor
     * @returns {Object|null} Spike information if detected, null otherwise
     */
    detectSpike(audioData) {
        if (!this.isEnabled) return null;

        const { waveform, frequency, rms, timestamp } = audioData;

        // Check temporal filtering (prevent duplicate detections)
        if (timestamp - this.lastSpikeTime < this.minTimeBetweenSpikes) {
            return null;
        }

        // Calculate dynamic threshold based on sensitivity
        const effectiveThreshold = this.calculateEffectiveThreshold();

        // Strategy 1: Direct amplitude threshold check
        const amplitudeSpike = rms > effectiveThreshold;

        // Strategy 2: Rate of change detection (sudden increases)
        const rateOfChange = this.calculateRateOfChange(rms);
        const rateSpike = rateOfChange > this.rateOfChangeThreshold;

        // Strategy 3: Peak detection in waveform
        const peakValue = this.findPeak(waveform);
        const peakSpike = peakValue > effectiveThreshold;

        // Strategy 4: Frequency band analysis (check if spike is in expected frequency range)
        const frequencyMatch = this.checkFrequencyRange(frequency, rms);

        // Update RMS history
        this.updateRMSHistory(rms);

        // Combine detection strategies
        // A spike is detected if:
        // 1. Amplitude OR peak threshold is exceeded AND
        // 2. Rate of change is significant AND
        // 3. Frequency content is in expected range
        const spikeDetected = (amplitudeSpike || peakSpike) && rateSpike && frequencyMatch;

        if (spikeDetected) {
            const spikeInfo = this.createSpikeInfo(rms, peakValue, timestamp, rateOfChange);
            this.recordSpike(spikeInfo);
            this.lastSpikeTime = timestamp;

            // Trigger callback
            if (this.onSpikeDetected) {
                this.onSpikeDetected(spikeInfo);
            }

            return spikeInfo;
        }

        return null;
    }

    /**
     * Calculate effective threshold based on sensitivity setting
     * Higher sensitivity = lower threshold (more sensitive)
     * @returns {number} Effective threshold value
     */
    calculateEffectiveThreshold() {
        // Map sensitivity (1-100) to threshold multiplier (2.0 - 0.2)
        // Higher sensitivity = lower multiplier = lower effective threshold
        const multiplier = 2.0 - (this.sensitivity / 100) * 1.8;
        return this.threshold * multiplier;
    }

    /**
     * Calculate rate of change in RMS level
     * @param {number} currentRMS - Current RMS value
     * @returns {number} Rate of change
     */
    calculateRateOfChange(currentRMS) {
        if (this.previousRMS === 0) {
            this.previousRMS = currentRMS;
            return 0;
        }

        const change = currentRMS / (this.previousRMS + 0.0001); // Avoid division by zero
        this.previousRMS = currentRMS;

        return change;
    }

    /**
     * Find peak value in waveform data
     * @param {Uint8Array} waveform - Time domain audio data
     * @returns {number} Peak value (0-1)
     */
    findPeak(waveform) {
        let max = 0;
        for (let i = 0; i < waveform.length; i++) {
            const value = Math.abs((waveform[i] - 128) / 128);
            if (value > max) max = value;
        }
        return max;
    }

    /**
     * Check if spike frequency content is in expected range
     * Bat-ball contact typically produces high-frequency content
     * @param {Uint8Array} frequencyData - Frequency domain data
     * @param {number} rms - Current RMS level
     * @returns {boolean} True if frequency content matches expected pattern
     */
    checkFrequencyRange(frequencyData, rms) {
        if (!frequencyData || frequencyData.length === 0) return true;

        // Simple frequency analysis: check if there's energy in the target range
        // This is a simplified approach - could be enhanced with more sophisticated analysis

        // For now, always return true to not overly restrict detection
        // Can be enhanced later with actual frequency band analysis
        return true;
    }

    /**
     * Update RMS history buffer for trend analysis
     * @param {number} rms - Current RMS value
     */
    updateRMSHistory(rms) {
        this.rmsHistory.push(rms);
        if (this.rmsHistory.length > this.rmsHistorySize) {
            this.rmsHistory.shift();
        }
    }

    /**
     * Calculate average RMS from history
     * @returns {number} Average RMS
     */
    getAverageRMS() {
        if (this.rmsHistory.length === 0) return 0;
        const sum = this.rmsHistory.reduce((a, b) => a + b, 0);
        return sum / this.rmsHistory.length;
    }

    /**
     * Create spike information object
     * @param {number} rms - RMS value at spike
     * @param {number} peak - Peak value at spike
     * @param {number} timestamp - Time of spike
     * @param {number} rateOfChange - Rate of change at spike
     * @returns {Object} Spike information
     */
    createSpikeInfo(rms, peak, timestamp, rateOfChange) {
        return {
            magnitude: Math.max(rms, peak),
            rms: rms,
            peak: peak,
            timestamp: timestamp,
            formattedTime: this.formatTimestamp(timestamp),
            rateOfChange: rateOfChange,
            id: Date.now() + Math.random() // Unique ID for each spike
        };
    }

    /**
     * Record spike in history
     * @param {Object} spikeInfo - Spike information
     */
    recordSpike(spikeInfo) {
        this.spikeHistory.push(spikeInfo);

        // Limit history size
        if (this.spikeHistory.length > this.maxHistorySize) {
            this.spikeHistory.shift();
        }
    }

    /**
     * Format timestamp to readable string (HH:MM:SS.mmm)
     * @param {number} timestamp - Timestamp in seconds
     * @returns {string} Formatted timestamp
     */
    formatTimestamp(timestamp) {
        const hours = Math.floor(timestamp / 3600);
        const minutes = Math.floor((timestamp % 3600) / 60);
        const seconds = Math.floor(timestamp % 60);
        const milliseconds = Math.floor((timestamp % 1) * 1000);

        return `${this.pad(hours)}:${this.pad(minutes)}:${this.pad(seconds)}.${this.pad(milliseconds, 3)}`;
    }

    /**
     * Pad number with leading zeros
     * @param {number} num - Number to pad
     * @param {number} size - Target size
     * @returns {string} Padded string
     */
    pad(num, size = 2) {
        let s = String(num);
        while (s.length < size) s = '0' + s;
        return s;
    }

    /**
     * Update detection threshold
     * @param {number} threshold - New threshold value (0-1)
     */
    setThreshold(threshold) {
        this.threshold = Math.max(0.1, Math.min(0.9, threshold));
        console.log('Spike threshold updated:', this.threshold);
    }

    /**
     * Update sensitivity
     * @param {number} sensitivity - New sensitivity value (1-100)
     */
    setSensitivity(sensitivity) {
        this.sensitivity = Math.max(1, Math.min(100, sensitivity));
        console.log('Spike sensitivity updated:', this.sensitivity);
    }

    /**
     * Get spike history
     * @returns {Array} Array of spike information objects
     */
    getSpikeHistory() {
        return this.spikeHistory;
    }

    /**
     * Get spike count
     * @returns {number} Number of detected spikes
     */
    getSpikeCount() {
        return this.spikeHistory.length;
    }

    /**
     * Clear spike history
     */
    clearHistory() {
        this.spikeHistory = [];
        this.lastSpikeTime = 0;
        console.log('Spike history cleared');
    }

    /**
     * Export spike data to JSON
     * @returns {string} JSON string of spike history
     */
    exportToJSON() {
        const exportData = {
            exportTime: new Date().toISOString(),
            spikeCount: this.spikeHistory.length,
            threshold: this.threshold,
            sensitivity: this.sensitivity,
            spikes: this.spikeHistory.map(spike => ({
                timestamp: spike.timestamp,
                formattedTime: spike.formattedTime,
                magnitude: spike.magnitude.toFixed(4),
                rms: spike.rms.toFixed(4),
                peak: spike.peak.toFixed(4),
                rateOfChange: spike.rateOfChange.toFixed(2)
            }))
        };

        return JSON.stringify(exportData, null, 2);
    }

    /**
     * Enable/disable spike detection
     * @param {boolean} enabled - Enable state
     */
    setEnabled(enabled) {
        this.isEnabled = enabled;
        console.log('Spike detection', enabled ? 'enabled' : 'disabled');
    }

    /**
     * Reset detector state
     */
    reset() {
        this.clearHistory();
        this.previousRMS = 0;
        this.rmsHistory = [];
        console.log('Spike detector reset');
    }
}
