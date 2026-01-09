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

    dispose() {
        this.stopCamera();
    }
}
