# Strikers Tournament Simulator

A minimal React/Vite browser simulator for testing the Strikers Club
steal-a-player tournament rules.

Inspired by the Blue Lock second selection steal a player stage. For a comprehensive breakdown of the original rules and how they are used in the show, see the [Blue Lock Fandom Wiki](https://bluelock.fandom.com/wiki/Second_Selection:_Rivalry_Battle). For the precise technical match logic and verbose backend code design, see the local [TOURNAMENT_RULES.md](TOURNAMENT_RULES.md) file.

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

