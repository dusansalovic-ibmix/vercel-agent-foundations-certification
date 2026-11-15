"use client";

import { useState } from "react";
import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type MemoryState =
  | { status: "idle" | "loading" }
  | { status: "loaded"; path: string; content: string }
  | { status: "error"; message: string };

/** Shows the admin agent's saved memory file (read from the sandbox). */
export function AdminMemoryDialog() {
  const [state, setState] = useState<MemoryState>({ status: "idle" });

  const load = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/admin/memory", { cache: "no-store" });
      const body = (await res.json()) as {
        path?: string;
        content?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
      setState({
        status: "loaded",
        path: body.path ?? "",
        content: body.content ?? "",
      });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Could not load memory.",
      });
    }
  };

  return (
    <Dialog onOpenChange={(open) => open && void load()}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm">
          <Brain className="size-4" aria-hidden="true" />
          Memory
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Agent memory</DialogTitle>
          <DialogDescription>
            Preferences, corrections and business context the agent saved in
            its sandbox. It is loaded at the start of every conversation.
          </DialogDescription>
        </DialogHeader>
        <div aria-live="polite" className="min-h-24">
          {state.status === "loading" && (
            <p className="text-sm text-muted-foreground">Loading…</p>
          )}
          {state.status === "error" && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
          {state.status === "loaded" &&
            (state.content.trim() ? (
              <div className="space-y-2">
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
                  {state.content}
                </pre>
                <p className="font-mono text-xs text-muted-foreground">{state.path}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nothing saved yet. Tell the agent a preference (e.g. “Remember
                that I prefer weekly numbers”) and it will be stored here.
              </p>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
