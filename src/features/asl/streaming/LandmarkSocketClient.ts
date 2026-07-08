import { LandmarkFrame } from "@/features/asl/types";
import { LandmarkServerMessage } from "@/features/asl/streaming/types";

interface LandmarkSocketClientEvents {
  onOpen?: () => void;
  onClose?: () => void;
  onError?: () => void;
  onMessage?: (message: LandmarkServerMessage) => void;
}

export class LandmarkSocketClient {
  private socket: WebSocket | null = null;
  private events: LandmarkSocketClientEvents;

  constructor(events: LandmarkSocketClientEvents = {}) {
    this.events = events;
  }

  connect(url: string): void {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    this.socket = new WebSocket(url);

    this.socket.onopen = () => {
      this.events.onOpen?.();
    };

    this.socket.onclose = () => {
      this.events.onClose?.();
    };

    this.socket.onerror = () => {
      this.events.onError?.();
    };

    this.socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data) as LandmarkServerMessage;
        this.events.onMessage?.(parsed);
      } catch {
        // Ignore invalid payloads from server for now.
      }
    };
  }

  sendFrame(frame: LandmarkFrame): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(frame));
  }

  disconnect(): void {
    if (!this.socket) {
      return;
    }

    this.socket.close();
    this.socket = null;
  }
}
