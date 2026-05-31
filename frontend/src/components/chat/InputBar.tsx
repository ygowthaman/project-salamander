import { useState, KeyboardEvent } from "react";
import "./InputBar.css";

interface Props {
  onSend: (message: string) => void;
  disabled: boolean;
}

export function InputBar({ onSend, disabled }: Props) {
  const [value, setValue] = useState("");

  function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="input-bar">
      <textarea
        className="input-bar__textarea"
        placeholder="Type what you're looking for..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
      />
      <button
        className="input-bar__button"
        onClick={handleSend}
        disabled={disabled || !value.trim()}
      >
        Send
      </button>
    </div>
  );
}
