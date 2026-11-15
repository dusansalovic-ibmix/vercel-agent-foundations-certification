import { start } from "workflow/api";
import { adminModelId } from "@/lib/agent";
import { isAdminRequest } from "@/lib/admin-session";
import { jsonError, readChatMessages, streamRun } from "@/lib/chat-route";
import { adminChatFlow } from "@/lib/workflows/admin-chat-flow";

/**
 * Store admin agent chat endpoint (`/admin`).
 *
 * Gated by the admin session cookie (also enforced in `proxy.ts`). Each turn
 * starts a durable `adminChatFlow` run; reconnects go to
 * `GET /api/admin/chat/:id/stream`.
 */
export async function POST(request: Request) {
  if (!(await isAdminRequest())) return jsonError(401, "Admin sign-in required.");

  const parsed = await readChatMessages(request);
  if ("error" in parsed) return parsed.error;

  const run = await start(adminChatFlow, [parsed.messages, adminModelId()]);
  return streamRun(run);
}
