# Salamander — Roadmap

This is the phased delivery plan for turning the shipped Phase 1 chat app into the
inventory-aware shopping agent specified in [`PRD.md`](PRD.md). The PRD is the authority on
*what* and *why*; this file is the authority on *what ships in which phase, and when*.

- Phases here are defined by the maintainer and may regroup or resequence the PRD's §10 build
  order. Where a phase diverges from a PRD decision, that divergence is called out explicitly.
- This is a living document — later phases are added as they are decided.

---

## Phase 1 — Foundation: Accounts + Inventory (with NL updates)

**Timeline: 6 weeks.** Maps to PRD build-order steps 1, 2, 3, and the stock-update slice of 4–5.

Goal: a real multi-user app where each user owns a private inventory, can manage it directly, and
can update stock levels by typing plain sentences that the LLM parses and applies live.

### a) Accounts, authentication & sessions — full stack ✅ *implemented*
_PRD §3 (incl. §3.7), build steps 1–2._

> **Delivered with Google OAuth in addition to email + password** — overriding PRD §1's
> password-only lock and §9's "OAuth is a non-goal." Caveat: flows requiring a database round-trip
> are implemented but not yet verified against a live Postgres, and no account-settings UI exists.
> See `ARCHITECTURE.md` → Known gaps.

- **Backend:** `users` + `oauth_accounts` + `auth_sessions` tables; argon2id password hashing;
  **Google OAuth (OIDC authorization-code flow with PKCE)**; JWT access token in an
  httpOnly / Secure / SameSite cookie; refresh with rotation, server-side revocation and replay
  detection; Fastify auth `preHandler` plugin; **authentication at the WebSocket handshake**;
  CSRF defense (SameSite cookie + double-submit token + Origin check); login throttling; account
  lifecycle (`PATCH /auth/me`, change-password with other-session revocation, `DELETE /auth/me`
  hard-delete cascade).
- **Schema impact:** `sessions` gains `user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
  `POST /sessions`, history, and the WS handler become user-scoped with ownership checks.
- **Frontend:** signup / login / logout screens with a "Continue with Google" button, auth guard,
  all API and WS calls credentialed (`credentials: 'include'`) with single-flight token refresh.
  **The account-settings screen (profile / password / delete) is still outstanding** — the routes
  exist, nothing calls them.

### b) Inventory creation — CRUD, full stack
_PRD §5.1 (precise path), build step 3._

- `inventory_items` + `inventory_events` tables; user-scoped `GET/POST/PATCH/DELETE /inventory` and
  `POST /inventory/{id}/adjust` (set absolute / increment / decrement).
- Frontend inventory list + create/edit UI.
- Categories are arbitrary and user-defined; `par_level` / mandate are optional. This delivers
  **track-only mode** on its own — a usable inventory catalog with no reorder machinery.

### c) Inventory updation — LLM parse → live update
_PRD §5.1 / §8.1, **stock-update extraction target only** (item-definition and mandate/grant
extraction are later phases)._

- Agent-layer NL extraction function for stock updates: tool-use structured output, validated with
  the same zod schema, **threshold-aware** number mapping (*"low"* → at/below the reorder threshold,
  *"out"* → 0, *"plenty"* → at/above par) and unit normalization (*"a dozen"* → 12).
- **Flow (one step, not a chat thread):**
  `textarea → LLM parse → DTO → DB write → WebSocket event → UI live-refresh`.
- A **golden eval set** + token/latency/model logging for this one extractor, so prompt changes are
  regression-checked from the start.

### Phase 1 decisions

- **Direct commit (overrides the PRD's locked confirm-before-commit for stock updates).** In this
  phase the NL stock update writes straight to the DB and pushes to the UI — there is no
  confirm/diff gate. This is intentional and low-risk here because no mandates, orders, or spending
  exist yet, so a misread is corrected with a follow-up NL update or a precise `/inventory/{id}/adjust`.
  The confirm-before-commit gate is expected to return when mandates land (they drive real spending).
- **User-scoped WebSocket push.** Today's socket is per-chat-session; Phase 1 adds a lightweight
  per-user channel so an inventory update can push its delta to the user's open UI. This is designed
  into the auth/WS layer up front rather than bolted on later.

### Phase 1 timeline breakdown

| Weeks | Work |
|---|---|
| 1 – 2.5 | Auth & accounts, full stack (JWT/cookies, CSRF, WS-handshake auth, throttling, lifecycle, frontend flows, `user_id` on `sessions`) |
| 2.5 – 3.5 | Inventory CRUD, full stack (track-only mode usable here) |
| 3.5 – 6 | NL stock-update extractor (direct commit) → DB → WS push → live UI refresh; eval set + cost logging |

Auth is the long pole — it is security-sensitive and gates everything else. The plan could compress
to ~4–5 weeks if the eval set stays minimal and account-lifecycle is trimmed; 6 weeks holds time to
do the CSRF and WS-authentication work properly.

---

## Phase 2 — Chat Lookup + Constraint Objects (Grants, Mandates, Budgets)

**Timeline: 6 weeks.** Maps to PRD build-order steps 6, 7, 8, 9, plus the remaining NL-extraction
targets from step 4.

Goal: the chat assistant becomes inventory-aware, and the user can define the full constraint layer
— what to reorder (mandates), under what per-purchase limits (grants), and within what per-period
category ceilings (budgets).

### a) Chat inventory lookup + remaining inventory operations
_PRD §5.8 / §8.2 (build step 6), plus the inventory NL work deferred from Phase 1._

- **Chat inventory-lookup tool:** give the existing streaming chat agent a **read-only**
  inventory-lookup tool (runs inside the chat WebSocket loop as a tool-use round-trip). It answers
  *"do I own / am I low on X?"* from the **asking user's own** inventory only (`user_id` bound
  server-side, never from the model), with fuzzy/semantic matching (*"LOTR special edition"* → the
  stored illustrated edition) and a plain "not tracked" when nothing matches. Read-only: no writes,
  no orders.
- **Remaining inventory NL operations (pending from Phase 1):** the **item-definition** extraction
  target (*"start tracking eggs, a dozen is normal"* → a new `inventory_item` with inferred
  `category` / `unit` / `par_level` / `restock_level`), completing the inventory side of the NL
  extraction layer (§8.1) begun with stock updates in Phase 1.

### b) Grants, Mandates & Budgets — full stack
_PRD §5.2 / §5.3 / §5.4 (build steps 7, 8, 9)._

- **Grants** (§5.3): reusable, user-owned per-purchase constraint sets (`max_price`,
  `preferred_vendor`, `brand`, `max_quantity`, `price_tolerance_pct`, `notes`). NL parse
  (`POST /grants/parse`) → commit (`POST /grants`); GET/PATCH/DELETE on parsed fields. Deleting a
  grant nulls `mandates.grant_id`, never deletes the mandate.
- **Mandates** (§5.2): a trigger condition (structured `{op, field, value}`) + shopping action tied
  to an inventory item, optionally referencing a grant. NL parse (`POST /mandates/parse`) where one
  sentence may yield both a grant and the mandate that references it; commit persists grant-first,
  then mandate. Viewable / editable / enable-disable-able.
- **Budgets** (§5.4): aggregate, per-period, per-category spend ceilings. **Form input** (not NL),
  per the PRD's bounded-fields principle. CRUD + `GET /budgets/{id}/status`, where spend-so-far is
  **computed from placed orders** in the current period (not stored). No placed orders exist until
  Phase 3, so status reads $0 spent / full headroom until then.
- **Frontend:** textarea-driven create flows for grants and mandates, a form for budgets, and
  list/edit/delete UIs for all three.

### Phase 2 decisions

- **Confirm-before-commit applies to mandates and grants** (per the PRD's locked decision). Unlike
  the Phase 1 stock-update override, these objects drive real spending, so the parsed draft is shown
  for review/edit before it is persisted. This is the return of the confirm gate anticipated in the
  Phase 1 notes.
- **NL extraction layer is now complete** across all §8.1 targets: stock updates (Phase 1), item
  definitions and mandate/grant (Phase 2). The golden eval set grows to cover the new targets.
- **No reorder machinery yet.** Mandates, grants, and budgets are *defined* in this phase but nothing
  evaluates or fires them — the scheduler, windows, product matching, carts, and fallback are Phase 3+.

### Phase 2 timeline breakdown

| Weeks | Work |
|---|---|
| 1 – 1.5 | Chat inventory-lookup tool (read-only, fuzzy match) in the chat WS loop |
| 1.5 – 2.5 | Item-definition NL extraction (remaining Phase 1 inventory op) |
| 2.5 – 4 | Grants + Mandates: schema, NL parse → confirm → commit, CRUD, frontend |
| 4 – 5.5 | Budgets: schema, form CRUD, computed `/status`, frontend |
| 5.5 – 6 | Eval-set extension for new targets; integration + polish |

---

## Phase 3 — On-Demand Carts (Provider + Product Matching + Manual Placement)

**Timeline: 5 weeks.** Maps to PRD build-order steps 10–12. This is the first half of the reorder
engine, and it stands on its own: by the end, a user can hit **"run a check now,"** get a cart of
real products assembled from firing mandates, review it, place it, and have stock restocked — with
**no scheduling and no automation**. Step 12 is the PRD's designated "near-term terminal step," so
this phase is a complete, shippable product even if Phase 4 never lands.

Goal: on demand, the agent evaluates mandates, resolves real products within grants, builds a cart,
and lets the user review and place it. **The user always does the actual checkout — the app never
completes a purchase.**

### Scope (PRD §5.9, §5.10)

- **ShoppingProvider interface + mock** (step 10, §5.10): abstract `search` + `price/availability`
  behind an internal interface; a mock/sandbox implementation returns **realistic ambiguity** so
  product matching is exercised before a real API is wired. A `placeOrder` method is reserved but
  unused (checkout is out of scope). Choosing/adding a real provider is an open decision (§12.5).
- **"Run a check now" + product matching** (step 11, §5.10): evaluate firing mandates, select one
  product per mandate from provider candidates within its grant, remember the pick
  (`preferred_product`) to stabilize and cheapen future runs, and **flag rather than guess** on
  low confidence. Produces persisted `shopping_runs` + `mandate_evaluations` and a `proposed` cart;
  no checkout side effect. The golden eval set (§8.3) gains product-selection cases here.
- **Cart review, manual placement & restock-on-place** (step 12, §5.9): the `orders` table +
  `/orders` routes — review, adjust quantities, remove lines, then `place` or `dismiss`. Placing
  marks the cart `placed` and **restocks each ordered item to its `restock_level`** so it isn't
  re-proposed. Placing records the user's action; it does **not** call a checkout API. It also makes
  budget spend-so-far real (Phase 2's `/budgets/{id}/status` now counts placed orders).

### Phase 3 decisions

- **This is a terminal, shippable state on its own.** Manual "run a check now" → review → place →
  restock is a full loop without any of the Phase 4 automation. The app builds carts and notifies;
  the user checks out. It never calls a provider checkout API in any mode.
- **A "run now" with no open window produces a one-off cart** (no window semantics) until the
  window engine arrives in Phase 4 (§12.17 open decision).
- **§12 open decisions resolved here:** provider choice (§12.5), candidate ranking (§12.22),
  manual-placement integration — deep link vs. list vs. recreate (§12.13), `restock_level` fallback
  (§12.23). Confirm at the start of the phase.

### Phase 3 timeline breakdown

| Weeks | Work |
|---|---|
| 1 | ShoppingProvider interface + mock (realistic ambiguity) |
| 1 – 3 | "Run a check now" + product matching (`preferred_product`, flag-don't-guess) + eval cases |
| 3 – 4.5 | Cart review, manual placement, restock-on-place (`orders` + `/orders` + UI) |
| 4.5 – 5 | Integration + polish; wire budget `/status` to placed-order spend |

---

## Phase 4 — Automation & Fallback (Schedule + Windows + LLM Fallback + Notifications)

**Timeline: 6 weeks.** Maps to PRD build-order steps 13–16. This layers the automated control loop
on top of Phase 3's on-demand carts: instead of the user triggering every check, a schedule opens a
reorder window, runs the check automatically, re-runs on mid-window inventory updates, applies the
LLM fallback when grants/budgets can't be satisfied, and notifies the user.

Goal: at a scheduled time the agent opens a window, assembles a cart, and tells the user it's ready
to place — the hands-off version of Phase 3's manual flow. **The user still does the actual
checkout.**

### Scope (PRD §5.5, §5.6, §5.7)

- **Reorder schedule config** (step 13, §5.5): `user_settings` schedule fields + `/schedule` routes
  — recurrence, start time, window length (default 12h), timezone.
- **Reorder-window engine** (step 14, §5.5): the control loop. Open a window at the scheduled local
  time and run the initial check; an inventory update **while a window is open** auto-triggers a
  re-run that appends newly-passing items to the **same** cart; a reminder + auto-close fires at
  `closes_at`. Includes the correctness-critical work: **serialized per-window runs, idempotent line
  appends keyed by `(cart, mandate)`, a guarded close transition, and per-user-timezone/DST
  evaluation.** Starts as an in-process cron sweep (§12.4 open decision on the substrate). Note:
  placing a cart now also **closes the open window**, extending Phase 3's `place` action.
- **LLM fallback decision + autonomy** (step 15, §5.6): when a mandate fires but its grant can't be
  satisfied — or a candidate would breach a budget — the LLM chooses from a fixed action set
  (flag / include-within-tolerance / substitute / skip / drop), weighed against **budget headroom
  and time left in the period**, never exceeding the user's configured autonomy level. Decisions are
  logged and shown on the cart.
- **Notifications** (step 16, §5.7): in-app feed first, email as a fast follow — the "cart ready to
  place" notice at window open and the window-expiry reminder if the cart was never placed.

### Phase 4 decisions

- **Completes the assisted scope — the terminal state of this roadmap.** Automation shapes *what the
  proposed cart contains*; the user still confirms the real spend at checkout.
- **Safe to enable:** because nothing is auto-purchased, the worst case of a live window is a cart
  the user ignores past expiry — not an unwanted charge.
- **§12 open decisions resolved here:** window-engine substrate (§12.4), budget period reset
  (§12.8), pending-cart accounting (§12.12), budget-breach behavior (§12.11), re-run removal
  (§12.16), notification chattiness (§12.18), window length / multiple schedules (§12.19).

### Phase 4 timeline breakdown

| Weeks | Work |
|---|---|
| 1 | Reorder schedule config (`user_settings` + `/schedule` + UI) |
| 1 – 3 | Reorder-window engine (lifecycle, cron sweep, timezone, concurrency/idempotency) |
| 3 – 4.5 | LLM fallback decision + per-user autonomy settings |
| 4.5 – 6 | Notifications (in-app feed, then email) |

The window engine (weeks 1–3) is the single riskiest piece in the whole roadmap — the
concurrency/idempotency requirements (§5.5) are where correctness bugs hide. Budget it
conservatively.

---

## Stretch (beyond this roadmap) — Autonomous ordering

Explicitly a PRD non-goal / stretch (§9.1), not part of the three assisted phases above: letting the
agent **place the order itself** rather than stopping at a proposed cart. The design already leaves
room (a reserved `ShoppingProvider.placeOrder`, an `auto_placed` order state, the §5.11 safeguards —
verified email, an opt-in toggle default off, per-run spend cap, budget enforcement, idempotent
placement). Deferred until the assisted flow is proven; sequenced only if/when the maintainer calls
for it.

---

## Timeline summary

| Phase | Scope | Duration |
|---|---|---|
| 1 | Accounts/auth/sessions + inventory CRUD + NL stock updates (direct commit) | 6 weeks |
| 2 | Chat inventory lookup + item-definition NL + grants/mandates/budgets | 6 weeks |
| 3 | On-demand carts: provider, product matching, cart review + manual placement + restock | 5 weeks |
| 4 | Automation: schedule, reorder-window engine, LLM fallback, notifications | 6 weeks |
| **Total** | **Chat app → assisted shopping agent** | **~23 weeks (~5.75 months)** |
| Stretch | Autonomous ordering (§9.1) | not scheduled |

Estimates assume the security and concurrency work is done properly (auth in Phase 1, the window
engine in Phase 4 are the long poles). They can compress if eval sets stay minimal and some §12 open
decisions land on the simpler option. Phases 1–3 are each independently shippable; Phase 4 adds
automation on top of the Phase 3 on-demand flow.
