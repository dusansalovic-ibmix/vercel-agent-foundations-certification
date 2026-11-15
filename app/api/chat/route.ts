import { start } from "workflow/api";
import { shoppingModelId } from "@/lib/agent";
import { readChatMessages, streamRun } from "@/lib/chat-route";
import { shoppingChatFlow } from "@/lib/workflows/chat-flow";

/**
 * Shopping agent chat endpoint (storefront chat panel).
 *
 * Each user turn starts a durable `shoppingChatFlow` run. The response streams
 * the run's output and carries its ID in `x-workflow-run-id`, which the
 * client's `WorkflowChatTransport` uses to reconnect via
 * `GET /api/chat/:id/stream` if the connection drops or the page reloads.
 */
export async function POST(request: Request) {
  const parsed = await readChatMessages(request);
  if ("error" in parsed) return parsed.error;

  const run = await start(shoppingChatFlow, [parsed.messages, shoppingModelId()]);
  return streamRun(run);
}
