/**
 * Durable steps for order returns.
 *
 * Each function is a Workflow step ("use step"): it runs on the server with
 * full Node.js access, its result is recorded in the run's event log, and it
 * is retried automatically on failure. Because completed steps are replayed
 * from the log instead of re-executed, a retry of `fileReturn` never repeats
 * `notifyCustomerReturnStarted` or `preauthorizeReturnRefund`.
 *
 * Error policy:
 * - Business failures (order missing, not eligible, invalid input) throw
 *   `FatalError` inside the workflow, or return a `ToolFailure` to the agent,
 *   so they are never retried.
 * - Transient failures (network, 5xx, 429) throw `RetryableError` with
 *   backoff and are retried by the runtime.
 */
import { FatalError, RetryableError, getStepMetadata } from "workflow";
import {
  ApiRequestError,
  createReturn,
  getOrder,
  getReturn,
  notifyReturnInProcess,
  preauthorizeRefund,
} from "./api";
import type { ReturnLine, ToolFailure } from "./agent-types";
import type { Order, RefundPreauthorization, Return } from "./types";

/** Order statuses the store API accepts returns for. */
const RETURNABLE_STATUSES = new Set(["fulfilled", "delivered"]);

export interface ReturnableOrder {
  orderId: string;
  status: string;
  items: ReturnLine[];
  total: number;
  currency: string;
}

function toReturnableOrder(order: Order): ReturnableOrder {
  return {
    orderId: order.id,
    status: order.status,
    items: order.items.map((item) => ({
      productId: item.productId,
      name: item.product?.name ?? item.productId,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
    total: order.total,
    currency: order.currency,
  };
}

function isTransient(error: unknown): boolean {
  if (!(error instanceof ApiRequestError)) return true;
  return error.status === 0 || error.status === 429 || error.status >= 500;
}

function retryable(context: string, error: unknown): RetryableError {
  const { attempt } = getStepMetadata();
  const status = error instanceof ApiRequestError ? error.status : "network";
  return new RetryableError(`${context} failed (${status}); retrying`, {
    retryAfter: Math.min(attempt * 2000, 10_000),
  });
}

// ---------------------------------------------------------------------------
// Used by the shopping agent's `returnOrder` tool before it starts the
// workflow, so the shopper gets an honest answer instead of a false
// "filed" confirmation for an order that can't be returned.
// ---------------------------------------------------------------------------

export async function checkReturnEligibility(
  orderId: string,
): Promise<({ ok: true } & ReturnableOrder) | ToolFailure> {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (!RETURNABLE_STATUSES.has(order.status)) {
      return {
        ok: false,
        code: "NOT_ELIGIBLE",
        message:
          order.status === "cancelled"
            ? `Order ${orderId} was cancelled, so there is nothing to return.`
            : `Order ${orderId} is "${order.status}" and hasn't been delivered yet, so it can't be returned yet.`,
      };
    }
    return { ok: true, ...toReturnableOrder(order) };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: `We couldn't find an order with ID "${orderId}". Please double-check the order number.`,
      };
    }
    const { attempt, maxAttempts } = getStepMetadata();
    if (isTransient(error) && attempt < maxAttempts) {
      throw retryable("Order lookup", error);
    }
    return {
      ok: false,
      code: "SERVICE_UNAVAILABLE",
      message:
        "The order service is unavailable right now, so the return was not filed. Please try again in a moment.",
    };
  }
}

// ---------------------------------------------------------------------------
// Steps of the return workflow (lib/workflows/return-flow.ts)
// ---------------------------------------------------------------------------

/** Step 1 — look up the order (fresh read inside the durable run). */
export async function loadOrderForReturn(
  orderId: string,
): Promise<ReturnableOrder> {
  "use step";
  try {
    const order = await getOrder(orderId);
    if (!RETURNABLE_STATUSES.has(order.status)) {
      throw new FatalError(
        `Order ${orderId} is "${order.status}" and is not eligible for return`,
      );
    }
    return toReturnableOrder(order);
  } catch (error) {
    if (error instanceof FatalError) throw error;
    if (!isTransient(error)) {
      throw new FatalError(`Order ${orderId} could not be loaded for return`);
    }
    throw retryable("Order lookup", error);
  }
}

/** Step 2 — tell the customer their return is being processed. */
export async function notifyCustomerReturnStarted(
  orderId: string,
): Promise<{ notifiedAt: string }> {
  "use step";
  await notifyReturnInProcess(orderId);
  return { notifiedAt: new Date().toISOString() };
}

/** Step 3 — pre-authorize the refund for the order. */
export async function preauthorizeReturnRefund(
  orderId: string,
): Promise<RefundPreauthorization> {
  "use step";
  try {
    return await preauthorizeRefund(orderId);
  } catch (error) {
    if (!isTransient(error)) {
      throw new FatalError(`Refund pre-authorization rejected for ${orderId}`);
    }
    throw retryable("Refund pre-authorization", error);
  }
}
// Payment side effect: allow a few retries, but not unbounded ones.
preauthorizeReturnRefund.maxRetries = 4;

/** Step 4 — file the return with the store, registering the decision callback. */
export async function fileReturn(input: {
  orderId: string;
  items: { productId: string; quantity: number }[];
  reason: string;
  callback: string;
}): Promise<Return> {
  "use step";
  try {
    return await createReturn(input);
  } catch (error) {
    if (!isTransient(error)) {
      const message =
        error instanceof ApiRequestError ? error.message : "Return rejected";
      throw new FatalError(`Return for ${input.orderId} rejected: ${message}`);
    }
    throw retryable("Filing the return", error);
  }
}
fileReturn.maxRetries = 6;

/**
 * Authoritative read of a return's status. Used both to verify a webhook
 * callback (the webhook URL is the only auth on that request) and as the
 * polling fallback when no callback arrives.
 */
export async function fetchReturnStatus(returnId: string): Promise<Return> {
  "use step";
  try {
    return await getReturn(returnId);
  } catch (error) {
    if (!isTransient(error)) {
      throw new FatalError(`Return ${returnId} could not be read`);
    }
    throw retryable("Return status lookup", error);
  }
}

/** Step 5 — tell the customer the final decision. */
export async function notifyCustomerReturnDecision(input: {
  orderId: string;
  returnId: string;
  decision: string | null;
  refundAmount: number | null;
}): Promise<{ notifiedAt: string }> {
  "use step";
  // In production this would hit your email provider.
  console.log(
    `[returnOrder] 📧 told customer the return ${input.returnId} for order ${input.orderId} was ${input.decision ?? "still pending"}` +
      (input.refundAmount != null ? ` (refund ${input.refundAmount} cents)` : ""),
  );
  return { notifiedAt: new Date().toISOString() };
}
