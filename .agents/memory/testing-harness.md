---
name: Manual testing harness
description: How to exercise the Strikers simulator's development-only multiplayer harness.
---

The browser simulator includes a development-only manual multiplayer harness. Set
`ENABLE_TEST_HARNESS=true`, start the app, and open `/?harness=1`. Create a fresh
15-player room, then open the isolated player sessions to exercise the normal
tournament UI manually.

Harness endpoints return 404 when the flag is disabled. Keep the flag off in
production. From the repository root, validate with:

```powershell
corepack pnpm --filter @workspace/strikers-simulator run typecheck
corepack pnpm --filter @workspace/strikers-simulator run build
```
