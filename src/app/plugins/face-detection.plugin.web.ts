import { WebPlugin } from '@capacitor/core';
import type { 
  FaceDetectionPlugin, 
  FaceDetectionResult, 
  FaceBounds, 
  FaceGuidance,
  OvalBounds 
} from './face-detection.plugin';

// TensorFlow.js types
declare const tf: any;
declare const blazeface: any;

export class FaceDetectionWeb extends WebPlugin implements FaceDetectionPlugin {
  private model: any = null;
  private isInitializing = false;
  private scriptsLoaded = false;

  async initialize(): Promise<{ success: boolean }> {
    if (this.model) {
      return { success: true };
    }

    if (this.isInitializing) {
      // Wait for ongoing initialization
      await this.waitForModel();
      return { success: this.model !== null };
    }

    this.isInitializing = true;

    try {
      // Load TensorFlow.js and BlazeFace scripts dynamically
      await this.loadScripts();
      
      // Load the BlazeFace model
      console.log('Loading BlazeFace model...');
      this.model = await blazeface.load();
      console.log('BlazeFace model loaded successfully');
      
      this.isInitializing = false;
      return { success: true };
    } catch (error) {
      console.error('Failed to initialize face detection:', error);
      this.isInitializing = false;
      return { success: false };
    }
  }

  private async loadScripts(): Promise<void> {
    if (this.scriptsLoaded) return;

    // Check if already loaded
    if (typeof tf !== 'undefined' && typeof blazeface !== 'undefined') {
      this.scriptsLoaded = true;
      return;
    }

    // Load TensorFlow.js
    await this.loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js');
    
    // Wait for TensorFlow to be ready
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Load BlazeFace (version 0.0.7 is the stable release)
    await this.loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/blazeface@0.0.7/dist/blazeface.js');
    
    // Wait for BlazeFace to be ready
    await new Promise(resolve => setTimeout(resolve, 300));
    
    this.scriptsLoaded = true;
  }

  private loadScript(src: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Check if script already exists
      if (document.querySelector(`script[src="${src}"]`)) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load script: ${src}`));
      document.head.appendChild(script);
    });
  }

  private async waitForModel(): Promise<void> {
    const maxWait = 30000; // 30 seconds
    const checkInterval = 100;
    let waited = 0;
    
    while (this.isInitializing && waited < maxWait) {
      await new Promise(resolve => setTimeout(resolve, checkInterval));
      waited += checkInterval;
    }
  }

  async detectFace(options: {
    imageData: string;
    ovalBounds: OvalBounds;
  }): Promise<FaceDetectionResult> {
    // Initialize if not already done
    if (!this.model) {
      const initResult = await this.initialize();
      if (!initResult.success) {
        return {
          faceDetected: false,
          guidance: 'no_face'
        };
      }
    }

    try {
      // Create image element from data URL
      const img = await this.loadImage(options.imageData);
      
      // Run face detection
      const predictions = await this.model.estimateFaces(img, false);
      
      if (!predictions || predictions.length === 0) {
        return {
          faceDetected: false,
          guidance: 'no_face'
        };
      }

      if (predictions.length > 1) {
        return {
          faceDetected: true,
          guidance: 'multiple_faces'
        };
      }

      const prediction = predictions[0];
      
      // Convert to normalized bounds (0-1)
      const bounds: FaceBounds = {
        x: prediction.topLeft[0] / img.width,
        y: prediction.topLeft[1] / img.height,
        width: (prediction.bottomRight[0] - prediction.topLeft[0]) / img.width,
        height: (prediction.bottomRight[1] - prediction.topLeft[1]) / img.height
      };

      // Calculate guidance
      const guidance = this.calculateGuidance(bounds, options.ovalBounds);

      return {
        faceDetected: true,
        bounds,
        guidance,
        confidence: prediction.probability?.[0] ?? 0.9
      };
    } catch (error) {
      console.error('Face detection error:', error);
      return {
        faceDetected: false,
        guidance: 'no_face'
      };
    }
  }

  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  private calculateGuidance(face: FaceBounds, oval: OvalBounds): FaceGuidance {
    // BlazeFace detects face features (eyes, nose, mouth) not full head
    // Reduced padding for less sensitive detection
    const headPaddingTop = face.height * 0.40;   // 40% for forehead/hair
    const headPaddingBottom = face.height * 0.08; // 8% for chin
    const headPaddingSide = face.width * 0.10;   // 10% for ears
    
    // Expanded bounds to represent full head
    const faceLeft = face.x - headPaddingSide;
    const faceRight = face.x + face.width + headPaddingSide;
    const faceTop = face.y - headPaddingTop;
    const faceBottom = face.y + face.height + headPaddingBottom;
    
    const faceCenterX = (faceLeft + faceRight) / 2;
    const faceCenterY = (faceTop + faceBottom) / 2;
    
    // Oval edges (approximate as rectangle for simplicity)
    const ovalLeft = oval.centerX - oval.radiusX;
    const ovalRight = oval.centerX + oval.radiusX;
    const ovalTop = oval.centerY - oval.radiusY;
    const ovalBottom = oval.centerY + oval.radiusY;
    
    // Check head size relative to oval (using expanded bounds)
    const headWidth = faceRight - faceLeft;
    const headHeight = faceBottom - faceTop;
    const headSize = Math.max(headWidth, headHeight);
    const ovalSize = Math.max(oval.radiusX * 2, oval.radiusY * 2);
    const sizeRatio = headSize / ovalSize;
    
    // Too small = move closer (face should fill 80% of oval)
    if (sizeRatio < 0.8) {
      return 'move_closer';
    }
    
    // Too large = move back (face should be at most 115% of oval size)
    if (sizeRatio > 1.15) {
      return 'move_back';
    }
    
    // Calculate how far outside each edge the face is
    const leftOverflow = ovalLeft - faceLeft;      // Positive = face too far left
    const rightOverflow = faceRight - ovalRight;   // Positive = face too far right
    const topOverflow = ovalTop - faceTop;         // Positive = face too high
    const bottomOverflow = faceBottom - ovalBottom; // Positive = face too low
    
    // Find the largest overflow and return that direction
    const overflows = [
      { value: leftOverflow, guidance: 'move_right' as FaceGuidance },
      { value: rightOverflow, guidance: 'move_left' as FaceGuidance },
      { value: topOverflow, guidance: 'move_down' as FaceGuidance },
      { value: bottomOverflow, guidance: 'move_up' as FaceGuidance }
    ];
    
    // Sort by overflow amount (largest first)
    overflows.sort((a, b) => b.value - a.value);
    
    // If any edge is outside bounds, return the direction with largest overflow
    if (overflows[0].value > 0) {
      return overflows[0].guidance;
    }
    
    // Check center is reasonably close to oval center
    const centerThreshold = 0.15;
    const xOffset = Math.abs(faceCenterX - oval.centerX);
    const yOffset = Math.abs(faceCenterY - oval.centerY);
    
    // Prioritize the larger offset
    if (xOffset > centerThreshold || yOffset > centerThreshold) {
      if (yOffset > xOffset) {
        return faceCenterY < oval.centerY ? 'move_down' : 'move_up';
      } else {
        return faceCenterX < oval.centerX ? 'move_right' : 'move_left';
      }
    }
    
    // Face is properly contained and centered!
    return 'hold_still';
  }

  async isAvailable(): Promise<{ available: boolean; platform: string }> {
    return {
      available: true,
      platform: 'web'
    };
  }

  async dispose(): Promise<void> {
    if (this.model) {
      // BlazeFace doesn't have explicit dispose, but we can clear the reference
      this.model = null;
    }
  }
}

