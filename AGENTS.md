# Agent Working Agreement

These guidelines tell automation (and humans) how to contribute changes here.

## Branching & PRs

- Never push changes directly to `master`.
- Always update local `master` before branching:
  - `git fetch origin`
  - `git checkout master`
  - `git reset --hard origin/master` (or `git pull --ff-only` if no divergence)
- For any new work, create a feature branch from `master` using the pattern:
  - `feat/<short-topic>` for features
  - `fix/<short-topic>` for bug fixes
  - `chore/<short-topic>` for maintenance
  - `docs/<short-topic>` for documentation-only changes
- Open a Pull Request into `master` with a concise description and checklist of changes.
- Keep PRs focused and reasonably small. Avoid bundling unrelated changes.

## Checkpointed Workflow (with user signals)

- Branch creation: wait for explicit user signal before creating a new branch.
- Implementation: iterate commits in that branch until the user confirms the work is ready.
- PR creation: wait for explicit user signal before opening a PR.
- Follow‑ups during review: assess if the request belongs in the same PR or a new branch.
  - Use judgment (scope, complexity, risk). If in doubt, ask user to confirm.
  - Prefer a new branch if the request is out of scope or large enough to delay the current PR.
- Never merge; leave merging to the user or CI/maintainers.

## Commits

- Use Conventional Commits style when possible:
  - `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `build:`, `ci:`
- Prefer clear, imperative subject lines and minimal noise.

## CI & Deploy

- GitHub Pages deploy is driven by Actions on pushes to `master` (`.github/workflows/deploy.yml`).
- Do not commit build artifacts (`dist/` is ignored); Pages deploy uses CI build output.
- Ensure `npm run lint` and `npm run build` succeed locally before opening a PR.

## Protobufs

- If `.proto` files under `proto/` change, regenerate `src/lib/protos.json` with `protobufjs-cli` (see README Regenerating protobuf JSON) and include the updated JSON in the PR.

## Browser constraints

- Web Bluetooth requires user gestures; do not add auto-scan behavior. Keep UX flows explicit.

## Keys & Secrets

- Never commit private keys or sensitive data. The UI supports importing/generating keys locally.

## Exceptions

- If a critical hotfix is required, still prefer a short-lived `fix/…` branch + PR for traceability.

By contributing, follow the above to keep the history tidy and deployments predictable.
