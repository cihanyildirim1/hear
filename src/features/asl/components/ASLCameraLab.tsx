"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { useCameraController } from "@/features/asl/camera/useCameraController";
import { LandmarkDebugPanel } from "@/features/asl/components/LandmarkDebugPanel";
import { LandmarkSocketClient } from "@/features/asl/streaming/LandmarkSocketClient";
import { LandmarkAckMessage } from "@/features/asl/streaming/types";
import { drawHandOverlay } from "@/features/asl/tracking/drawHandOverlay";
import { MediaPipeHandTracker } from "@/features/asl/tracking/MediaPipeHandTracker";
import { LandmarkFrame } from "@/features/asl/types";

import styles from "./ASLCameraLab.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function toASLWebSocketUrl(): string {
  const normalized = API_BASE_URL.replace(/\/$/, "");
  const wsBase = normalized.startsWith("https://")
    ? normalized.replace("https://", "wss://")
    : normalized.replace("http://", "ws://");

  return `${wsBase}/api/v1/ws/asl/landmarks`;
}

export function ASLCameraLab() {
  const { videoRef, isRunning, error, startCamera, stopCamera } =
    useCameraController();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const trackerRef = useRef<MediaPipeHandTracker | null>(null);
  const socketClientRef = useRef<LandmarkSocketClient | null>(null);

  const [trackingEnabled, setTrackingEnabled] = useState(false);
  const [streamingEnabled, setStreamingEnabled] = useState(false);
  const [handsDetected, setHandsDetected] = useState(0);
  const [latestHands, setLatestHands] = useState<LandmarkFrame["hands"]>([]);
  const [lastFrameTimestamp, setLastFrameTimestamp] = useState<number | null>(
    null,
  );
  const [streamStatus, setStreamStatus] = useState<
    "disconnected" | "connecting" | "connected" | "error"
  >("disconnected");
  const [lastServerAck, setLastServerAck] = useState<LandmarkAckMessage | null>(
    null,
  );
  const [trackerStatus, setTrackerStatus] = useState("idle");
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [lastStableLetter, setLastStableLetter] = useState<string>("-");
  const uiUpdateTimestampRef = useRef(0);
  const streamingEnabledRef = useRef(streamingEnabled);

  const streamUrl = useMemo(() => toASLWebSocketUrl(), []);
  const confidence = lastServerAck?.confidence ?? 0;
  const prominentLetter = lastStableLetter;
  const isLowConfidence = confidence > 0 && confidence < 0.7;

  function handleStreamingToggle(enabled: boolean) {
    setStreamingEnabled(enabled);
    setStreamStatus(enabled ? "connecting" : "disconnected");

    if (!enabled) {
      setLastServerAck(null);
      setLastStableLetter("-");
    }
  }

  useEffect(() => {
    streamingEnabledRef.current = streamingEnabled;
  }, [streamingEnabled]);

  useEffect(() => {
    const token = lastServerAck?.emitted_token;
    if (token) {
      setLastStableLetter(token);
    }
  }, [lastServerAck?.emitted_token]);

  useEffect(() => {
    if (streamingEnabled) {
      const client = new LandmarkSocketClient({
        onOpen: () => setStreamStatus("connected"),
        onClose: () => setStreamStatus("disconnected"),
        onError: () => setStreamStatus("error"),
        onMessage: (message) => {
          if (message.type === "landmark_ack") {
            setLastServerAck(message);
          }
        },
      });
      client.connect(streamUrl);
      socketClientRef.current = client;
      return () => {
        client.disconnect();
        socketClientRef.current = null;
      };
    }

    socketClientRef.current?.disconnect();
    socketClientRef.current = null;

    return undefined;
  }, [streamUrl, streamingEnabled]);

  useEffect(() => {
    let cancelled = false;

    async function setupTracker() {
      if (
        !isRunning ||
        !trackingEnabled ||
        !videoRef.current ||
        !canvasRef.current
      ) {
        trackerRef.current?.dispose();
        trackerRef.current = null;

        const canvas = canvasRef.current;
        if (canvas) {
          const context = canvas.getContext("2d");
          context?.clearRect(0, 0, canvas.width, canvas.height);
        }

        setTrackerStatus("idle");
        setHandsDetected(0);
        return;
      }

      setTrackerStatus("loading");
      setTrackingError(null);

      try {
        const tracker = await MediaPipeHandTracker.create((frame) => {
          if (!videoRef.current || !canvasRef.current) {
            return;
          }

          drawHandOverlay(canvasRef.current, videoRef.current, frame.hands);

          const shouldUpdateUi =
            frame.timestamp - uiUpdateTimestampRef.current > 120;
          if (shouldUpdateUi) {
            setHandsDetected(frame.hands.length);
            setLastFrameTimestamp(frame.timestamp);
            setLatestHands(frame.hands);
            uiUpdateTimestampRef.current = frame.timestamp;
          }

          if (streamingEnabledRef.current) {
            socketClientRef.current?.sendFrame(frame);
          }
        });

        if (cancelled) {
          tracker.dispose();
          return;
        }

        trackerRef.current?.dispose();
        trackerRef.current = tracker;
        tracker.start(videoRef.current);
        setTrackerStatus("running");
      } catch {
        setTrackerStatus("error");
        setTrackingError(
          "Hand tracking failed to initialize. Check browser support and permissions.",
        );
      }
    }

    void setupTracker();

    return () => {
      cancelled = true;
    };
  }, [isRunning, trackingEnabled, videoRef]);

  useEffect(() => {
    return () => {
      trackerRef.current?.dispose();
      socketClientRef.current?.disconnect();
    };
  }, []);

  return (
    <main className={styles.labPage}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1>ASL Lab: Camera + Hand Tracking</h1>
          <p>This part is still being developed...</p>
          <p>
            <Link href='/'>Back to home</Link>
          </p>
        </header>

        <section className={styles.stage} aria-label='ASL camera stage'>
          {!isRunning && (
            <div className={styles.emptyStage}>Start the camera to begin.</div>
          )}
          <video ref={videoRef} className={styles.video} playsInline muted />
          <canvas ref={canvasRef} className={styles.overlay} />
        </section>

        <section className={styles.prominentOutput}>
          <p className={styles.prominentLabel}>Live Letter</p>
          <p className={styles.prominentLetter}>{prominentLetter}</p>
          <p className={styles.prominentMeta}>
            Confidence: {confidence.toFixed(2)} (raw)
          </p>
          {isLowConfidence && (
            <p className={styles.prominentHint}>
              Hold your hand steady for 1-2 seconds for a cleaner letter.
            </p>
          )}
        </section>

        <section className={styles.controls}>
          <button type='button' className={styles.button} onClick={startCamera}>
            Start Camera
          </button>
          <button
            type='button'
            className={`${styles.button} ${styles.buttonSecondary}`}
            onClick={stopCamera}
          >
            Stop Camera
          </button>

          <label className={styles.toggle}>
            <input
              type='checkbox'
              checked={trackingEnabled}
              onChange={(event) => setTrackingEnabled(event.target.checked)}
            />
            Enable hand tracking
          </label>

          <label className={styles.toggle}>
            <input
              type='checkbox'
              checked={streamingEnabled}
              onChange={(event) => handleStreamingToggle(event.target.checked)}
            />
            Stream landmarks (WebSocket)
          </label>
        </section>

        <section className={styles.metrics}>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Camera</p>
            <p className={styles.metricValue}>
              {isRunning ? "Running" : "Stopped"}
            </p>
          </article>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Tracker</p>
            <p className={styles.metricValue}>{trackerStatus}</p>
          </article>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Hands Detected</p>
            <p className={styles.metricValue}>{handsDetected}</p>
          </article>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Stream</p>
            <p className={styles.metricValue}>{streamStatus}</p>
          </article>
        </section>

        {lastFrameTimestamp && (
          <section className={styles.metricRowWide}>
            <article className={styles.metric}>
              <p className={styles.metricLabel}>Last Landmark Frame</p>
              <p className={styles.metricValue}>
                {new Date(lastFrameTimestamp).toLocaleTimeString()}
              </p>
            </article>

            <article className={styles.metric}>
              <p className={styles.metricLabel}>Model Placeholder</p>
              <p className={styles.metricValue}>
                {lastServerAck?.predicted_sign ?? "-"} ({confidence.toFixed(2)})
              </p>
            </article>

            <article className={styles.metric}>
              <p className={styles.metricLabel}>Estimated FPS (window)</p>
              <p className={styles.metricValue}>
                {lastServerAck?.fps_estimate ?? 0}
              </p>
            </article>
          </section>
        )}

        <section className={styles.metricRowWide}>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Emitted Token</p>
            <p className={styles.metricValue}>
              {lastServerAck?.emitted_token ?? "-"}
            </p>
          </article>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Current Word</p>
            <p className={styles.metricValue}>
              {lastServerAck?.current_word ?? ""}
            </p>
          </article>
          <article className={styles.metric}>
            <p className={styles.metricLabel}>Committed Words</p>
            <p className={styles.metricValue}>
              {lastServerAck?.committed_words?.join(" ") ?? ""}
            </p>
          </article>
        </section>

        <section className={styles.metric}>
          <p className={styles.metricLabel}>Live Formatted Text</p>
          <p className={styles.metricValue}>
            {lastServerAck?.formatted_text ?? ""}
          </p>
        </section>

        <LandmarkDebugPanel
          hands={latestHands}
          lastFrameTimestamp={lastFrameTimestamp}
        />

        {(error || trackingError) && (
          <p className={styles.error} role='alert'>
            {error ?? trackingError}
          </p>
        )}
      </div>
    </main>
  );
}
