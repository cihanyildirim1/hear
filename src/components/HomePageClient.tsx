"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { ConversationLauncherCard } from "@/components/ConversationLauncherCard";
import { useConversationBootstrap } from "@/hooks/useConversationBootstrap";
import { SocketEvent } from "@/types/chat";

import styles from "@/app/page.module.css";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

function toWebSocketUrl(conversationId: string): string {
  const normalized = API_BASE_URL.replace(/\/$/, "");
  const wsBase = normalized.startsWith("https://")
    ? normalized.replace("https://", "wss://")
    : normalized.replace("http://", "ws://");
  return `${wsBase}/api/v1/ws/conversations/${conversationId}?role=A&mode=lobby`;
}

export function HomePageClient() {
  const { conversation, isLoading, error, createNewConversation } =
    useConversationBootstrap();
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null);
  const [bJoinedNotice, setBJoinedNotice] = useState<string | null>(null);
  const noticeTimeoutRef = useRef<number | undefined>(undefined);

  const joinUrl = useMemo(() => {
    if (!conversation) {
      return "";
    }

    if (typeof window === "undefined") {
      return `/join/${conversation.id}?role=B`;
    }

    return `${window.location.origin}/join/${conversation.id}?role=B`;
  }, [conversation]);

  const joinAsAUrl = useMemo(() => {
    if (!conversation) {
      return "";
    }

    if (typeof window === "undefined") {
      return `/join/${conversation.id}?role=A`;
    }

    return `${window.location.origin}/join/${conversation.id}?role=A`;
  }, [conversation]);

  useEffect(() => {
    if (!conversation) {
      return;
    }

    const socket = new WebSocket(toWebSocketUrl(conversation.id));

    socket.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as SocketEvent;
        if (payload.type === "participant_joined" && payload.role === "B") {
          setBJoinedNotice("User B joined. Join the room as User A now.");
          if (noticeTimeoutRef.current) {
            window.clearTimeout(noticeTimeoutRef.current);
          }
          noticeTimeoutRef.current = window.setTimeout(() => {
            setBJoinedNotice(null);
          }, 12000);
        }
      } catch {
        setBJoinedNotice("User B may have joined. Open the room to confirm.");
      }
    };

    return () => {
      if (noticeTimeoutRef.current) {
        window.clearTimeout(noticeTimeoutRef.current);
      }
      socket.close();
    };
  }, [conversation]);

  async function handleCopyLink() {
    if (!joinUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(joinUrl);
      setFeedbackMessage("Join link copied to clipboard.");
    } catch {
      setFeedbackMessage(
        "Copy failed. Please select and copy the link manually.",
      );
    }
  }

  async function handleNewConversation() {
    setFeedbackMessage(null);
    setBJoinedNotice(null);
    await createNewConversation();
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.intro} aria-labelledby='intro-title'>
          <p className={styles.kicker}>Accessibility-first communication</p>
          <h1 id='intro-title'>
            Bridge deaf and hearing conversations in seconds.
          </h1>
          <p>
            Open this page, scan the QR code from another device, and start a
            shared conversation instantly. No app install and no account
            required.
          </p>
          <p>
            <Link href='/asl' className={styles.aslLabLink}>
              Open ASL Lab (Camera + Hand Tracking)
            </Link>
          </p>
        </section>

        <ConversationLauncherCard
          conversation={conversation}
          isLoading={isLoading}
          error={error}
          joinUrl={joinUrl}
          onCopyLink={handleCopyLink}
          onNewConversation={handleNewConversation}
          feedbackMessage={feedbackMessage}
          bJoinedNotice={bJoinedNotice}
          joinAsAUrl={joinAsAUrl}
        />
      </main>

      <section
        className={styles.purposeSection}
        aria-labelledby='purpose-title'
      >
        <h2 id='purpose-title'>Purpose of Hear</h2>
        <p>
          Hear helps deaf and hearing users share one real-time conversation
          space without setup friction.
        </p>
        <div className={styles.purposeGrid}>
          <article className={styles.purposeCard}>
            <h3>Inclusive by default</h3>
            <p>
              Speech-to-text and text chat are available together so both users
              can communicate comfortably.
            </p>
          </article>
          <article className={styles.purposeCard}>
            <h3>Instant collaboration</h3>
            <p>
              QR and direct link sharing let two participants join from separate
              devices in seconds.
            </p>
          </article>
          <article className={styles.purposeCard}>
            <h3>Simple and private</h3>
            <p>
              No account or install required, keeping the flow focused on the
              conversation itself.
            </p>
          </article>
        </div>

        <p className={styles.contactNote}>
          If you have suggestions, or recommendations or questions, you can
          reach out to me from the Contact section of cihann.com.
        </p>
      </section>
    </div>
  );
}
