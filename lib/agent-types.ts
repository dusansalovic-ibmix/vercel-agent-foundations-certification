/**
 * Tool result shapes shared by the agents (server) and the chat UIs (client).
 *
 * Pure type module — safe to import from client components. Every tool
 * returns either `{ ok: true, ... }` or a `ToolFailure`, so the model and the
 * UI can always tell a real result apart from "not found", "invalid request"
 * or "service unavailable" without anyone inventing a successful outcome.
 */
import type {
  BackOfficeReturnDecision,
  BackOfficeReturnStatus,
  Category,
  PaginationMeta,
  Product,
  ProductSalesRow,
  Return,
  StockEntry,
  StockInfo,
  SupportTicket,
} from "./types";

export type ToolFailureCode =
  | "NOT_FOUND"
  | "INVALID_REQUEST"
  | "NOT_ELIGIBLE"
  | "ALREADY_IN_PROGRESS"
  | "SERVICE_UNAVAILABLE"
  | "SANDBOX_UNAVAILABLE";

export interface ToolFailure {
  ok: false;
  code: ToolFailureCode;
  /** Human-readable explanation, safe to show to the end user. */
  message: string;
  /** Optional hints, e.g. the list of valid category slugs. */
  hint?: string;
}

// ---------------------------------------------------------------------------
// Catalog (shared by both agents)
// ---------------------------------------------------------------------------

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  price: number;
  currency: string;
  category: string;
  image: string | null;
  shortDescription: string;
}

export type SearchProductsResult =
  | {
      ok: true;
      query: string | null;
      category: string | null;
      page: number;
      count: number;
      products: ProductSummary[];
    }
  | ToolFailure;

export type GetAllCategoriesResult =
  | { ok: true; categories: Category[] }
  | ToolFailure;

export type ProductDetailsResult =
  | {
      ok: true;
      product: Product;
      /** `null` when the live stock lookup failed — availability unknown. */
      stock: StockInfo | null;
    }
  | ToolFailure;

// ---------------------------------------------------------------------------
// Returns (shopping agent)
// ---------------------------------------------------------------------------

export interface ReturnLine {
  productId: string;
  name: string;
  quantity: number;
  lineTotal: number;
}

export type ReturnOrderResult =
  | {
      ok: true;
      status: "filed";
      orderId: string;
      /** Workflow run that processes the return in the background. */
      returnRunId: string;
      reason: string;
      items: ReturnLine[];
      refundEstimate: number;
      currency: string;
    }
  | (ToolFailure & { returnRunId?: string });

// ---------------------------------------------------------------------------
// Back office (admin agent)
// ---------------------------------------------------------------------------

interface SandboxDataRef {
  /**
   * Absolute path of the JSON file in the admin sandbox holding the full,
   * untruncated result — use it for aggregates and joins via the bash tool.
   * `null` when the sandbox could not be reached.
   */
  dataFile: string | null;
  /** True when `rows` only holds a preview of the full result. */
  truncated: boolean;
}

export type SupportTicketsResult =
  | ({
      ok: true;
      meta: { count: number; from: string; to: string };
      rows: SupportTicket[];
    } & SandboxDataRef)
  | ToolFailure;

export type ReturnsHistoryResult =
  | ({
      ok: true;
      meta: {
        count: number;
        from: string;
        to: string;
        status: BackOfficeReturnStatus | null;
        decision: BackOfficeReturnDecision | null;
      };
      rows: Return[];
    } & SandboxDataRef)
  | ToolFailure;

export type InventoryStockResult =
  | ({
      ok: true;
      pagination: PaginationMeta;
      rows: StockEntry[];
    } & SandboxDataRef)
  | ToolFailure;

export type SalesAnalyticsResult =
  | ({
      ok: true;
      meta: {
        count: number;
        from: string;
        to: string;
        days: number;
        currency: string;
        totals: { unitsSold: number; ordersCount: number; revenue: number };
      };
      rows: ProductSalesRow[];
    } & SandboxDataRef)
  | ToolFailure;

export type BashResult =
  | {
      ok: true;
      command: string;
      exitCode: number;
      stdout: string;
      stderr: string;
      /** True when stdout/stderr were cut to keep the response small. */
      truncated: boolean;
      durationMs: number;
    }
  | (ToolFailure & { command: string });

export type MemoryKind = "preference" | "correction" | "business_context";

export type SaveMemoryResult =
  | { ok: true; kind: MemoryKind; note: string; savedAt: string }
  | ToolFailure;
