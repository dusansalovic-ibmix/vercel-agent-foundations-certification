/**
 * Shared plumbing for the durable chat routes (shopping + admin).
 *
 * POST   start a workflow run for one chat turn and stream it back, with the
 *        run ID in `x-workflow-run-id` (required by `WorkflowChatTransport`).
 * GET    replay/resume a run's stream from a UI-chunk cursor after a dropped
 *        connection or a page refresh.
 *
 * Server-only.
 */
import { createModelCallToUIChunkTransform } from "@ai-sdk/workflow";
import {
  createUIMessageStreamResponse,
  safeValidateUIMessages,
  type UIMessage,
} from "ai";
import { getRun } from "workflow/api";

const MAX_MESSAGES = 60;
const MAX_BODY_BYTES = 400_000;

/**
 * Parse and validate the chat history posted by `useChat`.
 * Only user/assistant messages are accepted: a client can't smuggle in its
 * own `system` instructions.
 */
export async function readChatMessages(
  request: Request,
): Promise<{ messages: UIMessage[] } | { error: Response }> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return { error: jsonError(413, "Conversation is too long. Start a new chat.") };
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return { error: jsonError(400, "Request body must be JSON.") };
  }

  const candidate = (body as { messages?: unknown })?.messages;
  const validated = await safeValidateUIMessages({ messages: candidate });
  if (!validated.success) {
    return { error: jsonError(400, "Invalid chat messages.") };
  }

  const messages = validated.data
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-MAX_MESSAGES);

  if (messages.length === 0 || messages.at(-1)?.role !== "user") {
    return { error: jsonError(400, "The last message must be from the user.") };
  }

  return { messages };
}

/** Stream a freshly started run to the client. */
export function streamRun(run: {
  runId: string;
  readable: ReadableStream;
}): Response {
  return createUIMessageStreamResponse({
    stream: run.readable.pipeThrough(createModelCallToUIChunkTransform()),
    headers: { "x-workflow-run-id": run.runId },
  });
}

/**
 * Resume an existing run's stream.
 *
 * The durable stream stores raw model parts, while the transport counts UI
 * chunks, so we replay the raw stream from 0 and skip the UI chunks the client
 * already has (`uiStartIndex`). The client receives each chunk exactly once.
 *
 * `workflowFunctionName` ensures a run ID from one chat can't be used to read
 * the other chat's stream (e.g. a shopper probing admin runs).
 */
export async function resumeRunStream(
  request: Request,
  runId: string,
  workflowFunctionName: string,
): Promise<Response> {
  const startIndex = Number(
    new URL(request.url).searchParams.get("startIndex") ?? "0",
  );
  if (!Number.isSafeInteger(startIndex) || startIndex < 0) {
    return jsonError(400, "startIndex must be a non-negative integer.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(runId)) {
    return jsonError(400, "Invalid run ID.");
  }

  const run = getRun(runId);
  try {
    if (!(await run.exists)) return jsonError(404, "Run not found.");
    const workflowName = await run.workflowName;
    if (!workflowName.includes(workflowFunctionName)) {
      return jsonError(404, "Run not found.");
    }
  } catch {
    return jsonError(404, "Run not found.");
  }

  return createUIMessageStreamResponse({
    stream: run
      .getReadable({ startIndex: 0 })
      .pipeThrough(createModelCallToUIChunkTransform({ uiStartIndex: startIndex })),
    headers: { "x-workflow-run-id": runId },
  });
}

export function jsonError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}
