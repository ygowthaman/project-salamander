import {
  ActionIcon,
  Alert,
  Avatar,
  Badge,
  Button,
  Group,
  Menu,
  Modal,
  Paper,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import { IconAlertTriangle, IconMail, IconTrash, IconUserCog } from "@tabler/icons-react";
import { useCallback, useEffect, useState, FormEvent } from "react";
import { listMembers, removeMember, setMemberRole } from "../../api/households";
import { HouseholdMember } from "../../types";

/** Caught before a round-trip; the server validates properly. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ROLE_LABEL: Record<HouseholdMember["role"], string> = {
  admin: "Admin",
  user: "Member",
};

/**
 * Membership: who is in the household, what they may do, and how someone else
 * gets in. Rendered only for admins — those are exactly the powers the role
 * carries, and the server refuses all three from anyone else regardless.
 *
 * **Inviting does not work yet and the form says so.** It needs a table of its
 * own (a household, an invited email, a single-use token, a 24-hour expiry) and
 * an email to send, and Salamander has no SMTP configured. The form is here so
 * the shape of the screen is settled — one field, no role picker — but it makes
 * no request, because there is no endpoint behind it and a button that 404s is
 * worse than one that explains itself.
 *
 * **There is no role picker on the invite, deliberately.** Admin is conferred by
 * creating a household, and afterwards only by an existing admin granting it, so
 * everyone who joins by invitation joins as a member and is promoted here
 * afterwards if that is what is wanted.
 */
export function HouseholdMembers() {
  const [members, setMembers] = useState<HouseholdMember[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The row a request is in flight for, so only that row shows as busy. */
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<HouseholdMember | null>(null);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteNotice, setInviteNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setMembers(await listMembers());
    } catch (error) {
      setMembers(null);
      setLoadError(error instanceof Error ? error.message : "Could not load the member list.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function handleInvite(e: FormEvent) {
    e.preventDefault();

    const email = inviteEmail.trim();
    if (!EMAIL.test(email)) {
      setInviteNotice(null);
      setInviteError("Enter a valid email address");
      return;
    }

    setInviteError(null);
    setInviteNotice(
      `Invitations aren't available yet — Salamander can't send email until delivery is set up. Once it is, ${email} will get a link to join as a member.`,
    );
  }

  async function changeRole(member: HouseholdMember, role: HouseholdMember["role"]) {
    if (pendingId) return;

    setActionError(null);
    setPendingId(member.id);
    try {
      const updated = await setMemberRole(member.id, role);
      setMembers((current) =>
        current ? current.map((m) => (m.id === updated.id ? updated : m)) : current,
      );
    } catch (error) {
      // The one refusal the server makes here is demoting the last admin, and
      // its message says so — surface it rather than a generic failure.
      setActionError(error instanceof Error ? error.message : "Could not change that role.");
    } finally {
      setPendingId(null);
    }
  }

  async function confirmRemoval() {
    const member = confirmRemove;
    if (!member || pendingId) return;

    setActionError(null);
    setPendingId(member.id);
    try {
      await removeMember(member.id);
      setConfirmRemove(null);
      await load();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Could not remove that member.");
    } finally {
      setPendingId(null);
    }
  }

  return (
    <Paper withBorder radius="md" p="lg">
      <Title order={4} mb="xs">
        Members
      </Title>
      <Text size="sm" c="dimmed" mb="md">
        Who is in the household, and what they can do.
      </Text>

      <Alert
        color="yellow"
        variant="light"
        icon={<IconAlertTriangle size={18} />}
        mb="md"
        title="Invitations aren't available yet"
      >
        Sending one needs email delivery, which isn't configured. The form below is here so the flow
        is ready; it doesn't send anything.
      </Alert>

      <form onSubmit={handleInvite}>
        <Group align="flex-start" gap="sm" mb="xs" wrap="nowrap">
          <TextInput
            style={{ flex: 1 }}
            label="Invite by email"
            placeholder="them@example.com"
            type="email"
            value={inviteEmail}
            onChange={(e) => {
              setInviteEmail(e.currentTarget.value);
              if (inviteError) setInviteError(null);
              if (inviteNotice) setInviteNotice(null);
            }}
            error={inviteError}
            maxLength={320}
          />
          {/* Aligned to the input's box rather than its label. */}
          <Button type="submit" mt={25} leftSection={<IconMail size={16} stroke={1.6} />}>
            Send invitation
          </Button>
        </Group>
      </form>

      <Text size="xs" c="dimmed" mb="md">
        There is no role to pick: everyone who joins by invitation joins as a member. Promote them
        here once they have accepted.
      </Text>

      {inviteNotice && (
        <Alert color="blue" variant="light" mb="md" role="status">
          {inviteNotice}
        </Alert>
      )}

      {actionError && (
        <Alert color="red" variant="light" mb="md" role="alert">
          {actionError}
        </Alert>
      )}

      {loadError ? (
        <Alert color="red" variant="light" role="alert">
          {loadError}
        </Alert>
      ) : !members ? (
        <Skeleton height={120} radius="sm" />
      ) : (
        <Table.ScrollContainer minWidth={620}>
          <Table verticalSpacing="sm" highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Member</Table.Th>
                <Table.Th w={110}>Role</Table.Th>
                <Table.Th w={110}>Status</Table.Th>
                <Table.Th w={110} ta="right">
                  Actions
                </Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {members.map((member) => (
                <MemberRow
                  key={member.id}
                  member={member}
                  busy={pendingId === member.id}
                  disabled={pendingId !== null}
                  onChangeRole={changeRole}
                  onRemove={setConfirmRemove}
                />
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Modal
        opened={confirmRemove !== null}
        onClose={() => setConfirmRemove(null)}
        title="Remove this member?"
        centered
        size="md"
      >
        <Stack gap="md">
          {/* Says what removal actually costs, because most of it is nothing:
              the only thing destroyed is what nobody else could see anyway.

              Where they land is not described. A removed member is put into a
              household of their own with `skip_household` back to true, which
              is the state where the concept is hidden from them entirely —
              from their side they simply have their own stuff again. Naming it
              here would put a mechanism in front of the admin that the person
              it happens to will never see. */}
          <Text size="sm">
            {confirmRemove?.display_name ?? confirmRemove?.email} keeps their account and starts
            fresh with an empty inventory. Everything they added here stays — except the items they
            marked private, which are deleted.
          </Text>
          <Text size="sm" c="dimmed">
            They are not told by the app yet; notifications aren't built.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button color="red" loading={pendingId !== null} onClick={() => void confirmRemoval()}>
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Paper>
  );
}

interface MemberRowProps {
  member: HouseholdMember;
  busy: boolean;
  disabled: boolean;
  onChangeRole: (member: HouseholdMember, role: HouseholdMember["role"]) => void;
  onRemove: (member: HouseholdMember) => void;
}

function MemberRow({ member, busy, disabled, onChangeRole, onRemove }: MemberRowProps) {
  const joined = member.status === "active";
  const name = member.display_name ?? member.email;

  // A role belongs to someone who is actually in the household. Until an invited
  // person accepts, there is no membership to promote and no account to carry
  // the role, so the control waits for them.
  const roleReason = !joined ? "Available once they have accepted and joined." : null;
  // Removing yourself is a different operation — leaving, which can dissolve the
  // household when you are its last admin and so is deliberately not reachable
  // from a row action in a table.
  const removeReason = member.is_self ? "Leave the household from your own account instead." : null;

  return (
    <Table.Tr opacity={busy ? 0.6 : 1}>
      <Table.Td>
        <Group gap="sm" wrap="nowrap">
          <Avatar src={member.avatar_url} radius="xl" size="md" alt="">
            {name.slice(0, 1).toUpperCase()}
          </Avatar>
          <div>
            <Group gap={6}>
              <Text size="sm" fw={500}>
                {name}
              </Text>
              {member.is_self && (
                <Badge size="xs" variant="default">
                  You
                </Badge>
              )}
            </Group>
            {member.display_name && (
              <Text size="xs" c="dimmed">
                {member.email}
              </Text>
            )}
          </div>
        </Group>
      </Table.Td>

      <Table.Td>
        <Badge variant="light" color={member.role === "admin" ? "salamander" : "gray"}>
          {ROLE_LABEL[member.role]}
        </Badge>
      </Table.Td>

      <Table.Td>
        <Badge variant="dot" color={joined ? "green" : "yellow"}>
          {joined ? "Joined" : "Invited"}
        </Badge>
      </Table.Td>

      <Table.Td>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Menu position="bottom-end" shadow="md" withinPortal disabled={!joined || disabled}>
            <Menu.Target>
              <Tooltip label={roleReason ?? "Change role"} withArrow>
                {/* Wrapped so the tooltip still fires on a disabled control. */}
                <span>
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    aria-label={`Change role for ${name}`}
                    disabled={!joined || disabled}
                    loading={busy}
                  >
                    <IconUserCog size={18} stroke={1.6} />
                  </ActionIcon>
                </span>
              </Tooltip>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Label>Role</Menu.Label>
              <Menu.Item
                disabled={member.role === "admin"}
                onClick={() => onChangeRole(member, "admin")}
              >
                Make admin
              </Menu.Item>
              <Menu.Item
                disabled={member.role === "user"}
                onClick={() => onChangeRole(member, "user")}
              >
                Make member
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>

          <Tooltip label={removeReason ?? "Remove from household"} withArrow>
            <span>
              <ActionIcon
                variant="subtle"
                color="red"
                aria-label={`Remove ${name}`}
                disabled={member.is_self || disabled}
                onClick={() => onRemove(member)}
              >
                <IconTrash size={18} stroke={1.6} />
              </ActionIcon>
            </span>
          </Tooltip>
        </Group>
      </Table.Td>
    </Table.Tr>
  );
}
