# Strikers Tournament Simulator

A minimal browser simulator for testing the Strikers Club steal-a-player tournament rules.

## Run & Operate

- `pnpm --filter @workspace/strikers-simulator run dev` — run the browser simulator
- `pnpm run typecheck` — typecheck the simulator
- `pnpm run build` — build the simulator
- `python strikers_tournament_simulator.py --help` — run the standalone rules simulator

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite
- Rules reference: standalone Python simulator

## Where things live

- `artifacts/strikers-simulator/src/App.tsx` — browser simulator and visualization
- `strikers_tournament_simulator.py` — batch-capable rules simulator and validation reference

## Architecture decisions

- Multiplayer rooms use a focused MongoDB-backed API with polling for shared state; there is no large realtime framework or component library.

## Product

The app supports shared-link tournament rooms, host-controlled rules, team joining, substitute queueing and replacement, challenges, match reporting, and finalist progression. The standalone Python simulator remains available for rules testing.

## User preferences

- Keep the interface minimal and functional; avoid decorative styling and unnecessary components.

## Gotchas

Room creation and joining require `MONGODB_URI`; use `artifacts/strikers-simulator/.env.example` for the expected configuration names.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
