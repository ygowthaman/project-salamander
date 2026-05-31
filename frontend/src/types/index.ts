export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
}
