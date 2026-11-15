import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { createAdminAgent } from "@/lib/agent";
import { loadAdminMemoryStep } from "@/lib/tools";
import { describeAgentError, finishAgentStream } from "./stream-steps";

/**
 * One store-admin chat turn as a durable workflow run.
 *
 * 1. Read the memory file from the admin sandbox (application code, not the
 *    model) and put its contents into the agent's instructions.
 * 2. Run the admin agent: back-office reads, sandbox computation, and
 *    memory writes are each durable, retried steps.
 *
 * The workflow clock is deterministic, so "today" stays stable if the run is
 * replayed after an interruption.
 */
export async function adminChatFlow(messages: UIMessage[], model: string) {
  "use workflow";

  const memory = await loadAdminMemoryStep();
  const agent = createAdminAgent(model, {
    memory,
    nowIso: new Date().toISOString(),
  });
  const modelMessages = await convertToModelMessages(messages, {
    tools: agent.tools,
    ignoreIncompleteToolCalls: true,
  });

  try {
    const result = await agent.stream({
      messages: modelMessages,
      writable: getWritable<ModelCallStreamPart>(),
      // finishAgentStream closes the stream (and reports errors) below.
      preventClose: true,
      stopWhen: isStepCount(25),
    });
    await finishAgentStream();
    return { finishReason: result.finishReason, steps: result.steps.length };
  } catch (error) {
    await finishAgentStream(describeAgentError(error));
    return { finishReason: "error" as const, steps: 0 };
  }
}
