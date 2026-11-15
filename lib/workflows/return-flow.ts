import { createWebhook, sleep } from "workflow";
import {
  fetchReturnStatus,
  fileReturn,
  loadOrderForReturn,
  notifyCustomerReturnDecision,
  notifyCustomerReturnStarted,
  preauthorizeReturnRefund,
} from "@/lib/return-steps";

export interface ReturnFlowInput {
  orderId: string;
  reason: string;
}

/** How long to wait for the store's decision callback before polling. */
const CALLBACK_WAIT = "3m";
const POLL_INTERVAL = "1m";
const MAX_POLLS = 5;

/**
 * Durable order-return workflow.
 *
 * Started by the shopping agent's `returnOrder` tool (fire-and-forget), so the
 * chat confirms "filed" immediately while this keeps running in the
 * background. Every external call is a step: if filing the return fails and
 * is retried, the customer notification and the refund pre-authorization
 * that already completed are replayed from the event log, not executed again.
 *
 * Run-level idempotency: the tool starts this workflow with the hook token
 * `return:<orderId>`, so a second request for the same order while this run
 * is active is refused instead of starting a duplicate return.
 */
export async function returnFlow({ orderId, reason }: ReturnFlowInput) {
  "use workflow";

  // 1. Look up the order.
  const order = await loadOrderForReturn(orderId);

  // 2. Notify the customer that the return is in progress.
  await notifyCustomerReturnStarted(order.orderId);

  // 3. Pre-authorize the refund.
  const preauthorization = await preauthorizeReturnRefund(order.orderId);

  // 4. File the return. The store API POSTs its decision to this webhook URL.
  //    Make sure the webhook is registered before handing its URL out.
  const webhook = createWebhook();
  await webhook.getConflict();
  const filed = await fileReturn({
    orderId: order.orderId,
    items: order.items.map(({ productId, quantity }) => ({
      productId,
      quantity,
    })),
    reason,
    callback: webhook.url,
  });

  // 5. Wait for the decision: callback first, polling as a fallback (the
  //    callback can't reach localhost, or a protected preview deployment).
  const callbackArrived = await Promise.race([
    webhook.then(() => true),
    sleep(CALLBACK_WAIT).then(() => false),
  ]);

  // Never trust the callback body on its own — anyone holding the URL could
  // call it. Read the authoritative status from the store API instead.
  let latest = await fetchReturnStatus(filed.id);
  for (let i = 0; latest.decision == null && i < MAX_POLLS; i++) {
    await sleep(POLL_INTERVAL);
    latest = await fetchReturnStatus(filed.id);
  }

  // 6. Tell the customer the outcome.
  await notifyCustomerReturnDecision({
    orderId: order.orderId,
    returnId: filed.id,
    decision: latest.decision,
    refundAmount: latest.refundAmount,
  });

  return {
    orderId: order.orderId,
    returnId: filed.id,
    preauthorizationId: preauthorization.id,
    decision: latest.decision,
    refundAmount: latest.refundAmount,
    decisionSource: callbackArrived ? "callback" : "polling",
  };
}
