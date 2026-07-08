import { ConversationRoom } from "@/components/ConversationRoom";
import { RoleLabel } from "@/types/chat";

interface JoinPageProps {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ role?: string }>;
}

function sanitizeRole(role: string | undefined): RoleLabel {
  if (role === "A") {
    return "A";
  }
  return "B";
}

export default async function JoinPage({
  params,
  searchParams,
}: JoinPageProps) {
  const { conversationId } = await params;
  const { role } = await searchParams;

  return (
    <ConversationRoom
      conversationId={conversationId}
      initialRole={sanitizeRole(role)}
    />
  );
}
