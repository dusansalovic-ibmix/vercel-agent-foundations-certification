import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { getWritable } from "workflow";
import { redactSecrets } from "@/lib/secrets";

/**
 * Close the run's chat stream, optionally reporting a fatal error first.
 *
 * The agents stream with `preventClose: true` so this step owns closing the
 * stream. When the model keeps failing after its retries, `agent.stream()`
 * rejects; writing an explicit `error` part means the client shows a real
 * error (with a retry button) instead of an empty reply, and closing the
 * stream lets the transport finish cleanly instead of reconnecting.
 */
export async function finishAgentStream(errorMessage?: string): Promise<void> {
  "use step";
  const writer = getWritable<ModelCallStreamPart>().getWriter();
  try {
    if (errorMessage) {
      await writer.write({
        type: "error",
        error: redactSecrets(errorMessage).slice(0, 300),
      } as ModelCallStreamPart);
    }
    await writer.close();
  } catch {
    // Already closed — nothing more to do.
  } finally {
    writer.releaseLock();
  }
}

export function describeAgentError(error: unknown): string {
  const raw = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/GatewayAuthentication|unauthori[sz]ed|authentication|oidc|401|403/i.test(raw)) {
    return "The assistant could not reach the AI model (AI Gateway authentication failed). Please try again later.";
  }
  return "The assistant ran into a problem and could not finish this reply. Please try again.";
}
