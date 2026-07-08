export type HandednessLabel = "Left" | "Right" | "Unknown";

export interface LandmarkPoint {
  x: number;
  y: number;
  z: number;
}

export interface DetectedHand {
  handedness: HandednessLabel;
  landmarks: LandmarkPoint[];
}

export interface LandmarkFrame {
  timestamp: number;
  hands: DetectedHand[];
}
