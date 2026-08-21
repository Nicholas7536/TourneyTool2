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

For multiplayer room development, copy `.env.example` to `.env.local` and set
your MongoDB Atlas connection string:

```bash
cp .env.example .env.local
```

Set `MONGODB_URI` and optionally `MONGODB_DB`. The simulator can still load
without MongoDB configured, but creating or joining rooms requires it.

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

The browser shell loads without environment variables, but room creation and
joining require `MONGODB_URI`. Add `MONGODB_URI` and optionally `MONGODB_DB` to
the Vercel project environment variables for multiplayer use.

## Rules reference

The standalone Python simulator remains at the repository root as a separate
rules and batch-testing reference. It is not required to run the browser app.

## Future multiplayer direction

The current app is intentionally local-only. The planned multiplayer version
will add a server-backed tournament room with a shareable link, host-owned
rules, player/team joining, substitute queueing, challenge acceptance, lobby
assignment, match result reporting, and finalist progression.