export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  email_verified: boolean;
  created_at: string;
  /** False for accounts that only ever signed in with Google. */
  has_password?: boolean;
  linked_providers?: string[];
}
