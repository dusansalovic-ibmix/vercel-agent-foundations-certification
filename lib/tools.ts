/**
 * Tools for the shopping agent and the store admin agent.
 *
 * Every tool that touches the network is a Workflow step ("use step"), so it
 * runs server-side with the store API credentials, is retried on transient
 * failures, and its result is persisted in the run's event log (a resumed run
 * replays completed tool calls instead of repeating them).
 *
 * Tool `execute` functions are thin wrappers that pass only the validated
 * input to the step — the conversation history is not copied into every
 * step's serialized arguments.
 *
 * The two agents get separate tool sets (`shoppingTools` / `adminTools`):
 * back-office data, the sandbox `bash` tool and memory are never exposed to
 * shoppers.
 */
import { tool } from "ai";
import { z } from "zod/v4";
import { RetryableError, getStepMetadata } from "workflow";
import { start } from "workflow/api";
import { HookConflictError } from "workflow/errors";
import {
  ApiRequestError,
  getBackOfficeReturns,
  getBackOfficeSales,
  getBackOfficeStock,
  getBackOfficeSupportTickets,
  getCategories,
  getProductById,
  getProductStock,
  getProducts,
} from "./api";
import type {
  BashResult,
  GetAllCategoriesResult,
  InventoryStockResult,
  MemoryKind,
  ProductDetailsResult,
  ProductSummary,
  ReturnOrderResult,
  ReturnsHistoryResult,
  SalesAnalyticsResult,
  SaveMemoryResult,
  SearchProductsResult,
  SupportTicketsResult,
  ToolFailure,
} from "./agent-types";
import { checkReturnEligibility } from "./return-steps";
import {
  appendMemoryLine,
  readMemoryFile,
  runSandboxCommand,
  writeDataFile,
} from "./sandbox";
import { containsSecret, redactSecrets } from "./secrets";
import type { Product } from "./types";
import { returnFlow } from "./workflows/return-flow";

// ---------------------------------------------------------------------------
// Shared error handling
// ---------------------------------------------------------------------------

/**
 * Map an error thrown inside a step to a tool result.
 *
 * - 404 → NOT_FOUND, 400/422 → INVALID_REQUEST (never retried).
 * - Network / 429 / 5xx → throw `RetryableError` so the Workflow runtime
 *   retries the step with backoff. On the final attempt, return
 *   SERVICE_UNAVAILABLE instead, so the model gets an explicit failure it must
 *   report rather than a silent gap.
 *
 * Messages are built from the API's own error text and never include request
 * URLs, so the protection-bypass value can't leak into a chat.
 */
function failureFromError(
  error: unknown,
  what: string,
  notFound?: string,
): ToolFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 404) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: notFound ?? `${what}: not found.`,
      };
    }
    if (error.status === 400 || error.status === 422) {
      return {
        ok: false,
        code: "INVALID_REQUEST",
        message: `${what}: ${redactSecrets(error.message)}`,
      };
    }
  }
  const { attempt, maxAttempts } = getStepMetadata();
  if (attempt < maxAttempts) {
    throw new RetryableError(`${what} failed on attempt ${attempt}; retrying`, {
      retryAfter: Math.min(attempt * 1500, 8000),
    });
  }
  return {
    ok: false,
    code: "SERVICE_UNAVAILABLE",
    message: `${what} is unavailable right now (the store service did not respond after ${maxAttempts} attempts).`,
  };
}

function sandboxFailure(error: unknown, what: string): ToolFailure {
  const { attempt, maxAttempts } = getStepMetadata();
  if (attempt < maxAttempts) {
    throw new RetryableError(`${what} failed on attempt ${attempt}; retrying`, {
      retryAfter: Math.min(attempt * 2000, 8000),
    });
  }
  const detail = error instanceof Error ? redactSecrets(error.message) : "";
  return {
    ok: false,
    code: "SANDBOX_UNAVAILABLE",
    message: `${what}: the admin sandbox is unavailable.${detail ? ` (${detail.slice(0, 200)})` : ""}`,
  };
}

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

const dateString = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/,
    "Use YYYY-MM-DD or an ISO 8601 datetime",
  );

const orderIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_-]{1,40}$/, "Order IDs are letters, digits, - or _");

// ---------------------------------------------------------------------------
// Catalog steps (both agents)
// ---------------------------------------------------------------------------

function toSummary(product: Product): ProductSummary {
  const description = product.description ?? "";
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    price: product.price,
    currency: product.currency,
    category: product.category,
    image: product.images?.[0] ?? null,
    shortDescription:
      description.length > 160 ? `${description.slice(0, 157)}…` : description,
  };
}

export async function searchProductsStep(input: {
  query?: string;
  category?: string;
  page?: number;
  limit?: number;
}): Promise<SearchProductsResult> {
  "use step";
  const query = input.query?.trim() || null;
  const page = input.page ?? 1;
  const limit = input.limit ?? 12;
  let category = input.category?.trim().toLowerCase() || null;

  try {
    if (category) {
      // Validate the filter against live store data instead of trusting the
      // model's guess (e.g. "tshirts" vs "t-shirts").
      const categories = await getCategories();
      const match = categories.find(
        (c) => c.slug === category || c.name.toLowerCase() === category,
      );
      if (!match) {
        return {
          ok: false,
          code: "INVALID_REQUEST",
          message: `"${input.category}" is not a store category.`,
          hint: `Valid categories: ${categories.map((c) => c.slug).join(", ")}`,
        };
      }
      category = match.slug;
    }
    const products = await getProducts({
      search: query ?? undefined,
      category: category ?? undefined,
      page,
      limit,
    });
    return {
      ok: true,
      query,
      category,
      page,
      count: products.length,
      products: products.map(toSummary),
    };
  } catch (error) {
    return failureFromError(error, "Product search");
  }
}

export async function getAllCategoriesStep(): Promise<GetAllCategoriesResult> {
  "use step";
  try {
    return { ok: true, categories: await getCategories() };
  } catch (error) {
    return failureFromError(error, "Category list");
  }
}

export async function getProductDetailsStep(input: {
  product: string;
}): Promise<ProductDetailsResult> {
  "use step";
  const idOrSlug = input.product.trim();
  try {
    const product = await getProductById(idOrSlug);
    let stock = null;
    try {
      stock = await getProductStock(product.id);
    } catch {
      // Product facts are still useful; the UI shows "availability unknown".
    }
    return { ok: true, product, stock };
  } catch (error) {
    return failureFromError(
      error,
      "Product lookup",
      `No product matches "${idOrSlug}". Try searching the catalog instead.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Returns (shopping agent)
//
// `returnOrder` runs at the workflow level (no "use step"): it calls the
// eligibility step, then `start()`s the durable return workflow and returns
// right away. Inside a workflow, `start()` runs as an internal step, so a
// replay of this chat run never files the same return twice.
// ---------------------------------------------------------------------------

async function returnOrder(input: {
  orderId: string;
  reason: string;
}): Promise<ReturnOrderResult> {
  const orderId = input.orderId.trim();
  const reason = input.reason.trim();

  const order = await checkReturnEligibility(orderId);
  if (!order.ok) return order;

  try {
    const run = await start(returnFlow, [{ orderId, reason }], {
      // One active return run per order — duplicates are refused.
      experimental_hook: { token: `return:${orderId}` },
    });
    return {
      ok: true,
      status: "filed",
      orderId,
      returnRunId: run.runId,
      reason,
      items: order.items,
      refundEstimate: order.total,
      currency: order.currency,
    };
  } catch (error) {
    if (HookConflictError.is(error)) {
      return {
        ok: false,
        code: "ALREADY_IN_PROGRESS",
        message: `A return for order ${orderId} is already being processed — no duplicate was filed.`,
        returnRunId: error.conflictingRunId,
      };
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Back-office steps (admin agent, read-only)
//
// Each step returns a preview of the rows to the model and writes the full
// result as JSON into the admin sandbox, where the `bash` tool can compute
// exact aggregates and joins over it.
// ---------------------------------------------------------------------------

const PREVIEW_ROWS = 25;

function dataFileName(prefix: string, params: object): string {
  const parts = Object.entries(params as Record<string, unknown>)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}-${Array.isArray(v) ? v.join("+") : String(v)}`)
    .join("_")
    .replace(/[^A-Za-z0-9_+.-]/g, "-")
    .slice(0, 120);
  return `${prefix}${parts ? `_${parts}` : ""}.json`;
}

/** Best effort: a sandbox outage must not hide the data itself. */
async function saveToSandbox(
  fileName: string,
  data: unknown,
): Promise<string | null> {
  try {
    return await writeDataFile(fileName, data);
  } catch (error) {
    console.error("[admin-agent] could not write sandbox data file", {
      fileName,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function getSupportTicketsStep(
  input: Parameters<typeof getBackOfficeSupportTickets>[0] & {},
): Promise<SupportTicketsResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSupportTickets(input);
    const dataFile = await saveToSandbox(
      dataFileName("support-tickets", input),
      { meta, filters: input, rows: data },
    );
    return {
      ok: true,
      meta,
      rows: data.slice(0, PREVIEW_ROWS),
      truncated: data.length > PREVIEW_ROWS,
      dataFile,
    };
  } catch (error) {
    return failureFromError(error, "Support tickets");
  }
}

export async function getReturnsHistoryStep(
  input: Parameters<typeof getBackOfficeReturns>[0] & {},
): Promise<ReturnsHistoryResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeReturns(input);
    const dataFile = await saveToSandbox(dataFileName("returns", input), {
      meta,
      filters: input,
      rows: data,
    });
    return {
      ok: true,
      meta: {
        ...meta,
        status: input.status ?? null,
        decision: input.decision ?? null,
      },
      rows: data.slice(0, PREVIEW_ROWS),
      truncated: data.length > PREVIEW_ROWS,
      dataFile,
    };
  } catch (error) {
    return failureFromError(error, "Returns history");
  }
}

export async function getInventoryStockStep(
  input: Parameters<typeof getBackOfficeStock>[0] & {},
): Promise<InventoryStockResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeStock(input);
    const dataFile = await saveToSandbox(dataFileName("inventory", input), {
      pagination: meta.pagination,
      filters: input,
      rows: data,
    });
    return {
      ok: true,
      pagination: meta.pagination,
      rows: data.slice(0, 60),
      truncated: data.length > 60,
      dataFile,
    };
  } catch (error) {
    return failureFromError(error, "Inventory stock");
  }
}

export async function getSalesAnalyticsStep(
  input: Parameters<typeof getBackOfficeSales>[0] & {},
): Promise<SalesAnalyticsResult> {
  "use step";
  try {
    const { data, meta } = await getBackOfficeSales(input);
    const dataFile = await saveToSandbox(dataFileName("sales", input), {
      meta,
      filters: input,
      rows: data,
    });
    return {
      ok: true,
      meta,
      rows: data.slice(0, 60),
      truncated: data.length > 60,
      dataFile,
    };
  } catch (error) {
    return failureFromError(
      error,
      "Sales analytics",
      input.productId
        ? `No product with ID "${input.productId}" exists in the catalog.`
        : undefined,
    );
  }
}

// ---------------------------------------------------------------------------
// Sandbox + memory steps (admin agent)
// ---------------------------------------------------------------------------

export async function bashStep(input: { command: string }): Promise<BashResult> {
  "use step";
  try {
    const outcome = await runSandboxCommand(input.command);
    return { ok: true, command: input.command, ...outcome };
  } catch (error) {
    return { ...sandboxFailure(error, "Command"), command: input.command };
  }
}
// Commands may have side effects inside the sandbox, so keep retries low.
bashStep.maxRetries = 1;

const CREDENTIAL_PATTERN =
  /(bypass|api[_ -]?key|password|secret|token)\s*[:=]\s*\S{6,}/i;

export async function saveMemoryStep(input: {
  kind: MemoryKind;
  note: string;
}): Promise<SaveMemoryResult> {
  "use step";
  const note = input.note.replace(/\s+/g, " ").trim();
  if (containsSecret(note) || CREDENTIAL_PATTERN.test(note)) {
    return {
      ok: false,
      code: "INVALID_REQUEST",
      message:
        "That note looks like it contains a credential. Credentials are never stored in memory.",
    };
  }
  const savedAt = new Date().toISOString();
  const line = `- [${savedAt.slice(0, 10)}] (${input.kind}) ${note}`;
  try {
    await appendMemoryLine(line);
    return { ok: true, kind: input.kind, note, savedAt };
  } catch (error) {
    return sandboxFailure(error, "Saving memory");
  }
}
saveMemoryStep.maxRetries = 2;

/** Read the memory file at the start of each admin conversation turn. */
export async function loadAdminMemoryStep(): Promise<
  { ok: true; content: string } | { ok: false; message: string }
> {
  "use step";
  try {
    return { ok: true, content: redactSecrets(await readMemoryFile()) };
  } catch (error) {
    const { attempt, maxAttempts } = getStepMetadata();
    if (attempt < maxAttempts) {
      throw new RetryableError("Loading memory failed; retrying", {
        retryAfter: attempt * 1500,
      });
    }
    return {
      ok: false,
      message: error instanceof Error ? redactSecrets(error.message) : "unknown error",
    };
  }
}
loadAdminMemoryStep.maxRetries = 2;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const searchProductsInput = z.object({
  query: z
    .string()
    .trim()
    .max(100)
    .optional()
    .describe(
      "Free-text search over product names, descriptions and tags. Omit to browse.",
    ),
  category: z
    .string()
    .trim()
    .max(50)
    .optional()
    .describe(
      "Category slug from getAllCategories (e.g. 'hoodies'). Omit for all categories.",
    ),
  page: z.number().int().min(1).max(20).optional().describe("1-based page."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(30)
    .optional()
    .describe("Results per page (default 12, max 30)."),
});

const searchProducts = tool({
  description:
    "Search or browse the Ship It Shop catalog by text and/or category. Call with no arguments to browse the full catalog. Returns product IDs, slugs, names, prices (integer cents), categories and images.",
  inputSchema: searchProductsInput,
  execute: (input) => searchProductsStep(input),
});

const getAllCategories = tool({
  description:
    "List the store's current product categories (slug, name, product count). Use it to discover valid category filters — never guess category names.",
  inputSchema: z.object({}),
  execute: () => getAllCategoriesStep(),
});

const getProductDetails = tool({
  description:
    "Get the full details for one product by ID or slug: description, price (integer cents), images, tags, and live stock availability.",
  inputSchema: z.object({
    product: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .describe("Product ID (e.g. 'hoodie_001') or slug (e.g. 'black-pullover-hoodie')."),
  }),
  execute: (input) => getProductDetailsStep(input),
});

const returnOrderTool = tool({
  description:
    "File a return for a customer's order. Looks up the order, then starts a durable background workflow that notifies the customer, pre-authorizes the refund and files the return with the store. Only call once you have the order ID and the customer's reason.",
  inputSchema: z.object({
    orderId: orderIdSchema.describe("The order number, e.g. '11111'."),
    reason: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .describe("Why the customer is returning the order, in their words."),
  }),
  execute: (input) => returnOrder(input),
});

export const shoppingTools = {
  searchProducts,
  getAllCategories,
  getProductDetails,
  returnOrder: returnOrderTool,
};

const getSupportTickets = tool({
  description:
    "Read support tickets (read-only). Filters: created-at date range, status, priority, category, assignee, and limit. Returns totals, a preview of rows and `dataFile`, a JSON file in the sandbox with every matching row.",
  inputSchema: z.object({
    from: dateString.optional().describe("Inclusive start (YYYY-MM-DD). Default: 30 days before `to`."),
    to: dateString.optional().describe("Inclusive end (YYYY-MM-DD). Default: now."),
    status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
    priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
    category: z
      .enum([
        "shipping",
        "returns",
        "product_quality",
        "sizing",
        "billing",
        "payment",
        "account",
        "other",
      ])
      .optional(),
    assignee: z
      .string()
      .trim()
      .regex(/^[a-z0-9_.-]{1,40}$/i)
      .optional()
      .describe("Staff username, e.g. 'alex'. Unassigned tickets are excluded when set."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (1–500, default 25)."),
  }),
  execute: (input) => getSupportTicketsStep(input),
});

const getReturnsHistory = tool({
  description:
    "Read historical customer returns (read-only; ~180 days of history). Filters: created-at date range, status, decision, limit. Each row has items (productId, quantity), reason, decision, refundAmount (cents) and an order summary. Full rows are saved to `dataFile` in the sandbox.",
  inputSchema: z.object({
    from: dateString.optional().describe("Inclusive start (YYYY-MM-DD). Default: 30 days before `to`."),
    to: dateString.optional().describe("Inclusive end (YYYY-MM-DD). Default: now."),
    status: z.enum(["pending", "processing", "completed"]).optional(),
    decision: z
      .enum(["approved", "rejected", "needs_info"])
      .optional()
      .describe("Implies status=completed."),
    limit: z.number().int().min(1).max(500).optional().describe("Max rows (1–500, default 25). Use 500 for rate calculations."),
  }),
  execute: (input) => getReturnsHistoryStep(input),
});

const getInventoryStock = tool({
  description:
    "Read current inventory levels (read-only). Filters: productIds, lowStock (1–5 units), inStock, with page/limit pagination. Full rows are saved to `dataFile` in the sandbox.",
  inputSchema: z.object({
    productIds: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
    lowStock: z.boolean().optional().describe("true = only products with 1–5 units; false = exclude them."),
    inStock: z.boolean().optional().describe("true = only products with stock; false = only out-of-stock."),
    page: z.number().int().min(1).optional(),
    limit: z.number().int().min(1).max(200).optional().describe("Rows per page (1–200, default 50)."),
  }),
  execute: (input) => getInventoryStockStep(input),
});

const getSalesAnalytics = tool({
  description:
    "Read sales totals per product for a date range (read-only; ~180 days of history), sorted by units sold. Optional productId filter. `meta.totals` has units, orders and revenue (cents). Full rows are saved to `dataFile` in the sandbox.",
  inputSchema: z.object({
    from: dateString.optional().describe("Inclusive start (YYYY-MM-DD). Default: 30 days before `to`."),
    to: dateString.optional().describe("Inclusive end (YYYY-MM-DD). Default: now."),
    productId: z.string().trim().min(1).max(60).optional(),
  }),
  execute: (input) => getSalesAnalyticsStep(input),
});

const bash = tool({
  description:
    "Run a bash command in the admin's isolated Vercel Sandbox (cwd /vercel/sandbox, no network, no credentials). Use it for ALL arithmetic, aggregates and joins over the JSON files that the back-office tools write to /vercel/sandbox/data. Node.js, Python 3 and jq are available. For anything beyond a one-liner, use a quoted heredoc to avoid shell-quoting errors, e.g. python3 - <<'PY' ... PY. Commands time out after 60 seconds.",
  inputSchema: z.object({
    command: z.string().min(1).max(8000).describe("The bash command or script to run."),
    description: z
      .string()
      .max(300)
      .optional()
      .describe("A few words (under 80 characters) on what the command computes, shown to the employee."),
  }),
  execute: ({ command }) => bashStep({ command }),
});

const saveMemory = tool({
  description:
    "Save a durable note to the admin memory file so it is available in future conversations. Use for employee preferences, corrections to your earlier answers, and business context. Never store credentials, secrets or personal customer data.",
  inputSchema: z.object({
    kind: z.enum(["preference", "correction", "business_context"]),
    note: z
      .string()
      .trim()
      .min(3)
      .max(500)
      .describe("One self-contained sentence, e.g. 'Report revenue in USD with no decimals.'"),
  }),
  execute: (input) => saveMemoryStep(input),
});

export const adminTools = {
  searchProducts,
  getAllCategories,
  getSupportTickets,
  getReturnsHistory,
  getInventoryStock,
  getSalesAnalytics,
  bash,
  saveMemory,
};
