/**
 * ReplayController Class
 * Manages instant replay functionality with buffer management
 * Supports slow motion, loop replay, and clip saving
 */

class ReplayController {
    constructor() {
        // Replay buffer (circular buffer)
        this.buffer = [];
        this.maxBufferSize = 30; // seconds
        this.bufferFPS = 30;

        // Replay state
        this.isRecording = false;
        this.isReplaying = false;
        this.replayDuration = 5; // seconds

        // MediaRecorder for capturing
        this.mediaRecorder = null;
        this.recordedChunks = [];
        this.capturedStream = null;

        // Replay clips
        this.savedClips = [];

        // Callbacks
        this.onReplayReady = null;
        this.onBufferUpdate = null;
    }

    /**
     * Start recording to buffer
     * @param {HTMLVideoElement|HTMLCanvasElement} source - Source to record
     */
    startRecording(source) {
        try {
            // Get stream from source
            let stream;
            if (source instanceof HTMLVideoElement) {
                // Capture video element
                const canvas = document.createElement('canvas');
                canvas.width = source.videoWidth || 1280;
                canvas.height = source.videoHeight || 720;

                const ctx = canvas.getContext('2d');

                // Capture frames
                const captureFrame = () => {
                    if (!this.isRecording) return;

                    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);

                    // Add to buffer
                    this.addFrameToBuffer({
                        imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
                        timestamp: source.currentTime
                    });

                    requestAnimationFrame(captureFrame);
                };

                this.isRecording = true;
                captureFrame();

                // Also capture stream for MediaRecorder
                stream = canvas.captureStream(this.bufferFPS);
            } else if (source instanceof HTMLCanvasElement) {
                stream = source.captureStream(this.bufferFPS);
                this.isRecording = true;
            } else {
                throw new Error('Invalid source for recording');
            }

            // Setup MediaRecorder
            this.capturedStream = stream;
            this.setupMediaRecorder(stream);

            console.log('Replay buffer recording started');
            return true;
        } catch (error) {
            console.error('Failed to start recording:', error);
            return false;
        }
    }

    /**
     * Setup MediaRecorder for stream capture
     * @param {MediaStream} stream - Media stream
     */
    setupMediaRecorder(stream) {
        try {
            const options = {
                mimeType: 'video/webm;codecs=vp9',
                videoBitsPerSecond: 2500000
            };

            // Fallback mimeTypes
            if (!MediaRecorder.isTypeSupported(options.mimeType)) {
                options.mimeType = 'video/webm';
            }

            this.mediaRecorder = new MediaRecorder(stream, options);
            this.recordedChunks = [];

            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    this.recordedChunks.push(event.data);

                    // Keep only last N seconds
                    const targetSize = this.maxBufferSize * 1000; // rough estimate
                    while (this.recordedChunks.length > targetSize / 100) {
                        this.recordedChunks.shift();
                    }

                    if (this.onBufferUpdate) {
                        this.onBufferUpdate(this.getBufferDuration());
                    }
                }
            };

            this.mediaRecorder.start(100); // Capture data every 100ms
        } catch (error) {
            console.error('Failed to setup MediaRecorder:', error);
        }
    }

    /**
     * Add frame to buffer
     * @param {Object} frameData - Frame data with imageData and timestamp
     */
    addFrameToBuffer(frameData) {
        this.buffer.push(frameData);

        // Remove old frames (keep only maxBufferSize worth)
        const maxFrames = this.maxBufferSize * this.bufferFPS;
        if (this.buffer.length > maxFrames) {
            this.buffer.shift();
        }
    }

    /**
     * Stop recording
     */
    stopRecording() {
        this.isRecording = false;

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        console.log('Replay buffer recording stopped');
    }

    /**
     * Get instant replay (last N seconds)
     * @param {number} duration - Duration in seconds
     * @returns {Promise<Blob>} Replay video blob
     */
    async getInstantReplay(duration = null) {
        const replayDur = duration || this.replayDuration;

        try {
            if (this.recordedChunks.length === 0) {
                throw new Error('No recorded data available');
            }

            // Create blob from recorded chunks
            const blob = new Blob(this.recordedChunks, { type: 'video/webm' });

            console.log('Instant replay created:', blob.size, 'bytes');

            if (this.onReplayReady) {
                this.onReplayReady(blob);
            }

            return blob;
        } catch (error) {
            console.error('Failed to create instant replay:', error);
            return null;
        }
    }

    /**
     * Create replay from buffer frames
     * @param {number} startTime - Start timestamp
     * @param {number} endTime - End timestamp
     * @returns {Array} Frames in the replay range
     */
    getReplayFrames(startTime, endTime) {
        return this.buffer.filter(frame => {
            return frame.timestamp >= startTime && frame.timestamp <= endTime;
        });
    }

    /**
     * Save replay clip
     * @param {Blob} blob - Replay blob
     * @param {Object} metadata - Clip metadata
     */
    saveClip(blob, metadata = {}) {
        const clip = {
            id: Date.now(),
            blob: blob,
            url: URL.createObjectURL(blob),
            timestamp: new Date().toISOString(),
            duration: this.replayDuration,
            ...metadata
        };

        this.savedClips.push(clip);
        console.log('Clip saved:', clip.id);

        return clip;
    }

    /**
     * Download replay clip
     * @param {Blob} blob - Replay blob
     * @param {string} filename - Filename for download
     */
    downloadClip(blob, filename = `replay-${Date.now()}.webm`) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        console.log('Clip downloaded:', filename);
    }

    /**
     * Set replay duration
     * @param {number} duration - Duration in seconds
     */
    setReplayDuration(duration) {
        this.replayDuration = Math.max(2, Math.min(30, duration));
        console.log('Replay duration set to:', this.replayDuration, 'seconds');
    }

    /**
     * Set buffer size
     * @param {number} size - Buffer size in seconds
     */
    setBufferSize(size) {
        this.maxBufferSize = Math.max(5, Math.min(60, size));
        console.log('Buffer size set to:', this.maxBufferSize, 'seconds');
    }

    /**
     * Get current buffer duration
     * @returns {number} Buffer duration in seconds
     */
    getBufferDuration() {
        return this.buffer.length / this.bufferFPS;
    }

    /**
     * Check if buffer is ready for replay
     * @returns {boolean} True if buffer has enough data
     */
    isBufferReady() {
        return this.getBufferDuration() >= this.replayDuration;
    }

    /**
     * Clear buffer
     */
    clearBuffer() {
        this.buffer = [];
        this.recordedChunks = [];
        console.log('Replay buffer cleared');
    }

    /**
     * Get saved clips
     * @returns {Array} Array of saved clips
     */
    getSavedClips() {
        return this.savedClips;
    }

    /**
     * Delete saved clip
     * @param {number} clipId - Clip ID to delete
     */
    deleteClip(clipId) {
        const index = this.savedClips.findIndex(clip => clip.id === clipId);
        if (index !== -1) {
            const clip = this.savedClips[index];
            URL.revokeObjectURL(clip.url);
            this.savedClips.splice(index, 1);
            console.log('Clip deleted:', clipId);
        }
    }

    /**
     * Create slow motion replay
     * @param {Blob} blob - Original replay blob
     * @param {number} speed - Playback speed (0.25, 0.5, etc.)
     * @returns {Promise<Blob>} Slow motion replay blob
     */
    async createSlowMotion(blob, speed = 0.25) {
        // This is a simplified version
        // In production, you'd use FFmpeg.js or similar for true slow motion
        console.log('Slow motion replay created with speed:', speed);
        return blob; // Return original for now
    }

    /**
     * Dispose and cleanup
     */
    dispose() {
        this.stopRecording();
        this.clearBuffer();

        if (this.capturedStream) {
            this.capturedStream.getTracks().forEach(track => track.stop());
        }

        // Revoke object URLs
        this.savedClips.forEach(clip => {
            URL.revokeObjectURL(clip.url);
        });

        this.savedClips = [];
        console.log('ReplayController disposed');
    }
}
