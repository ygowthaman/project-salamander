import {
  Alert,
  Anchor,
  Button,
  Center,
  Divider,
  Image,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconBrandGoogleFilled } from "@tabler/icons-react";
import { useState, FormEvent } from "react";
import logoUrl from "../../assets/simple_logo.svg";
import { startGoogleLogin } from "../../api/auth";
import { useAuth } from "../../auth/useAuth";

/** Codes the backend appends to its /login redirect when OAuth fails. */
const OAUTH_ERRORS: Record<string, string> = {
  email_not_verified:
    "Google hasn't verified that email address, so we can't link it to an existing account. Sign in with your password instead.",
  google_auth_failed: "Google sign-in failed. Please try again.",
  state_mismatch: "That sign-in link expired. Please try again.",
  bad_state: "That sign-in link expired. Please try again.",
  missing_state: "That sign-in link expired. Please try again.",
  missing_code: "Google sign-in was cancelled.",
  access_denied: "Google sign-in was cancelled.",
  internal_error: "Something went wrong on our end. Please try again.",
};

function initialOAuthError(): string | null {
  const code = new URLSearchParams(window.location.search).get("error");
  if (!code) return null;
  return OAUTH_ERRORS[code] ?? "Sign-in failed. Please try again.";
}

export function LoginPage() {
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(initialOAuthError);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;

    setError(null);
    setBusy(true);
    try {
      if (mode === "signin") {
        await signIn(email, password);
      } else {
        await register(email, password, displayName.trim() || undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
  }

  return (
    // No explicit background: in dark mode Mantine's body sits a step darker
    // than Paper's default surface, so the card separates on its own.
    <Center h="100%" p="md">
      <Paper w="100%" maw={400} withBorder shadow="sm" radius="md" px="xl" py={32}>
        {/* Decorative: the title right below it already names the app. */}
        <Image src={logoUrl} alt="" w={200} h={200} mx="auto" mb="md" />
        <Title order={1} size="h3" ta="center">
          Salamander
        </Title>
        <Text size="sm" c="dimmed" ta="center" mt={4} mb="lg">
          {mode === "signin" ? "Sign in to your account" : "Create an account"}
        </Text>

        {error && (
          <Alert color="red" variant="light" mb="md" role="alert">
            {error}
          </Alert>
        )}

        <Button
          fullWidth
          variant="default"
          leftSection={<IconBrandGoogleFilled size={16} />}
          onClick={startGoogleLogin}
        >
          Continue with Google
        </Button>

        <Divider label="or" labelPosition="center" my="lg" />

        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            {mode === "signup" && (
              <TextInput
                label="Name"
                description="Optional"
                value={displayName}
                onChange={(e) => setDisplayName(e.currentTarget.value)}
                autoComplete="name"
              />
            )}

            <TextInput
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.currentTarget.value)}
              autoComplete="email"
              required
            />

            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              autoComplete={mode === "signin" ? "current-password" : "new-password"}
              description={mode === "signup" ? "At least 12 characters." : undefined}
              // Mirrors the server's zod rule so the failure is caught before a
              // round-trip; the server remains the actual enforcer.
              minLength={mode === "signup" ? 12 : undefined}
              required
            />

            <Button type="submit" fullWidth loading={busy}>
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
          </Stack>
        </form>

        <Anchor
          component="button"
          type="button"
          onClick={switchMode}
          size="xs"
          c="dimmed"
          ta="center"
          mt="lg"
          w="100%"
          display="block"
        >
          {mode === "signin"
            ? "Don't have an account? Create one"
            : "Already have an account? Sign in"}
        </Anchor>
      </Paper>
    </Center>
  );
}
