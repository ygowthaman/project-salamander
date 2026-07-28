# PRD: Autonomous Shopping Agent (with Accounts, Auth & Sessions)

## Status

Draft / not started. This document turns `docs/IDEAS.md` (the product vision) into an
implementable PRD, and adds the accounts, authentication, and session layer that the vision
assumes but does not yet specify. It is self-contained so a fresh Claude Code session can pick up
the work without re-reading the originating conversation.

Read order for context:
1. This file.
2. `docs/IDEAS.md` — the raw product vision this PRD formalizes.
3. `ARCHITECTURE.md` — the architecture of the shipped Phase 1 chat app.
4. The `*_CONTEXT.md` files under `node-server/src/` — why the current code is shaped the way it is.

> **Note on the two "PRD" files.** The root `PRD.md` documents the *completed* Python→Node
> backend rewrite and is now historical. **This** file is the forward-looking product PRD. If the
> two ever conflict, this one governs new work.

---

## 1. Overview

Salamander is evolving from a **chat-based shopping assistant** (Phase 1, shipped) into a
**shopping agent** that tracks a user's inventory and, when stock runs low, prepares the reorder
through a third-party shopping service (e.g. Instacart) — guided by user-defined rules and an LLM
for judgment calls.

**The domain is general inventory, not just groceries.** Categories are arbitrary and user-defined —
groceries, office supplies (printer ink, paper), household goods, or anything else. And the
**reordering machinery is opt-in**: a user who only wants to *track* what they own (e.g. a book
collection) can add items and never create a mandate, grant, budget, or schedule. In that mode the
app is a pure inventory catalog with a chat assistant that can answer *"do I already own this?"*
(§5.8) — useful when you're standing in a store. Everything below supports both the full
reorder flow and this track-only mode; the difference is simply whether the user sets up mandates.

**Scope of this PRD — assisted, not autonomous.** When mandates fire, the agent resolves products,
respects grants and budgets, **assembles a ready-to-checkout cart, and notifies the user that an
order is ready to place. The user reviews the cart and places the order manually.** The application
never completes a checkout on the user's behalf in this scope. **Fully autonomous ordering —
the agent placing the order itself — is a stretch goal** (§9.1), deferred until the assisted flow is
proven and the §5.11 safeguards are in place.

The shipped Phase 1 already provides the foundation this PRD builds on: Node/Fastify backend,
Postgres + Drizzle, Claude streaming over WebSockets, and a React/Vite frontend. This PRD adds
three things on top of that foundation:

- **Accounts, authentication, and sessions** — so data belongs to a user and the agent can act
  on that user's behalf. (New requirement; not in `IDEAS.md`.)
- **The inventory & shopping domain** — inventory (across arbitrary categories, reorder optional),
  an inventory-aware chat assistant, mandates, grants, budgets, the reorder scheduler, the LLM
  fallback decision, cart assembly, notifications, and the shopping-provider integration. (From
  `IDEAS.md`, scoped to assisted cart-building rather than autonomous checkout.)
- **A revised data model and API surface** that ties every domain object to an owning user.

### Decisions locked for this PRD

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | ~~Self-hosted email + password only~~ → **email + password *and* Google OAuth**, JWT session cookie | **Superseded during implementation** (see §3.7). Password auth still exists exactly as specified; Google sign-in was added alongside it so users are not forced to create another password. The JWT-cookie session model is unchanged. |
| Multi-user model | **Single user per account** | Each account owns its own inventory/mandates/orders. Household sharing is explicitly deferred (see Non-goals + Future phases). |
| Input model | **Natural-language-first: free-text → LLM parse → confirm-before-commit** for inventory stock updates, inventory item definitions, mandates, and grants. Forms only for account creation and budgets. | Users won't hand-enter counts or trigger syntax; they type *"low on eggs"* / *"buy eggs when we're low, under $5"*. The LLM translates to structured JSON (for stock, a threshold-aware `current_stock`); the parsed draft is shown for approval/edit before persisting. |
| Stored trigger form | **Structured `{op, field, value}`** | The scheduler must evaluate triggers deterministically; the free text is only the LLM's input, never what runs. |
| Spend limits | **Two-tier: per-item grants + per-period/category budgets** | A grant bounds one purchase ("eggs ≤ $5"); a budget bounds cumulative category spend over a period ("groceries ≤ $500/month"). Budget headroom is what makes grant overrides meaningful. |
| Ordering model | **Assisted: agent builds the cart, user places the order manually** | The agent assembles a ready-to-checkout cart and notifies the user; the user does the actual checkout. The app never auto-completes a purchase in this scope. Autonomous placement is a stretch goal (§9.1). |
| Post-purchase restock | **Placing a cart optimistically sets each ordered item's stock to its `restock_level` ("full")** | Closes the reorder loop and prevents re-proposing just-ordered items (§5.9). Placing ≠ delivered, so a short/failed delivery is corrected with a normal NL stock update. |

---

## 2. Terminology — the two meanings of "session"

"Session" is overloaded in this codebase. This PRD always qualifies it:

- **Chat session** — an existing row in the `sessions` table: one conversation thread between a
  user and the shopping assistant (`sessions` + `messages`, per Phase 1). Renamed in prose to
  *chat session* wherever ambiguity is possible; the table name stays `sessions` for
  backward-compatibility.
- **Auth session** (a.k.a. login session) — a *new* concept: an authenticated browser session,
  represented by a signed JWT delivered in an httpOnly cookie, optionally backed by a
  server-side refresh-token record for revocation.

When this document says "session" unqualified inside the auth chapter, it means an **auth
session**; everywhere else it means a **chat session**.

---

## 3. Users, Authentication & Sessions (new)

### 3.1 Goals

- A person can sign up, log in, and log out.
- Every domain object (chat sessions, inventory, mandates, orders, notifications) belongs to
  exactly one user and is invisible to all others.
- The autonomous scheduler and LLM fallback act **as** a specific user, scoped to that user's
  data and autonomy settings.
- Auth is enforced on every REST route and on the WebSocket handshake.

### 3.2 User information (profile)

`users` table holds identity + the small amount of profile the agent needs to act well:

| Field | Notes |
|---|---|
| `id` | UUID, app-generated (`crypto.randomUUID`), consistent with existing tables. |
| `email` | Unique, case-insensitive (store lowercased), validated with zod. Login identifier. |
| `password_hash` | `argon2id`. **Never** store or log the plaintext. **Nullable** — null for Google-only accounts (§3.7). |
| `display_name` | Optional, shown in UI and available to the LLM for tone. |
| `avatar_url` | Optional; populated from the Google profile picture when available. |
| `email_verified` | Boolean; gate autonomous ordering behind a verified email. |
| `created_at`, `updated_at` | Timestamps. |

Deferred profile fields that the domain will eventually want (delivery address, default store,
payment handle) are **out of scope** here and belong with the shopping-provider integration
phase — noted so the schema can grow without rework.

### 3.3 Authentication mechanism

- **Signup**: `POST /auth/signup { email, password, display_name? }` → creates the user, hashes
  the password, issues an auth session (sets cookie), returns the public user shape. Reject weak
  passwords (min length + zxcvbn-style check optional) and duplicate emails (409).
- **Login**: `POST /auth/login { email, password }` → verify hash, issue auth session. Use a
  constant-time comparison path; return an identical 401 for "no such user" and "wrong password"
  (no user enumeration).
- **Logout**: `POST /auth/logout` → clears the cookie and revokes the refresh record (if used).
- **Current user**: `GET /auth/me` → returns the authenticated user's public shape, or 401.

**Tokens.** A short-lived access JWT (e.g. 15 min) carries `sub = user.id`. It is delivered as an
**httpOnly, Secure, SameSite=Lax cookie** — not readable by JS, which removes the XSS token-theft
class. A longer-lived refresh token (e.g. 30 days) allows silent renewal; store a hash of it in an
`auth_sessions` table so individual sessions can be revoked (logout, "log out everywhere",
password change).

`auth_sessions` (refresh/revocation store):

| Field | Notes |
|---|---|
| `id` | UUID. |
| `user_id` | FK → `users.id`, `ON DELETE CASCADE`. |
| `refresh_token_hash` | Hash of the refresh token; never the raw token. |
| `user_agent`, `ip` | Optional, for a "your sessions" UI and anomaly review. |
| `expires_at`, `created_at`, `revoked_at` | Lifecycle. |

JWT signing secret comes from `JWT_SECRET` (Secret Manager in prod, `.env` locally). Rotating it
invalidates all outstanding access tokens — acceptable given the refresh flow.

### 3.4 Enforcement

- **REST**: a Fastify `preHandler`/auth plugin reads the cookie, verifies the JWT, loads
  `request.user`. Unauthenticated requests to protected routes → 401. `/auth/signup` and
  `/auth/login` are the only fully public routes.
- **WebSocket**: authenticate at the **handshake** (the cookie is sent with the WS upgrade
  request). Reject the upgrade with a close code if unauthenticated. On every incoming WS message,
  verify the target chat session's `user_id` matches `request.user.id` before doing any work —
  never trust the `session_id` in the path alone.
- **Ownership checks**: every repository read/write is scoped by `user_id`. A user requesting
  another user's `session_id`/`mandate_id` gets a 404 (not 403 — don't confirm existence).
- **CSRF protection**: because auth is a **cookie** the browser attaches automatically, every
  state-changing request needs CSRF defense — otherwise a malicious site could trigger authenticated
  mutations. Layered approach:
  - `SameSite=Lax` on the auth cookie is the baseline (blocks cross-site POSTs from forms/links);
    consider `SameSite=Strict` if no cross-site top-level nav flow needs the cookie.
  - Additionally enforce a **CSRF token** (double-submit cookie or a per-session token echoed in an
    `X-CSRF-Token` header) on all mutating REST routes (`POST/PATCH/DELETE`), validated by the auth
    plugin. `SameSite` alone is not treated as sufficient for the money-adjacent actions here.
  - Also **check the `Origin`/`Referer`** against the allowed frontend origin on mutations, and keep
    CORS credentialed to that specific origin (no wildcard) — reinforces the above.
  - The WebSocket upgrade validates `Origin` at the handshake for the same reason (a cross-site page
    must not be able to open an authenticated socket).

### 3.5 Impact on existing Phase 1 code

- `sessions` gains `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` — via a new
  migration. Existing rows (dev data) may need a backfill or a clean reset; document in the
  migration notes.
- `POST /sessions` derives `user_id` from `request.user`, not from the body.
- `GET /sessions/{id}/history` and the WS handler add ownership checks.
- Frontend gains signup/login/logout screens and an auth guard; API/WS calls rely on the cookie
  being sent automatically (`credentials: 'include'` / cookie on WS upgrade). CORS must allow
  credentials for the specific frontend origin (wildcards are incompatible with credentialed
  requests).

### 3.6 Account lifecycle & hardening

Table-stakes account management for a shippable app (data export is explicitly **out of scope**):

- **Update profile** — `PATCH /auth/me { display_name?, email? }`. Changing email re-sets
  `email_verified = false` and re-triggers verification (verification gates only the autonomous
  stretch goal, §5.11, so a pending re-verify doesn't block normal use).
- **Change password** — `POST /auth/change-password { current_password, new_password }`. Requires
  the current password; on success, **revoke all other `auth_sessions`** (keep the current one) so a
  password change logs out other devices.
- **Delete account** — `DELETE /auth/me` (require password re-entry). Cascades all user-owned rows
  via the existing `ON DELETE CASCADE` on every `user_id` FK, revokes all `auth_sessions`, and
  clears the cookie. Hard delete; no export, no soft-delete/undo in scope.
- **Login hardening** — rate-limit / throttle `POST /auth/login` per IP + per account (e.g.
  exponential backoff or a temporary lockout after N failures). Without this the no-enumeration
  decision (§3.3) is undercut by unthrottled brute force. Applies to `/auth/signup` too (abuse) and,
  lightly, to the LLM-backed routes (cost — see §8.3).

### 3.7 Google OAuth (implemented — supersedes the password-only decision)

Google sign-in ships **alongside** email + password rather than replacing it. Everything in
§3.2–§3.6 still holds; this section records what changed.

- **`users.password_hash` is nullable.** An account created through Google has no password. Login
  must treat null as "this account has no password credential" and still return the same 401 —
  and, because argon2 takes ~50 ms, still burn the same time, or the response latency leaks which
  accounts are OAuth-only.
- **New `oauth_accounts` table** (§6) — one row per linked provider identity, keyed
  `UNIQUE (provider, provider_account_id)` on Google's stable `sub` claim. **Never keyed on email:**
  a Google account's email can change, and matching on it would re-point the link at whoever holds
  that address next.
- **Account linking rule.** When a Google identity's email matches an existing account, the two are
  linked **only if Google asserts `email_verified`**. Otherwise anyone able to create a Google
  account claiming that address could take over the matching Salamander account. An unverified match
  is refused, not silently linked.
- **ID-token validation** checks signature (against Google's JWKS), issuer, **and audience**. The
  audience check is load-bearing: without it an ID token minted for a different OAuth client would
  be accepted.
- **PKCE + `state`.** The authorization-code flow uses S256 PKCE, with `state` and the code verifier
  held in one signed, httpOnly cookie for the duration of the redirect. This is what stands in for
  CSRF protection on the callback, which is a GET driven by Google and cannot carry a CSRF header.
- **`POST /auth/change-password` doubles as "set a password."** For a Google-only account there is no
  current password to prove; the authenticated cookie is the proof, so an OAuth user can add a
  password and gain a second way in.
- **`DELETE /auth/me` cannot always require a password.** Google-only accounts confirm with a typed
  `"DELETE"` string instead.
- **Google credentials are optional configuration.** Without `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` the server still boots and password auth works; `/auth/google` returns 503.
  Local dev and CI therefore need no OAuth client.

**Deployment consequence.** `SameSite=Lax` cookies are not sent cross-site, so the API must share a
registrable domain with the frontend — the backend is served from `api.axoliz.ai`, not its `run.app`
URL. See `ARCHITECTURE.md` → Deployment.

---

## 4. Core Concepts (from IDEAS.md)

| Term | Definition |
|---|---|
| **Inventory** | The items a user tracks, with current stock levels. |
| **Mandate** | A condition that triggers a shopping action, e.g. "if eggs < 2 units, buy eggs." |
| **Grant** | Per-purchase constraints attached to a mandate, e.g. "price ≤ $5, preferred brand X." |
| **Budget** | A per-period, per-category cumulative spend limit, e.g. "groceries ≤ $500/month." |
| **Reorder Schedule** | The user's recurring configuration for when a reorder window opens — recurrence (e.g. weekly, Saturday), start time (08:00), window length (default 12h), timezone. |
| **Reorder Window** | A concrete open period opened by the schedule (e.g. Sat 08:00 → 20:00). While open, inventory updates auto-trigger re-checks that append to the window's live cart; it closes on user confirmation or expiry. |
| **Shopping Run** | One execution of the mandate check within a window (the initial run at open, plus any re-runs triggered by inventory updates); produces per-mandate evaluations and appends to the window's proposed order. |
| **Proposed Order (Cart)** | The ready-to-checkout cart a window assembles — line items, chosen products, prices, total — accreting across the window's runs. The user reviews it and places the order **manually**; the app does not check out. |
| **Fallback Decision** | When a mandate fires but its grant can't be satisfied (or a budget would be breached), the LLM decides what to do within the user's configured autonomy. |
| **Autonomy Level** | Per-user (and optionally per-mandate) setting bounding what the LLM may do without asking. |

---

## 5. Functional Requirements

### 5.0 Input model — natural language by default, forms only where they fit

**Natural-language text is the primary interaction** across the app. The user types plain sentences
into a textarea; the backend calls the LLM to **parse them into the structured JSON the app stores**,
validates the result, shows the parsed draft for approval, and commits on confirm. This applies to:

- **Inventory stock updates** (§5.1) — *"low on eggs and milk, out of bread"*.
- **Inventory item definitions** (§5.1) — *"start tracking eggs, a dozen is normal"*.
- **Mandates** (§5.2) — *"buy eggs when we're low"*.
- **Grants** (§5.3) — *"only if they're under $5"*.

The user never hand-fills a trigger condition, a grant constraint, or a stock count — the LLM does
the translation, and the confirm step (a pre-filled, editable view of the parsed fields) is where any
correction happens.

**Structured forms are reserved for the few genuinely bounded, high-stakes inputs** where prose adds
nothing and precision matters: **account creation** (email, password — §3) and **budgets** (name,
amount, category, period — §5.4; NL is an option there per §12). Everything the confirm step surfaces
is itself an editable form, so "forms vs. NL" is really "NL-first with a form as the safety net."

§5.1–5.3 and §8.1 describe how the parse → validate → confirm → commit flow works and how it fails
safely.

### 5.1 Inventory management

**Categories are arbitrary and reorder is optional.** An `inventory_item` is just something the user
tracks — a grocery, printer ink, or a book — distinguished by its user-defined `category`. Items are
useful on their own: a user can maintain a **track-only** catalog (e.g. books they own) with no
mandate, grant, budget, or schedule attached, and never enter the reorder flow at all. `par_level`
and any mandate are optional per item. For non-consumables that carry richer metadata (a book's
author/edition/ISBN, an ink cartridge's model number), an optional `attributes` field (§6) holds
those key/values so the chat assistant can match a fuzzy query like *"the LOTR special edition"* to
the right row (§5.8).

The daily reality (for the consumable/reorder case): a user will **not** open a form and type "6"
into an egg-count field every day.
They will, once a week (often right after a "cart ready to place" notification, §5.7), type a
qualitative update. So inventory is **natural-language-first**, with the LLM translating fuzzy
language into the concrete numbers the mandates evaluate against.

**Stock updates (the primary interaction).** The user types free text — e.g. *"low on eggs and milk,
out of bread, still plenty of rice"* — and the LLM maps each phrase to a concrete `current_stock`
value for that item. The translation is **threshold-aware**: for each named item the backend passes
the LLM its `current_stock`, `par_level`, `unit`, and any mandate trigger threshold, so:
  - *"out of eggs"* → `current_stock = 0`
  - *"low on eggs"* → a value at/below the reorder threshold (so the eggs mandate fires next run) —
    e.g. par is 6, trigger is `stock < 2` → set `1`
  - *"restocked / plenty of eggs"* → at or above `par_level`
  - a stated number (*"2 eggs left"*) → used verbatim
This is exactly the mechanism behind the user's example: *"I'm low on eggs"* becomes a small
`current_stock` that makes the `eggs < 2` mandate pass. **A single sentence updates many items at
once.** Each write is logged to the history/audit trail (§6, `inventory_events`), with the original
phrase kept as the `reason`.

**Unit normalization is the LLM's job.** Stock is stored as a plain number in the item's base unit;
the LLM converts natural quantity expressions on the way in — *"a dozen eggs"* → `12`, *"a loaf of
bread"* → `1`, *"half a bag of rice"* → the item's fractional value. The user never has to think in
the stored unit; the same normalization applies to a mandate's purchase quantity (*"buy a dozen
eggs"* → `12`) so stock counts and reorder quantities stay in the same unit.

**Item definitions.** New items can be introduced in the same textarea (*"start tracking eggs, a
dozen is normal"*); the LLM infers `category`, `unit`, a sensible `par_level`, and a **`restock_level`
(the "full" quantity)**, which the confirm step exposes for the user to accept or edit. `restock_level`
is what an item's stock is set to when a reorder for it is placed (§5.9) — e.g. eggs → `12`, bread →
`1`. (A plain form is a fine alternative for precise first-time setup, but is not the expected path.)

**Confirm-before-commit and failure handling.** The parsed draft is shown as a per-item diff
(*"Eggs 6 → 1 (low), Milk 4 → 1 (low), Bread 2 → 0 (out)"*) for the user to approve or adjust before
anything is written — nothing is committed on a guess. An item name the LLM can't resolve to a
tracked item is **surfaced, not invented**: the confirm step offers to add it as a new item (or the
user drops it). See §8.1.

**Precise edits remain available.** A structured `POST /inventory/{id}/adjust` (set absolute /
increment / decrement) stays for exact or programmatic updates; the NL path is what the user reaches
for day to day. All inventory is scoped to the authenticated user.

**Committing a stock update while a reorder window is open auto-triggers a re-check** (§5.5): the
just-lowered items are re-evaluated against their mandates and any newly-passing ones are appended
to the window's live cart. This is the "check inventory → add missing items → cart grows" step of
the window flow. Outside an open window the update just records the number.

### 5.2 Mandates
- **Created from natural-language text**, not a form. The user types a sentence into a textarea
  (e.g. *"buy a dozen eggs when we drop below 2, only if they're under $5"*). The backend passes
  that text to the LLM extraction step (§8.1), which returns structured fields:
  - **Trigger condition** — e.g. `stock < 2`.
  - **Action** — what to shop for (may differ from the tracked item, e.g. "buy a dozen eggs").
  - **Grant** — any purchase constraints stated in the same sentence (e.g. "under $5"). A single
    sentence commonly yields **both** a mandate and its grant; the backend persists the grant first
    (§5.3), then the mandate referencing it via `grant_id`. If no constraint is stated, the mandate
    has no grant (unbounded → always escalates to fallback).
- The parsed result is validated with zod against the mandate/grant schema before commit. On a
  low-confidence or unparseable input, the backend returns what it understood (or an error) so the
  UI can ask the user to rephrase or edit — it never guesses a trigger it isn't confident about.
  The parsed draft is **shown to the user for approval/edit before it is committed**
  (confirm-before-commit; locked decision, §1) — mandates drive real spending, so nothing persists
  until the user accepts the draft.
- Mandates are viewable, editable, deletable, and enable/disable-able. Editing may re-run the
  textarea → parse flow, or (recommended) allow direct field edits on the already-parsed mandate.
- Multiple mandates per item allowed (future-friendly; not required in first cut).

### 5.3 Grants
A **grant** is a reusable, user-owned set of purchase constraints — the budget/limits a mandate's
order must satisfy. Grants are first-class objects, not an inline blob on the mandate, so one
constraint set (e.g. "cheap staples: ≤ $5, store brand, qty ≤ 2") can be defined once and attached
to many mandates, and edited in one place.

Grants are **created from natural-language text** too — either inline as part of a mandate sentence
(§5.2), or standalone by typing a constraint into a textarea (e.g. *"never spend more than $5, prefer
the store brand"*), which the LLM extraction step (§8.1) parses into the fields below. The same
validate-and-confirm-before-commit flow as mandates applies (§1 locked decision).
- Fields the extraction produces (all scoped to the authenticated user):
  - **`name`** — human label (e.g. "Cheap staples").
  - **`max_price`** — price ceiling for the purchase (nullable = no cap).
  - **`preferred_vendor`** — preferred store/vendor (nullable).
  - **`brand`** — brand preference/restriction (nullable).
  - **`max_quantity`** — quantity ceiling (nullable).
  - **`price_tolerance_pct`** — how far over `max_price` the LLM fallback may auto-approve
    (e.g. 20 → +20%); 0/null means "never auto-override, always ask".
  - **`notes`** — freeform extra constraints for the LLM to honor.
- Grants are viewable, editable, and deletable. Deleting a grant that mandates reference detaches
  it from them (`mandates.grant_id → NULL`), it does not delete those mandates.

### 5.4 Budgets

A **budget** is an *aggregate, time-windowed spend limit over a category* — e.g. "≤ $500 on
groceries this month." It is a different kind of constraint from a grant:

| | Grant (§5.3) | Budget |
|---|---|---|
| Scope | one purchase, one item | many purchases, a category, over a period |
| Nature | per-order preference ("eggs ≤ $5") | cumulative ceiling ("groceries ≤ $500/month") |
| Checked against | the price of a single candidate order | actual spend so far this period |

The two form a **two-tier model**: a fine-grained grant on eggs (≤ $5) sits *inside* a coarse
grocery budget (≤ $500/month). Both are needed — neither expresses the other.

- CRUD for a budget, scoped to the authenticated user:
  - **`name`** — human label (e.g. "Monthly groceries").
  - **`category`** — the `inventory_items.category` this applies to; **`NULL` = account-wide**
    (all spend). This is how "$500 for all groceries" and a future "$100 household" coexist.
  - **`amount`** — the ceiling for one period (numeric).
  - **`period`** — `monthly` (default) / `weekly`; the reset rule (calendar vs rolling) is an
    open decision (§12).
- **Spend is computed, not stored**: the amount spent this period = sum of `orders.total_price`
  for **`placed`** orders (the ones the user actually checked out; §5.9) in the current period
  window whose items map to the budget's category (via `mandate → inventory_item → category`). No
  running total to drift out of sync. A `proposed` cart the user hasn't placed yet does not count
  as spend, but a run *may* factor pending carts into headroom to avoid over-proposing — an open
  decision (§12).
- Budgets are simple enough to enter via a **form**, consistent with §5.0 — but the NL extractor
  (§8.1) can also emit a budget from a sentence like *"$500 for groceries this month"* if preferred
  (§12).
- The account-wide budget (`category = NULL`) **subsumes** `user_settings.spend_ceiling`; that
  loose setting is folded into this concept.

### 5.5 Reorder scheduler & reorder window

The schedule is not a single instant but a **window**. A **scheduling module** lets the user
configure a **reorder schedule** — recurrence, start time, and a window length (default **12
hours**), in the user's timezone. Example: *"weekly, Saturday 08:00, 12h window"* → each Saturday a
reorder window is open from **08:00 to 20:00**.

**Mandate check (a run).** Whenever the scheduler evaluates mandates for a user it does one run:
  1. Load current inventory.
  2. Evaluate each active mandate's trigger condition.
  3. For each mandate that fires, resolve a candidate product within its grant via the provider.
  4. Candidate fits its grant **and** the applicable budget's remaining headroom → **append it as a
     line item to the window's proposed order (cart)**, skipping items already in the cart.
  5. Candidate fails its grant, **or** would exceed the budget → escalate to the LLM Fallback
     Decision (§5.6), whose outcome appends an (adjusted/substituted) line item or flags it.

**Window flow (the new control loop).** Using the *Saturday 08:00, 12h* example:
  1. **Open (08:00).** The window opens and the **initial run** executes. Passing items are added to
     a fresh cart; a **"cart ready to place"** notification is sent (§5.7). The app never checks out.
  2. **User reacts.** The user opens the notification, does a quick inventory check, and updates
     stock in natural language (§5.1) — e.g. *"also low on milk and bread"*.
  3. **Auto re-run (within the window).** Because inventory changed **while the window is open**,
     the update **automatically triggers another run** that appends the newly-passing items to the
     **same** cart (no new cart, no duplicate lines). This can happen any number of times until the
     window closes.
  4. **Confirm.** Once the cart looks complete, the user confirms — i.e. places the order manually
     (§5.9). Placing the cart **closes the window** (`placed`).
  5. **Expiry reminder.** If the user has **not** confirmed by window close (20:00), a **second,
     reminder notification** is sent and the window closes (`expired`). Inventory updates after
     close no longer auto-trigger runs; the cart persists and the user may still place or dismiss it
     manually. **From here it is entirely up to the user** — the automated flow of control is done.

- Only inventory updates **inside** an open window auto-trigger re-runs. Outside a window, updating
  stock just records the number (the next scheduled window will pick it up), unless the user hits
  "run a check now" manually.
- Runs, per-mandate evaluations, the window, and the proposed order are all persisted for audit.
- Because nothing is auto-purchased, the whole loop is safe to enable early — worst case is a cart
  the user ignores past expiry, not an unwanted charge.
- A **manual "run a check now"** remains available; if no window is open it opens an ad-hoc one (or
  just produces a one-off cart — see §12).

**Concurrency — appends to a window's cart must be serialized.** Multiple runs can target the same
window's cart near-simultaneously: two inventory updates landing close together, the cron sweep and
an event-driven re-run overlapping, or a manual "run now" during an auto re-run. Without control they
could **double-append the same line or interleave and corrupt the cart total**. Requirements:
- Serialize runs per window (e.g. a per-`reorder_window` advisory/row lock, or a single-flight queue
  keyed by window id) so at most one run mutates a given cart at a time — the "skip items already in
  the cart" dedup (step 4) is only safe under this serialization.
- Make line-item appends **idempotent** — key a line by `(cart_id, mandate_id)` and upsert, so a
  retried or overlapping run cannot create a duplicate line even if serialization is bypassed.
- Guard the window-close transition: placing/expiring a window must atomically stop further appends
  (a run that starts against an already-`placed`/`expired` window is a no-op), so nothing is added
  to a cart the user just checked out.

### 5.6 LLM fallback decision
- Triggered when a mandate fires but its grant cannot be satisfied, **or** a candidate order would
  push a budget over its limit.
- LLM context: item, mandate, grant, actual available options/prices, the user's
  history/preferences and autonomy level, **and the budget situation for the item's category** —
  the budget amount, spend so far this period, remaining headroom, and time left in the period.
- The LLM chooses from a **fixed action set** (each outcome affects only what goes into the cart —
  never an actual purchase, since the user places the order):
  - Add the item to the cart but flag it for the user's attention.
  - Include it at the higher price within tolerance — **weighed against budget headroom**, not a
    fixed percentage. Example: eggs are $6 against a $5 grant, but the grocery budget is $500 with
    $300 still unspent and a week left → the $1 overage is immaterial, include it. The same $1 with
    $480 already spent → leave it out and flag instead.
  - Substitute a different product/brand.
  - Skip this cycle and retry next scheduled run.
  - Drop the item from this cart entirely.
- Decision + rationale are logged and surfaced to the user on the cart where relevant.
- **Autonomy is user-configured**: "flag everything for me" vs "auto-include minor overrides" vs
  bounded auto-substitution, etc. The LLM must never exceed the user's ceiling, and **must never add
  line items that would push the cart total past a budget's hard limit** (as opposed to a single
  item's soft grant) unless the user's autonomy explicitly permits budget overruns. (This is about
  what the *proposed cart* contains; the user still confirms the actual spend at checkout.)

### 5.7 Notifications
Notify the user of:
- **Cart ready to place** — the primary notification, sent when a reorder window opens and the
  initial run produces a cart ("N items, ~$X, review & place"). Links to the proposed order (§5.9).
- **Window-closing reminder** — a **second notification** sent at window expiry if the cart was
  never placed ("your cart is still unconfirmed"), per the §5.5 flow. This is the last automated
  nudge; after it, control is entirely the user's.
- Mandates that required fallback; LLM decisions made while assembling the cart; failed provider
  lookups / integration errors.

Delivery starts in-app (notification feed) with email as a fast follow; both are per-user. A run
triggered by an inventory update mid-window does **not** fire a fresh "cart ready" each time (that
would be noisy); the cart badge/count updates live, and only the initial open and the expiry
reminder are push-notified — how chatty re-runs should be is an open decision (§12).

### 5.8 Chat assistant (retained + inventory-aware)
The Phase 1 conversational assistant remains, now authenticated and user-scoped. **It gains access
to the user's inventory** so it can answer questions about what they own — the canonical case being,
while standing in a store: *"Do I have the Lord of the Rings special edition book?"* or *"Am I low
on printer ink?"*

- The agent is given an **inventory-lookup tool** (§8.2). When a message needs it, the LLM calls the
  tool, which queries the user's `inventory_items` (scoped by `user_id`), and the LLM answers from
  the returned rows — including current stock, category, and `attributes` (author/edition/etc.).
- Matching is **fuzzy and semantic**: *"LOTR special edition"* should resolve to a stored
  *"The Lord of the Rings — Illustrated Special Edition"* even without an exact string match. The
  tool returns candidate rows (by keyword/category) and the LLM disambiguates; if nothing matches it
  says so plainly (*"you don't have that tracked"*), optionally offering to add it.
- This is what makes the **track-only** mode (§5.1) genuinely useful without any reorder setup: add
  your books/supplies, then just ask.
- Scope guard: the lookup is **read-only over the asking user's own inventory** — never another
  user's, and it does not place orders or edit data. (Letting chat *update* stock or *create*
  mandates conversationally is a natural extension but is left to the dedicated NL flows in
  §5.1–5.3 for now.)

### 5.9 Proposed order (cart) review & manual placement
- A window's proposed order is a persisted cart: line items (product, quantity, unit price), a
  total, and per-item notes from any fallback decisions. It **accretes across the window's runs**
  (§5.5) — the initial open plus each inventory-triggered re-run append to this one cart. Status
  lifecycle: `proposed` → `placed` (user placed it) → or `dismissed` (user declined). See §6.
- The user reviews the cart in the UI: adjust quantities, remove items, then **places the order
  themselves** — either in the provider's own app/site, or via a deep link the cart provides.
  After placing, they mark the cart `placed`, which **closes the open reorder window** and
  **restocks the ordered items** (below); dismissing marks it `dismissed`.
- **Restock-on-place (closes the reorder loop).** Marking a cart `placed` sets each ordered item's
  `current_stock` to its **`restock_level`** ("full" — eggs → 12, bread → 1; §5.1). This is what
  prevents the same items being re-proposed on the next window: once placed, the item is at full, so
  its mandate no longer fires. It is an **optimistic** restock (placing ≠ delivered) — if a delivery
  is short or fails, the user corrects with a normal NL stock update (*"bread never came"* → back to
  0). Each restock writes an `inventory_events` row (`reason = "reorder placed"`).
- **The application performs no checkout in this scope.** Marking `placed` records the user's action
  and restocks; it does not call a provider checkout API.
- After the window expires unplaced, the cart stays `proposed` and remains placeable/dismissable
  indefinitely — expiry only stops the *automatic* re-runs, it does not void the cart or restock.

### 5.10 Shopping-provider integration & product matching
- Provider integration (Instacart or similar) is needed to **search products and check
  price/availability** so the cart can be assembled with real products and prices. Actual
  **checkout/order placement is out of scope** here (it is the §9.1 stretch goal).
- Abstract behind an internal **`ShoppingProvider`** interface (search + price/availability now;
  a `placeOrder` method reserved for the stretch goal) so additional providers can be added later.
  First implementation may be a **mock/sandbox provider** so the scheduler, cart assembly, and
  fallback logic can be built and tested before a real API is wired up.

**Product matching (mandate `shopping_query` → a specific SKU).** This is the hardest real-world
step and the biggest single driver of cart quality — *"buy a dozen eggs"* must become one concrete
product out of many. Recommended approach:
  1. `ShoppingProvider.search(shopping_query)` returns a **ranked list of candidate products** (name,
     brand, size, price, availability) — not a single guess.
  2. The **LLM selects** the best candidate given the mandate's `shopping_query` and its grant
     (brand/vendor/price/quantity), the same disambiguation pattern used for chat lookup (§8.2) and
     the fallback (§5.6). It records a short rationale on the line item.
  3. **Remember the choice per mandate**: store the selected product ref on the mandate
     (`preferred_product`, §6). Next run, prefer that product if still available/within grant and
     skip re-selection — matching gets more accurate and cheaper over time, and stays stable
     week-to-week.
  4. **Low-confidence → flag, don't guess**: if no candidate clears the grant, or several are close
     and none is clearly best, the line item is **flagged for the user** in the cart (reusing the
     fallback flag) rather than silently picking. The user's pick in cart review updates
     `preferred_product`.
- This keeps matching honest (the mock provider should return realistic *ambiguity*, not one clean
  fixture, so this path is exercised before a real API lands). The DB-side vs LLM-side split for
  ranking is an open decision (§12).

### 5.11 Safeguards (mostly for the autonomous stretch goal)
- In the assisted flow, the strongest safeguard is structural: **the user is the one who checks
  out**, so nothing is bought without an explicit human action. Budgets and grants shape the
  *proposed* cart; the user confirms the real spend.
- The gates below apply to the **autonomous stretch goal (§9.1)**, where the app would place orders
  itself: verified email; an explicit per-user "autonomous ordering enabled" toggle (default
  **off**); the account-wide budget (§5.4); a per-**run** spend cap (a circuit-breaker limiting
  spend in a single scheduler run, distinct from the per-period budget); and idempotent order
  placement (a run must not double-order on retry). All order actions are fully logged in both
  modes.

---

## 6. Data Model (draft)

App-generated UUID PKs throughout (consistent with Phase 1). Every user-owned table carries
`user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE` and is indexed on `(user_id, …)`
for the common list queries.

```sql
users
  id, email (unique, lowercased), password_hash (NULLABLE — null for
  Google-only accounts), display_name, avatar_url,
  email_verified, created_at, updated_at

oauth_accounts                 -- linked provider identities (§3.7)
  id, user_id → users(id) ON DELETE CASCADE,
  provider ('google'), provider_account_id (Google's stable `sub`),
  created_at
  -- UNIQUE (provider, provider_account_id); never keyed on email

auth_sessions
  id, user_id → users(id), refresh_token_hash, user_agent, ip,
  expires_at, created_at, revoked_at

sessions                       -- chat sessions (existing; + user_id)
  id, user_id → users(id), title, created_at

messages                       -- existing, unchanged
  id, session_id → sessions(id) ON DELETE CASCADE, role, content, created_at

inventory_items
  id, user_id → users(id), name, category, unit (nullable),
  current_stock (nullable), par_level (nullable),   -- null for track-only, non-consumable items
  restock_level (nullable),        -- the "full" quantity; stock is set to this when a reorder is
                                   --   PLACED (§5.9). eggs → 12, bread → 1. LLM-inferred, editable.
  attributes (jsonb, nullable),   -- freeform metadata: author/edition/ISBN, model number, etc.
  created_at, last_updated
  -- All quantity fields are stored in the item's base unit; the LLM normalizes
  --   "a dozen"/"a loaf" to numbers on the way in (§5.1).
  -- category is arbitrary/user-defined (groceries, office supplies, books, …).
  -- An item needs no mandate/par to exist; reorder is opt-in (§5.1).

inventory_events               -- optional audit log
  id, user_id → users(id), inventory_item_id → inventory_items(id),
  delta, new_stock, reason, created_at

grants                         -- reusable, user-owned per-purchase constraints (micro)
  id, user_id → users(id), name, max_price (numeric, nullable),
  preferred_vendor, brand, max_quantity (int, nullable),
  price_tolerance_pct (int, nullable), notes, created_at, updated_at

budgets                        -- aggregate, per-period, per-category spend limit (macro)
  id, user_id → users(id), name,
  category (text, nullable → matches inventory_items.category; NULL = account-wide),
  amount (numeric), period ('monthly' | 'weekly'), created_at, updated_at
  -- spend-so-far is COMPUTED from PLACED orders in the current period, not stored

mandates
  id, user_id → users(id), inventory_item_id → inventory_items(id),
  grant_id (nullable → grants(id) ON DELETE SET NULL),
  trigger_condition, shopping_query, active (bool),
  preferred_product (jsonb, nullable),   -- last product chosen for this mandate (§5.10);
                                         --   reused next run to stabilize + cheapen matching
  created_at, updated_at

reorder_windows                -- one open period opened by the schedule (§5.5)
  id, user_id → users(id),
  opened_at, closes_at,          -- closes_at = opened_at + schedule window length
  status ('open' | 'placed' | 'expired'),
  order_id (nullable → orders(id)),   -- the live cart this window is building
  opened_notified_at, reminder_notified_at (nullable),
  closed_at (nullable)
  -- While status='open' and now < closes_at, inventory updates auto-trigger re-runs.

shopping_runs
  id, user_id → users(id),
  reorder_window_id (nullable → reorder_windows(id)),  -- null for ad-hoc "run now"
  trigger ('window_open' | 'inventory_update' | 'manual'), run_at, status, summary

mandate_evaluations
  id, shopping_run_id → shopping_runs(id), mandate_id → mandates(id),
  triggered (bool), fulfilled_normally (bool), fallback_invoked (bool),
  fallback_decision (jsonb), order_id (nullable → orders(id))

orders                         -- a PROPOSED ORDER / cart; accretes across a window's runs; user places it
  id, user_id → users(id), reorder_window_id (nullable → reorder_windows(id)), provider,
  items (jsonb: line items, each {mandate_id, product, qty, unit_price, flags}),
  total_price,
  status ('proposed' | 'placed' | 'dismissed'),   -- 'placed' = user checked out, not the app
  created_at, placed_at (nullable), dismissed_at (nullable)
  -- Budget "spent this period" counts orders with status='placed' in the budget PERIOD.
  -- A cart aggregates many mandates/runs, so the per-mandate link lives in items[] and
  -- mandate_evaluations.order_id, not a single orders.mandate_id.

notifications
  id, user_id → users(id), type, payload (jsonb), read_at, created_at

user_settings                  -- autonomy + reorder-schedule config
  user_id → users(id) (PK), autonomy_level,
  schedule_recurrence,           -- e.g. 'weekly'; the day(s) it fires (e.g. Saturday)
  schedule_start_time,           -- local time the window opens, e.g. 08:00
  schedule_window_hours (default 12),   -- window length; closes_at = open + this
  timezone,                      -- IANA tz; the schedule is evaluated in the user's local time
  schedule_enabled (bool),
  autonomous_ordering_enabled (bool), per_run_spend_cap, updated_at
  -- schedule_* replaces the old single schedule_cron: the schedule now opens a
  --   reorder WINDOW (§5.5), not a single instant.
  -- per_run_spend_cap is a single-run circuit-breaker; per-period/per-category
  --   ceilings live in `budgets` (old `spend_ceiling` → account-wide budget, category = NULL)
```

Grant constraints are modeled as first-class columns on the `grants` table (not a blob), so they
can be queried and validated per-field. The genuinely open-ended parts (`fallback_decision`, order
`items`, notification `payload`) stay `jsonb`; validate their shapes with zod at the boundary.

---

## 7. API Surface (draft)

All routes below `/auth/signup` and `/auth/login` require authentication.

```
# Auth & account lifecycle (§3.3, §3.6, §3.7)
POST   /auth/signup            { email, password, display_name? } → user + Set-Cookie
POST   /auth/login             { email, password }                → user + Set-Cookie  (throttled)
GET    /auth/google                                               → 302 to Google (PKCE + state)
GET    /auth/google/callback   ?code&state                        → links/creates user, 302 to app
POST   /auth/logout                                               → clears cookie
POST   /auth/refresh                                              → rotates access + refresh token
GET    /auth/me                                                   → current user (+ has_password, linked_providers)
PATCH  /auth/me               { display_name?, email? }           → update profile (email → re-verify)
POST   /auth/change-password  { current_password, new_password }  → revokes other sessions
DELETE /auth/me               { password }                        → hard-delete account (cascades)

# Chat (existing, now user-scoped)
POST   /sessions               { title? }                         → chat session
GET    /sessions/{id}/history                                     → messages[]
WS     /ws/{session_id}                                           → stream (auth at handshake)

# Inventory — natural language first (parse → confirm → commit), forms as fallback
POST             /inventory/parse  { text }   -- LLM → draft: per-item stock diffs + new-item
                                              --   proposals + unresolved names; nothing persisted
POST             /inventory/updates { updates[] }  -- commit confirmed stock changes / item adds;
                                              --   writes inventory_events (reason = original phrase)
GET              /inventory                    -- list
GET/PATCH/DELETE /inventory/{id}               -- precise manual edits
POST             /inventory/{id}/adjust   { delta | absolute, reason? }  -- exact/programmatic update

# Mandates & grants — natural language, parse → confirm → commit (two steps; §1 locked)
#   step 1: parse the textarea input into a structured draft (nothing persisted)
POST             /mandates/parse  { text }    -- LLM → { mandate, grant? } draft, no persist
POST             /grants/parse    { text }    -- LLM → grant draft, no persist
#   step 2: user reviews/edits the draft, then commits the confirmed structured object
POST             /mandates        { mandate, grant? }   -- commits the confirmed draft
POST             /grants          { grant }              -- commits the confirmed draft
GET              /mandates ; GET /grants                 -- list
GET/PATCH/DELETE /mandates/{id} ; /grants/{id}          -- PATCH edits parsed fields directly

# Budgets (per-period, per-category spend limits, macro) — form input (or NL, §12)
GET/POST         /budgets         { name, category?, amount, period }
GET/PATCH/DELETE /budgets/{id}
GET              /budgets/{id}/status         -- amount, spent this period, remaining, days left

# Reorder schedule (the scheduling module; stored on user_settings)
GET/PATCH /schedule            { recurrence, start_time, window_hours, timezone, enabled }

# Reorder windows & runs
GET    /windows/current        -- the open window (if any): opened_at, closes_at, cart, status
GET    /windows                -- history of windows
POST   /runs                   -- "run a check now"; assembles/updates a cart (dry-run first)
GET    /runs                   -- history
GET    /runs/{id}              -- run + evaluations + resulting proposed order
#   Note: an inventory update inside an open window triggers a run automatically (server-side),
#   not via this route (§5.1, §5.5).

# Proposed orders (carts) — app builds them; user places the order manually
GET    /orders                 -- list (filter by status: proposed | placed | dismissed)
GET    /orders/{id}            -- the cart: line items, total, per-item flags
PATCH  /orders/{id}            -- adjust quantities / remove line items before placing
POST   /orders/{id}/place      -- user marks it placed (records the action; app does NOT check out)
POST   /orders/{id}/dismiss    -- user declines the cart

# Notifications
GET    /notifications
POST   /notifications/{id}/read

# Settings
GET/PATCH /settings            -- autonomy level, ordering toggle, per-run spend cap
                               --   (reorder schedule has its own /schedule routes above)
```

Ownership is enforced on every `{id}` route; cross-user access returns 404.

---

## 8. System Architecture

```
┌─────────────┐      ┌───────────────────────┐      ┌───────────────┐
│  React UI   │◄────►│   Node.js / Fastify    │◄────►│   PostgreSQL   │
│ Inventory,  │ HTTPS│  REST + WS + Auth guard │      │ users, auth,   │
│ Mandates,   │  WSS │                         │      │ inventory,     │
│ Chat, Feed  │      │                         │      │ mandates, runs,│
└─────────────┘      └───────────┬─────────────┘      │ orders, notifs │
                                 │                    └───────────────┘
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
        ┌────────────────┐  ┌──────────────┐   ┌──────────────────┐
        │ Reorder-window │  │ LLM Service   │   │ ShoppingProvider │
        │ engine         │  │ (NL parsing + │   │ (interface;      │
        │ (open / re-run │  │  fallback     │   │  mock → real API)│
        │  / remind)     │  │  decisions)   │   │                  │
        └────────────────┘  └───────────────┘   └──────────────────┘
```

Deployment stays on GCP (Cloud Run + Cloud SQL) per `ARCHITECTURE.md`. Add `JWT_SECRET` to Secret Manager
alongside the existing secrets.

**Reorder-window engine.** The schedule is no longer a single cron tick — a window has a lifecycle
with **timed** events (open at the scheduled local time; a **reminder + auto-close** at
`closes_at`) and **event-driven** events (an inventory update while a window is open triggers a
re-run). Implications for the substrate (open decision §12):
- Opening windows is periodic and can start as an in-process `node-cron` sweep (e.g. every minute,
  "open any window whose start time has arrived; fire reminders for any past `closes_at`").
- The mid-window re-run is triggered synchronously from the `/inventory/updates` handler when an
  open window exists — no scheduler round-trip needed.
- Timezone matters: the scheduled local time is evaluated in the user's `timezone`, so the engine
  compares against per-user local time, not server UTC wall-clock.
- Graduating to Cloud Scheduler → a job endpoint / Cloud Tasks (with a per-window delayed task for
  the reminder) is the scale/reliability path.

### 8.1 Natural-language extraction (inventory, mandates & grants)

The LLM Service gains a responsibility beyond the streaming chat assistant and the fallback
decision: **turning free-form text into the structured JSON the app stores.** There are three
extraction targets, each its own agent-layer function with its own tool/output schema:

1. **Inventory stock updates** — text → a list of per-item `current_stock` changes.
2. **Inventory item definitions** — text → new `inventory_items` (category/unit/par inferred).
3. **Mandates (+ optional grant)** and **standalone grants** — text → the mandate/grant schema.

All three share one flow — **parse (no persist) → confirm → commit**:

```
PARSE (no persist):
1. UI textarea → POST /{inventory|mandates|grants}/parse { text }
2. Backend calls the LLM with:
     - the raw user text
     - the target JSON schema for that extraction type (tool input_schema)
     - CONTEXT so fuzzy language resolves to real rows:
         · the user's inventory item names + ids (so "eggs" → an existing item, not a new one)
         · for stock updates specifically, per named item: current_stock, par_level, unit, and
           the item's mandate trigger threshold — this is what lets "low"/"out"/"plenty" map to a
           concrete number that makes the right mandate fire
3. LLM returns structured JSON via tool use / structured output (the tool's input_schema IS the
   target schema), so the model must return schema-shaped JSON, not prose to regex.
4. Backend validates with the SAME zod schema (never trust the model's shape blindly).
   Valid → return the draft to the UI (nothing persisted). For stock updates the draft is a
   per-item old→new diff so the user sees exactly what will change.
   Invalid / low-confidence / unresolved item → return 422 with the partial parse + a message; the
   UI prompts to rephrase, edit, or add the missing item. Nothing is guessed into the DB.

CONFIRM → COMMIT (§1 locked: confirm-before-commit):
5. UI shows the draft (mandate fields, or the per-item stock diff); the user accepts or edits.
6. UI → POST /{inventory/updates | mandates | grants} with the confirmed object.
7. Backend re-validates with the same zod schema, then persists:
     - stock updates → update current_stock + write inventory_events rows (reason = original phrase)
     - mandate/grant → grant first if present, then mandate with grant_id
   Only user-confirmed data is ever written.
```

Notes:
- These extraction calls are **non-streaming** and distinct from the chat streaming path — they live
  in the agent layer (`src/agent/`), reusing the Anthropic client with parsing-specific prompts and
  tool schemas. Each runs synchronously inside its POST; a short timeout + clear error is the failure
  mode.
- **Threshold-aware translation is the crux of the inventory case.** Without feeding the item's
  `par_level`/trigger to the model, "low on eggs" is unquantifiable; with it, the model can land a
  `current_stock` in the right band and the confirm diff lets the user nudge it. The stored value is
  a plain number — the qualitative word is never persisted except as the audit `reason`.
- Passing existing item names/ids is what lets the model link to an existing `inventory_item_id`
  instead of inventing one; unresolved names are surfaced, not silently created.

### 8.2 Chat inventory lookup (tool use)

The streaming chat assistant (§5.8) is given a **read-only inventory-lookup tool** so it can answer
"do I own / am I low on X?" questions:

- The tool takes a query (keywords, and optionally a category) and returns matching
  `inventory_items` for the **authenticated user only** — `user_id` is bound server-side from the
  session, never taken from the model, so the model cannot read another user's inventory.
- It returns candidate rows (name, category, `current_stock`, `attributes`) and the **LLM does the
  fuzzy matching / disambiguation** — *"LOTR special edition"* → the stored illustrated edition. A
  broad keyword/category fetch + LLM judgement is simpler and more forgiving than trying to encode
  fuzzy matching in SQL; revisit with full-text/trigram search if volumes demand it (§12).
- This runs inside the existing chat WebSocket loop as a tool-use round-trip: the model may call the
  tool, receive rows, then stream its answer. No new REST route — the capability is agent-side.
- The tool is strictly read-only (no writes, no orders). Conversational stock edits / mandate
  creation are intentionally left to the dedicated NL flows (§5.1–5.3).

### 8.3 LLM reliability, cost & evaluation

Nearly every user action routes through the LLM (extraction, chat lookup, product selection,
fallback), so treat the model as a first-class operational dependency, not glue.

**Failure handling.** Every LLM call has a timeout, a bounded retry (once, on transient
errors/timeouts), and a **clean user-facing failure** — extraction returns a "couldn't read that,
try rephrasing" rather than a 500, and a failed product-selection **flags the line item** instead of
dropping it. No LLM failure should silently corrupt data (the confirm-before-commit gate already
ensures nothing persists from a bad parse).

**Cost guard (recommended).**
- **Model tiering** — use a small/fast model (Haiku-class) for the high-volume, low-stakes calls
  (extraction, chat lookup, product selection); reserve a larger model only where judgement matters
  (fallback). This is open decision §12 (extraction model).
- **Prompt caching** — the extraction/chat system prompts and JSON schemas are large and static;
  cache them (the Phase-1 system prompt already does this) so repeated calls are cheap.
- **Per-user budget/throttle** — track tokens/requests per user; enforce a daily cap on LLM-backed
  endpoints with a friendly error, and a global circuit-breaker if spend crosses a threshold. Pairs
  with the login/abuse throttling in §3.6.
- **Observability** — log tokens + latency + model per call so cost is measurable, not a surprise.

**Evaluation set (recommended, ship-blocking for trust).** LLM output is non-deterministic and a
prompt tweak can silently regress behavior, so keep a **checked-in golden eval set** — a few dozen
input→expected cases per target:
- extraction: sentences → expected structured JSON (assert key fields, e.g. *"low on eggs"* →
  `current_stock ≤ trigger`; *"a dozen"* → `12`);
- chat lookup: queries → expected matched item / "not found";
- product selection: candidate lists + grant → expected pick / flag.
Run it as a scripted regression (CI or pre-merge), scoring by field-level/semantic match with a
tolerance, and **gate prompt/model changes on the pass rate**. Start ~30–50 cases and grow it from
real misses.

---

## 9. Non-goals (for this PRD)

- **Autonomous order placement / checkout.** In scope, the agent builds the cart and the **user
  places the order manually** (§5.9). The app calling a provider's checkout API to buy on the user's
  behalf is a **stretch goal (§9.1)**, not near-term.
- **Household / shared accounts.** Single user per account only; no membership, roles, or invites.
- ~~**Third-party / social login (OAuth)**~~ — **no longer a non-goal; Google sign-in is
  implemented** (§3.7). **MFA and magic links remain out of scope.**
- **Complex mandate conditions** (multi-item combinations, expiry dates, seasonal rules) beyond
  simple threshold triggers in the first cut.
- **Partial-fulfillment / delivery-fee edge-case handling** beyond routing it to the LLM fallback.
- **Bulk inventory import.** Deferred. Items are added one at a time (form or NL), which keeps the
  app functional at onboarding; a user typing *"add all these to my grocery list: …"* and the chat
  bulk-creating items is the intended future path (it needs chat to gain write access, currently
  read-only per §5.8/§8.2) — not required now.
- **Data export.** Account deletion is in scope (§3.6); exporting a user's data is not.
- **Native mobile app.** Deferred — the app is web-first for now; a phone-app port (the natural home
  for the in-store chat-lookup use case) is a later phase, not this PRD.

### 9.1 Stretch goal — autonomous ordering

Once the assisted flow is proven, the natural next step is letting the agent **place the order
itself** instead of stopping at a proposed cart. This is deliberately deferred; the design already
leaves room for it:
- The `ShoppingProvider` interface reserves a `placeOrder` method (unused in scope).
- The `orders` status lifecycle can gain an `auto_placed` state distinct from user-`placed`.
- The §5.11 safeguards (verified email, an explicit opt-in toggle default **off**, per-run spend
  cap, budget enforcement, idempotent placement, full logging) exist specifically for this mode.
- Autonomy settings would gain a level that permits placement without a confirmation step.

Nothing in the assisted scope should preclude this — it should be an additive capability, not a
rewrite. Until then, the app never completes a purchase on the user's behalf.

---

## 10. Build Order (MVP → full)

Extends the `IDEAS.md` build order with the auth layer sequenced first, since everything else
depends on a user identity.

1. **Auth foundation** — `users` + `auth_sessions` tables, signup/login/logout/me, JWT cookie,
   Fastify auth plugin, WS handshake auth. Add `user_id` to `sessions`; scope existing chat routes.
   Include **account lifecycle** (§3.6): `PATCH /auth/me`, change-password, `DELETE /auth/me`, and
   **login throttling/lockout**.
2. **Frontend auth** — signup/login/logout UI, auth guard, credentialed API/WS calls, plus an
   account-settings screen (profile / password / delete).
3. **Inventory model + precise edits** — `inventory_items` + `inventory_events`, the structured
   `GET/POST/PATCH/DELETE /inventory` and `/inventory/{id}/adjust` routes, user-scoped. This is the
   deterministic substrate the NL layer writes through. No scheduling yet.
4. **NL extraction layer** (§8.1) — the agent-layer functions that parse free-form text into
   structured JSON via tool use / structured output, with zod validation. Build all three targets
   (inventory stock updates, item definitions, mandate/grant), the **golden eval set + cost/latency
   logging** (§8.3), and unit-test against fixture sentences — threshold-aware stock mapping
   ("low"→below trigger) and unit normalization ("a dozen"→12) — before wiring to routes.
5. **NL inventory** — `POST /inventory/parse` → confirm (per-item old→new diff) → `POST
   /inventory/updates` (§5.1). The everyday path; makes mandates fireable from a weekly sentence.
   (At this point the app is already usable as a **track-only inventory** for any category — no
   mandates/schedule required.)
6. **Chat inventory lookup** (§8.2) — give the existing chat agent a read-only inventory-lookup
   tool so it can answer *"do I own / am I low on X?"* with fuzzy matching. Depends only on the
   inventory model (step 3); can ship before any reorder machinery.
7. **Grant CRUD** — the `grants` table + `/grants` routes (§5.3). `POST /grants/parse` returns a
   draft; `POST /grants` commits the confirmed object; PATCH/GET/DELETE operate on parsed fields.
   Reusable constraint sets a mandate can point at.
8. **Mandate CRUD** — `/mandates/parse` → confirm → `POST /mandates` (a sentence may yield a grant +
   mandate), tied to inventory items, referencing a grant via `grant_id`. Textarea UI, not a form.
9. **Budget CRUD** — the `budgets` table + `/budgets` routes (§5.4), form input, plus the computed
   `/budgets/{id}/status` (spend-so-far from placed orders in the current period).
10. **ShoppingProvider interface + mock impl** (search + price/availability only; no checkout).
    Then a real provider for price/availability lookups.
11. **"Run a check now" + product matching** — assembles a **proposed order (cart)** from firing
    mandates, selecting a product per mandate from provider candidates and remembering it
    (`preferred_product`), low-confidence → flag (§5.10); dry-run first (mock returning realistic
    ambiguity). No checkout.
12. **Cart review, manual placement & restock-on-place** — `orders` table + `/orders` routes (§5.9):
    review, adjust, `place` (marks placed **and sets each ordered item to its `restock_level`**, so
    it isn't re-proposed), `dismiss`. This is the near-term **terminal step**.
13. **Reorder schedule config** — `user_settings` schedule fields + `/schedule` routes (§5.5): the
    scheduling module UI (recurrence, start time, window length default 12h, timezone).
14. **Reorder-window engine** — `reorder_windows` table + the lifecycle (§5.5): open a window at the
    scheduled local time and run the initial check; auto-trigger a re-run from `/inventory/updates`
    while a window is open (append to the same cart); send the expiry reminder + auto-close at
    `closes_at`. Start as an in-process cron sweep.
15. **LLM fallback decision** (grant miss **or** budget overrun) + per-user autonomy settings; the
    fallback receives budget headroom + time-left as context and shapes what goes in the cart.
16. **Notifications** (in-app feed, then email) — the "cart ready to place" open notice and the
    window-expiry reminder.

**Stretch (§9.1): autonomous order placement.** Add a `placeOrder` path to `ShoppingProvider` and
real checkout with the §5.11 safeguards (verified email, ordering toggle default off, per-run spend
cap, budget enforcement, idempotency). Not part of the near-term scope.

---

## 11. Acceptance Criteria

Auth / accounts:

> **Status:** implemented (including §3.7 Google OAuth). The guard-layer criteria below are covered
> by `node-server/npm test`; the criteria that require a database round-trip — signup, login,
> refresh rotation, the OAuth callback — are implemented but **not yet verified against a live
> Postgres**, and the migration has not been applied anywhere.

- [ ] A user can sign up, log in, refresh, and log out; `GET /auth/me` reflects state.
- [ ] A user can sign in with Google; a returning Google user resolves to the same account via
      `oauth_accounts.provider_account_id`, not by email.
- [ ] A Google identity whose **verified** email matches an existing password account links to it;
      an **unverified** match is refused rather than linked (account-takeover guard).
- [ ] A Google ID token is rejected unless its signature, issuer **and audience** all check out.
- [ ] A Google-only account can set a password via `POST /auth/change-password` without supplying a
      current one, and can delete itself with a typed confirmation instead of a password.
- [ ] Replaying an already-rotated refresh token revokes every session for that user.
- [ ] Passwords are stored only as argon2id/bcrypt hashes; plaintext never logged.
- [ ] Login returns an identical 401 for unknown-email and wrong-password (no enumeration).
- [ ] Access token is an httpOnly + Secure + SameSite cookie; refresh tokens are revocable via
      `auth_sessions`; logout revokes.
- [ ] Every protected REST route returns 401 unauthenticated; every `{id}` route returns 404 for
      another user's resource.
- [ ] WebSocket upgrade is rejected when unauthenticated; each WS message re-checks chat-session
      ownership.
- [ ] A user can update profile (`PATCH /auth/me`), change password (revoking other sessions), and
      delete their account (`DELETE /auth/me`) — the delete cascades all their data and revokes
      sessions. Repeated failed logins are throttled/locked out.
- [ ] Mutating REST routes are CSRF-protected (`SameSite` cookie **plus** a CSRF token and an
      Origin/Referer check); a cross-site page cannot trigger an authenticated mutation or open an
      authenticated WebSocket.

Domain:
- [ ] Categories are user-defined and unrestricted (groceries, office supplies, books, …); an item
      can exist with no mandate/par/schedule (**track-only** mode) and the app is fully usable that
      way — nothing forces a user into the reorder flow.
- [ ] The chat assistant answers *"do I own / am I low on X?"* from the asking user's own inventory
      via a read-only lookup tool, with fuzzy matching (*"LOTR special edition"* → the stored row)
      and a plain "not tracked" when nothing matches; it never reads another user's data or writes.
- [ ] Inventory stock updates, mandates, and grants are entered via a free-text textarea; only
      account creation (and budgets) use a structured form.
- [ ] `POST /inventory/parse` turns a sentence like *"low on eggs and milk, out of bread"* into a
      per-item `current_stock` draft where the numbers are **threshold-aware** (e.g. "low" lands
      at/below the item's mandate trigger so that mandate fires); the draft persists nothing and is
      shown as an old→new diff. `POST /inventory/updates` commits only the confirmed changes and
      writes `inventory_events` with the original phrase as `reason`.
- [ ] A stock-update sentence updates multiple items at once; an item the LLM can't resolve is
      surfaced for the user to add, never silently created.
- [ ] Quantity expressions are normalized to the item's base unit on the way in (*"a dozen"* → `12`,
      *"a loaf"* → `1`), for both stock updates and a mandate's purchase quantity.
- [ ] `POST /mandates/parse` and `POST /grants/parse` return an LLM-parsed draft that passes the
      zod schema, persisting nothing; the create routes persist only the user-confirmed draft
      (confirm-before-commit). A sentence carrying both a trigger and a constraint yields a grant +
      a mandate referencing it.
- [ ] An unparseable or low-confidence input returns a 4xx with the partial parse and is never
      surfaced as a final, committed value.
- [ ] Inventory (NL + precise `/adjust`), grant, and mandate CRUD work end-to-end, fully
      user-scoped.
- [ ] A grant can be referenced by a mandate; deleting a grant nulls the reference on its mandates
      rather than deleting them.
- [ ] Budget CRUD works; `/budgets/{id}/status` returns spend-so-far computed from **placed** orders
      in the current period (not a stored running total), plus remaining headroom and time left.
- [ ] A per-item grant miss with ample budget headroom results in the item being **included in the
      cart** within the user's autonomy; the same miss with little/no headroom leaves it out/flagged.
- [ ] Line items are never added that push the cart total past a budget's hard limit unless autonomy
      permits it; the per-item grant remains a soft constraint.
- [ ] "Run a check now" produces a persisted `shopping_run` + `mandate_evaluations`, and (if
      anything fired) a **`proposed` order/cart** — with no checkout side effect in any mode.
- [ ] The reorder schedule is configurable (recurrence, start time, window length default 12h,
      timezone); at the scheduled local time a `reorder_window` opens, the initial run assembles a
      cart, and a "cart ready" notification fires.
- [ ] Committing an inventory update **while a window is open** auto-triggers a re-run that appends
      newly-passing items to the **same** cart (no duplicate lines, no second cart); the same update
      outside any open window does not.
- [ ] Placing the cart closes the window (`placed`); if unplaced by `closes_at`, a **second reminder
      notification** is sent, the window becomes `expired`, and further inventory updates no longer
      auto-trigger runs while the cart remains placeable/dismissable.
- [ ] Concurrent runs against the same window's cart are serialized and appends are idempotent
      (keyed by `(cart, mandate)`): overlapping re-runs / a manual run during an auto re-run produce
      no duplicate lines and no corrupted total, and a run against an already-`placed`/`expired`
      window is a no-op.
- [ ] `ShoppingProvider` interface exists with a working mock implementation (search +
      price/availability); it exposes no checkout in scope.
- [ ] Product matching selects one product per mandate from provider candidates within the grant,
      records the choice on `preferred_product` (reused next run), and **flags** rather than guesses
      when no candidate clearly fits.
- [ ] Placing a cart sets each ordered item's `current_stock` to its `restock_level`, so the item is
      **not re-proposed** on the next window; a short/failed delivery is corrected by a normal NL
      stock update.
- [ ] A golden eval set (§8.3) covers extraction, chat lookup, and product selection, runs as a
      scripted regression, and gates prompt/model changes; LLM calls log tokens/latency/model and are
      throttled per user.
- [ ] LLM fallback returns only actions from the fixed set and never exceeds the user's autonomy
      ceiling; decisions are logged and shown on the cart.
- [ ] **The app never completes a checkout.** A cart can be reviewed, adjusted, and marked `placed`
      or `dismissed` by the user; `place` records the user's action and does not call a provider
      checkout API. (The §5.11 autonomous-placement safeguards are validated only if/when §9.1 is
      built.)

Migrations / compatibility:
- [ ] New migrations add `users`, `auth_sessions`, `user_id` on `sessions`, and the domain tables;
      the existing Phase 1 chat flow still works for an authenticated user.

---

## 12. Open Decisions (confirm at implementation start)

1. ~~**Password hashing**~~ — **resolved:** argon2id via `@node-rs/argon2` (prebuilt binaries, so no
   node-gyp toolchain), library defaults m=19456, t=2, p=1.
2. ~~**Access-token transport**~~ — **resolved:** httpOnly cookie, for XSS resistance and automatic
   WS-upgrade delivery. Consequence: the API must share a registrable domain with the frontend
   (`api.axoliz.ai`). Revisit if a mobile client without cookie support appears.
3. ~~**Refresh strategy**~~ — **resolved:** server-side `auth_sessions`, with rotation on every
   refresh and family-wide revocation on replay.
4. **Reorder-window engine substrate** (§8): in-process `node-cron` sweep for opening windows +
   firing reminders (fastest to build) vs Cloud Scheduler + a job endpoint / per-window delayed
   Cloud Task for the reminder (scales, survives instance churn). Start in-process, plan the
   graduation. Timezone/DST handling (evaluate schedule in the user's `timezone`) is part of this.
5. **First shopping provider**: which real API to target, and whether it exposes usable
   search/pricing (checkout is not needed in scope) — or stay on the mock until one is chosen.
6. **Email verification & password reset transport**: which mail provider, and whether verification
   gates signup or only the autonomous stretch goal (assumed: it's not required for the assisted
   flow, since the user checks out themselves). **Still open and now more pressing:** Google
   sign-in sets `email_verified` for free, but a password-only account currently has no way to
   verify an address or reset a forgotten password.
7. **Extraction model**: which Claude model does the NL→JSON parsing, and whether it's the same
   model as the chat assistant. A smaller/faster model may suffice for structured extraction.
8. **Budget period reset**: calendar-month (resets on the 1st) vs rolling 30-day vs configurable
   per budget. Calendar-month is the assumed default.
9. **Budget category granularity**: account-wide + single-level category keyed off
   `inventory_items.category` (recommended, assumed above) vs nested/hierarchical budgets
   (groceries → dairy → …). Single-level covers the "$500 groceries + $5 eggs" case.
10. **Budget input method**: a simple form (recommended, per the §5.0 bounded-fields principle)
    vs the same NL textarea path as mandates/grants. The extractor can emit a budget either way.
11. **Budget-breach behavior**: route every would-be breach to the LLM fallback so the
    headroom/tolerance logic applies (recommended), vs a hard block that never consults the LLM.
    Recommendation: fallback for *soft* per-item grant misses within budget headroom; hard block
    only when the user's autonomy forbids budget overruns.
12. **Pending-cart accounting**: does budget headroom count only `placed` spend (assumed), or also
    subtract still-`proposed` carts the user hasn't placed yet? Counting pending carts avoids
    over-proposing across back-to-back runs but risks under-proposing if the user dismisses them.
13. **Manual-placement integration**: how the user actually checks out from a proposed cart — a
    deep link into the provider's app/site with the items pre-loaded (best UX, provider-dependent),
    a copyable shopping list, or just a reviewed cart the user recreates in the provider. Drives how
    much the `ShoppingProvider` cart-assembly step needs to expose.
14. **Qualitative→quantitative anchor for stock**: what "low"/"plenty" map to — relative to the
    item's **mandate trigger threshold** (recommended, so "low" reliably fires the reorder) vs its
    `par_level` vs a fixed fraction. And behavior for an item with **no mandate/par** yet (assumed:
    "low"/"out" still set a small/zero count, "plenty" a nominal restock, all shown in the confirm
    diff for correction).
15. **New-item field inference**: when a stock sentence names an untracked item, how much to infer
    (unit, category, par_level) vs ask. Assumed: infer sensible defaults and expose them as editable
    fields in the confirm step rather than blocking.
16. **Re-run item removal**: a mid-window re-run **appends** newly-passing items (assumed). Should a
    re-run also **remove** a line if the user restocked that item during the window (stock back above
    trigger)? Assumed no — removal stays a manual cart edit — but auto-removing avoids buying
    something no longer needed.
17. **"Run now" with no open window**: does the manual check open an ad-hoc window (enabling the
    same re-run/reminder loop) or just produce a one-off cart with no window semantics? Assumed:
    one-off cart, no reminder.
18. **Re-run notification chattiness**: only the window open + expiry reminder are push-notified
    (assumed), with mid-window appends reflected as a live cart badge — vs a (throttled) "items
    added" nudge on each re-run.
19. **Window length & multiple schedules**: 12h is the assumed default window; confirm the min/max
    bounds, and whether a user may configure more than one reorder schedule (assumed: one per user
    for now).
20. **Chat inventory-lookup matching**: LLM fuzzy-matching over a broad keyword/category fetch
    (assumed, §8.2 — simplest, most forgiving) vs SQL full-text / `pg_trgm` trigram search. Start
    with the former; add DB-side search if catalogs get large enough that fetching candidates is
    costly.
21. **`attributes` shape**: fully freeform per-item `jsonb` (assumed) vs light per-category
    conventions (e.g. books → {author, edition, isbn}) to make chat matching and any future
    UI/filtering more predictable.
22. **Product-candidate ranking**: rank provider search results LLM-side over a raw candidate list
    (assumed, §5.10 — flexible, handles grant nuances) vs provider-side/deterministic pre-ranking
    with the LLM only breaking ties (cheaper, more predictable). Start LLM-side; revisit on cost.
23. **`restock_level` fallback**: when an item has no `restock_level` set, what does placing restock
    it to — `par_level`, the purchased quantity, or leave stock unchanged and rely on a manual
    update? Assumed: fall back to `par_level`, else the ordered quantity.

**Decisions now locked** (were open in earlier drafts; confirmed by the maintainer): mandates/grants
use **confirm-before-commit** — the parsed draft is shown for approval/edit before persisting, so the
`/…/parse` preview routes (§7) are part of the standard flow, not optional; and the **stored trigger
is a structured `{op, field, value}` form** that the scheduler evaluates deterministically, with the
free text used only as the LLM's input. See the §1 locked-decisions table.
