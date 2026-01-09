/**
 * VideoAnalyzer Class - Frame-by-frame video analysis
 */
class VideoAnalyzer {
    constructor(videoElement) {
        this.video = videoElement;
        this.currentFrame = 0;
        this.fps = 30;
    }

    captureCurrentFrame() {
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0);
        return ctx.getImageData(0, 0, canvas.width, canvas.height);
    }

    async exportFrame(format = 'png') {
        const canvas = document.createElement('canvas');
        canvas.width = this.video.videoWidth;
        canvas.height = this.video.videoHeight;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(this.video, 0, 0);

        return new Promise(resolve => {
            canvas.toBlob(blob => resolve(blob), `image/${format}`);
        });
    }

    getFrameAtTime(time) {
        this.video.currentTime = time;
        return this.captureCurrentFrame();
    }
}
