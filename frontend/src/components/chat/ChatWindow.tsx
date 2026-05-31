import { useState, useEffect, useRef } from "react";
import { Message } from "../../types";
import { createSession } from "../../api/sessions";
import { useWebSocket } from "../../hooks/useWebSocket";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import "./ChatWindow.css";

export function ChatWindow() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createSession().then((session) => setSessionId(session.id));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const { sendMessage } = useWebSocket(sessionId, {
    onChunk: (text) => {
      setStreamingContent((prev) => prev + text);
    },
    onDone: () => {
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", content: streamingContent },
      ]);
      setStreamingContent("");
      setIsStreaming(false);
    },
    onError: () => {
      setIsStreaming(false);
    },
  });

  function handleSend(text: string) {
    const userMessage: Message = { id: crypto.randomUUID(), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    sendMessage(text);
  }

  return (
    <div className="chat-window">
      <header className="chat-window__header">
        <h1 className="chat-window__title">Shopping Assistant</h1>
      </header>

      <div className="chat-window__messages">
        {messages.length === 0 && !isStreaming && (
          <p className="chat-window__empty">Hi! What are you looking to buy today?</p>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {streamingContent && (
          <MessageBubble
            message={{ id: "streaming", role: "assistant", content: streamingContent }}
          />
        )}
        <div ref={bottomRef} />
      </div>

      <InputBar onSend={handleSend} disabled={isStreaming || !sessionId} />
    </div>
  );
}
