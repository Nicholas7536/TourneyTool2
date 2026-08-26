# Strikers Tournament Simulator

A minimal React/Vite browser simulator for testing the Strikers Club
steal-a-player tournament rules.

To learn more about the tournament rules, [click here](TOURNAMENT_RULES.md).

## Requirements

- Node.js 20.19 or newer (Render uses Node.js 22.15.0)
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
required for a normal local build.

For multiplayer room development, create a repository-root `.env.local` and
set your MongoDB Atlas connection string:

```bash
touch .env.local
```

Set `MONGODB_URI` and optionally `MONGODB_DB`. The simulator can still load
without MongoDB configured, but creating or joining rooms requires it. Never
commit `.env.local` or put credentials in source files.

To enable the development-only manual multiplayer harness, also set:

```bash
ENABLE_TEST_HARNESS=true
```

Restart the server, then open `/?harness=1`. Click **Create fresh 15-player
room** and open the individual player views. Each view uses a separate test
token while running the normal tournament frontend, so all actions remain
manual. The harness is disabled and its API returns 404 unless the environment
flag is enabled.

### Manual harness commands

From the repository root, install dependencies and build the frontend:

```powershell
pnpm install
pnpm run typecheck
pnpm run build
```

For the current PowerShell session, enable the harness with:

```powershell
$env:ENABLE_TEST_HARNESS = "true"
```

Alternatively, add `ENABLE_TEST_HARNESS=true` to `.env.local` before starting the server.

Then start the Vite development server:

```powershell
pnpm run dev
```

Open [http://localhost:5173/?harness=1](http://localhost:5173/?harness=1).

To run the built version instead:

```powershell
pnpm run serve
```

Then open [http://localhost:3000/?harness=1](http://localhost:3000/?harness=1).

Do not enable `ENABLE_TEST_HARNESS` in production.

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

## Production server

Run the Express server with `pnpm run serve` after building. It serves the
compiled browser application and the `/api` routes from the same process.
Room creation and joining require `MONGODB_URI`; optionally set `MONGODB_DB`.
Keep these values in the environment and do not commit them.

Rooms are cleaned up automatically in MongoDB. Waiting rooms expire after 24
hours, active tournaments after 7 days, and finished tournaments after 24
hours. MongoDB's TTL index performs the background cleanup, while API reads
also remove expired legacy room records.

## Deploy on Render

The repository includes `render.yaml` for a Render Node web service. Render
uses the checked-in pnpm lockfile, runs `pnpm install --frozen-lockfile` and
`pnpm run build`, then starts the Express server with `pnpm run serve`.
Node.js 22.15.0 is configured for the service because Vite 7 requires Node.js
20.19 or newer. The pnpm workspace configuration explicitly permits pnpm to
run esbuild's required install step during the Render build.
It also disables pnpm's dependency verification reinstall when the server
starts, preventing a second install from exceeding Render's free-tier memory
limit.

Set `MONGODB_URI` in the Render environment before using room creation or
joining. `MONGODB_DB` defaults to `strikers`. The server listens on Render's
`PORT` automatically.

