import { DetectedHand } from "@/features/asl/types";

const HAND_COLORS = ["#4cc9f0", "#f72585"];

export function drawHandOverlay(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  hands: DetectedHand[],
): void {
  const context = canvas.getContext("2d");
  if (!context) {
    return;
  }

  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    return;
  }

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);

  hands.forEach((hand, handIndex) => {
    const color = HAND_COLORS[handIndex % HAND_COLORS.length];

    hand.landmarks.forEach((landmark) => {
      const x = landmark.x * width;
      const y = landmark.y * height;

      context.beginPath();
      context.arc(x, y, 4, 0, Math.PI * 2);
      context.fillStyle = color;
      context.fill();
    });

    const wrist = hand.landmarks[0];
    if (wrist) {
      context.fillStyle = color;
      context.font = "16px var(--font-geist-sans, Segoe UI, sans-serif)";
      context.fillText(
        hand.handedness,
        wrist.x * width + 8,
        Math.max(16, wrist.y * height - 8),
      );
    }
  });
}
