# Contributing

## Branch protection

`master` is protected. For everyone except repository admins:

- Direct pushes are rejected — all changes go through a pull request.
- A pull request needs **1 approving review** from the repository owner before it
  can merge.
- Stale approvals are dismissed when new commits are pushed.
- All review conversations must be resolved before merge.
- Force pushes and branch deletion are blocked for everyone.

Repository admins can push directly to `master` and merge without waiting for an
approval. This is intentional — it keeps the owner unblocked on a personal project
while still requiring review from anyone else.

> Note: GitHub does not allow the author of a pull request to approve their own PR.
> The owner merges their own PRs using the admin bypass rather than self-approving.

## Workflow

```bash
git checkout -b feat/short-description
# make changes
npm run typecheck && npm run lint && npm test
git commit -m "feat: short description"
git push -u origin feat/short-description
gh pr create
```

## Commit messages

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.

## Before opening a pull request

- `npm run typecheck` passes
- `npm run lint` passes
- `npm test` passes
- New logic in `src/shared/core/` has unit tests — that directory is the pure core
  and is held to full coverage of its branches
- No secrets, tokens, real student names or unredacted API responses in the diff,
  including in test fixtures
