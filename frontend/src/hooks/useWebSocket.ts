import { useEffect, useRef, useCallback } from "react";

const WS_BASE_URL = import.meta.env.VITE_WS_URL ?? "ws://192.168.1.103:8000";

interface WebSocketHandlers {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}

export function useWebSocket(sessionId: string | null, handlers: WebSocketHandlers) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!sessionId) return;

    const ws = new WebSocket(`${WS_BASE_URL}/ws/${sessionId}`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === "chunk") handlersRef.current.onChunk(data.text);
      else if (data.type === "done") handlersRef.current.onDone();
      else if (data.type === "error") handlersRef.current.onError(data.message);
    };

    return () => {
      ws.close();
    };
  }, [sessionId]);

  const sendMessage = useCallback((message: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ message }));
    }
  }, []);

  return { sendMessage };
}
