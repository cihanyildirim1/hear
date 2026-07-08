import { DetectedHand } from "@/features/asl/types";

import styles from "./ASLCameraLab.module.css";

interface LandmarkDebugPanelProps {
  hands: DetectedHand[];
  lastFrameTimestamp: number | null;
}

function formatCoord(value: number): string {
  return value.toFixed(3);
}

export function LandmarkDebugPanel({
  hands,
  lastFrameTimestamp,
}: LandmarkDebugPanelProps) {
  return (
    <section className={styles.debugPanel} aria-label='Landmark debug panel'>
      <header className={styles.debugHeader}>
        <h2>Landmark Debug</h2>
        <p>
          Frame:{" "}
          {lastFrameTimestamp
            ? new Date(lastFrameTimestamp).toLocaleTimeString()
            : "-"}
        </p>
      </header>

      {hands.length === 0 && (
        <p className={styles.debugEmpty}>No hands detected in current frame.</p>
      )}

      {hands.map((hand, handIndex) => (
        <article
          key={`${hand.handedness}-${handIndex}`}
          className={styles.debugHandCard}
        >
          <h3>
            Hand {handIndex + 1}: {hand.handedness}
          </h3>
          <p className={styles.debugMeta}>
            Landmarks: {hand.landmarks.length}/21
          </p>

          <div className={styles.debugGrid}>
            {hand.landmarks.map((point, pointIndex) => (
              <div
                key={`${handIndex}-${pointIndex}`}
                className={styles.debugPoint}
              >
                <p className={styles.debugPointTitle}>#{pointIndex}</p>
                <p>x: {formatCoord(point.x)}</p>
                <p>y: {formatCoord(point.y)}</p>
                <p>z: {formatCoord(point.z)}</p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </section>
  );
}
