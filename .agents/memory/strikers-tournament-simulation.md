---
name: Tournament state reachability
description: Reachability finding for the steal-a-player roster simulator.
---

The documented 4-player/2-player deadlock state is not reachable from a valid
all-3-player starting population under the stated one-player-steal transitions
when same-level matching is used. The simulator should detect deadlocks
generically, but must not inject that state or report it as a normal 24-player
outcome.

**Why:** Exhaustive state exploration and a large seeded simulation sweep both
showed the valid transition system preserves enough same-level pairings to
reach the second finalist without that specific deadlock.

**How to apply:** Keep deadlock handling and emergency policy support in place
for future rule changes or custom starting states, and treat handoff examples
as fixtures to validate rather than assumptions about the baseline model.