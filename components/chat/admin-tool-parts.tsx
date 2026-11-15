"use client";

import type { ReactNode } from "react";
import { BookmarkCheck, FileJson } from "lucide-react";
import {
  Tool,
  ToolContent,
  ToolHeader,
  type ToolPart,
} from "@/components/ai-elements/tool";
import { Terminal } from "@/components/ai-elements/terminal";
import { Badge } from "@/components/ui/badge";
import type { AdminAgentUIMessage } from "@/lib/agent";
import type { ToolFailure } from "@/lib/agent-types";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ToolErrorNotice,
  ToolFailureNotice,
  ToolProgress,
} from "./chat-status";

type AdminPart = AdminAgentUIMessage["parts"][number];

const TOOL_TITLES: Record<string, string> = {
  searchProducts: "Catalog search",
  getAllCategories: "Categories",
  getSupportTickets: "Support tickets",
  getReturnsHistory: "Returns history",
  getInventoryStock: "Inventory",
  getSalesAnalytics: "Sales analytics",
  bash: "Sandbox command",
  saveMemory: "Memory",
};

const PREVIEW = 8;

function day(value: string) {
  return value.slice(0, 10);
}

function filtersLabel(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const entries = Object.entries(input as Record<string, unknown>).filter(
    ([, v]) => v !== undefined && v !== null && v !== "",
  );
  if (entries.length === 0) return null;
  return entries
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(",") : String(v)}`)
    .join(" · ");
}

// ---------------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------------

function PreviewTable({
  columns,
  rows,
  total,
}: {
  columns: string[];
  rows: ReactNode[][];
  total: number;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="whitespace-nowrap px-2 py-1.5 font-medium">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t">
              {row.map((cell, j) => (
                <td key={j} className="max-w-[14rem] truncate px-2 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {total > rows.length && (
        <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
          Showing {rows.length} of {total} rows.
        </p>
      )}
    </div>
  );
}

function DataFile({ path }: { path: string | null }) {
  if (!path) {
    return (
      <p className="text-xs text-muted-foreground">
        Full result could not be saved to the sandbox.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <FileJson className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Full result saved to</span>
      <code className="truncate font-mono">{path}</code>
    </p>
  );
}

function Meta({ items }: { items: (string | null | undefined)[] }) {
  return (
    <p className="text-xs text-muted-foreground">
      {items.filter(Boolean).join(" · ")}
    </p>
  );
}

/** Collapsible tool card with a status badge that reflects tool failures too. */
function AdminToolCard({
  part,
  title,
  defaultOpen,
  children,
}: {
  part: ToolPart;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const failed =
    part.state === "output-available" &&
    typeof part.output === "object" &&
    part.output !== null &&
    (part.output as { ok?: boolean }).ok === false;
  const state = failed ? "output-error" : part.state;
  return (
    <Tool defaultOpen={defaultOpen ?? failed} className="mb-0">
      <ToolHeader
        title={title}
        type={part.type as Extract<ToolPart, { type: `tool-${string}` }>["type"]}
        state={state}
        className="text-left"
      />
      <ToolContent className="space-y-3 p-3 pt-0">{children}</ToolContent>
    </Tool>
  );
}

// ---------------------------------------------------------------------------
// Sandbox command
// ---------------------------------------------------------------------------

function BashPart({ part }: { part: Extract<AdminPart, { type: "tool-bash" }> }) {
  const command = part.input?.command ?? "";
  const description = part.input?.description;
  const running = part.state === "input-streaming" || part.state === "input-available";

  let output = `$ ${command}`;
  let footer: ReactNode = null;

  if (part.state === "output-available") {
    const result = part.output;
    if (result.ok) {
      const stdout = result.stdout.trimEnd();
      const stderr = result.stderr.trimEnd();
      output += stdout ? `\n${stdout}` : "";
      output += stderr ? `\n\u001b[31m${stderr}\u001b[0m` : "";
      if (!stdout && !stderr) output += "\n\u001b[2m(no output)\u001b[0m";
      footer = (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge
            variant={result.exitCode === 0 ? "secondary" : "destructive"}
            className="font-mono"
          >
            exit {result.exitCode}
          </Badge>
          <span>{(result.durationMs / 1000).toFixed(1)}s</span>
          {result.truncated && <span>· output truncated</span>}
        </div>
      );
    }
  }

  const title = `${TOOL_TITLES.bash}${description ? ` · ${description}` : ""}`;
  const commandFailed =
    part.state === "output-available" && part.output.ok && part.output.exitCode !== 0;

  return (
    <AdminToolCard part={part} title={title} defaultOpen>
      {running && <ToolProgress label="Running in the sandbox…" />}
      {part.state === "output-error" ? (
        <ToolErrorNotice label="Sandbox command" errorText={part.errorText} />
      ) : part.state === "output-available" && !part.output.ok ? (
        <ToolFailureNotice failure={part.output} />
      ) : null}
      <Terminal
        output={output}
        isStreaming={running}
        className={cn("text-xs", commandFailed && "border-destructive/50")}
        aria-label="Sandbox command and output"
      />
      {footer}
    </AdminToolCard>
  );
}

// ---------------------------------------------------------------------------
// Back-office data
// ---------------------------------------------------------------------------

function failureOf(output: unknown): ToolFailure | null {
  return output && typeof output === "object" && (output as ToolFailure).ok === false
    ? (output as ToolFailure)
    : null;
}

function DataToolPart({ part }: { part: ToolPart }) {
  const name = part.type.replace(/^tool-/, "");
  const baseTitle = TOOL_TITLES[name] ?? name;
  const filters = filtersLabel(part.input);

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <AdminToolCard part={part} title={baseTitle}>
        <ToolProgress label={`Fetching ${baseTitle.toLowerCase()}…`} />
        {filters && <Meta items={[filters]} />}
      </AdminToolCard>
    );
  }

  if (part.state === "output-error") {
    return (
      <AdminToolCard part={part} title={`${baseTitle} · failed`} defaultOpen>
        <ToolErrorNotice label={baseTitle} errorText={part.errorText} />
      </AdminToolCard>
    );
  }

  if (part.state !== "output-available") return null;

  const failure = failureOf(part.output);
  if (failure) {
    return (
      <AdminToolCard part={part} title={`${baseTitle} · failed`} defaultOpen>
        <ToolFailureNotice failure={failure} />
        {filters && <Meta items={[`Filters: ${filters}`]} />}
      </AdminToolCard>
    );
  }

  const typed = part as Extract<AdminPart, { state: "output-available" }>;

  switch (typed.type) {
    case "tool-getSupportTickets": {
      const r = typed.output;
      if (!r.ok) return null;
      return (
        <AdminToolCard
          part={part}
          title={`${baseTitle} · ${r.meta.count} · ${day(r.meta.from)} → ${day(r.meta.to)}`}
        >
          {filters && <Meta items={[`Filters: ${filters}`]} />}
          {r.rows.length > 0 && (
            <PreviewTable
              columns={["Ticket", "Subject", "Status", "Priority", "Assignee"]}
              total={r.meta.count}
              rows={r.rows.slice(0, PREVIEW).map((t) => [
                <span key="id" className="font-mono">{t.id}</span>,
                t.subject,
                t.status,
                t.priority,
                t.assignee ?? "—",
              ])}
            />
          )}
          <DataFile path={r.dataFile} />
        </AdminToolCard>
      );
    }

    case "tool-getReturnsHistory": {
      const r = typed.output;
      if (!r.ok) return null;
      return (
        <AdminToolCard
          part={part}
          title={`${baseTitle} · ${r.meta.count} · ${day(r.meta.from)} → ${day(r.meta.to)}`}
        >
          {filters && <Meta items={[`Filters: ${filters}`]} />}
          {r.rows.length > 0 && (
            <PreviewTable
              columns={["Return", "Items", "Status", "Decision", "Refund"]}
              total={r.meta.count}
              rows={r.rows.slice(0, PREVIEW).map((ret) => [
                <span key="id" className="font-mono">{ret.id}</span>,
                ret.items.map((i) => `${i.productId}×${i.quantity}`).join(", "),
                ret.status,
                ret.decision ?? "—",
                ret.refundAmount != null ? formatPrice(ret.refundAmount) : "—",
              ])}
            />
          )}
          <DataFile path={r.dataFile} />
        </AdminToolCard>
      );
    }

    case "tool-getInventoryStock": {
      const r = typed.output;
      if (!r.ok) return null;
      return (
        <AdminToolCard
          part={part}
          title={`${baseTitle} · ${r.pagination.total} products · page ${r.pagination.page}/${Math.max(r.pagination.totalPages, 1)}`}
        >
          {filters && <Meta items={[`Filters: ${filters}`]} />}
          {r.rows.length > 0 && (
            <PreviewTable
              columns={["Product", "Stock", "Status"]}
              total={r.rows.length}
              rows={r.rows.slice(0, PREVIEW).map((s) => [
                s.product.name,
                s.stock,
                !s.inStock ? "Out of stock" : s.lowStock ? "Low" : "OK",
              ])}
            />
          )}
          <DataFile path={r.dataFile} />
        </AdminToolCard>
      );
    }

    case "tool-getSalesAnalytics": {
      const r = typed.output;
      if (!r.ok) return null;
      const { totals, currency } = r.meta;
      return (
        <AdminToolCard
          part={part}
          title={`${baseTitle} · ${day(r.meta.from)} → ${day(r.meta.to)}`}
        >
          <Meta
            items={[
              `${totals.unitsSold} units`,
              `${totals.ordersCount} orders`,
              `${formatPrice(totals.revenue, currency)} revenue`,
              filters ? `Filters: ${filters}` : null,
            ]}
          />
          {r.rows.length > 0 && (
            <PreviewTable
              columns={["Product", "Units", "Orders", "Revenue"]}
              total={r.rows.length}
              rows={r.rows.slice(0, PREVIEW).map((row) => [
                row.product.name,
                row.unitsSold,
                row.ordersCount,
                formatPrice(row.revenue, row.currency),
              ])}
            />
          )}
          <DataFile path={r.dataFile} />
        </AdminToolCard>
      );
    }

    case "tool-searchProducts": {
      const r = typed.output;
      if (!r.ok) return null;
      return (
        <AdminToolCard part={part} title={`${baseTitle} · ${r.count} products`}>
          {filters && <Meta items={[filters]} />}
          {r.products.length > 0 && (
            <PreviewTable
              columns={["ID", "Product", "Price"]}
              total={r.products.length}
              rows={r.products.slice(0, PREVIEW).map((p) => [
                <span key="id" className="font-mono">{p.id}</span>,
                p.name,
                formatPrice(p.price, p.currency),
              ])}
            />
          )}
        </AdminToolCard>
      );
    }

    case "tool-getAllCategories": {
      const r = typed.output;
      if (!r.ok) return null;
      return (
        <AdminToolCard part={part} title={`${baseTitle} · ${r.categories.length}`}>
          <p className="text-xs text-muted-foreground">
            {r.categories.map((c) => `${c.slug} (${c.productCount})`).join(", ")}
          </p>
        </AdminToolCard>
      );
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

function SaveMemoryPart({
  part,
}: {
  part: Extract<AdminPart, { type: "tool-saveMemory" }>;
}) {
  if (part.state === "input-streaming" || part.state === "input-available") {
    return <ToolProgress label="Saving to memory…" />;
  }
  if (part.state === "output-error") {
    return <ToolErrorNotice label="Saving to memory" errorText={part.errorText} />;
  }
  if (part.state !== "output-available") return null;
  if (!part.output.ok) return <ToolFailureNotice failure={part.output} />;
  return (
    <div
      role="note"
      className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs"
    >
      <BookmarkCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <p>
        <span className="font-medium">Saved to memory</span>{" "}
        <span className="text-muted-foreground">
          ({part.output.kind.replace("_", " ")})
        </span>
        : {part.output.note}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function AdminToolPart({ part }: { part: AdminPart }) {
  switch (part.type) {
    case "tool-bash":
      return <BashPart part={part} />;
    case "tool-saveMemory":
      return <SaveMemoryPart part={part} />;
    case "tool-searchProducts":
    case "tool-getAllCategories":
    case "tool-getSupportTickets":
    case "tool-getReturnsHistory":
    case "tool-getInventoryStock":
    case "tool-getSalesAnalytics":
      return <DataToolPart part={part as ToolPart} />;
    default:
      return null;
  }
}
