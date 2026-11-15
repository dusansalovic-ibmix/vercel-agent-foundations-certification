"use client";

/**
 * Admin chat panel at /admin, connected to the store admin agent.
 *
 * Separate endpoint (`/api/admin/chat`), separate conversation storage and a
 * separate tool set from the shopping chat. Tool activity (back-office reads,
 * sandbox commands, memory writes) is shown inline with AI Elements.
 */
import { useState } from "react";
import { BarChart3, SquarePen } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import { AdminToolPart } from "@/components/chat/admin-tool-parts";
import {
  ChatErrorNotice,
  ChatPanelSkeleton,
  ToolProgress,
} from "@/components/chat/chat-status";
import { Button } from "@/components/ui/button";
import { useDurableChat, useIsClient } from "@/hooks/use-durable-chat";
import type { AdminAgentUIMessage } from "@/lib/agent";

const SUGGESTIONS = [
  "Which products have the highest return rate over the last 90 days?",
  "Which top sellers are running low on stock?",
  "What were yesterday's top sellers?",
  "Summarize this week's revenue",
  "Summarize open urgent support tickets",
  "Remember: show revenue rounded to whole dollars",
];

export function AdminAgentChat() {
  const isClient = useIsClient();
  return isClient ? <AdminChatPanel /> : <ChatPanelSkeleton label="Loading the admin agent" />;
}

function AdminChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop, regenerate, reset } =
    useDurableChat<AdminAgentUIMessage>({
      id: "store-admin-agent",
      api: "/api/admin/chat",
      storageKey: "ship-it-shop:admin-chat:v1",
    });

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  const handleSubmit = (message: PromptInputMessage) => send(message.text ?? "");

  const lastMessage = messages.at(-1);
  const awaitingFirstToken =
    status === "submitted" ||
    (status === "streaming" &&
      lastMessage?.role === "assistant" &&
      !lastMessage.parts.some((p) => p.type === "text" || p.type.startsWith("tool-")));

  return (
    <div className="flex h-full min-h-0 flex-col">
      {messages.length > 0 && (
        <div className="flex items-center justify-end border-b px-2 py-1">
          <Button type="button" variant="ghost" size="sm" onClick={reset} disabled={busy}>
            <SquarePen className="size-3.5" aria-hidden="true" />
            New conversation
          </Button>
        </div>
      )}

      <Conversation className="flex-1" aria-label="Store admin agent conversation">
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <div className="flex max-w-md flex-col items-center gap-3">
                <BarChart3 className="size-8 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="text-sm font-medium">Store operations assistant</h2>
                  <p className="text-sm text-muted-foreground">
                    Ask about support tickets, returns, inventory and sales.
                    Numbers are computed in an isolated sandbox, and I remember
                    your preferences between conversations. Store data is
                    read-only.
                  </p>
                </div>
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((message) => (
              <Message from={message.role} key={message.id}>
                <MessageContent className="w-full gap-3">
                  {message.parts.map((part, index) => {
                    const key = `${message.id}-${index}`;
                    if (part.type === "text") {
                      return message.role === "user" ? (
                        <p key={key} className="whitespace-pre-wrap">
                          {part.text}
                        </p>
                      ) : (
                        <MessageResponse key={key}>{part.text}</MessageResponse>
                      );
                    }
                    if (part.type.startsWith("tool-")) {
                      return <AdminToolPart key={key} part={part} />;
                    }
                    return null;
                  })}
                </MessageContent>
              </Message>
            ))
          )}

          {awaitingFirstToken && <ToolProgress label="Thinking…" />}

          {error && status === "error" && (
            <ChatErrorNotice error={error} onRetry={() => void regenerate()} />
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      <div className="flex flex-col gap-3 border-t p-3">
        {messages.length === 0 && (
          <Suggestions aria-label="Suggested questions">
            {SUGGESTIONS.map((s) => (
              <Suggestion key={s} suggestion={s} onClick={send} />
            ))}
          </Suggestions>
        )}
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask the admin agent…"
              aria-label="Message the store admin agent"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools />
            <PromptInputSubmit
              status={status}
              onStop={stop}
              disabled={!busy && !input.trim()}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
