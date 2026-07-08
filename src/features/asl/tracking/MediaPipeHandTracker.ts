import { DetectedHand, LandmarkFrame } from "@/features/asl/types";

type OnFrameCallback = (frame: LandmarkFrame) => void;

interface RawDetectionResult {
  landmarks?: Array<Array<{ x: number; y: number; z: number }>>;
  handednesses?: Array<Array<{ categoryName?: string }>>;
  handedness?: Array<Array<{ categoryName?: string }>>;
}

interface NormalizedDetectionResult {
  landmarks: Array<Array<{ x: number; y: number; z: number }>>;
  handednesses: Array<Array<{ categoryName?: string }>>;
  handedness: Array<Array<{ categoryName?: string }>>;
}

interface HandLandmarkerLike {
  detectForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => RawDetectionResult;
  close: () => void;
}

interface ReadinessSnapshot {
  readyState: number;
  hasSrcObject: boolean;
  videoWidth: number;
  videoHeight: number;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  timestampMs: number;
  timestampDeltaMs: number;
}

interface FrameTiming {
  callbackNowMs?: number;
  mediaTimeMs?: number;
}

const DEBUG_TRACKER = process.env.NEXT_PUBLIC_ASL_TRACKER_DEBUG === "1";
const MIN_READY_STATE = 2;
const SUPPRESSED_MEDIAPIPE_PATTERNS = [
  "Created TensorFlow Lite XNNPACK delegate for CPU",
  "INFO: Created TensorFlow Lite XNNPACK delegate for CPU",
  "inference_feedback_manager.cc",
  "OpenGL error checking is disabled",
  "gl_context.cc:1118",
  "landmark_projection_calculator.cc:81",
  "Using NORM_RECT without IMAGE_DIMENSIONS",
];
const NON_FATAL_DETECT_MESSAGES = [
  "Created TensorFlow Lite XNNPACK delegate for CPU",
  "INFO: Created TensorFlow Lite XNNPACK delegate for CPU",
  "OpenGL error checking is disabled",
  "Using NORM_RECT without IMAGE_DIMENSIONS",
  "landmark_projection_calculator.cc:81",
  "gl_context.cc:1118",
  "vision_wasm_internal.js",
  "put_char",
  "_fd_write",
];
const DETECTION_ERROR_LOG_INTERVAL_MS = 2000;
const PRE_DETECT_LOG_INTERVAL_MS = 2000;
const EMPTY_DETECTION_RESULT: NormalizedDetectionResult = {
  landmarks: [],
  handednesses: [],
  handedness: [],
};

let isGlobalMediaPipeConsoleSuppressionInstalled = false;

function shouldSuppressMediaPipeConsoleArgs(args: unknown[]): boolean {
  if (args.length === 0) {
    return false;
  }

  const joinedMessage = args
    .map((arg) => {
      if (typeof arg === "string") {
        return arg;
      }
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(" ");

  return SUPPRESSED_MEDIAPIPE_PATTERNS.some((pattern) =>
    joinedMessage.includes(pattern),
  );
}

function installGlobalMediaPipeConsoleSuppression(): void {
  if (isGlobalMediaPipeConsoleSuppressionInstalled) {
    return;
  }

  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;
  const originalConsoleInfo = console.info;
  const originalConsoleLog = console.log;

  const passthroughOrSuppress =
    (target: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      if (shouldSuppressMediaPipeConsoleArgs(args)) {
        return;
      }
      target(...args);
    };

  console.error = passthroughOrSuppress(originalConsoleError);
  console.warn = passthroughOrSuppress(originalConsoleWarn);
  console.info = passthroughOrSuppress(originalConsoleInfo);
  console.log = passthroughOrSuppress(originalConsoleLog);

  isGlobalMediaPipeConsoleSuppressionInstalled = true;
}

export class MediaPipeHandTracker {
  private handLandmarker: HandLandmarkerLike;
  private onFrame: OnFrameCallback;
  private animationFrameId: number | null = null;
  private videoFrameCallbackId: number | null = null;
  private activeVideoElement: HTMLVideoElement | null = null;
  private running = false;
  private isDisposed = false;
  private lastVideoTime = -1;
  private lastTimestampMs = 0;
  private lastDetectionErrorLogAt = 0;
  private lastPreDetectLogAt = 0;
  private loopGeneration = 0;
  private frameInFlight = false;
  private handLandmarkerClosed = false;
  private suppressionRestorer: (() => void) | null = null;

  private constructor(
    handLandmarker: HandLandmarkerLike,
    onFrame: OnFrameCallback,
  ) {
    this.handLandmarker = handLandmarker;
    this.onFrame = onFrame;
  }

  static async create(
    onFrame: OnFrameCallback,
    maxHands = 2,
  ): Promise<MediaPipeHandTracker> {
    installGlobalMediaPipeConsoleSuppression();

    const vision: typeof import("@mediapipe/tasks-vision") =
      await import("@mediapipe/tasks-vision");
    const visionVersion = (vision as { VERSION?: string }).VERSION ?? "unknown";

    const wasmVersionTag =
      visionVersion !== "unknown" ? visionVersion : "latest";
    const wasmPath = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${wasmVersionTag}/wasm`;
    const modelAssetPath =
      "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

    if (DEBUG_TRACKER) {
      console.info("[ASL][Tracker] create() begin", {
        visionVersion,
        maxHands,
        wasmPath,
        modelAssetPath,
        userAgent: navigator.userAgent,
      });
    }

    let filesetResolver: Awaited<
      ReturnType<typeof vision.FilesetResolver.forVisionTasks>
    >;
    try {
      filesetResolver = await vision.FilesetResolver.forVisionTasks(wasmPath);
    } catch (error) {
      console.error("[ASL][Tracker] FilesetResolver.forVisionTasks failed", {
        wasmPath,
        error,
      });
      throw error;
    }

    let handLandmarker: Awaited<
      ReturnType<typeof vision.HandLandmarker.createFromOptions>
    >;
    try {
      handLandmarker = await vision.HandLandmarker.createFromOptions(
        filesetResolver,
        {
          baseOptions: {
            modelAssetPath,
          },
          runningMode: "VIDEO",
          numHands: maxHands,
        },
      );
    } catch (error) {
      console.error("[ASL][Tracker] HandLandmarker.createFromOptions failed", {
        modelAssetPath,
        error,
      });
      throw error;
    }

    if (DEBUG_TRACKER) {
      console.info("[ASL][Tracker] create() success");
    }

    return new MediaPipeHandTracker(handLandmarker, onFrame);
  }

  private buildReadinessSnapshot(
    video: HTMLVideoElement,
    timestampMs: number,
  ): ReadinessSnapshot {
    return {
      readyState: video.readyState,
      hasSrcObject: video.srcObject !== null,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      timestampMs,
      timestampDeltaMs: timestampMs - this.lastTimestampMs,
    };
  }

  private isReadyForDetection(snapshot: ReadinessSnapshot): boolean {
    return (
      snapshot.readyState >= MIN_READY_STATE &&
      snapshot.hasSrcObject &&
      snapshot.videoWidth > 0 &&
      snapshot.videoHeight > 0 &&
      !snapshot.paused &&
      !snapshot.ended
    );
  }

  private installMediaPipeNoiseSuppression(): void {
    if (this.suppressionRestorer !== null) {
      return;
    }

    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;
    const originalConsoleLog = console.log;

    const shouldSuppressMessage = (args: unknown[]): boolean => {
      if (args.length === 0) {
        return false;
      }

      const joinedMessage = args
        .map((arg) => {
          if (typeof arg === "string") {
            return arg;
          }
          if (arg instanceof Error) {
            return `${arg.name}: ${arg.message}`;
          }
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(" ");

      return SUPPRESSED_MEDIAPIPE_PATTERNS.some((pattern) =>
        joinedMessage.includes(pattern),
      );
    };

    const passthroughOrSuppress =
      (target: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        if (shouldSuppressMessage(args)) {
          return;
        }
        target(...args);
      };

    console.error = passthroughOrSuppress(originalConsoleError);
    console.warn = passthroughOrSuppress(originalConsoleWarn);
    console.info = passthroughOrSuppress(originalConsoleInfo);
    console.log = passthroughOrSuppress(originalConsoleLog);

    this.suppressionRestorer = () => {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
      console.log = originalConsoleLog;
    };
  }

  private uninstallMediaPipeNoiseSuppression(): void {
    if (this.suppressionRestorer) {
      this.suppressionRestorer();
      this.suppressionRestorer = null;
    }
  }

  start(video: HTMLVideoElement): void {
    if (this.running || this.isDisposed || this.handLandmarkerClosed) {
      return;
    }

    if (video.srcObject === null) {
      if (DEBUG_TRACKER) {
        console.warn(
          "[ASL][Tracker] start() ignored because video.srcObject is null",
        );
      }
      return;
    }

    this.running = true;
    this.loopGeneration += 1;
    this.activeVideoElement = video;
    this.lastTimestampMs = 0;
    this.lastDetectionErrorLogAt = 0;
    this.lastPreDetectLogAt = 0;
    this.frameInFlight = false;

    let activeSource: HTMLVideoElement["srcObject"] = video.srcObject;
    const generation = this.loopGeneration;

    this.installMediaPipeNoiseSuppression();

    if (DEBUG_TRACKER) {
      console.info("[ASL][Tracker] start()", {
        readyState: video.readyState,
        hasSrcObject: video.srcObject !== null,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        paused: video.paused,
      });
    }

    const processFrame = (frameTiming?: FrameTiming) => {
      if (
        !this.running ||
        this.isDisposed ||
        generation !== this.loopGeneration
      ) {
        return;
      }

      if (this.frameInFlight) {
        this.scheduleNextFrame(video, processFrame, generation);
        return;
      }

      this.frameInFlight = true;

      if (
        !this.handLandmarker ||
        this.handLandmarkerClosed ||
        typeof this.handLandmarker.detectForVideo !== "function"
      ) {
        const initError = new Error(
          "HandLandmarker is not initialized before detection loop.",
        );
        if (DEBUG_TRACKER) {
          console.error(
            "[ASL][Tracker] Invalid handLandmarker instance",
            initError,
          );
          throw initError;
        }

        console.warn("[ASL][Tracker] Invalid handLandmarker instance");
        this.stop();
        this.frameInFlight = false;
        return;
      }

      if (video !== this.activeVideoElement) {
        if (DEBUG_TRACKER) {
          console.warn("[ASL][Tracker] stale video element callback ignored");
        }
        this.frameInFlight = false;
        return;
      }

      if (video.srcObject !== activeSource) {
        if (DEBUG_TRACKER) {
          console.info(
            "[ASL][Tracker] video srcObject changed during tracking",
          );
        }
        activeSource = video.srcObject;
        this.lastVideoTime = -1;
      }

      const timestampMs = this.resolveTimestampMs(video, frameTiming);
      const snapshot = this.buildReadinessSnapshot(video, timestampMs);

      if (
        this.lastTimestampMs !== 0 &&
        snapshot.timestampMs <= this.lastTimestampMs
      ) {
        if (DEBUG_TRACKER) {
          console.warn(
            "[ASL][Tracker] timestamp adjusted to preserve monotonicity",
            {
              previousTimestampMs: this.lastTimestampMs,
              currentTimestampMs: snapshot.timestampMs,
              adjustedTimestampMs: this.lastTimestampMs + 0.01,
            },
          );
        }
        snapshot.timestampMs = this.lastTimestampMs + 0.01;
        snapshot.timestampDeltaMs = snapshot.timestampMs - this.lastTimestampMs;
      }

      if (!this.isReadyForDetection(snapshot)) {
        if (DEBUG_TRACKER) {
          console.info(
            "[ASL][Tracker] waiting for ready video state",
            snapshot,
          );
        }
        this.frameInFlight = false;
        this.scheduleNextFrame(video, processFrame, generation);
        return;
      }

      if (video.currentTime === this.lastVideoTime) {
        this.frameInFlight = false;
        this.scheduleNextFrame(video, processFrame, generation);
        return;
      }

      this.logPreDetectDiagnostics(video, snapshot);

      this.lastTimestampMs = snapshot.timestampMs;
      this.lastVideoTime = video.currentTime;

      const result = this.detectForVideoWithDiagnostics(video, snapshot);
      const normalizedResult = this.normalizeDetectionResult(result);
      const handednesses =
        normalizedResult.handednesses.length > 0
          ? normalizedResult.handednesses
          : normalizedResult.handedness;

      const hands: DetectedHand[] = normalizedResult.landmarks.map(
        (landmarks, index) => {
          const handednessName =
            handednesses[index]?.[0]?.categoryName ?? "Unknown";

          return {
            handedness:
              handednessName === "Left" || handednessName === "Right"
                ? handednessName
                : "Unknown",
            landmarks: landmarks.map((point) => ({
              x: point.x,
              y: point.y,
              z: point.z,
            })),
          };
        },
      );

      this.onFrame({
        timestamp: Date.now(),
        hands,
      });

      this.frameInFlight = false;
      this.scheduleNextFrame(video, processFrame, generation);
    };

    this.scheduleNextFrame(video, processFrame, generation);
  }

  stop(): void {
    this.running = false;
    this.loopGeneration += 1;
    this.frameInFlight = false;
    this.lastVideoTime = -1;
    this.lastTimestampMs = 0;

    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    if (this.videoFrameCallbackId !== null) {
      const video = this.activeVideoElement;
      if (video && "cancelVideoFrameCallback" in video) {
        (
          video as HTMLVideoElement & {
            cancelVideoFrameCallback: (handle: number) => void;
          }
        ).cancelVideoFrameCallback(this.videoFrameCallbackId);
      }
      this.videoFrameCallbackId = null;
    }

    this.activeVideoElement = null;
    this.uninstallMediaPipeNoiseSuppression();
  }

  private scheduleNextFrame(
    video: HTMLVideoElement,
    processFrame: (frameTiming?: FrameTiming) => void,
    generation: number,
  ): void {
    if (
      !this.running ||
      this.isDisposed ||
      generation !== this.loopGeneration
    ) {
      return;
    }

    if ("requestVideoFrameCallback" in video) {
      this.videoFrameCallbackId = (
        video as HTMLVideoElement & {
          requestVideoFrameCallback: (
            callback: (now: number, metadata: { mediaTime: number }) => void,
          ) => number;
        }
      ).requestVideoFrameCallback((now, metadata) => {
        this.videoFrameCallbackId = null;
        processFrame({
          callbackNowMs: now,
          mediaTimeMs: metadata.mediaTime * 1000,
        });
      });
      return;
    }

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      processFrame();
    });
  }

  private resolveTimestampMs(
    video: HTMLVideoElement,
    frameTiming?: FrameTiming,
  ): number {
    const mediaTimestamp = frameTiming?.mediaTimeMs;
    if (typeof mediaTimestamp === "number" && Number.isFinite(mediaTimestamp)) {
      return mediaTimestamp;
    }

    const currentTimeTimestamp = video.currentTime * 1000;
    if (Number.isFinite(currentTimeTimestamp) && currentTimeTimestamp > 0) {
      return currentTimeTimestamp;
    }

    const callbackNowMs = frameTiming?.callbackNowMs;
    if (typeof callbackNowMs === "number" && Number.isFinite(callbackNowMs)) {
      return callbackNowMs;
    }

    return performance.now();
  }

  private logPreDetectDiagnostics(
    video: HTMLVideoElement,
    snapshot: ReadinessSnapshot,
  ): void {
    const now = performance.now();
    const shouldLogNow =
      DEBUG_TRACKER ||
      now - this.lastPreDetectLogAt >= PRE_DETECT_LOG_INTERVAL_MS;

    if (!shouldLogNow) {
      return;
    }

    this.lastPreDetectLogAt = now;

    console.info("[ASL][Tracker] pre-detect diagnostics", {
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      paused: video.paused,
      ended: video.ended,
      currentTime: video.currentTime,
      srcObject: video.srcObject,
      timestamp: snapshot.timestampMs,
      lastTimestamp: this.lastTimestampMs,
      timestampDelta: snapshot.timestampDeltaMs,
      running: this.running,
      disposed: this.isDisposed,
      animationFrameId: this.animationFrameId,
      videoFrameCallbackId: this.videoFrameCallbackId,
    });
  }

  private detectForVideoWithDiagnostics(
    video: HTMLVideoElement,
    snapshot: ReadinessSnapshot,
  ): RawDetectionResult {
    if (
      !this.handLandmarker ||
      this.isDisposed ||
      this.handLandmarkerClosed ||
      !this.running
    ) {
      return EMPTY_DETECTION_RESULT;
    }

    try {
      return this.withScopedMediaPipeConsoleSuppression(() =>
        this.handLandmarker.detectForVideo(video, snapshot.timestampMs),
      );
    } catch (error) {
      const rawErrorText = this.stringifyUnknownError(error);
      const errorStackText = error instanceof Error ? (error.stack ?? "") : "";
      const errorMessageText =
        error instanceof Error ? error.message : rawErrorText;
      const combinedErrorText = `${rawErrorText} ${errorMessageText} ${errorStackText}`;
      const isBenignRuntimeMessage =
        this.matchesNonFatalDetectMessage(combinedErrorText);

      const now = performance.now();
      const shouldLogNow =
        DEBUG_TRACKER ||
        now - this.lastDetectionErrorLogAt >= DETECTION_ERROR_LOG_INTERVAL_MS;

      if (shouldLogNow && !isBenignRuntimeMessage) {
        this.lastDetectionErrorLogAt = now;

        console.error("[ASL][Tracker] detectForVideo failed", {
          snapshot,
          videoState: {
            readyState: video.readyState,
            videoWidth: video.videoWidth,
            videoHeight: video.videoHeight,
            currentTime: video.currentTime,
          },
          errorConstructor:
            error !== null && error !== undefined
              ? (error as { constructor?: { name?: string } }).constructor?.name
              : undefined,
          errorPrototype:
            error !== null && error !== undefined
              ? Object.getPrototypeOf(error)
              : undefined,
          errorPrototypeName:
            error !== null && error !== undefined
              ? Object.getPrototypeOf(error)?.constructor?.name
              : undefined,
          errorType: error instanceof Error ? error.name : typeof error,
          errorMessage: errorMessageText,
          errorStack: error instanceof Error ? error.stack : undefined,
          errorKeys:
            error !== null && typeof error === "object"
              ? Object.getOwnPropertyNames(error)
              : [],
          errorProperties: this.extractErrorProperties(error),
          rawError: error,
        });
      }

      if (shouldLogNow && isBenignRuntimeMessage && DEBUG_TRACKER) {
        this.lastDetectionErrorLogAt = now;
        console.info(
          "[ASL][Tracker] detectForVideo non-fatal runtime message",
          {
            errorMessage: errorMessageText,
            rawError: error,
          },
        );
      }

      // Never rethrow inside the frame loop. Returning an empty detection result
      // prevents Next.js runtime overlays for non-actionable WASM-side logs.

      return EMPTY_DETECTION_RESULT;
    }
  }

  private withScopedMediaPipeConsoleSuppression<T>(run: () => T): T {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;
    const originalConsoleInfo = console.info;
    const originalConsoleLog = console.log;

    const passthroughOrSuppress =
      (target: (...args: unknown[]) => void) =>
      (...args: unknown[]) => {
        if (this.shouldSuppressConsoleArgs(args)) {
          return;
        }
        target(...args);
      };

    console.error = passthroughOrSuppress(originalConsoleError);
    console.warn = passthroughOrSuppress(originalConsoleWarn);
    console.info = passthroughOrSuppress(originalConsoleInfo);
    console.log = passthroughOrSuppress(originalConsoleLog);

    try {
      return run();
    } finally {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
      console.log = originalConsoleLog;
    }
  }

  private shouldSuppressConsoleArgs(args: unknown[]): boolean {
    if (args.length === 0) {
      return false;
    }

    const joinedMessage = args
      .map((arg) => {
        if (typeof arg === "string") {
          return arg;
        }
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}`;
        }
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      })
      .join(" ");

    return SUPPRESSED_MEDIAPIPE_PATTERNS.some((pattern) =>
      joinedMessage.includes(pattern),
    );
  }

  private matchesNonFatalDetectMessage(message: string): boolean {
    const normalizedMessage = message.toLowerCase();
    return NON_FATAL_DETECT_MESSAGES.some((pattern) =>
      normalizedMessage.includes(pattern.toLowerCase()),
    );
  }

  private normalizeDetectionResult(
    result: RawDetectionResult | null | undefined,
  ): NormalizedDetectionResult {
    if (!result || typeof result !== "object") {
      return EMPTY_DETECTION_RESULT;
    }

    const landmarks = Array.isArray(result.landmarks) ? result.landmarks : [];
    const handednesses = Array.isArray(result.handednesses)
      ? result.handednesses
      : [];
    const handedness = Array.isArray(result.handedness)
      ? result.handedness
      : [];

    return {
      landmarks,
      handednesses,
      handedness,
    };
  }

  private extractErrorProperties(error: unknown): Record<string, unknown> {
    if (error === null || typeof error !== "object") {
      return {};
    }

    const properties: Record<string, unknown> = {};
    for (const key of Object.getOwnPropertyNames(error)) {
      try {
        properties[key] = (error as Record<string, unknown>)[key];
      } catch {
        properties[key] = "<unreadable>";
      }
    }
    return properties;
  }

  private stringifyUnknownError(error: unknown): string {
    if (typeof error === "string") {
      return error;
    }

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.isDisposed = true;
    this.stop();
    try {
      this.handLandmarker.close();
      this.handLandmarkerClosed = true;
    } catch {
      // No-op: tracker may already be closed by teardown race.
    }
  }
}
