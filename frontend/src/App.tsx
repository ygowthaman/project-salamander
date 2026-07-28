import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./components/auth/LoginPage";
import { ChatWindow } from "./components/chat/ChatWindow";
import "./App.css";

function Gate() {
  const { status } = useAuth();

  // Render nothing decisive until the cookie has been checked — showing the
  // login form first would flash it at users who are already signed in.
  if (status === "loading") {
    return <div className="app-loading">Loading…</div>;
  }

  return status === "authenticated" ? <ChatWindow /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
