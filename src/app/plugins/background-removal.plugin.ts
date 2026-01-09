import { registerPlugin } from '@capacitor/core';

export interface BackgroundRemovalResult {
  /** Base64 encoded image with background removed/replaced with white */
  dataUrl: string;
  /** Whether face was detected */
  faceDetected: boolean;
}

export interface BackgroundRemovalPlugin {
  /**
   * Remove background from image and replace with white.
   * Uses Vision + Core Image on iOS, ML Kit on Android.
   * @param options - Image data URL and options
   */
  removeBackground(options: { 
    imageData: string;
    /** Use elliptical mask around face (iOS only) */
    useEllipticalMask?: boolean;
  }): Promise<BackgroundRemovalResult>;

  /**
   * Check if native background removal is available
   */
  isAvailable(): Promise<{ available: boolean; platform: string }>;
}

const BackgroundRemoval = registerPlugin<BackgroundRemovalPlugin>('BackgroundRemoval', {
  web: () => import('./background-removal.plugin.web').then(m => new m.BackgroundRemovalWeb()),
});

export default BackgroundRemoval;

