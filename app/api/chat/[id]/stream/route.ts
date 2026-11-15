import { resumeRunStream } from "@/lib/chat-route";

/**
 * Resume a shopping chat run's stream (`WorkflowChatTransport` reconnects
 * here with `?startIndex=<chunks already received>`).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return resumeRunStream(request, id, "shoppingChatFlow");
}
