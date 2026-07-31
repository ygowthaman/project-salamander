import { Center, Loader } from "@mantine/core";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/useAuth";
import { LoginPage } from "./components/auth/LoginPage";
import { HomePage } from "./components/home/HomePage";

function Gate() {
  const { status } = useAuth();

  // Render nothing decisive until the cookie has been checked — showing the
  // login form first would flash it at users who are already signed in.
  if (status === "loading") {
    return (
      <Center h="100%">
        <Loader size="sm" color="gray" />
      </Center>
    );
  }

  return status === "authenticated" ? <HomePage /> : <LoginPage />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
