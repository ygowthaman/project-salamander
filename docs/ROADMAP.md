# Salamander — Roadmap

This is the phased delivery plan for building the inventory-aware shopping agent specified in
[`PRD.md`](PRD.md) on top of the existing backend foundation. The PRD is the authority on *what*
and *why*; this file is the authority on *what ships in which phase, and when*.

> **The chat app is to be removed — this has not happened yet.** Salamander is to have no
> conversational surface: the LLM becomes an interpreter that turns free text into DTOs the server
> commits (PRD §1). Nothing in this roadmap builds a chatbot, and the Phase 1 chat tables, routes,
> and UI get deleted **before Phase 1a begins** — see `ARCHITECTURE.md` → *Removing the chat app*
> for the checklist. Budget it as prerequisite work; it is not costed into any phase below.

- Phases here are defined by the maintainer and may regroup or resequence the PRD's §10 build
  order. Where a phase diverges from a PRD decision, that divergence is called out explicitly.
- This is a living document — later phases are added as they are decided.

---

## Phase 1 — Foundation: Accounts + Inventory (with NL updates)

**Timeline: 6 weeks.** Maps to PRD build-order steps 1, 2, 3, and the stock-update slice of 4–5.

Goal: a real multi-user app where each user owns a private inventory, can manage it directly, and
can update stock levels by typing plain sentences that the LLM parses and applies live.

### a) Accounts, authentication & sessions — full stack
_PRD §3, build steps 1–2._

- **Backend:** `users` + `auth_sessions` tables; argon2id password hashing; JWT access token in an
  httpOnly / Secure / SameSite cookie; refresh + server-side revocation; Fastify auth `preHandler`
  plugin; **authentication at the WebSocket handshake**; CSRF defense (SameSite cookie + CSRF token +
  Origin/Referer check); login throttling/lockout; account lifecycle (`PATCH /auth/me`,
  change-password with other-session revocation, `DELETE /auth/me` hard-delete cascade).
- **Schema impact:** the Phase 1 `sessions` and `messages` tables are **dropped** (PRD §3.5) — there
  is no chat session to scope to a user. The token-streaming WS handler is replaced by the per-user
  push channel below.
- **Frontend:** signup / login / logout screens, auth guard, account-settings screen (profile /
  password / delete), all API and WS calls credentialed (`credentials: 'include'`).

### b) Inventory creation — CRUD, full stack
_PRD §5.1 (precise path), build step 3._

- `inventory_items` + `inventory_events` tables; user-scoped `GET/POST/PATCH/DELETE /inventory` and
  `POST /inventory/{id}/adjust` (set absolute / increment / decrement).
- Frontend inventory list + create/edit UI.
- Categories are arbitrary and user-defined; `par_level` / mandate are optional. This delivers
  **track-only mode** on its own — a usable inventory catalog with no reorder machinery.

### c) Inventory updation — LLM interpret → live update
_PRD §5.1 / §8.1, **stock-update interpretation target only** (item-definition and mandate/grant
targets are later phases)._

- Agent-layer interpretation function for stock updates: tool-use structured output, validated with
  the same zod schema, **threshold-aware** number mapping (*"low"* → at/below the reorder threshold,
  *"out"* → 0, *"plenty"* → at/above par) and unit normalization (*"a dozen"* → 12).
- **Flow (one shot, no conversation):**
  `input box → LLM interpret → DTO → DB write → WebSocket push → UI live-refresh`.
- This phase establishes the pattern every later NL surface reuses, so get the layering right:
  prompt + schema in `src/agent/`, validation at the route, `user_id` bound server-side.
- A **golden eval set** + token/latency/model logging for this one interpreter, so prompt changes
  are regression-checked from the start.

### Phase 1 decisions

- **Direct commit for inventory** (PRD §5.0 — commit policy is chosen per module, and this is that
  choice for this one). The NL stock update writes straight to the DB and pushes to the UI; there is
  no confirm/diff gate. It is the everyday interaction, and a misread costs one correcting sentence
  or a precise `/inventory/{id}/adjust`. Doubly low-risk here because no mandates, orders, or
  spending exist yet. The confirm gate arrives in Phase 2 with mandates and grants, which do drive
  spending. Validation still gates every write — direct commit drops the human approval step, not
  the zod schema check.
- **User-scoped WebSocket push channel.** The chat socket is deleted; in its place Phase 1 stands up
  a per-user, server→client channel so an inventory write can push its delta to the open UI. The
  channel is derived server-side from the auth session, so it is designed into the auth/WS layer up
  front rather than bolted on later. It is best-effort: REST stays the source of truth, and a
  dropped socket means stale, not broken.
- **Chat removal is prerequisite work, not a phase item.** The `sessions`/`messages` tables, the
  streaming handler, the chat agent, and the chat UI are deleted before Phase 1a begins.

### Phase 1 timeline breakdown

| Weeks | Work |
|---|---|
| 1 – 2.5 | Auth & accounts, full stack (JWT/cookies, CSRF, WS-handshake auth, throttling, lifecycle, frontend flows) + the per-user push channel |
| 2.5 – 3.5 | Inventory CRUD, full stack (track-only mode usable here) |
| 3.5 – 6 | NL stock-update interpreter (direct commit) → DB → WS push → live UI refresh; eval set + cost logging |

Auth is the long pole — it is security-sensitive and gates everything else. The plan could compress
to ~4–5 weeks if the eval set stays minimal and account-lifecycle is trimmed; 6 weeks holds time to
do the CSRF and WS-authentication work properly.

---

## Phase 2 — NL Search + Constraint Objects (Grants, Mandates, Budgets)

**Timeline: 6 weeks.** Maps to PRD build-order steps 6, 7, 8, 9, plus the remaining
interpretation targets from step 4.

Goal: inventory becomes searchable in plain language, and the user can define the full constraint
layer — what to reorder (mandates), under what per-purchase limits (grants), and within what
per-period category ceilings (budgets).

### a) NL inventory search + remaining inventory operations
_PRD §5.8 / §8.2 (build step 6), plus the inventory NL work deferred from Phase 1._

- **NL inventory search:** a **read-only search box** — not a chat window. The user's question is
  interpreted into a query DTO, the backend fetches candidates from the **asking user's own**
  inventory (`user_id` bound server-side, never from the model) and returns them. **One LLM call,
  then a DB query** — fetched rows are never sent back to the model, so cost does not scale with
  catalog size. Fuzzy matching comes from the DTO expanding terms (*"LOTR"* →
  `["lord of the rings", "tolkien"]`) so SQL finds the stored illustrated edition; a plain "nothing
  tracked" when nothing matches. **The result is rows
  rendered in the normal inventory table**, plus a server-generated count line — not a composed
  answer, and nothing streams. Read-only: no writes, no orders.
- **Remaining inventory NL operations (pending from Phase 1):** the **item-definition**
  interpretation target (*"Add 1984 to my Books"*, *"start tracking eggs, a dozen is normal"* → a
  new `inventory_item` with inferred `category` / `unit` / `par_level` / `restock_level`),
  completing the inventory side of the interpretation layer (§8.1) begun with stock updates in
  Phase 1. Direct commit, like the stock-update path it joins.

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

- **Confirm-before-commit for mandates and grants** — the per-module commit choice (PRD §5.0) for
  these two. Unlike Phase 1's inventory writes, these objects drive real spending and a misread
  threshold is not self-evident until it buys the wrong thing, so the parsed draft is shown for
  review/edit before it is persisted. This is the confirm gate anticipated in the Phase 1 notes.
  Inventory keeps direct commit; the two patterns coexist, sharing one interpretation core.
- **The interpretation layer is now complete** across all §8.1 targets: stock updates (Phase 1),
  item definitions, search, and mandate/grant (Phase 2). The golden eval set grows to cover the new
  targets.
- **No reorder machinery yet.** Mandates, grants, and budgets are *defined* in this phase but nothing
  evaluates or fires them — the scheduler, windows, product matching, carts, and fallback are Phase 3+.

### Phase 2 timeline breakdown

| Weeks | Work |
|---|---|
| 1 – 1.5 | NL inventory search (read-only, fuzzy match) — interpret → query → rows |
| 1.5 – 2.5 | Item-definition interpretation (remaining Phase 1 inventory op) |
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
| 2 | NL inventory search + item-definition NL + grants/mandates/budgets | 6 weeks |
| 3 | On-demand carts: provider, product matching, cart review + manual placement + restock | 5 weeks |
| 4 | Automation: schedule, reorder-window engine, LLM fallback, notifications | 6 weeks |
| **Total** | **Foundation → assisted shopping agent** | **~23 weeks (~5.75 months)** |
| Stretch | Autonomous ordering (§9.1) | not scheduled |

Estimates assume the security and concurrency work is done properly (auth in Phase 1, the window
engine in Phase 4 are the long poles). They can compress if eval sets stay minimal and some §12 open
decisions land on the simpler option. Phases 1–3 are each independently shippable; Phase 4 adds
automation on top of the Phase 3 on-demand flow.
