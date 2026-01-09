import { WebPlugin } from '@capacitor/core';
import type { BackgroundRemovalPlugin, BackgroundRemovalResult } from './background-removal.plugin';

export class BackgroundRemovalWeb extends WebPlugin implements BackgroundRemovalPlugin {
  
  async removeBackground(options: { 
    imageData: string; 
    useEllipticalMask?: boolean;
  }): Promise<BackgroundRemovalResult> {
    // Web fallback: Apply simple elliptical vignette mask
    // This is a simplified version - native implementations will be much better
    console.log('Using web fallback for background removal (elliptical mask only)');
    
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }
        
        const size = Math.min(img.width, img.height);
        canvas.width = size;
        canvas.height = size;
        
        // Fill with white background
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, size, size);
        
        // Create elliptical clip path
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(
          size / 2,
          size / 2,
          size * 0.45,  // horizontal radius
          size * 0.48,  // vertical radius (slightly taller for face)
          0,
          0,
          Math.PI * 2
        );
        ctx.closePath();
        ctx.clip();
        
        // Draw image centered
        const offsetX = (img.width - size) / 2;
        const offsetY = (img.height - size) / 2;
        ctx.drawImage(img, -offsetX, -offsetY);
        
        ctx.restore();
        
        resolve({
          dataUrl: canvas.toDataURL('image/png'),
          faceDetected: true // We don't actually detect on web
        });
      };
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = options.imageData;
    });
  }

  async isAvailable(): Promise<{ available: boolean; platform: string }> {
    return { 
      available: true, 
      platform: 'web' 
    };
  }
}

