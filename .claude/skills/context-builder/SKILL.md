---
name: context-builder
description: Use when asked to "build the context for X", "map the X module", "give me a context file for X", or to produce a codebase map / orientation file for a module or feature so a later session knows where to look. Produces a pointers-only context file under docs/context/ — file locations, and nothing that could be read out of the code itself.
---

# Context builder

A context file is a **map, not a summary**. It says *where to look*. The code says *what is
there*. A session handed the map plus the repo can answer any question; a session handed the map
alone can answer none — that is the design, not a shortfall.

## The one rule

**Nothing in a context file may be anything that could be read out of the code.**

Not a symbol name, not a signature, not a shape, not a behaviour. If a question can be answered by
opening the file the line points at, the line must not answer it. What remains is the one thing
the code cannot tell you until you have already found it: **where the file is**.

Test each line before writing it: *could someone change the code without touching this line, and
leave the line wrong?* If yes, the line is content — delete it. A path survives everything but a
rename. A symbol list, a column list, a status, a behaviour note, a count — all rot silently, and
a stale map is worse than none because it is trusted.

Corollary: **do not read files to describe them.** Read them to find out what imports what and
which file owns which role, then write the paths and close them.

## Symbol names are the trap

Exported names are the tempting exception and the one that has actually gone wrong. They look
harmless — short, factual, greppable — and they are the fastest thing in the repo to rot. A
rename, a split, a deletion: each is a normal edit that leaves no reason to open the context file,
so the wrong name survives every pass and is handed to the next session as fact.

**So: no function, type, class, constant, route-handler or hook names. Anywhere. Including as
grep seeds.** A grep seed is a symbol name with an excuse. The path is the seed — open the file
and every name in it is correct by construction.

> ✗ **`` [`services/inventory.ts`](…) `` → `interpretSentence`, `Interpreted`, `resolveNamedItem`**
> Three names, each one rename away from being a lie, in a file nobody will reopen to check.

> ✓ **Service · `` [`services/inventory.ts`](…) ``**
> Points. Says nothing. Stays true until someone moves the file.

## Allowed on a line

- A repo-relative link: `` [`inventory.ts`](../../node-server/src/db/schema/inventory.ts) ``
- The **role** the file plays — schema, repository, service, route, client, component, mock,
  fixture. Structural, not behavioural.
- An **edge**: which file registers, imports, or is imported by which
- A **handling convention** that no reading of the code reveals — "regenerate, never hand-edit"

## Banned on a line

- Exported symbol names of every kind — functions, types, classes, constants, components
- Table names, column names, enum values, field lists, wire shapes
- What a function does, validates, enforces, returns, or when it throws
- Script and command names — point at `package.json` instead
- Rationale, trade-offs, invariants, PRD prose, anything quoting `docs/PRD.md`
- Status — "not implemented", "returns 501", "stubbed", "TODO", "partially wired"
- Counts — "3 repositories", "the 8 tables"
- "There is no X here" / "X deliberately lives elsewhere" (see [clean-and-update](../clean-and-update/SKILL.md))

## Building one

1. **Find the module's files, don't summarise them.** Start from the three anchors and follow
   imports outward:
   - the route file — `node-server/src/api/<module>.ts`, and its registration in
     `node-server/src/app.ts`
   - the schema module — `node-server/src/db/schema/<module>.ts`
   - the frontend client — `frontend/src/api/<module>.ts`

   ```bash
   grep -rln "inventory\|Inventory" --include="*.ts" --include="*.tsx" --include="*.json" \
     node-server/src node-server/test frontend/src docs | sort
   ```

2. **Walk every layer.** Same order as [clean-and-update](../clean-and-update/SKILL.md) so the two
   agree on what a module consists of: schema → migrations → repositories → services → API →
   frontend types/client/components/mocks → tests → docs.

3. **Write it as tables.** A narrow cell physically resists prose. Left cell a role, right cell a
   link. Omit a layer entirely when the module has no file there — an empty section is a
   statement about absence.

4. **Verify before reporting done.** Every link resolves, and no line names a symbol.

   ```bash
   grep -o '](\.\.[^)]*)' docs/context/INVENTORY_CONTEXT.md | sed 's/^](//; s/)$//; s/#.*//' \
     | sort -u | while read -r p; do [ -e "docs/context/$p" ] || echo "DEAD: $p"; done
   ```

## Output

Write to `docs/context/<MODULE>_CONTEXT.md`, uppercase module name. Links are relative to that
directory (`../../node-server/...`).

Link to the file, never into it. `#L42` anchors rot on the next edit, and a symbol name is banned
outright — so a file holding several unrelated things is pointed at whole, and its size is the
signal that it wants splitting.

```markdown
# Inventory — context

Pointers only; the linked file is the answer.

## Server

| | |
|---|---|
| Tables | [`db/schema/inventory.ts`](../../node-server/src/db/schema/inventory.ts), [`categories.ts`](../../node-server/src/db/schema/categories.ts) |
| Barrel | [`db/schema/index.ts`](../../node-server/src/db/schema/index.ts) |
| Migrations | [`node-server/drizzle/`](../../node-server/drizzle/) — regenerate, never hand-edit |
| Repositories | [`inventoryItems.ts`](../../node-server/src/db/repositories/inventoryItems.ts), [`categories.ts`](../../node-server/src/db/repositories/categories.ts) |
| Routes | [`api/inventory.ts`](../../node-server/src/api/inventory.ts), registered in [`app.ts`](../../node-server/src/app.ts) |

## Frontend

| | |
|---|---|
| Client | [`api/inventory.ts`](../../frontend/src/api/inventory.ts) |
| Types | [`types/index.ts`](../../frontend/src/types/index.ts) |
| Components | [`components/inventory/`](../../frontend/src/components/inventory/) |
| Mocks | [`api/mocks/inventory.groupedByCategory.json`](../../frontend/src/api/mocks/inventory.groupedByCategory.json) |

## Neighbours

| | |
|---|---|
| Household scoping | [`services/households.ts`](../../node-server/src/services/households.ts) |
| Auth guard | [`auth/plugin.ts`](../../node-server/src/auth/plugin.ts) |
```

## Refreshing

Rebuild from the tree; do not patch. There is no prose to preserve, so a regenerate is cheaper
than a diff and cannot leave a half-updated line behind. Removing a module's file means removing
its row — not striking it through, not annotating it.
