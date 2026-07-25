import { useState, useEffect, useRef } from "react";
import { Message } from "../../types";
import { useAuth } from "../../auth/useAuth";
import { createSession } from "../../api/sessions";
import { useWebSocket } from "../../hooks/useWebSocket";
import { MessageBubble } from "./MessageBubble";
import { InputBar } from "./InputBar";
import "./ChatWindow.css";

// crypto.randomUUID exists only in secure contexts, so it is undefined when the
// dev server is reached over plain HTTP on a LAN IP. These ids are just React
// list keys — the persisted UUIDs come from the server — so a counter is fine.
let nextLocalId = 0;
function localId(): string {
  return crypto.randomUUID?.() ?? `local-${nextLocalId++}`;
}

export function ChatWindow() {
  const { user, signOut } = useAuth();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streamingContent, setStreamingContent] = useState<string>("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    createSession()
      .then((session) => setSessionId(session.id))
      // Without this the input stays disabled with no visible reason.
      .catch(() => setError("Couldn't reach the server. Is the backend running?"));
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
        { id: localId(), role: "assistant", content: streamingContent },
      ]);
      setStreamingContent("");
      setIsStreaming(false);
    },
    onError: () => {
      setIsStreaming(false);
    },
  });

  function handleSend(text: string) {
    const userMessage: Message = { id: localId(), role: "user", content: text };
    setMessages((prev) => [...prev, userMessage]);
    setIsStreaming(true);
    sendMessage(text);
  }

  return (
    <div className="chat-window">
      <header className="chat-window__header">
        <h1 className="chat-window__title">Shopping Assistant</h1>
        <div className="chat-window__account">
          {user?.avatar_url && (
            <img className="chat-window__avatar" src={user.avatar_url} alt="" />
          )}
          <span className="chat-window__user">{user?.display_name ?? user?.email}</span>
          <button className="chat-window__signout" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <div className="chat-window__messages">
        {error && <p className="chat-window__error">{error}</p>}
        {!error && messages.length === 0 && !isStreaming && (
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
