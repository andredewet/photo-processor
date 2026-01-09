import { Injectable } from '@angular/core';
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera';
import BackgroundRemoval from '../plugins/background-removal.plugin';

export interface ProcessedImage {
  dataUrl: string;
  blob: Blob;
  size: number;
}

export interface BackgroundRemovalResult {
  dataUrl: string;
  faceDetected: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ImageProcessingService {
  private bgRemovalAvailable: boolean | null = null;

  constructor() {
    this.checkBackgroundRemovalAvailability();
  }

  private async checkBackgroundRemovalAvailability() {
    try {
      const result = await BackgroundRemoval.isAvailable();
      this.bgRemovalAvailable = result.available;
      console.log(`Background removal available: ${result.available} (${result.platform})`);
    } catch (e) {
      this.bgRemovalAvailable = false;
      console.log('Background removal not available');
    }
  }

  /**
   * Take a picture using the device camera
   */
  async takePicture(): Promise<string> {
    const image = await Camera.getPhoto({
      quality: 100,
      allowEditing: false,
      resultType: CameraResultType.DataUrl,
      source: CameraSource.Camera
    });
    return image.dataUrl || '';
  }

  /**
   * Crop an image
   */
  async cropImage(dataUrl: string, x: number, y: number, width: number, height: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Resize image to 256x256 using Canvas API with high quality interpolation
   */
  async resizeImage(dataUrl: string, width: number = 256, height: number = 256): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        canvas.width = width;
        canvas.height = height;
        
        // Use high quality interpolation
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  /**
   * Compress image to JPEG with target file size (~10KB) using iterative quality adjustment
   * This ensures consistent file sizes across all browsers
   */
  async compressImage(dataUrl: string, targetSizeKB: number = 10): Promise<ProcessedImage> {
    // Load the image once
    const img = await this.loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Could not get canvas context');
    }
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    
    // Binary search for optimal quality to hit target size
    let minQuality = 0.10;
    let maxQuality = 0.95;
    let quality = 0.70;
    let bestBlob: Blob | null = null;
    let bestDataUrl: string = '';
    
    const targetBytes = targetSizeKB * 1024;
    const tolerance = 1024; // 1KB tolerance
    
    for (let i = 0; i < 8; i++) { // Max 8 iterations
      const blob = await this.canvasToBlob(canvas, quality);
      
      // Check if we're close enough to target
      if (Math.abs(blob.size - targetBytes) < tolerance) {
        bestBlob = blob;
        break;
      }
      
      // Always keep the best result so far
      if (!bestBlob || Math.abs(blob.size - targetBytes) < Math.abs(bestBlob.size - targetBytes)) {
        bestBlob = blob;
      }
      
      // Binary search adjustment
      if (blob.size > targetBytes) {
        maxQuality = quality;
        quality = (minQuality + quality) / 2;
      } else {
        minQuality = quality;
        quality = (maxQuality + quality) / 2;
      }
    }
    
    if (!bestBlob) {
      throw new Error('Failed to compress image');
    }
    
    // Convert blob to data URL
    bestDataUrl = await this.blobToDataUrl(bestBlob);
    
    return {
      dataUrl: bestDataUrl,
      blob: bestBlob,
      size: bestBlob.size
    };
  }
  
  private loadImage(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }
  
  private canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to create blob'));
        }
      }, 'image/jpeg', quality);
    });
  }
  
  private blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Remove background from image using native APIs
   * - iOS: Vision framework + Core Image (face detection + elliptical mask)
   * - Android: ML Kit Selfie Segmentation
   * - Web: Simple elliptical mask fallback
   */
  async removeBackground(dataUrl: string, useEllipticalMask: boolean = true): Promise<BackgroundRemovalResult> {
    try {
      const result = await BackgroundRemoval.removeBackground({
        imageData: dataUrl,
        useEllipticalMask
      });
      return {
        dataUrl: result.dataUrl,
        faceDetected: result.faceDetected
      };
    } catch (error) {
      console.error('Background removal failed:', error);
      throw error;
    }
  }

  /**
   * Check if native background removal is available
   */
  async isBackgroundRemovalAvailable(): Promise<boolean> {
    if (this.bgRemovalAvailable !== null) {
      return this.bgRemovalAvailable;
    }
    await this.checkBackgroundRemovalAvailability();
    return this.bgRemovalAvailable ?? false;
  }
}

