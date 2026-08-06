# Salamander — working agreements

## Code carries no commentary

**Code files contain code. Not prose.** This is not a style preference to be
weighed against others — it is a hard rule, it applies to every engineer and
every agent touching this repo, and it is never violated.

Make the code explain itself:

- **Descriptive names.** A well-named function, variable or type removes the
  need for the sentence that would have described it. If you are reaching for a
  comment, the name is wrong.
- **Simple logic.** Small functions, early returns, one job each. A block that
  needs a paragraph to follow needs to be split, not annotated.
- **No narration.** Never restate what the next line does, label a section,
  summarise a function's parameters, or reproduce a type signature in English.

A comment is acceptable **only** when something is genuinely, unavoidably
unclear from the code — a non-obvious ordering constraint, a workaround for
external behaviour, a lock whose absence is a race. That bar is high. Expect to
clear it a handful of times in the whole repo, and when you do, keep it to one
line.

Never acceptable, regardless:

- Docstring/JSDoc blocks describing what a function does
- Spec or requirement citations (`PRD §2.3.3`) — the PRD is the place for those
- Commented-out code, `TODO`, `FIXME`, or notes about what is not built yet
- History of any kind: what changed, what this used to be, what was removed
- Banner or divider comments organising a file into sections

Tooling directives (`eslint-disable`, `@ts-expect-error`, `<reference />`) are
not comments in this sense and stay.

## Where the prose belongs

- **Why the product works this way** → [`docs/PRD.md`](docs/PRD.md), the source
  of truth.
- **Why the system is built this way** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
- **Why this change was made** → the commit message.

If you find yourself deleting a comment that holds a real insight, move it to
whichever of those three it belongs in. Do not leave it in the code.

## Removing things

Git is the history. Code and docs describe only the present state. Deleting
anything — a column, a route, a type, a doc section — means deleting every
reference to it, leaving no tombstone comment, deprecation note or changelog
entry. See the `clean-and-update` skill.
