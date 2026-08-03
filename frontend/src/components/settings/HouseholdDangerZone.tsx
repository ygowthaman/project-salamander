import {
  Alert,
  Button,
  Group,
  List,
  Modal,
  Paper,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useState, ReactNode } from "react";
import { deleteHousehold, leaveHousehold } from "../../api/households";
import { useAuth } from "../../auth/useAuth";
import { HouseholdDetail } from "../../types";

interface HouseholdDangerZoneProps {
  detail: HouseholdDetail;
  /** Reports a completed departure so the section above can say what happened. */
  onLeft: (previousHouseholdDestroyed: boolean) => void;
}

/**
 * The two ways out of a household, and the warnings the PRD requires in front of
 * each.
 *
 * They are deliberately asymmetric, and the copy has to carry that: **leaving
 * costs you almost nothing, and deleting destroys everything for everyone.**
 *
 * The last-admin case is what makes leaving dangerous at all. Every household
 * must always have at least one admin, so a departure that would leave none
 * dissolves the household instead of being refused — taking its inventory and
 * the accounts of every member still in it. That is announced here rather than
 * discovered afterwards, which is the one thing this section exists for:
 * someone clicking "leave" has not accepted that they are destroying anything,
 * and would otherwise take down a household and everyone in it while believing
 * they were only removing themselves.
 *
 * A user who skipped the household step never reaches this screen — they do not
 * know they have a household, and neither of these controls would mean anything
 * to them.
 */
export function HouseholdDangerZone({ detail, onLeft }: HouseholdDangerZoneProps) {
  const { applyUser, signOut } = useAuth();

  const [leaveOpen, setLeaveOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lastAdmin = detail.is_last_admin;
  const othersCount = detail.member_count - 1;

  async function handleLeave() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const result = await leaveHousehold();
      // The session survives — leaving is not deleting an account. Applying the
      // returned user is what re-points the app at the new household; without it
      // every screen keeps rendering the one they just left.
      applyUser(result.user);
      setLeaveOpen(false);
      onLeft(result.previous_household_destroyed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not leave the household.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      await deleteHousehold();
      // The caller's own account went with the household, so there is nothing
      // left to be signed in as. The logout request will fail against a user
      // that no longer exists; `signOut` clears local state regardless, which is
      // the part that matters.
      await signOut().catch(() => {});
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete the household.");
      setBusy(false);
    }
  }

  return (
    <>
      {error && (
        <Alert color="red" variant="light" role="alert">
          {error}
        </Alert>
      )}

      {/* ---- Leave, available to both roles ---- */}
      <Paper withBorder radius="md" p="lg">
        <Title order={4} mb="xs">
          Leave this household
        </Title>
        <Text size="sm" c="dimmed" mb="md">
          Stop being part of {detail.name}. You keep your account.
        </Text>

        {lastAdmin && (
          <Alert
            color="red"
            variant="light"
            icon={<IconAlertTriangle size={18} />}
            title="You are the last admin"
            mb="md"
          >
            Every household must have at least one admin, so leaving does not just remove you — it
            deletes <strong>{detail.name}</strong> entirely: its inventory, its records, and the
            accounts of{" "}
            {othersCount === 0
              ? "everyone in it"
              : `all ${othersCount} other ${othersCount === 1 ? "member" : "members"}`}
            . This cannot be undone.
          </Alert>
        )}

        <List size="sm" spacing="xs" mb="lg">
          <List.Item>
            <strong>Your private items are deleted.</strong> Nobody else could see them, so nothing
            is left behind that anyone could read or remove.
          </List.Item>
          <List.Item>
            <strong>Everything else you added stays here</strong> and other members go on seeing it.
            Items belong to the household, not to the person who added them, and leaving does not
            turn any of it into personal property.
          </List.Item>
          <List.Item>
            <strong>Your account is not deleted.</strong> You keep your sign-in, your password and
            any linked Google account, and you stay signed in.
          </List.Item>
          <List.Item>
            <strong>You cannot take a copy with you.</strong> Exporting your data is not built yet.
          </List.Item>
          <List.Item>
            If you are the last admin, leaving deletes the whole household and every remaining
            member&rsquo;s account along with it.
          </List.Item>
        </List>

        <Button color="red" onClick={() => setLeaveOpen(true)}>
          Leave household
        </Button>
      </Paper>

      {/* ---- Delete, admins only ----
          Membership and role are both required, and the server checks "admin of
          THIS household" rather than "is an admin". Hiding it from a member is
          about not offering an action that would be refused, not about the
          check — that lives on the route. */}
      {detail.role === "admin" && (
        <Paper
          withBorder
          radius="md"
          p="lg"
          style={{ borderColor: "var(--mantine-color-red-8)" }}
        >
          <Title order={4} mb="xs" c="red">
            Delete this household
          </Title>
          <Text size="sm" c="dimmed" mb="md">
            The only thing in Salamander that genuinely destroys data.
          </Text>

          <List size="sm" spacing="xs" mb="lg">
            <List.Item>
              <strong>Everything the household owns is destroyed</strong> — its inventory, its
              spending records, its categories and its history.
            </List.Item>
            <List.Item>
              <strong>Every member&rsquo;s account is destroyed with it, including yours.</strong>{" "}
              {othersCount === 0
                ? "You are the only member."
                : `${othersCount} other ${othersCount === 1 ? "person" : "people"} will lose their ${othersCount === 1 ? "account" : "accounts"}, and they are not asked first.`}
            </List.Item>
            <List.Item>
              <strong>This is irreversible.</strong> There is no recovery path, no undo window and
              nothing to restore from.
            </List.Item>
            <List.Item>
              You are signed out immediately, because the account you are signed in as will no
              longer exist.
            </List.Item>
            <List.Item>
              <strong>Just want to leave? Don&rsquo;t delete.</strong> Invite someone,
              make them an admin, then leave the household.
            </List.Item>
          </List>

          <Button color="red" onClick={() => setDeleteOpen(true)}>
            Delete household
          </Button>
        </Paper>
      )}

      <ConfirmByNameModal
        opened={leaveOpen}
        onClose={() => setLeaveOpen(false)}
        title="Are you sure you want to leave this household?"
        householdName={detail.name}
        confirmLabel="Leave household"
        busy={busy}
        onConfirm={() => void handleLeave()}
      >
        <Text size="sm">
          Your private items will be deleted. Everything else you added stays with {detail.name} and
          other members keep seeing it. Your account is not deleted, you can continue using your account with or without a new household.
        </Text>
        {lastAdmin && (
          <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
            You are the last admin, so this also deletes {detail.name} and the accounts of everyone
            still in it. This cannot be undone.
          </Alert>
        )}
      </ConfirmByNameModal>

      <ConfirmByNameModal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this household?"
        householdName={detail.name}
        confirmLabel="Delete household"
        busy={busy}
        onConfirm={() => void handleDelete()}
      >
        <Alert color="red" variant="light" icon={<IconAlertTriangle size={18} />}>
          This destroys {detail.name}, everything it owns, and every member&rsquo;s account —
          including yours. It cannot be undone and there is nothing to restore from.
        </Alert>
      </ConfirmByNameModal>
    </>
  );
}

interface ConfirmByNameModalProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  householdName: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  children: ReactNode;
}

/**
 * A destructive confirmation gated on typing the household's name.
 *
 * The typing is what separates "I clicked the wrong button" from "I meant this":
 * both actions behind it are irreversible, and one of them ends other
 * people's accounts. Matching is exact apart from surrounding whitespace — a
 * near-miss is not a confirmation.
 */
function ConfirmByNameModal({
  opened,
  onClose,
  title,
  householdName,
  confirmLabel,
  busy,
  onConfirm,
  children,
}: ConfirmByNameModalProps) {
  const [typed, setTyped] = useState("");
  const matches = typed.trim() === householdName.trim();

  function close() {
    setTyped("");
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title={title}
      centered
      size="md"
      closeOnClickOutside={!busy}
      closeOnEscape={!busy}
    >
      <Stack gap="md">
        {children}

        <TextInput
          label={
            <>
              Type <strong>{householdName}</strong> to confirm
            </>
          }
          value={typed}
          onChange={(e) => setTyped(e.currentTarget.value)}
          autoComplete="off"
          data-autofocus
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button color="red" disabled={!matches} loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
