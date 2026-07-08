import { Conversation, ConversationCreateResponse } from "@/types/conversation";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export async function createConversation(): Promise<Conversation> {
  const response = await fetch(`${API_BASE_URL}/api/v1/conversations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Unable to create a conversation right now.");
  }

  const payload = (await response.json()) as ConversationCreateResponse;

  return {
    id: payload.id,
    createdAt: payload.created_at,
  };
}
