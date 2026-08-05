---
name: clean-and-update
description: Use whenever removing, deleting, dropping, replacing, renaming, migrating, or updating anything in this repo — a table, column, route, function, type, dependency, config key, or a section of documentation. Also use when asked to "clean up", "get rid of", "take out", "refactor away", or "bring X up to date". Enforces complete removal with no leftover history, tombstones, or changelog residue in code comments and markdown.
---

# Clean and update

Git is the history. Code and docs describe **only the present state**.

## The two rules

**REMOVE means remove.** Delete the thing and every reference to it, so the repo reads as if it never existed. Not deprecated, not commented out, not explained — gone.

**UPDATE means replace.** Delete the stale content *first*, then write the new. Never append the new alongside the old and let the reader work out which one is current.

## Never leave these behind

Every one of these is a failure, not a courtesy:

- Tombstone comments — `// there is deliberately no X here`, `// X was removed because…`, `-- no audit table; see D9`
- Decision-log or changelog entries recording a deletion
- Session-log / "what changed on 2026-08-05" lines in markdown
- Parentheticals like *"(this originally read…)"*, *"(formerly `foo`)"*, *"(used to live on the item)"*
- Struck-through or `(RETIRED)` / `(DEPRECATED)` entries kept for the record — rewrite the entry instead
- "Old → new" mapping tables that outlive the migration
- Commented-out code, unused imports, dead types, orphaned fixtures or mocks
- A doc sentence explaining why something is absent

If a fact only makes sense to someone who knows the previous version, it does not belong in the file.

## Scope checklist

A removal is not done until every layer is clean. For this repo, walk:

1. **Schema** — `node-server/src/db/schema/`, plus the inferred `$inferSelect` / `$inferInsert` types and the barrel in `schema/index.ts`
2. **Migrations** — run `npm run db:generate` from `node-server/`; it wipes `drizzle/` and republishes one baseline from `schema/`. Do not hand-write a drop migration
3. **Repositories and services** — `node-server/src/db/repositories/`
4. **API** — routes, zod schemas, serialisers, wire shapes, and the comments describing them
5. **Frontend** — types, API clients, components, mocks in `api/mocks/`
6. **Tests** — cases, fixtures, helpers
7. **Docs** — `README.md`, `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/DEPLOYMENT.md`

Also fix anything the removal made *wrong* rather than merely absent: a comment saying "one transaction so A and B land together" when B is gone, a stated count ("8 tables"), a list that now has one item, a link to a deleted anchor.

## Verify before reporting done

Grep for the removed name and every related identifier — snake_case, camelCase, PascalCase, the route path, the serialiser, the query schema:

```bash
grep -rn "old_name\|oldName\|OldName" --include="*.ts" --include="*.tsx" --include="*.md" --include="*.sql" --include="*.json" . | grep -v node_modules
```

**Expect zero hits.** A hit in something written to explain the removal is a failure. Then run `npm run typecheck` and `npm test` from `node-server/`.

## Before deleting

Confirm the thing is genuinely unrequired — check `docs/PRD.md`, which is the source of truth, and whether anything consumes it. Report that finding in **chat**, in a few lines. Do not write the justification into a file.

## Where history does belong

The commit message, and nowhere else. Put the reasoning there.
