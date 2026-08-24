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

Vite starts the development server on port 5173 by default. `PORT` and
`BASE_PATH` may be set when running behind a hosting platform; neither is
required for a normal local or Vercel build.

For multiplayer room development, copy the repository root `.env.example` to
`.env.local` and set your MongoDB Atlas connection string:

```bash
cp .env.example .env.local
```

Set `MONGODB_URI` and optionally `MONGODB_DB`. The simulator can still load
without MongoDB configured, but creating or joining rooms requires it. Never
commit `.env.local` or put credentials in source files.

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

Import the repository into Vercel from its root. The root `vercel.json`
configures the Vite build and output directory, while `api/[...path].ts`
exposes the Express API as a Vercel function:

- Build command: `pnpm run build`
- Output directory: `dist/public`
- Install command: `pnpm install`

The browser shell loads without environment variables, but room creation and
joining require `MONGODB_URI`. Add `MONGODB_URI` and optionally `MONGODB_DB` to
the Vercel project environment variables for multiplayer use. Add them in the
Vercel project settings for each required environment; do not commit them.

Rooms are cleaned up automatically in MongoDB. Waiting rooms expire after 24
hours, active tournaments after 7 days, and finished tournaments after 24
hours. MongoDB's TTL index performs the background cleanup, while API reads
also remove expired legacy room records.

## Rules reference

The standalone Python simulator remains at the repository root as a separate
rules and batch-testing reference. It is not required to run the browser app.
