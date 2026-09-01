# Strikers Tournament Simulator

Minimal React/Vite simulator for the Strikers Club steal-a-player tournament.

## Core Intructions

- No emojis, no markdown headers
- Terse and direct only
- Always read files with tools, never guess
- No thinking/reasoning mode
- Code only unless explanation is asked

## Quick start

- Requires Node.js 20.19+ and pnpm 10+.
- Install: `pnpm install`
- Develop: `pnpm run dev`
- Verify: `pnpm run typecheck` and `pnpm run build`
- Preview/production server: `pnpm run serve`

## Environment

Use `.env.local` for `MONGODB_URI` and optional `MONGODB_DB` when testing rooms.
Never commit credentials. The manual harness also requires
`ENABLE_TEST_HARNESS=true` and `/?harness=1`; keep it disabled in production.

## Additional context

- [tournament.md](TOURNAMENT_RULES.md): tournament rules and invariants.
- [testingharness.md](.agents/testing-harness.md): manual multiplayer harness.