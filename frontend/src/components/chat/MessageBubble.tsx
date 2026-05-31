import { Message } from "../../types";
import "./MessageBubble.css";

interface Props {
  message: Message;
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === "user";
  return (
    <div className={`bubble-wrapper ${isUser ? "bubble-wrapper--user" : "bubble-wrapper--assistant"}`}>
      <div className={`bubble ${isUser ? "bubble--user" : "bubble--assistant"}`}>
        {message.content}
      </div>
    </div>
  );
}
