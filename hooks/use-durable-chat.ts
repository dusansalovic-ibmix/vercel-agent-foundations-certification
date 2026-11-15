"use client";

import { useChat } from "@ai-sdk/react";
import { WorkflowChatTransport } from "@ai-sdk/workflow/client";
import type { UIMessage } from "ai";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * `useChat` wired to a durable workflow chat endpoint.
 *
 * - Sends each turn to `api` (POST), which starts a workflow run and returns
 *   its ID in `x-workflow-run-id`.
 * - `WorkflowChatTransport` reconnects to `${api}/${runId}/stream` whenever
 *   the stream ends without a `finish` chunk (network drop, function
 *   timeout), resuming from the last chunk it received.
 * - The conversation and the in-flight run ID are kept in localStorage per
 *   chat (`storageKey`), so the shopping and admin chats never share history.
 *   After a page refresh we restore the messages as they were when the turn
 *   was sent and reattach to the still-running workflow, which replays its
 *   output exactly once — no duplicated text and no second run.
 */

interface StoredChat<M> {
  messages: M[];
  activeRunId: string | null;
}

function readStored<M>(key: string): StoredChat<M> {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredChat<M>>;
      return {
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        activeRunId:
          typeof parsed.activeRunId === "string" ? parsed.activeRunId : null,
      };
    }
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return { messages: [], activeRunId: null };
}

function writeStored<M>(key: string, patch: Partial<StoredChat<M>>) {
  try {
    const next = { ...readStored<M>(key), ...patch };
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full or blocked (private mode): persistence is best effort.
  }
}

export function useDurableChat<M extends UIMessage>({
  id,
  api,
  storageKey,
}: {
  id: string;
  api: string;
  storageKey: string;
}) {
  // Read once, synchronously. Callers render this hook on the client only
  // (see `useIsClient`), so localStorage is available and there is no
  // server/client markup mismatch.
  const [initial] = useState(() => readStored<M>(storageKey));
  const activeRunId = useRef<string | null>(initial.activeRunId);

  const transport = useMemo(
    () =>
      new WorkflowChatTransport<M>({
        api,
        maxConsecutiveErrors: 5,
        onChatSendMessage: (response, options) => {
          const runId = response.headers.get("x-workflow-run-id");
          activeRunId.current = runId;
          // Snapshot the history as sent (without the reply being streamed)
          // so a refresh can replay the reply from the start of the run.
          writeStored<M>(storageKey, {
            messages: options.messages,
            activeRunId: runId,
          });
        },
        onChatEnd: () => {
          activeRunId.current = null;
          writeStored<M>(storageKey, { activeRunId: null });
        },
        prepareReconnectToStreamRequest: ({ api: defaultApi, ...rest }) => {
          const runId =
            activeRunId.current ?? readStored<M>(storageKey).activeRunId;
          return {
            ...rest,
            api: runId
              ? `${api}/${encodeURIComponent(runId)}/stream`
              : defaultApi,
          };
        },
      }),
    [api, storageKey],
  );

  const chat = useChat<M>({
    id,
    transport,
    // Restore the conversation and, if a run was still in flight when the
    // page was closed or refreshed, let useChat reattach to it on mount.
    messages: initial.messages,
    resume: initial.activeRunId != null,
    throttle: 50,
    onError: () => {
      // Don't try to reattach to a run that failed for this client.
      activeRunId.current = null;
      writeStored<M>(storageKey, { activeRunId: null });
    },
  });

  const { setMessages, status, messages } = chat;

  // Persist the full conversation once a turn completes.
  const previousStatus = useRef(status);
  useEffect(() => {
    const previous = previousStatus.current;
    previousStatus.current = status;
    const finishedTurn =
      (previous === "submitted" || previous === "streaming") &&
      status === "ready";
    if (finishedTurn) {
      activeRunId.current = null;
      writeStored<M>(storageKey, { messages, activeRunId: null });
    }
  }, [status, messages, storageKey]);

  const stop = useCallback(() => {
    // Stop listening; the server-side run may still finish on its own.
    activeRunId.current = null;
    writeStored<M>(storageKey, { activeRunId: null });
    void chat.stop();
  }, [chat, storageKey]);

  const reset = useCallback(() => {
    activeRunId.current = null;
    void chat.stop();
    chat.clearError();
    setMessages([]);
    writeStored<M>(storageKey, { messages: [], activeRunId: null });
  }, [chat, setMessages, storageKey]);

  return { ...chat, stop, reset };
}

const subscribeNoop = () => () => {};

/**
 * `false` during server rendering and hydration, `true` afterwards. Chat
 * panels render their stateful part only on the client because their initial
 * state comes from localStorage.
 */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
