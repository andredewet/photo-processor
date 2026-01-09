import { Component, ElementRef, ViewChild, OnDestroy, OnInit, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Capacitor } from '@capacitor/core';
import { ImageProcessingService, ProcessedImage } from '../services/image-processing.service';
import FaceDetection, { FaceGuidance, getGuidanceMessage } from '../plugins/face-detection.plugin';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  imports: [CommonModule],
})
export class HomePage implements OnInit, OnDestroy {
  @ViewChild('videoElement') videoElement!: ElementRef<HTMLVideoElement>;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('detectionCanvas') detectionCanvas!: ElementRef<HTMLCanvasElement>;

  // State
  processedImage: ProcessedImage | null = null;
  isProcessing = false;
  processingStep = '';
  isCameraActive = false;
  
  // Camera state
  isWebCameraActive = false;
  useFrontCamera = true;
  private mediaStream: MediaStream | null = null;
  
  // Face detection state
  faceGuidance: FaceGuidance = 'no_face';
  guidanceMessage = 'Initializing...';
  private faceDetectionReady = false;
  private isDetecting = false;
  private detectionInterval: any = null;
  
  // Oval bounds for face positioning (normalized 0-1)
  // Oval bounds - slightly taller than wide (face shape)
  private readonly ovalBounds = {
    centerX: 0.50,
    centerY: 0.50,
    radiusX: 0.32,  // Narrower
    radiusY: 0.42   // Taller - more face-shaped
  };

  constructor(
    private imageProcessingService: ImageProcessingService,
    private ngZone: NgZone
  ) {
    this.initializeFaceDetection();
  }

  ngOnInit() {
    // Auto-start camera on load
    this.startCamera();
  }

  ngOnDestroy() {
    this.stopWebCamera();
    this.stopFaceDetection();
    FaceDetection.dispose().catch(() => {});
  }

  private async initializeFaceDetection() {
    try {
      console.log('Initializing face detection...');
      const result = await FaceDetection.initialize();
      this.faceDetectionReady = result.success;
      console.log('Face detection ready:', result.success);
      
      if (result.success) {
        this.guidanceMessage = 'Position your face in the frame';
      } else {
        this.guidanceMessage = 'Face detection unavailable';
      }
    } catch (error) {
      console.error('Face detection init error:', error);
      this.faceDetectionReady = false;
      this.guidanceMessage = 'Face detection unavailable';
    }
  }

  async startCamera() {
    this.isCameraActive = true;
    this.processedImage = null;
    this.faceGuidance = 'no_face';
    this.guidanceMessage = this.faceDetectionReady ? 'Position your face in the frame' : 'Initializing...';
    
    if (!Capacitor.isNativePlatform()) {
      setTimeout(() => this.startWebCamera(), 100);
    }
  }

  async startWebCamera() {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: this.useFrontCamera ? 'user' : 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      };
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      this.isWebCameraActive = true;
      
      const attachStream = (retries = 5) => {
        if (this.videoElement?.nativeElement && this.mediaStream) {
          const video = this.videoElement.nativeElement;
          video.srcObject = this.mediaStream;
          video.onloadedmetadata = () => {
            video.play()
              .then(() => {
                console.log('Camera stream started');
                // Start face detection after video is playing
                this.startFaceDetection();
              })
              .catch(err => console.error('Error playing video:', err));
          };
        } else if (retries > 0) {
          setTimeout(() => attachStream(retries - 1), 100);
        }
      };
      
      setTimeout(() => attachStream(), 100);
    } catch (error) {
      console.error('Error accessing camera:', error);
      this.isWebCameraActive = false;
      this.isCameraActive = false;
    }
  }

  private startFaceDetection() {
    if (this.detectionInterval) return;
    
    // Wait for face detection to be ready
    const startLoop = (retries = 20) => {
      if (this.faceDetectionReady) {
        console.log('Starting face detection loop');
        this.detectionInterval = setInterval(() => {
          if (this.isWebCameraActive && !this.isDetecting) {
            this.detectFaceInFrame();
          }
        }, 250); // 4 FPS
      } else if (retries > 0) {
        setTimeout(() => startLoop(retries - 1), 500);
      } else {
        console.log('Face detection not available, skipping');
        this.guidanceMessage = 'Position your face in the frame';
      }
    };
    
    startLoop();
  }

  private stopFaceDetection() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    this.isDetecting = false;
  }

  private async detectFaceInFrame() {
    if (!this.videoElement?.nativeElement || !this.detectionCanvas?.nativeElement) {
      return;
    }

    const video = this.videoElement.nativeElement;
    if (video.videoWidth === 0 || video.videoHeight === 0) {
      return;
    }

    this.isDetecting = true;

    try {
      const canvas = this.detectionCanvas.nativeElement;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Crop video to square (like object-fit: cover) to match visual display
      const videoWidth = video.videoWidth;
      const videoHeight = video.videoHeight;
      const size = Math.min(videoWidth, videoHeight);
      
      // Calculate crop offsets (center crop)
      const cropX = (videoWidth - size) / 2;
      const cropY = (videoHeight - size) / 2;
      
      // Use smaller canvas for faster detection
      const canvasSize = Math.floor(size * 0.4);
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      
      // Mirror if using front camera
      if (this.useFrontCamera) {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      
      // Draw cropped square portion of video
      ctx.drawImage(video, cropX, cropY, size, size, 0, 0, canvasSize, canvasSize);

      const frameData = canvas.toDataURL('image/jpeg', 0.5);

      const result = await FaceDetection.detectFace({
        imageData: frameData,
        ovalBounds: this.ovalBounds
      });

      // Update UI in Angular zone
      this.ngZone.run(() => {
        this.faceGuidance = result.guidance;
        this.guidanceMessage = getGuidanceMessage(result.guidance);
      });

    } catch (error) {
      console.error('Face detection error:', error);
    } finally {
      this.isDetecting = false;
    }
  }

  stopWebCamera() {
    this.stopFaceDetection();
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    this.isWebCameraActive = false;
  }

  async captureAndProcess() {
    try {
      let imageData: string;
      let imageWidth: number;
      let imageHeight: number;
      
      if (this.isWebCameraActive && this.videoElement?.nativeElement && this.canvasElement?.nativeElement) {
        const video = this.videoElement.nativeElement;
        const canvas = this.canvasElement.nativeElement;
        
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        imageWidth = video.videoWidth;
        imageHeight = video.videoHeight;
        
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        if (this.useFrontCamera) {
          ctx.translate(canvas.width, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(video, 0, 0);
        
        imageData = canvas.toDataURL('image/jpeg', 0.95);
        this.stopWebCamera();
      } else {
        imageData = await this.imageProcessingService.takePicture();
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => {
            imageWidth = img.naturalWidth;
            imageHeight = img.naturalHeight;
            resolve();
          };
          img.src = imageData;
        });
      }
      
      this.isCameraActive = false;
      this.isProcessing = true;
      
      const minDim = Math.min(imageWidth!, imageHeight!);
      const cropSize = Math.floor(minDim * 0.85);
      const cropX = Math.floor((imageWidth! - cropSize) / 2);
      const cropY = Math.floor((imageHeight! - cropSize) / 2);
      
      this.processingStep = 'Cropping...';
      let processed = await this.imageProcessingService.cropImage(imageData, cropX, cropY, cropSize, cropSize);
      
      this.processingStep = 'Resizing...';
      processed = await this.imageProcessingService.resizeImage(processed, 256, 256);
      
      this.processingStep = 'Compressing to ~10KB...';
      const result = await this.imageProcessingService.compressImage(processed, 10); // Target 10KB
      
      this.processedImage = result;
      this.processingStep = '';
      
    } catch (error) {
      console.error('Error:', error);
      this.processingStep = 'Error: ' + (error instanceof Error ? error.message : 'Unknown error');
      this.isCameraActive = false;
    } finally {
      this.isProcessing = false;
    }
  }

  retake() {
    this.processedImage = null;
    this.startCamera();
  }

  async downloadImage() {
    if (!this.processedImage) return;

    try {
      const link = document.createElement('a');
      link.href = this.processedImage.dataUrl;
      link.download = `photo-${Date.now()}.jpg`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Error downloading:', error);
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }
}
