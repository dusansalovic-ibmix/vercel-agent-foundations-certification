"use client";

/**
 * Storefront chat panel, connected to the shopping agent.
 *
 * `useDurableChat` posts each turn to `/api/chat` (a durable workflow run) and
 * transparently reconnects to the run's stream after a dropped connection or
 * a page refresh. Assistant text renders as Markdown; tool results render as
 * generative UI (product cards, product details, return confirmation).
 */
import { useState } from "react";
import { Bot, SquarePen } from "lucide-react";
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
import {
  ChatErrorNotice,
  ChatPanelSkeleton,
  ToolProgress,
} from "@/components/chat/chat-status";
import { ShoppingToolPart } from "@/components/chat/shopping-tool-parts";
import { Button } from "@/components/ui/button";
import { useDurableChat, useIsClient } from "@/hooks/use-durable-chat";
import type { ShoppingAgentUIMessage } from "@/lib/agent";

const SUGGESTIONS = [
  "What's new in hoodies?",
  "Show me gifts under $30",
  "What categories do you have?",
  "I'd like to return order 11111",
];

export function AgentChat() {
  const isClient = useIsClient();
  return isClient ? <ShoppingChatPanel /> : <ChatPanelSkeleton label="Loading the shopping assistant" />;
}

function ShoppingChatPanel() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status, error, stop, regenerate, reset } =
    useDurableChat<ShoppingAgentUIMessage>({
      id: "shopping-agent",
      api: "/api/chat",
      storageKey: "ship-it-shop:shopping-chat:v1",
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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={busy}
          >
            <SquarePen className="size-3.5" aria-hidden="true" />
            New chat
          </Button>
        </div>
      )}

      <Conversation className="flex-1" aria-label="Shopping assistant conversation">
        <ConversationContent className="gap-6">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              <div className="flex flex-col items-center gap-4">
                <Bot className="size-8 text-muted-foreground" aria-hidden="true" />
                <div className="space-y-1">
                  <h2 className="text-sm font-medium">
                    Hi! I&apos;m the Ship It Shop assistant
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    I can find products, explain the details, and help you
                    return an order.
                  </p>
                </div>
                <div className="flex flex-wrap justify-center gap-2">
                  {SUGGESTIONS.map((s) => (
                    <Suggestion key={s} suggestion={s} onClick={send} />
                  ))}
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
                      return <ShoppingToolPart key={key} part={part} />;
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

      <div className="border-t p-3">
        <PromptInput onSubmit={handleSubmit}>
          <PromptInputBody>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about products or returns…"
              aria-label="Message the shopping assistant"
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
