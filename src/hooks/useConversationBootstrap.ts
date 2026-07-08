"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { createConversation } from "@/lib/api";
import { Conversation } from "@/types/conversation";

interface UseConversationBootstrapResult {
  conversation: Conversation | null;
  isLoading: boolean;
  error: string | null;
  createNewConversation: () => Promise<void>;
}

export function useConversationBootstrap(): UseConversationBootstrapResult {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const didBootstrap = useRef(false);

  const createNewConversation = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const nextConversation = await createConversation();
      setConversation(nextConversation);
    } catch {
      setError("We could not create a conversation. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (didBootstrap.current) {
      return;
    }

    didBootstrap.current = true;
    void createNewConversation();
  }, [createNewConversation]);

  return {
    conversation,
    isLoading,
    error,
    createNewConversation,
  };
}
