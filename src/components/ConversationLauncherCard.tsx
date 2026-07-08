"use client";

import Link from "next/link";
import QRCode from "react-qr-code";

import { Conversation } from "@/types/conversation";

import styles from "./ConversationLauncherCard.module.css";

interface ConversationLauncherCardProps {
  conversation: Conversation | null;
  isLoading: boolean;
  error: string | null;
  joinUrl: string;
  onCopyLink: () => Promise<void>;
  onNewConversation: () => Promise<void>;
  feedbackMessage: string | null;
  bJoinedNotice: string | null;
  joinAsAUrl: string;
}

export function ConversationLauncherCard({
  conversation,
  isLoading,
  error,
  joinUrl,
  onCopyLink,
  onNewConversation,
  feedbackMessage,
  bJoinedNotice,
  joinAsAUrl,
}: ConversationLauncherCardProps) {
  return (
    <section
      className={styles.card}
      aria-labelledby='conversation-launcher-title'
    >
      <header className={styles.header}>
        <h1 id='conversation-launcher-title'>Start a conversation</h1>
        <p>Scan this QR code to join instantly from another device.</p>
        <p className={styles.roleHint}>
          Shared QR/link is for User B. You are User A.
        </p>
      </header>

      <div className={styles.qrPanel} aria-live='polite'>
        {isLoading && (
          <p className={styles.status}>Creating a secure room...</p>
        )}

        {!isLoading && !error && conversation && (
          <>
            <div className={styles.qrFrame}>
              <QRCode
                value={joinUrl}
                size={184}
                bgColor='transparent'
                fgColor='#143042'
              />
            </div>
            <p className={styles.roomId}>
              Room ID: <strong>{conversation.id}</strong>
            </p>
          </>
        )}

        {error && (
          <p className={styles.error} role='alert'>
            {error}
          </p>
        )}
      </div>

      <div className={styles.linkBlock}>
        <label htmlFor='join-link' className={styles.linkLabel}>
          Join link
        </label>
        <input
          id='join-link'
          className={styles.linkInput}
          type='text'
          value={joinUrl}
          readOnly
          aria-readonly='true'
        />
      </div>

      <div className={styles.actions}>
        <button
          type='button'
          className={styles.primaryButton}
          onClick={() => void onCopyLink()}
          disabled={isLoading || !conversation}
          aria-label='Copy join link'
        >
          Copy Link
        </button>
        <button
          type='button'
          className={styles.secondaryButton}
          onClick={() => void onNewConversation()}
          disabled={isLoading}
          aria-label='Create a new conversation'
        >
          New Conversation
        </button>
      </div>

      <div className={styles.joinBlock}>
        <Link
          href={joinAsAUrl || "#"}
          className={styles.joinAsAButton}
          aria-disabled={!joinAsAUrl}
        >
          Join Room as User A
        </Link>
        {bJoinedNotice && (
          <p className={styles.joinNotice} role='status' aria-live='polite'>
            {bJoinedNotice}
          </p>
        )}
      </div>

      <p className={styles.feedback} aria-live='polite'>
        {feedbackMessage}
      </p>
    </section>
  );
}
