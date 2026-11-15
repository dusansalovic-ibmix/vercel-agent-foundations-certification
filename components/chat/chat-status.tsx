"use client";

import { AlertCircle, RotateCcw, SearchX } from "lucide-react";
import type { ReactNode } from "react";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { Button } from "@/components/ui/button";
import type { ToolFailure } from "@/lib/agent-types";
import { cn } from "@/lib/utils";

/** Placeholder with the chat panel's layout, shown until the client mounts. */
export function ChatPanelSkeleton({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <span className="sr-only">{label}</span>
      <div className="flex-1" />
      <div className="border-t p-3">
        <div className="h-24 rounded-md border bg-muted/30" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Inline progress line for a running tool or a pending reply. */
export function ToolProgress({
  icon,
  label,
  className,
}: {
  icon?: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        className,
      )}
    >
      {icon && (
        <span className="shrink-0 animate-pulse" aria-hidden="true">
          {icon}
        </span>
      )}
      <Shimmer as="span" className="text-sm">
        {label}
      </Shimmer>
    </div>
  );
}

const FAILURE_TITLES: Record<ToolFailure["code"], string> = {
  NOT_FOUND: "Not found",
  INVALID_REQUEST: "Couldn't use that request",
  NOT_ELIGIBLE: "Not eligible",
  ALREADY_IN_PROGRESS: "Already in progress",
  SERVICE_UNAVAILABLE: "Service unavailable",
  SANDBOX_UNAVAILABLE: "Sandbox unavailable",
};

/** A tool that ran but could not produce a result (missing record, outage…). */
export function ToolFailureNotice({
  failure,
  title,
}: {
  failure: Pick<ToolFailure, "code" | "message" | "hint">;
  title?: string;
}) {
  const isMissing = failure.code === "NOT_FOUND";
  const Icon = isMissing ? SearchX : AlertCircle;
  return (
    <div
      role="note"
      className={cn(
        "flex gap-2 rounded-lg border px-3 py-2.5 text-sm",
        isMissing
          ? "border-border bg-muted/40"
          : "border-destructive/30 bg-destructive/5",
      )}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          isMissing ? "text-muted-foreground" : "text-destructive",
        )}
        aria-hidden="true"
      />
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title ?? FAILURE_TITLES[failure.code]}</p>
        <p className="text-muted-foreground">{failure.message}</p>
        {failure.hint && (
          <p className="text-xs text-muted-foreground">{failure.hint}</p>
        )}
      </div>
    </div>
  );
}

/** A tool call that threw (after its retries were exhausted). */
export function ToolErrorNotice({
  label,
  errorText,
}: {
  label: string;
  errorText?: string;
}) {
  return (
    <ToolFailureNotice
      title={`${label} failed`}
      failure={{
        code: "SERVICE_UNAVAILABLE",
        message:
          errorText && errorText.length < 200
            ? errorText
            : "Something went wrong while running this step.",
      }}
    />
  );
}

/** Conversation-level error (request failed, stream could not be resumed). */
export function ChatErrorNotice({
  error,
  onRetry,
}: {
  error: Error;
  onRetry: () => void;
}) {
  const message = /401/.test(error.message)
    ? "Your admin session has expired. Please sign in again."
    : /413/.test(error.message)
      ? "This conversation is too long. Start a new chat to continue."
      : error.message && !error.message.startsWith("Failed to fetch chat")
        ? error.message
        : "The assistant couldn't respond. Check your connection and try again.";
  return (
    <div
      role="alert"
      className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <div className="flex gap-2">
        <AlertCircle
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
        <p>{message}</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={onRetry}
      >
        <RotateCcw className="size-3.5" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
