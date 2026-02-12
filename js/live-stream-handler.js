/**
 * LiveStreamHandler Class - Manages live stream capture and processing
 */
class LiveStreamHandler {
    constructor() {
        this.isLive = false;
        this.stream = null;
        this.cameras = {};
    }

    async startCamera(videoElement, constraints = {}) {
        try {
            const defaultConstraints = {
                video: { width: 1280, height: 720 },
                audio: true
            };

            this.stream = await navigator.mediaDevices.getUserMedia({
                ...defaultConstraints,
                ...constraints
            });

            videoElement.srcObject = this.stream;
            this.isLive = true;

            console.log('Camera started');
            return true;
        } catch (error) {
            console.error('Failed to start camera:', error);
            alert('Camera access denied or not available');
            return false;
        }
    }

    stopCamera() {
        if (this.stream) {
            this.stream.getTracks().forEach(track => track.stop());
            this.isLive = false;
            console.log('Camera stopped');
        }
    }

    async getAvailableDevices() {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return {
            video: devices.filter(d => d.kind === 'videoinput'),
            audio: devices.filter(d => d.kind === 'audioinput')
        };
    }

    /**
     * Check if camera stream is currently active
     */
    isActive() {
        return this.isLive && this.stream !== null;
    }

    /**
     * Get the current media stream
     */
    getStream() {
        return this.stream;
    }

    /**
     * Switch to a specific camera by device ID
     */
    async switchCamera(videoElement, deviceId) {
        this.stopCamera();

        try {
            this.stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    deviceId: { exact: deviceId },
                    width: 1280,
                    height: 720
                },
                audio: true
            });

            videoElement.srcObject = this.stream;
            this.isLive = true;
            console.log('Camera switched to device:', deviceId);
            return true;
        } catch (error) {
            console.error('Failed to switch camera:', error);
            return false;
        }
    }

    dispose() {
        this.stopCamera();
    }
}
