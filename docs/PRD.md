# Salamander — Product Requirements

**Status:** draft, in progress. Sections are added module by module; anything not yet written here is undecided, not implied.

---

## 1. Introduction

Salamander is an **inventory management system for a household**. It keeps a running picture of what you own, how much of it is left, and what needs to be bought — and it builds up a spending record alongside that inventory, so the same system that knows you are low on eggs also knows what eggs have cost you this year.

The long-term direction is **autonomous shopping driven by inventory**: when stock runs low, the system assembles what needs buying without being asked. That is the destination, not the starting point. The core that has to be right first is the inventory itself — an accurate, low-friction record of what is in the house. Everything else is built on top of that record, and the shopping capability is only as good as the record underneath it.

### 1.1 What the product does

- **Inventory** — tracks items the household owns, their quantity or stock level, and what has run low. This is the core of the product; every other module reads from it or writes to it.
- **Budgeting** — spending limits and targets, tracked against what has actually been bought.
- **Bill capture** — the user uploads a screenshot or photo of a bill or receipt; the system reads it and records the purchase, updating inventory and spend together.
- **Statistics** — spend over time, sliced by item and by category: what a specific item has cost across the year, what a category is consuming per month, how that is trending.

### 1.2 The role of the LLM

The application connects to an LLM extensively, and the LLM's job is **interpretation** — turning unstructured input the user already has into the structured records the system stores.

Two kinds of input:

**Plain-text intent.** The user writes a normal sentence and the system works out what to do with the inventory:

- *"I am low on eggs"* → the existing eggs entry is marked low on stock.
- *"Add 1984 to books"* → a new item in the books category.
- *"Add Thriller record to my wishlist"* → a new wishlist entry, not an owned item.

The user is never asked to fill in a form to say this. They write it the way they would say it, and the system resolves it against what already exists — which item they mean, which category it belongs to, whether this is a new thing or an update to something already tracked.

**Bills and receipts.** The user uploads an image of a bill. The LLM reads it into plain structured text — line items, quantities, prices, date, merchant — which is then stored. This is what feeds both the spending record and the inventory update, from a source the user did not have to type.

---

## 2. Modules

### 2.1 Users

A **user** is one person with an account. The user record holds identity and profile only — it is who someone is and how they get in, not what they own. What is owned belongs to the household (§2.2).

**Identity.** A user is identified by their email address, which is unique among **active** accounts and treated case-insensitively (`Sam@example.com` and `sam@example.com` are the same account, and one cannot be registered while the other exists). A soft-deleted account releases its address for reuse — see §2.2.8. Every account has an internal id independent of the email, so changing the address does not change who the user is.

**Profile.** Alongside the email, a user carries:

- **Display name** — optional. Shown wherever a person needs naming in the UI. Populated automatically from Google when the account is created that way.
- **Avatar image** — optional, likewise populated from Google when available.
- **Email verified** — whether the address has been proven to belong to the user. Today this is only ever set by Google asserting it; there is no verification email of our own. *TBD: whether Salamander needs its own verification flow, and what — if anything — is gated on an unverified address.*
- **Created date.**

**Credentials are optional, and there may be more than one.** A user can have a password, a linked Google account, or both:

- Signing up with email and password creates an account with a password and no Google link.
- Signing in with Google for the first time creates an account with a Google link and **no password at all** — this is a normal, complete account, not a degraded one.
- Either kind of account can gain the other: a Google-only user can set a password, and a password user can link Google.

Nothing in the product should assume a user has a password. A password-less account must be able to do everything a password account can, including the destructive operations in §2.4.

**What a user can change about themselves.**

- **Display name** — freely.
- **Email address** — freely, provided the new address is not already taken. Changing it marks the address unverified again, because the new one has not been proven.
- **Password** — set it (if they have none) or change it (proving the current one first). Changing a password signs the user out everywhere except the device that made the change; see §2.4. A user who has forgotten their password resets it instead — §2.4.6.
- **Delete their account.** Deleting a user is a **soft delete** — the account is retired, but the record remains. It has to: inventory items record which member added them (§2.2.9), and hard-deleting the person would destroy or orphan that history for everyone else in the household. Because a password-less account has no password to re-enter as proof of intent, deletion requires an explicit typed confirmation instead. Deleting a *household* is the operation that genuinely destroys data, including its users. The exception to the soft delete is the **last admin** of a household: their account deletion takes the household and everyone left in it with them — see §2.2.8.

### 2.2 Households

A **household** is the thing that owns data. Inventory, wishlist, budgets, bills, statistics — none of them belong to a user. They belong to a household, and a user reaches them only through the household they are a member of.

**Every user always belongs to a household. There is no such thing as a user without one.** This is the single most important rule in this section, and everything below follows from it.

#### 2.2.1 Optional to the user, mandatory to the system

The household is a **product-level option and a system-level guarantee**, and those two facts are deliberately different.

- **What the user sees.** On reaching the product for the first time, they are shown a form to create a household — a name and an address. They can **skip** it. A user who skips never has to think about households at all; they just have their stuff.
- **What actually happens.** A household is created either way. When the user skips, the system creates one for them and names it from **the part of their email address before the `@`**. The user is not told this and does not see it.

The reason for the split is that the alternative — letting a user exist without a household — means every part of the system that reads data has to handle two ownership shapes, one for lone users and one for households. Guaranteeing the household always exists means there is exactly one way anything is owned, and the "single user" case is just a household with one member in it.

**The form is shown on first entry regardless of how the account was made.** Signing up with email and password and signing in with Google for the first time reach the same step: an account has just come into existence, and the household question is asked once, there. It is not a property of the password sign-up form, and a Google user is not quietly opted into skipping just because their route in had no form to hang it on.

**The one exception is a user who arrives by invitation** (§2.2.6). They are joining a household that already exists and were told which one before they accepted, so they are never asked to create one and never see this form.

Skipping is answering the question, not deferring it. A user who skips is not asked again on their next sign-in; the form remains reachable afterwards on their own initiative (§2.2.4).

**What triggers the form is account creation, not a first-login check.** Both ways in report whether the request created an account or merely signed an existing one in, and the household step follows the former. Signing in with Google for the tenth time is indistinguishable to the user from signing in with a password for the tenth time: nothing is asked.

This is deliberately not derived from `skipHousehold` (§2.2.3). That flag cannot carry it — a user who was asked and skipped and a user who was never asked both sit at `true`, so keying the form on it would either re-ask at every sign-in or never ask at all. The question is asked once, at the moment the account appears, and the flag records the answer.

#### 2.2.2 The relationship

A user points at a household. **Many users to one household**: a household can have many members, and a **user belongs to exactly one household at a time**. There is no state in which a user is in two households, and no state in which they are in none.

#### 2.2.3 The skip flag

The user record carries a **`skipHousehold` flag**. It records one thing: **whether the user skipped the household step and had one made for them, or actually chose to create one.**

- **`skipHousehold` is true** — they skipped. A household exists for them, silently, and they do not know about it.
- **`skipHousehold` is false** — they created a household deliberately and know they have one.

The flag exists because the *data* looks identical in both cases — there is a household row either way — but the *user's understanding* does not. Someone who skipped does not know they have a household, so the UI must not show them household features, member lists, or a household name they never chose. The flag is what lets the interface tell those two people apart.

Every route by which a user comes to be in a household sets it, and there are only four:

| How they got there | `skipHousehold` |
| --- | --- |
| Created a household when asked (§2.2.1) | `false` |
| Skipped when asked (§2.2.1) | `true` |
| Joined by invitation (§2.2.6) | `false` |
| Left or was removed, landing in a new household of their own (§2.2.10) | `true` |

#### 2.2.4 Creating a household later

A user who skipped can create a household at any time afterwards. They are shown **the same create form** they were originally offered, and from their point of view they are creating a household for the first time.

Internally, nothing is created. The household they already have is **updated in place** with the name and address they supply, and **`skipHousehold` is cleared to false** — they are no longer someone who skipped.

This matters because that existing household already owns everything the user has accumulated — their inventory, their spending history, all of it. Creating a genuinely new household here would mean moving all of that across, or worse, leaving it behind. Updating the row they already have means **enabling a household is a rename, never a migration**, and there is no moment at which a user's data has to be re-parented.

#### 2.2.5 Household record

A household holds:

- **Name** — **mandatory.** A household always has one. Chosen by the user if they created one; otherwise derived from their email address, taking everything before the `@`. Email is mandatory on every account, so this derivation always has an input — which is why it is the email and not the display name, which is optional and may be absent.
- **Address** — **optional**, supplied through the create form. A household with no address is a normal household, not an incomplete one, and nothing may require an address to be present in order to work.

#### 2.2.6 Household management and invitations

A household has a **management page**. This is where a member can see and administer the household, and where they invite other people into it.

**Inviting someone is an `admin` action** (§2.3). An admin enters the email address of the person they want to add. What happens next depends on whether that address already has an account — the two cases are genuinely different, because one person needs creating and the other needs moving.

**Inviting someone with no account: an emailed link.** Salamander sends an invitation to the address. Following the link takes the invited person to a sign-up page where **their email address and the household they are joining are already filled in and not theirs to choose** — the only thing they supply is a password. Accepting therefore creates their account and places them in the inviting household in one step.

This is the **one path by which a user does not get an auto-provisioned household of their own** (§2.2.1). An invited user joins an existing household directly, so no household is created for them and none is left behind.

**An invited member has `skipHousehold` set to false** (§2.2.3). The household was fixed before their account existed — it was named in the invitation they accepted — so there is nothing to skip and nothing to ask. They know they are in a household, which is precisely what the flag records. The same applies to someone who accepts an invitation from an existing account: whatever the flag was before, they are in a household they chose to join, and it is false afterwards.

**Acceptance is by password only.** An invited person cannot accept by signing in with Google; they set a password like any other password sign-up. They remain free to link Google afterwards (§2.1), but that is a later, separate act.

**The link expires 24 hours after it is sent, and it is single-use.** Acceptance consumes it: the moment the password is set, the link is spent. Whichever comes first — the 24 hours elapsing or the invitation being accepted — the link is dead afterwards, and anyone following it is shown a plain message saying it has expired. A fresh invitation is the only way forward. The link is what allows an account to be created at a known email address with a password the holder chooses, so it is a credential, and it is treated as one: short-lived, and good exactly once.

**Inviting someone who already has an account: an in-app notification, no email.** Nothing is emailed. The next time that person signs in, they see a **notification carrying the invitation**, which they can accept. Accepting moves them into the inviting household.

Two things follow from the fact that they already have a household (§2.2.2 — everyone does):

- **Accepting means leaving the household they were in**, with the consequences set out in §2.2.10. In particular, **they do not bring anything with them**: the items they own stay behind in the household they left.
- **The invitation is an offer, not an action taken on them.** It sits in their notifications until they accept it. Nothing about their account changes until they do.

Notifications are their own module and are not yet written; this flow depends on it.

*TBD: email delivery is not built.* The invitation flow for new users assumes Salamander can send email; the SMTP setup that makes that possible is deferred and will be specified separately. The existing-account flow does not need it.

*TBD: how an in-app invitation ages.* The 24-hour expiry above is stated for the emailed link. Whether a notification-borne invitation also expires — and whether a person who has not signed in for a week still finds it waiting — is unspecified.

#### 2.2.7 Roles

Members have roles. There are two: **admin** and **user**. Roles are specified in §2.3; where a rule in this section depends on a role, it is marked as such.

#### 2.2.8 Deletion

The two deletions are deliberately asymmetric.

**Deleting a user is a soft delete.** The account is retired and the person can no longer use it, but the record survives. It has to survive because inventory items carry attribution (§2.2.9): hard-deleting the member who added half the pantry would destroy or orphan that record for everyone still living there. The household outlives its members.

Precisely what a soft delete does:

- **The user record is retained, but only its name.** The household keeps a complete history of who added what: someone still living there can look at an item and see who put it on the list, even though that person no longer takes any part in the household. Displaying that name is the whole reason the record survives, and it is the only reason.
- **Their private items are deleted.** An item only they could see (§2.2.9) has no audience once they are gone — retaining it would preserve something nobody can read, attributed to someone who has left. Deletion here costs the household nothing, because to the household those items never existed.
- **Every means of signing in is destroyed.** The password is discarded, any linked provider account is unlinked, and all sessions are revoked. Retiring the account has to remove the ways back into it, not merely mark it — an intact provider link would let the same person sign in again and land on the retired record.
- **Their email address is released** and can be used to register again. The retired record does not keep it: the address is discarded outright, not held in reserve. Uniqueness (§2.1) therefore constrains active accounts only, and a released address is free the moment the deletion completes.

**A soft delete is irreversible. There is no recovery path.** The account cannot be restored, reinstated, or reclaimed, and Salamander offers no undo window. What survives is a name attached to past entries — not an account in any suspended state.

Registering again with a released address produces a **new account**, not the old one revived. It has its own identity, its own household (§2.2.1), and no connection to the attribution the previous record still carries. Two people sharing an email address over time are two unrelated users, and the product never claims otherwise.

**Deleting a household is a hard delete, and it is total.** It removes the household and everything the household owns — its inventory, its records, *and its users*. This is the only operation in the product that genuinely destroys data.

**Who may delete a household: any member of that household holding the `admin` role** (§2.3). Membership and role are both required — an admin of one household has no authority over another, so the check is always "admin *of this household*", never "is an admin".

**When the last admin deletes their account, the household is deleted with them.** Because every household must always have at least one admin (§2.3.3), an account deletion that would leave none is treated as a deletion of the whole household: the household is destroyed, and **every remaining member's account is destroyed along with it** — the full hard delete described above, not a soft delete.

There is **no delegation**. The role does not pass to another member, the deletion is not refused, and nobody is prompted to hand it over first. The admin is assumed to know what they are doing and to be accountable for it; this is an admin-level change, and its consequences are theirs.

This one rule covers both cases that reach it, and they are the same case:

- **A user who skipped** (§2.2.1) is the sole member and therefore the sole admin (§2.3.2), so deleting their account deletes the household that was silently created for them. Nobody else is in it and no other member's attribution is at stake, so nothing is lost that the soft delete exists to protect.
- **A user who created a household** and is still its only member is likewise its last admin, and the same thing happens.

They differ only in that the first person never knew they had a household.

**A household is also destroyed when its last admin leaves** rather than deletes their account (§2.2.10). That is the same hard delete described here, with one difference: the departing admin is warned first.

**No extra confirmation is required for any of this.** Deleting a household uses the ordinary confirmation, and a user who skipped is not warned that a household is going with them — they do not know they have one, and raising it at the moment of deletion would introduce the concept purely to alarm them.

#### 2.2.9 Attribution and private items

**Every inventory item records which member added it.** Ownership of the item still belongs to the household; the attribution is *who*, alongside the household's *whose*. This is what the soft delete in §2.2.8 exists to protect.

**An inventory item can be marked private.** A private item is **visible only to the member who added it** — other members of the household do not see it at all. This is what makes a shared household usable for things that are genuinely one person's: a gift bought for a housemate, or anything else that being in a shared pantry should not automatically expose.

**Private is private, including from admins.** An `admin` has no privileged view of another member's private items. The role governs administration of the household — who is in it, and whether it continues to exist — and confers no visibility into another person's things. This is a deliberate limit on what the role means, not an oversight.

**A private item does not outlive its owner's membership.** Whether the member is soft-deleted (§2.2.8) or leaves (§2.2.10), their private items are deleted. Nothing private is ever inherited by the household, and nothing private is ever carried to another one.

The detail of how private items behave inside inventory — whether they count toward household totals, whether they appear in spending statistics, how they interact with budgets — belongs to the Inventory module and is not settled here.

#### 2.2.10 Leaving a household, and being removed from one

**A member can leave the household they are in.** This is distinct from deleting an account (§2.2.8) — the person keeps their account, their credentials, and their identity. They only stop being part of that household.

**An admin can also remove a member** (§2.3). Removal and leaving are **the same operation with a different instigator**: everything below applies unchanged to a member who is removed, including where they land and what happens to their items. Nothing is retained for a removed member that a departing one would lose, and nothing is destroyed that a departing one would keep.

**Any member can be removed, including another admin.** Admins are not protected from one another — consistent with §2.3.3, where any admin may demote any other and no member holds a standing no one else can touch.

**A removed member is told.** They did not choose this, so they are informed of it through the notification module rather than discovering it by finding their household gone. Notifications are their own module and are not yet written; this depends on it, as the in-app invitation flow above does.

**They leave alone.** A departing member takes nothing with them. Every item they added stays with the household they left. Nothing is exported into their new household — not ordinary items, and not private ones. Ownership belongs to the household, and leaving does not convert any of it into personal property.

**Their private items are deleted.** The one exception to "everything stays" is the items only they could see (§2.2.9). Those are destroyed rather than left behind, for the same reason they are destroyed when a member is soft-deleted (§2.2.8): an item nobody can see has no audience, and the household loses nothing it ever had. Leaving them in place would put records in the household's inventory that no remaining member — not even an admin — could read or remove.

Private items therefore behave identically however a member departs: they go when the person goes.

The reason is that the alternative is unworkable in a shared home: deciding which of the eggs, the shampoo and the half-used spice jars belong to the person walking out is a judgement Salamander cannot make, and making it wrong silently corrupts the household's stock count for everyone still living there. Leaving the record intact is the only outcome that is always correct for the people who remain.

*Getting a copy of your data out on the way is a real need, and **export is deferred to a later release**.*

**They land in a household of their own.** Nobody is ever without one (§2.2.2), so a departure is always a move rather than an eviction into nothing: a new household is created for the departing member and they become its sole occupant. They are returned to exactly the state of a user who skipped the household step at sign-up (§2.2.1) — **`skipHousehold` is set back to true**, the new household is named and provisioned the same silent way, and from their point of view they are simply an individual user again, with an empty inventory.

Because they are the only member of that new household, they are its `admin` (§2.3.2).

**When the last admin leaves, the household they leave is deleted.** Every household must always have at least one admin (§2.3.3), so a departure that would leave none dissolves the household instead: it is destroyed under §2.2.8 — totally, including its inventory and **including the accounts of every member still in it**. The person leaving is unaffected by that; they move into their own new household exactly as above.

**They are warned first.** Unlike the equivalent account deletion in §2.2.8, this one is announced: the departing admin is told that leaving will delete the household because they are the last admin, before it happens. The difference is deliberate. Someone deleting their account has already accepted that they are destroying something; someone clicking "leave" has not, and would otherwise take down a household and everyone in it while believing they were only removing themselves.

**Accepting an invitation is a leave and a join at once.** A member who accepts an invitation to another household (§2.2.6) leaves their current one under all the rules above — most importantly, they arrive with nothing, and if they were its last admin, the household they came from is deleted. The one difference is where they land: they join the inviting household rather than a new one of their own.

Note that a **sole member is always the sole admin** (§2.3.2), so a person leaving a household they were alone in always dissolves it. No empty household is ever left behind.

**Removal can never trigger that dissolution.** Only an admin can remove someone, so an admin always remains afterwards. The household-destroying case belongs to leaving alone.

### 2.3 Roles

There are **two roles: `admin` and `user`.** That is the whole set to begin with.

**A role belongs to the user.** It is carried on the user record, not derived from anything else — a user *has* a role the same way they have a display name. Every user has exactly one.

Because a user belongs to exactly one household (§2.2.2), a user's role is in practice their role *within* that household, and the two readings coincide today. They would stop coinciding if a user could ever belong to more than one household, at which point the role would have to move onto the membership rather than the person.

#### 2.3.1 What the roles may do

**Permissions are granted to `admin` only, and always within the holder's own household.** A role carries no authority outside the household its holder belongs to, so every role check is "admin *of this household*", never "is an admin" — the distinction matters the moment there is more than one household in the system.

| Action | Required |
| --- | --- |
| **Invite a member** (§2.2.6) | `admin` of that household |
| **Remove a member** (§2.2.10) | `admin` of that household |
| **Delete the household** (§2.2.8) | `admin` of that household |
| **Change another member's role** (§2.3.3) | `admin` of that household |

Everything else in the product is available to both roles.

**Administration is not visibility.** The role governs who is in the household and whether it continues to exist. It grants no privileged view of another member's data: an admin **cannot** see items another member marked private (§2.2.9). Private is private.

#### 2.3.2 Which role a new user gets

**Whoever creates a household is its admin.** That covers both routes into a first account, and the two are treated identically:

- A user who **creates a household** at sign-up is its admin.
- A user who **skips** is *also* an admin — of the household they were silently given. It makes no practical difference to them: they are the only member, there is nobody to administer, and the role is a label they never see. Nothing about the skip case is special-cased.

**Everyone who joins by invitation joins as a `user`.** Admin is conferred by creating a household, and afterwards only by an existing admin granting it (§2.3.3).

#### 2.3.3 Changing roles, and the one invariant

**Any admin can change any member's role, including another admin's.** An admin can promote a `user`, and can demote another admin — including the person who originally created the household.

**There is no primary admin, no owner, and no founder.** The member who created the household holds no authority the others lack and cannot be protected from them. Once there are two admins they are peers, and either may remove the other's role. This is a deliberate choice: the alternative — a permanent creator who cannot be displaced — means a household can be left under the control of someone who has moved out, with no way for the people still living there to take it back.

**Every household must always have at least one admin.** This is an invariant of the system, not a guideline. Any operation that would leave a household with zero admins is refused — demoting the last admin is not possible.

Account deletion is the one thing that does not resolve this by refusal. When the last admin deletes their account there is no household left to be admin-less: the household and every remaining member are deleted with them (§2.2.8). The invariant is preserved by the household ceasing to exist, not by the deletion being blocked.

### 2.4 Authentication

Authentication covers proving who a user is and keeping them signed in. Two ways in, one session model behind both.

#### 2.4.1 Ways to sign in

**Email and password.** Sign-up takes an email, a password, and an optional display name. The password requirement is a **minimum length of 12 characters**, with no composition rules — length is what resists offline cracking, and character-class rules mostly produce predictable substitutions. This account will eventually authorise spending, which is the reason for the higher-than-typical floor.

**Google.** A standard OAuth 2.0 authorization-code sign-in with PKCE, verifying the returned OpenID Connect identity token. The user is always asked which Google account to use, so that "sign in as someone else" is possible on a shared machine.

Google sign-in is **optional infrastructure**: if the deployment has no Google credentials configured, the rest of the product still works and only Google sign-in is unavailable. Local development and automated tests do not need an OAuth client.

**These are the only two ways in.** There are no other identity providers, and none are planned. The account-linking model in §2.4.2 is written generically — a link records *which provider* and *which account at that provider*, rather than assuming Google — so adding one later would be an addition rather than a redesign. That is a property of the design, not an intention.

#### 2.4.2 Matching a Google sign-in to an account

This is the part with real consequences, because getting it wrong hands one person another person's account.

- A Google link is keyed on **Google's own stable account identifier, never on the email address.** A Google account's email can change; matching on email would silently re-point an existing link at a different person.
- If the incoming Google account is already linked, that link decides which user is signed in. Nothing else is consulted.
- If it is not linked but the email matches an existing Salamander account, the two are joined into one account **only if Google asserts the address is verified.** If Google does not, the sign-in is refused rather than linked. Auto-linking an unproven address is an account-takeover route: anyone able to create a Google account claiming an address would inherit the Salamander account for it.
- Otherwise a new account is created, with the display name and avatar taken from the Google profile.

When linking to an existing password account, profile fields the password sign-up never collected (display name, avatar) are filled in from Google; existing values are not overwritten.

#### 2.4.3 Sessions

A signed-in session is two credentials with different lifetimes, both held in cookies the browser sends automatically and JavaScript cannot read:

- A **short-lived access credential**, valid 15 minutes, that authorises ordinary requests.
- A **long-lived refresh credential**, valid 30 days, whose only use is obtaining a new access credential.

The 30 days is an **absolute** lifetime: refreshing does not extend it, so a session ends 30 days after sign-in regardless of activity. Each refresh **rotates** the credential — the old one stops working the moment a new one is issued.

**Revocation is real, not just expiry.** Every session exists as a record that can be revoked, which is what makes the following possible:

- **Sign out** ends that one session immediately.
- **Changing a password ends every other session** and keeps the current device signed in. This is the "someone else knows my password" recovery path.
- **Reusing an already-rotated refresh credential ends every session for that user.** Either the user raced themselves, or the credential leaked; the system assumes the worse case and forces a fresh sign-in everywhere rather than quietly issuing a new session to a possible attacker.

Refresh credentials are stored in a form that cannot be replayed if the database is read by someone who should not have it.

#### 2.4.4 Resistance to abuse

- **Sign-in failures are indistinguishable.** A wrong password, an email with no account, and an email belonging to a Google-only account all return the same failure, and take the same amount of time. Anything else lets an attacker enumerate which addresses have accounts and which of those have no password.
- **Rate limiting** applies to both sign-up and sign-in. Sign-in is limited *per targeted account* as well as per source, so an attacker with many source addresses still cannot grind away at one account.
- **Cross-site request forgery** is defended on every state-changing request by a token the browser must echo back and an origin check, on top of the cookies' own same-site restriction. The bar is set at defence-in-depth deliberately: these requests will eventually move money.

#### 2.4.5 What a client can ask about the current session

A signed-in client can retrieve the current user, together with **whether they have a password** and **which providers are linked**. Both matter to the UI: a Google-only user should be offered "set a password" rather than "change password", and should be warned before unlinking their only way in.

***TBD: unlinking.*** Removing a linked Google account is not implemented. When it is, it must not be possible to remove the last remaining means of signing in.

#### 2.4.6 Password reset

**A user who has forgotten their password must be able to recover their account.** Salamander needs a forgot-password flow, and it does not have one: today a user with a password, no memory of it, and no linked Google account is permanently locked out.

The flow is the ordinary one. The user asks for a reset from the sign-in page by giving their email address; Salamander emails them a link; following it lets them set a new password. The new password is subject to the same minimum length as any other (§2.4.1).

Two rules carry over from elsewhere in this section and are not optional:

- **A completed reset ends every existing session for that user** (§2.4.3), exactly as changing a password does. A reset is the recovery path for "someone else may have my password", so leaving their sessions alive would defeat the point.
- **Asking for a reset must not reveal whether an account exists.** The response is the same for an address with an account and one without, in line with §2.4.4 — otherwise the reset form becomes the account-enumeration oracle that the sign-in form was carefully designed not to be.

**The reset link expires 24 hours after it is sent, and it is single-use** — the same policy as the invitation link in §2.2.6, and for the same reason: both are emailed credentials that grant control of an account. Setting the new password consumes the link. Whichever comes first, the 24 hours elapsing or the reset being completed, the link is dead afterwards and anyone following it is shown a plain message saying it has expired. Asking for a new reset is the only way forward.

Emailed links in Salamander therefore behave uniformly: **24 hours, one use, then an expiry message.** A user who requests a reset twice should expect the first link to be worthless, and nothing in the product should mint an emailed credential that outlives either bound.

**This flow depends on email delivery, which is not built** — the same SMTP gap that blocks household invitations (§2.2.6). Both are waiting on it.

*TBD: resetting a password on an account that has none.* A Google-only account has no password to forget. Whether "forgot password" on such an address does nothing, or doubles as a way to set a first password by email, is unspecified — and the second reading would make email possession sufficient to gain a password credential on a Google-only account, which interacts with §2.4.2.

### 2.5 Inventory

The inventory is the running record of what the household owns. It is the core of the product (§1): every other module either reads from it or writes to it, and none of them are better than the record underneath them.

**The inventory belongs to the household** (§2.2), never to a user. A member reaches it through their membership, sees their household's items and no others, and takes none of it with them when they leave (§2.2.10).

#### 2.5.1 What an inventory item is

An **item** is one tracked thing. Not only consumables: a carton of eggs, a cartridge of printer ink and a copy of *1984* are all items, and the record has to hold all three without treating any of them as a special case.

An item carries:

- **Name** — mandatory. What the household calls the thing.
- **Category** — mandatory, and a reference to one of the household's categories (§2.5.2) rather than a typed word.
- **Quantity** — how much is on hand. Optional, because a household may want to track that it owns a thing without counting it.
- **Unit** — optional free text: *each*, *litres*, *loaves*. Deliberately free text and deliberately not a record of its own, because nothing in the product groups or totals by unit — an inconsistency between *litres* and *L* stays inside the one row it was typed into and never adds up wrong anywhere.
- **Attributes** — optional and open-ended: author, edition, ISBN, model number, whatever distinguishes this thing. This is what tells two items with the same name apart, and it is what natural-language reads match against (§2.5.8).
- **Added by** — which member (§2.2.9). Mandatory, and it does not change afterwards.
- **Private** — whether the item is visible only to the member who added it (§2.2.9).
- **Created and last-updated dates.**

**The item record says nothing about buying the thing.** Whether an item is reordered, at what level, and under what constraints is a separate concern that is not written yet. It is kept off the item deliberately: a book and a carton of eggs must both be complete records, and a column that is meaningless for half the rows forces every reader to guess whether an empty value means *not set yet* or *does not apply here* — two different states that one blank cannot distinguish.

#### 2.5.2 Categories

**Every item is in exactly one category, and the categories are the household's own.** They are a set the household names and curates, not a fixed taxonomy the product supplies. A category name is unique within its household, compared case-insensitively — *Books* and *books* are one category, not two.

Categories are records rather than free text on the item because the rest of the product groups by them: statistics slice spend by category (§1.1) and budgets are set against them. As free text, one member writing *groceries* and another writing *grocery* would silently split a total with nothing appearing to be wrong. The same reasoning does not apply to `unit`, which is why that stays free text.

Because items point at the category record and not at its name, **renaming a category is safe** — every item follows it, and no history is rewritten.

*TBD: the category management surface.* Creating, renaming and deleting categories, and what happens to a category that still has items in it, are not specified here. *TBD: whether a new household starts with any categories at all,* or with an empty list the first item has to fill.

#### 2.5.3 Two ways to do everything

There are four operations — **add, read, update, delete** — and each is available two ways: through a **form**, and by **writing a sentence**.

**Neither path is a subset of the other.** Anything that can be done with a form can be done with a sentence, and anything that can be done with a sentence can be done with a form. They are two entrances to the same four operations, not a simple mode and an advanced one.

**Both are permanent.** The sentence is the everyday path, because nobody types numbers into fields to say they are low on eggs, milk and bread. The form is the exact path, because an interpretation can be wrong and the user needs a way to say precisely what they mean and correct what was misread.

**The form path never depends on the LLM.** If the model is slow, misconfigured, or unavailable, the inventory stays fully usable through forms. This is the reason the two paths are not layered — the natural-language path is not a front end onto the forms, so losing it costs convenience and never function.

#### 2.5.4 The form path

Ordinary and unsurprising. A form to add an item, the same form pre-filled to update one, and a delete control on each item. The category is chosen from a picker over the household's own categories rather than typed, so a form submission can never invent one. No interpretation happens anywhere in this path: what is submitted is what is stored.

*The view, update and delete controls already exist in the interface; the natural-language path below is the new work.*

#### 2.5.5 The natural-language path

The user writes what they want in a normal sentence — *"Add 1984 to my books"* — and the system works out what to do with it. The sequence:

1. **The sentence goes to the server.** The client never contacts the LLM.
2. **The server calls the model with three things:** the user's text as they wrote it, the shape of the JSON object the model must reply with, and the **metadata** it needs to resolve words onto records — the household's categories, and the items in view (§2.5.6).
3. **The model replies** with either a structured object or a question (§2.5.7).
4. **The server validates the object** against the same shape it gave the model, and commits it.
5. **The committed change is pushed to open clients** and the interface updates without a reload (§2.5.10).

**The server owns the exchange with the model, and that is not an implementation detail.** The metadata decides what the model is able to resolve, and the model's answer decides what is written. Both are bound to the household and the member on the server, from the session. A client able to supply its own metadata, or to post a structured object of its own, could read or write another household's inventory — so neither is ever taken from the request.

**The model's output is a proposal, never a write.** It is re-validated on arrival, and an object that fails that check writes nothing. The model is trusted to interpret language, not to decide what is allowed.

#### 2.5.6 What the model is told

The metadata exists so the model can map the user's words onto records that already exist: *books* onto the household's **Books** category, *1984* onto the item the household already has. It carries the household's categories, and the items currently in view with enough of their attributes to tell two similar ones apart.

Three rules bound it, and each is a consequence of a rule established earlier.

**It is scoped to the household.** Only this household's categories and items are ever sent (§2.2).

**It excludes what the asking member cannot see.** Another member's private items are not in the metadata — including when the asker is an admin, who has no privileged view of them (§2.2.9, §2.3.1). Privacy is enforced when the context is assembled, not by instructing the model to keep a secret: a private item that was never sent cannot be named back to the wrong person.

**It never introduces the household to a member who skipped.** Nothing the model is given, and nothing it says back, may mention the household to a member at `skipHousehold: true` (§2.2.3). They do not know they have one, and a clarifying question about *"your household's categories"* is exactly where they would find out.

#### 2.5.7 When the model cannot produce a valid object

Some sentences do not resolve. The user writes *"Add 1984 to my library"*, and **Library** is not one of the categories the model was given.

**The model asks rather than guesses.** It replies with a question — *"Library does not exist as a category. Did you mean Books?"* — the user answers, and the exchange continues until either a valid object is produced or the user gives up on it.

**Ambiguity is asked about because a wrong guess is indistinguishable from a deliberate entry.** Quietly filing *1984* under the nearest-looking category, or creating **Library** because the word appeared, produces an inventory that does not match what the user believes they have — and nothing about the record afterwards reveals that it was a guess. One extra exchange is cheap; a quietly wrong record is not.

**Nothing is written until the exchange resolves.** There is no partial record and no placeholder. A conversation the user abandons leaves the inventory exactly as it was.

**Names are resolved, never invented.** The model may only map the user's words onto records it was given. If *1984* matches nothing the household tracks, that is a question or a plain "nothing tracked" — never a new item conjured to satisfy the sentence.

**This is the only place the model's own words reach the user, and they are confined to clarification.** Results are not composed by the model: a read renders the matching items, and a write renders what was actually stored. The model may say whatever it needs in order to be understood while it is still working out what the user meant, but everything the product *asserts* about the household's stock is rendered by the server from the record.

**The exchange resolves against categories; it never creates one.** The user may push back, and the answer does not change:

- *"Add 1984 to my library"* → *"Library does not exist as a category. Did you mean Books?"*
- *"No, I mean Library"* → *"Library is not a category yet. It has to be added before an item can go in it."*
- *"Add the category, then"* → the user is told where to add it, and it is not added here.

Those turns count against the cap below like any others; there is no special allowance for arguing the point, and the exchange fails at ten as it would for any other sentence that does not resolve.

**Where the user is sent is written by the product, not composed by the model.** The model may explain that the category is missing — that is clarification, and §2.5.7 allows it — but directions to a place in the interface are not something to leave to interpretation, for the same reason the ten-turn failure message is server-written.

**Why the interpretation step does not extend the taxonomy.** Categories are the set that statistics and budgets group by (§2.5.2), which is why they are curated records rather than words typed onto items. A taxonomy that grows a word at a time while a sentence is being interpreted is exactly the drift that choice was made to prevent — and an exchange that can create the records it resolves against no longer has a fixed set to resolve against, which is what makes its answers checkable.

**This is a scope decision, not a permanent one.** Creating a category — and metadata generally — from inside the exchange is a thing we intend to allow later. It is simply not in scope now, and a later section may lift this without contradicting anything above it.

**The exchange is capped at ten.** One exchange is one message from the user and one reply from the model, and the tenth is the last. If no valid object has been produced by then, the operation fails: the user is told plainly that it could not be understood, and is pointed at the form as the way to do it (§2.5.4). Nothing is written, the same as for an exchange the user abandons.

**The cap is a ceiling, not a target.** Nearly every sentence resolves on the first reply and an ambiguous one on the second; ten is set where it is because an exchange that has not converged by the tenth turn is not converging, and the remaining outcomes are all bad ones — a user answering the same question repeatedly, a model narrowing on the wrong item, and a cost that climbs with every turn. Failing at a known point is better than any of them.

**Failing this way is not a dead end, which is the point of §2.5.3.** The form does the same four operations exactly, so a user who cannot get a sentence understood is one form away from the thing they were trying to do. This is the case that path exists for, and it is why the two are not layered: the fallback for a failed interpretation cannot itself be an interpretation. The failure message is written by the server, not the model — a model that has just failed ten times to understand the request is not the thing to explain the failure.

**The exchange is ephemeral.** It lives only while the user is in it. It is not stored, it is not resumable, and it does not survive a reload, a navigation away, or a lost connection — any of those end it, and the user starts again with a fresh sentence. A restarted exchange is a new one, with its own count of ten.

**Restarting is cheap, which is what makes this affordable.** Every operation here is small and self-contained — add an item, correct a quantity, remove one thing — so the whole cost of losing an exchange is retyping a sentence. There is nothing half-finished to recover, because nothing is written until the exchange resolves. Persisting the conversation would mean deciding when it expires, what happens if it is resumed after the inventory it was resolving against has changed underneath it, and whether a stale exchange may still commit — real complexity, bought for a user who would rather just type the sentence again.

This is a decision about the **conversation**, not about the record: what a committed write stores about the sentence that produced it is a separate question, and one this section does not settle.

#### 2.5.8 The four operations in a sentence

| Intent | Example | What it produces |
| --- | --- | --- |
| **Add** | *"Add 1984 to my books"* | A new item, with **books** resolved to the household's **Books** category |
| **Read** | *"Do I have 1984?"* | A query. The matching items are shown; nothing is written |
| **Update** | *"Make my copy of 1984 a special edition"* | A change to that item's attributes |
| **Delete** | *"Remove 1984 from my books"* | That item is deleted |

**Read is the one that does not write,** which makes it the safest of the four: it needs no confirmation and cannot be wrong in a way that persists. It also has to match loosely — someone asking about *1984* should find the item whether the household stored it as *1984* or *Nineteen Eighty-Four* — so it resolves against attributes as well as names, and says plainly that nothing matches rather than offering the nearest thing it found.

**Update and delete both require certainty about which item is meant.** A sentence that resolves to more than one item is a question, not a choice the model makes on the user's behalf. Delete deserves particular care: a form delete is aimed at a specific row the user was looking at, whereas a sentence is aimed at a description, and the two are not equally precise. *TBD: whether a natural-language delete is confirmed before it happens.*

**One sentence may name several items** — *"low on eggs and milk, out of bread"* is one input and three changes. If any part of it does not resolve, the whole sentence goes into the clarification exchange rather than committing the parts that did: applying half a sentence leaves the user to work out which half landed, which is worse than being asked.

#### 2.5.9 Attribution, privacy, and what each member sees

**Every item records the member who added it** (§2.2.9), taken from the session — the person whose form submission or sentence created it. It is never read from the model's output or from the request body, for the same reason the household scope is not: neither is under the server's control.

**An item can be marked private**, and a private item is visible only to the member who added it — including to admins (§2.3.1). Private items are deleted when their owner is deleted or leaves the household (§2.2.8, §2.2.10); nothing private is ever inherited or carried anywhere.

**A consequence worth stating plainly: counts and totals differ between members, and that is correct.** Every figure the product shows a member is computed over what that member can see, so two people in one household can look at the same inventory and see different numbers whenever one of them holds private items. A single household-wide figure would announce that private items exist and how many there are — which is the thing private is for preventing. There is therefore no household total independent of who is looking at it.

§2.2.9 deferred to this module the question of how private items behave inside inventory. **The visibility rule above is the part inventory settles**: private items count for their owner and for nobody else, everywhere a count is shown. How that rule carries into spending statistics and budgets follows from it, but those modules are not written and the detail belongs to them.

#### 2.5.10 Live updates

A committed change is pushed to open clients so the interface reflects it without a reload — this is what makes a sentence feel like it did something.

**It is pushed to the members who are allowed to see it.** A change to an ordinary item reaches every member of the household with the app open; a change to a private item reaches only its owner. The rule that governs the metadata governs the push, for the same reason and with the same consequence.

**The push is a convenience, not the record.** What is stored is the truth. A client that missed a push is stale rather than wrong, and a reload corrects it. Nothing about a write may depend on the push being delivered, because that would turn a dropped connection into lost data.

#### 2.5.11 What writes to inventory from elsewhere

Bill capture (§1.1) records a purchase and updates the inventory as part of doing so, which makes it a second writer into this module. It is not specified yet. When it is, it is bound by everything above: the same item record, the same attribution to the member who uploaded the bill, and the same rule that nothing is written from an interpretation that did not fully resolve.
