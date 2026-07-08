export interface LandmarkAckMessage {
  type: "landmark_ack";
  timestamp: number;
  hands: number;
  frame_count: number;
  window_size: number;
  avg_hands_last_window: number;
  fps_estimate: number;
  predicted_sign: string;
  confidence: number;
  emitted_token: string | null;
  current_word: string;
  committed_words: string[];
  formatted_text: string;
}

export interface LandmarkValidationErrorMessage {
  type: "validation_error";
  details: unknown;
}

export type LandmarkServerMessage =
  | LandmarkAckMessage
  | LandmarkValidationErrorMessage;
