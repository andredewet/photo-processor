import { registerPlugin } from '@capacitor/core';

export interface FaceBounds {
  /** X position as percentage (0-1) from left */
  x: number;
  /** Y position as percentage (0-1) from top */
  y: number;
  /** Width as percentage (0-1) of image width */
  width: number;
  /** Height as percentage (0-1) of image height */
  height: number;
}

export interface FaceDetectionResult {
  /** Whether a face was detected */
  faceDetected: boolean;
  /** Face bounding box (normalized 0-1 coordinates) */
  bounds?: FaceBounds;
  /** Guidance message for the user */
  guidance: FaceGuidance;
  /** Confidence score (0-1) */
  confidence?: number;
}

export type FaceGuidance = 
  | 'no_face'
  | 'move_closer'
  | 'move_back'
  | 'move_left'
  | 'move_right'
  | 'move_up'
  | 'move_down'
  | 'hold_still'
  | 'multiple_faces';

export interface OvalBounds {
  /** Center X as percentage (0-1) */
  centerX: number;
  /** Center Y as percentage (0-1) */
  centerY: number;
  /** Horizontal radius as percentage (0-1) */
  radiusX: number;
  /** Vertical radius as percentage (0-1) */
  radiusY: number;
}

export interface FaceDetectionPlugin {
  /**
   * Initialize the face detection model
   */
  initialize(): Promise<{ success: boolean }>;

  /**
   * Detect face in an image and get positioning guidance
   * @param options - Image data and oval bounds to compare against
   */
  detectFace(options: {
    /** Base64 image data URL */
    imageData: string;
    /** The oval bounds to position the face within */
    ovalBounds: OvalBounds;
    /** Sensitivity 0-1 (0 = strict, 1 = lenient) */
    sensitivity?: number;
  }): Promise<FaceDetectionResult>;

  /**
   * Check if face detection is available
   */
  isAvailable(): Promise<{ available: boolean; platform: string }>;

  /**
   * Clean up resources
   */
  dispose(): Promise<void>;
}

const FaceDetection = registerPlugin<FaceDetectionPlugin>('FaceDetection', {
  web: () => import('./face-detection.plugin.web').then(m => new m.FaceDetectionWeb()),
});

export default FaceDetection;

// Helper function to get human-readable guidance message
export function getGuidanceMessage(guidance: FaceGuidance): string {
  const messages: Record<FaceGuidance, string> = {
    'no_face': 'Position your face in the frame',
    'move_closer': 'Move closer',
    'move_back': 'Move back a little',
    'move_left': 'Move slightly left',
    'move_right': 'Move slightly right',
    'move_up': 'Move up a little',
    'move_down': 'Move down a little',
    'hold_still': 'Perfect! Hold still',
    'multiple_faces': 'Only one face allowed'
  };
  return messages[guidance];
}

