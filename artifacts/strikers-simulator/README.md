# Strikers Tournament Simulator

A minimal React/Vite browser simulator for testing the Strikers Club
steal-a-player tournament rules.

## Requirements

- Node.js 20 or newer
- pnpm 10 or newer (or npm, if you adapt the commands)

## Install

```bash
pnpm install
```

## Development

```bash
pnpm run dev
```

Vite starts the development server on port 5173 by default. Replit supplies
the `PORT` and `BASE_PATH` environment variables automatically when running
the artifact there; neither variable is required for a normal local or Vercel
build.

## Check and build

```bash
pnpm run typecheck
pnpm run build
```

The production files are written to `dist/public`.

To preview the production build locally:

```bash
pnpm run serve
```

## Vercel

Copy the contents of this folder into a GitHub repository and import that
repository into Vercel. The included `vercel.json` configures the correct
Vite build and output directory:

- Build command: `pnpm run build`
- Output directory: `dist/public`
- Install command: `pnpm install`

No environment variables are required for the current local simulator.

## Rules reference

The standalone Python simulator remains at the repository root as a separate
rules and batch-testing reference. It is not required to run the browser app.

## Future multiplayer direction

The current app is intentionally local-only. The planned multiplayer version
will add a server-backed tournament room with a shareable link, host-owned
rules, player/team joining, substitute queueing, challenge acceptance, lobby
assignment, match result reporting, and finalist progression.