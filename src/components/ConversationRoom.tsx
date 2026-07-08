"use client";

import Link from "next/link";
import {
  FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ChatMessage, RoleLabel, SocketEvent } from "@/types/chat";

import styles from "./ConversationRoom.module.css";

interface ConversationRoomProps {
  conversationId: string;
  initialRole: RoleLabel;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionResultListLike {
  length: number;
  [index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultListLike;
}

interface SpeechRecognitionErrorEventLike {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function toWebSocketUrl(conversationId: string, role: RoleLabel): string {
  const normalized = API_BASE_URL.replace(/\/$/, "");
  const wsBase = normalized.startsWith("https://")
    ? normalized.replace("https://", "wss://")
    : normalized.replace("http://", "ws://");
  return `${wsBase}/api/v1/ws/conversations/${conversationId}?role=${role}&mode=chat`;
}

function formatTime(isoDateTime: string): string {
  return new Date(isoDateTime).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ConversationRoom({
  conversationId,
  initialRole,
}: ConversationRoomProps) {
  const [isDarkTheme, setIsDarkTheme] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "disconnected"
  >("connecting");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [typingLabel, setTypingLabel] = useState<string | null>(null);
  const [presenceLabel, setPresenceLabel] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [role, setRole] = useState<RoleLabel>(initialRole);

  const socketRef = useRef<WebSocket | null>(null);
  const typingTimeoutRef = useRef<number | undefined>(undefined);
  const presenceTimeoutRef = useRef<number | undefined>(undefined);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const roleRef = useRef<RoleLabel>(initialRole);
  const previousLatestMessageIdRef = useRef<string | null>(null);
  const moveHighlightTimeoutRef = useRef<number | undefined>(undefined);
  const listEndRef = useRef<HTMLDivElement | null>(null);
  const [justMovedToHistoryId, setJustMovedToHistoryId] = useState<
    string | null
  >(null);
  const otherRole: RoleLabel = useMemo(
    () => (role === "A" ? "B" : "A"),
    [role],
  );
  const latestMessage =
    messages.length > 0 ? messages[messages.length - 1] : null;
  const historyMessages = useMemo(
    () => (messages.length > 1 ? messages.slice(0, -1) : []),
    [messages],
  );
  const speechSupported = useSyncExternalStore(
    () => () => undefined,
    () => Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
    () => false,
  );

  useEffect(() => {
    roleRef.current = role;
  }, [role]);

  useEffect(() => {
    let isMounted = true;
    const socket = new WebSocket(toWebSocketUrl(conversationId, initialRole));
    socketRef.current = socket;

    socket.onopen = () => {
      if (!isMounted) {
        return;
      }
      setConnectionStatus("connected");
      setErrorMessage(null);
    };

    socket.onmessage = (event) => {
      if (!isMounted) {
        return;
      }

      try {
        const payload = JSON.parse(event.data) as SocketEvent;

        if (payload.type === "role_assigned") {
          setRole(payload.role);
          return;
        }

        if (payload.type === "history") {
          setMessages(payload.messages);
          return;
        }

        if (payload.type === "message") {
          setMessages((previous) => [...previous, payload.message]);
          return;
        }

        if (payload.type === "typing") {
          if (payload.sender === roleRef.current || !payload.isTyping) {
            setTypingLabel(null);
            return;
          }
          setTypingLabel(`User ${payload.sender} is typing...`);
          return;
        }

        if (payload.type === "participant_joined") {
          if (payload.role !== roleRef.current) {
            setPresenceLabel(`User ${payload.role} joined the room.`);
            if (presenceTimeoutRef.current) {
              window.clearTimeout(presenceTimeoutRef.current);
            }
            presenceTimeoutRef.current = window.setTimeout(() => {
              setPresenceLabel(null);
            }, 3000);
          }
          return;
        }

        if (payload.type === "participant_left") {
          if (payload.role !== roleRef.current) {
            setPresenceLabel(`User ${payload.role} left the room.`);
            if (presenceTimeoutRef.current) {
              window.clearTimeout(presenceTimeoutRef.current);
            }
            presenceTimeoutRef.current = window.setTimeout(() => {
              setPresenceLabel(null);
            }, 3000);
          }
        }
      } catch {
        setErrorMessage("Received an unexpected event from server.");
      }
    };

    socket.onclose = () => {
      if (!isMounted) {
        return;
      }
      setConnectionStatus("disconnected");
    };

    socket.onerror = () => {
      if (!isMounted) {
        return;
      }
      setErrorMessage("Connection failed. Try opening the room again.");
      setConnectionStatus("disconnected");
    };

    return () => {
      isMounted = false;
      if (typingTimeoutRef.current) {
        window.clearTimeout(typingTimeoutRef.current);
      }
      if (presenceTimeoutRef.current) {
        window.clearTimeout(presenceTimeoutRef.current);
      }
      socket.close();
    };
  }, [conversationId, initialRole]);

  useEffect(() => {
    listEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, typingLabel]);

  useEffect(() => {
    const currentLatestMessageId = latestMessage?.id ?? null;
    const previousLatestMessageId = previousLatestMessageIdRef.current;

    if (
      previousLatestMessageId &&
      currentLatestMessageId &&
      previousLatestMessageId !== currentLatestMessageId
    ) {
      setJustMovedToHistoryId(previousLatestMessageId);

      if (moveHighlightTimeoutRef.current) {
        window.clearTimeout(moveHighlightTimeoutRef.current);
      }

      moveHighlightTimeoutRef.current = window.setTimeout(() => {
        setJustMovedToHistoryId(null);
      }, 700);
    }

    previousLatestMessageIdRef.current = currentLatestMessageId;
  }, [latestMessage]);

  useEffect(() => {
    return () => {
      if (moveHighlightTimeoutRef.current) {
        window.clearTimeout(moveHighlightTimeoutRef.current);
      }
      speechRecognitionRef.current?.stop();
    };
  }, []);

  function stopListening() {
    speechRecognitionRef.current?.stop();
    setIsListening(false);
  }

  function startListening() {
    setSpeechError(null);

    if (!speechSupported) {
      setSpeechError("Speech recognition is unavailable in this browser.");
      return;
    }

    const SpeechRecognitionImpl =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!SpeechRecognitionImpl) {
      setSpeechError("Speech recognition is unavailable in this browser.");
      return;
    }

    const recognition = new SpeechRecognitionImpl();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let transcript = "";

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
      ) {
        transcript += event.results[index][0].transcript;
      }

      const nextDraft = transcript.trim();
      if (nextDraft) {
        handleDraftChange(nextDraft);
      }
    };

    recognition.onerror = (event) => {
      setSpeechError(`Speech recognition error: ${event.error}.`);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    speechRecognitionRef.current = recognition;

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setSpeechError("Unable to start speech recognition.");
      setIsListening(false);
    }
  }

  function sendTyping(isTyping: boolean) {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "typing",
        sender: role,
        isTyping,
      }),
    );
  }

  function handleDraftChange(value: string) {
    setDraft(value);
    sendTyping(true);

    if (typingTimeoutRef.current) {
      window.clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = window.setTimeout(() => {
      sendTyping(false);
    }, 900);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const content = draft.trim();
    const socket = socketRef.current;
    if (!content || !socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "message",
        sender: role,
        content,
      }),
    );

    if (isListening) {
      stopListening();
    }

    sendTyping(false);
    setDraft("");
  }

  return (
    <main
      className={`${styles.page} ${isDarkTheme ? styles.darkTheme : styles.lightTheme}`}
    >
      <section className={styles.chatShell} aria-labelledby='room-title'>
        <header className={styles.topBar}>
          <h1 id='room-title' className={styles.helloTitle}>
            Hello User {otherRole}
          </h1>

          <div className={styles.topBarActions}>
            <button
              type='button'
              className={styles.themeButton}
              onClick={() => setIsDarkTheme((value) => !value)}
              aria-label={
                isDarkTheme ? "Switch to light mode" : "Switch to dark mode"
              }
            >
              {isDarkTheme ? "Light" : "Dark"}
            </button>

            <span
              className={
                connectionStatus === "connected"
                  ? styles.connectedBadge
                  : styles.offlineBadge
              }
              aria-live='polite'
            >
              {connectionStatus === "connected" ? "Connected" : "Offline"}
            </span>
          </div>
        </header>

        <div className={styles.metaRow}>
          <p className={styles.roomMeta}>Room: {conversationId}</p>
          <p className={styles.roomMeta}>You are User {role}</p>
        </div>

        {errorMessage && (
          <p className={styles.error} role='alert'>
            {errorMessage}
          </p>
        )}

        <section
          className={styles.latestPanel}
          aria-live='polite'
          aria-label='Latest message'
        >
          <p className={styles.panelTitle}>Latest message</p>
          {latestMessage ? (
            <article className={styles.latestMessage}>
              <p className={styles.latestSender}>
                {latestMessage.sender === role
                  ? `You (User ${role})`
                  : `User ${otherRole}`}
              </p>
              <p className={styles.latestContent}>{latestMessage.content}</p>
              <time
                className={styles.latestTime}
                dateTime={latestMessage.timestamp}
              >
                {formatTime(latestMessage.timestamp)}
              </time>
            </article>
          ) : (
            <p className={styles.empty}>
              No messages yet. Start the conversation.
            </p>
          )}
          {typingLabel && <p className={styles.typing}>{typingLabel}</p>}
        </section>

        <section
          className={styles.historyPanel}
          aria-live='polite'
          aria-label='Conversation history'
        >
          <p className={styles.panelTitle}>Conversation History</p>
          {presenceLabel && <p className={styles.presence}>{presenceLabel}</p>}

          <div className={styles.messageList}>
            {historyMessages.length === 0 ? (
              <p className={styles.empty}>
                History will appear here as new messages arrive.
              </p>
            ) : (
              historyMessages.map((message) => {
                const isMine = message.sender === role;
                const movedClass =
                  justMovedToHistoryId === message.id
                    ? styles.messageMoved
                    : "";

                return (
                  <article
                    key={message.id}
                    className={`${isMine ? styles.myMessage : styles.otherMessage} ${movedClass}`}
                    aria-label={isMine ? "Your message" : "Other user message"}
                  >
                    <p className={styles.senderTag}>
                      {isMine ? `You (User ${role})` : `User ${otherRole}`}
                    </p>
                    <p>{message.content}</p>
                    <time dateTime={message.timestamp}>
                      {formatTime(message.timestamp)}
                    </time>
                  </article>
                );
              })
            )}

            <div ref={listEndRef} />
          </div>
        </section>

        <form className={styles.composer} onSubmit={handleSubmit}>
          <label htmlFor='message' className={styles.hiddenLabel}>
            Type message
          </label>
          <input
            id='message'
            type='text'
            value={draft}
            onChange={(event) => handleDraftChange(event.target.value)}
            className={styles.input}
            placeholder='Type here...'
            autoComplete='off'
          />
          <button
            type='button'
            className={isListening ? styles.micButtonActive : styles.micButton}
            onClick={isListening ? stopListening : startListening}
            disabled={!speechSupported || connectionStatus !== "connected"}
            aria-label={
              isListening ? "Stop speech to text" : "Start speech to text"
            }
          >
            {isListening ? "Stop" : "🎤"}
          </button>
          <button
            type='submit'
            className={styles.sendButton}
            disabled={connectionStatus !== "connected" || !draft.trim()}
          >
            ➤
          </button>
        </form>

        {!speechSupported && (
          <p className={styles.speechNotice} role='status'>
            Speech-to-text is not supported in this browser. Use Chrome or Edge
            for microphone input.
          </p>
        )}

        {speechError && (
          <p className={styles.speechError} role='alert'>
            {speechError}
          </p>
        )}

        <Link href='/' className={styles.homeLink}>
          Back to Home
        </Link>
      </section>
    </main>
  );
}
