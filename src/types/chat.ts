export interface ChatMessage {
  id: string;
  sender: string;
  content: string;
  timestamp: string;
}

export type RoleLabel = "A" | "B";

export type SocketEvent =
  | { type: "role_assigned"; role: RoleLabel }
  | { type: "history"; messages: ChatMessage[] }
  | { type: "message"; message: ChatMessage }
  | { type: "typing"; sender: RoleLabel; isTyping: boolean }
  | { type: "participant_joined"; role: RoleLabel }
  | { type: "participant_left"; role: RoleLabel }
  | { type: "participant_names"; names: Partial<Record<RoleLabel, string>> }
  | { type: "name_updated"; role: RoleLabel; name: string };
