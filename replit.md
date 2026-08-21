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

- The current app is intentionally local-only; multiplayer persistence and realtime coordination will be added as a focused backend when that work starts.

## Product

The current app runs single tournaments and batch simulations locally. The planned product will add shared-link tournaments, host-controlled rules, team joining, substitutes, challenges, match reporting, and finalist progression.

## User preferences

- Keep the interface minimal and functional; avoid decorative styling and unnecessary components.

## Gotchas

The current simulator is a proof of concept, not yet a multiplayer tournament service.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
