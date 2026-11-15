import type { ModelCallStreamPart } from "@ai-sdk/workflow";
import { convertToModelMessages, isStepCount, type UIMessage } from "ai";
import { getWritable } from "workflow";
import { createShoppingAgent } from "@/lib/agent";
import { describeAgentError, finishAgentStream } from "./stream-steps";

/**
 * One shopping-chat turn as a durable workflow run.
 *
 * `POST /api/chat` starts a run per user message with the full UI history.
 * Model calls and tool steps are durable: transient failures are retried, and
 * if the function serving the request dies, the run keeps going and the
 * client reconnects to `GET /api/chat/:runId/stream` to replay the stream
 * from where it left off — no duplicate output, no second run.
 */
export async function shoppingChatFlow(messages: UIMessage[], model: string) {
  "use workflow";

  const agent = createShoppingAgent(model);
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
      stopWhen: isStepCount(10),
    });
    await finishAgentStream();
    return { finishReason: result.finishReason, steps: result.steps.length };
  } catch (error) {
    await finishAgentStream(describeAgentError(error));
    return { finishReason: "error" as const, steps: 0 };
  }
}
