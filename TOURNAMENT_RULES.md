# Strikers Club Tournament Rules

This document is the behavioral contract for the tournament simulator and web app. Tests should treat the rules in the **Hard rules** section as invariants. The matchmaking policies and emergency behavior are configurable or still under investigation.

## 1. Tournament model

This is a population ladder, not a fixed bracket. Teams move between roster levels as they win or lose matches.

The intended progression is:

```text
2 players -> 3 players -> 4 players -> 5 players -> finalist
```

A team can move downward after losing:

```text
5 players -> finalist lock
4 players -> 3 players
3 players -> 2 players
2 players -> 1 player -> eliminated
```

## 2. Hard rules

### 2.1 Lobby limits

- The smallest valid match is 2v2 (4 players total).
- Valid normal match sizes are 2v2, 3v3, and 4v4.
- A 5-player team is a finalist and does not enter another qualification match.
- No 6v6 match is allowed.

### 2.2 Starting state

- Everyone starts in teams of three.
- Other supported starting populations are 15, 18, 21, 27, and 30 players.
- Starting populations are divisible by three and produce complete 3-player teams.

### 2.3 Steal mechanic

After every completed match:

- The winner permanently takes exactly one player from the loser.
- The loser permanently loses exactly one player.
- The player is transferred; players are never borrowed or temporarily loaned.
- The stolen player's team assignment must change to the winner.
- The selected stolen player must belong to the losing team.

Normal transitions are:

| Match | Winner after match | Loser after match |
|---|---:|---:|
| 2v2 | 3 | 1, eliminated |
| 3v3 | 4 | 2 |
| 4v4 | 5, finalist | 3 |

### 2.4 Elimination

- A team with one remaining player is eliminated.
- An eliminated team cannot challenge, accept, or enter another match.
- The remaining player is no longer part of the active tournament population.
- A 2v2 loss therefore eliminates exactly one player.

### 2.5 Finalists

- Reaching five players immediately locks the team as a finalist.
- A finalist leaves the active ladder.
- A finalist cannot steal more players or enter qualification matches.
- The preferred qualification ending is the first two teams to reach five.
- One finalist is a valid edge-case outcome if all other active teams eventually disappear before a second finalist is created.

### 2.6 Challenging Rules

- A team may participate in at most one active match at a time.
- A team in an active match cannot create or accept another match. Any previously pending challenges are deleted
- A team that has issued a pending challenge cannot issue another pending challenge.
- The issuing team may cancel its own pending challenge and then challenge a different team.
- A team that is only the target of pending challenges is not reserved and may receive additional challenges or issue its own challenge.
- When a target accepts one challenge, competing pending challenges involving either participating team become invalid.
- The frontend must hide or disable unavailable teams.
- The backend must enforce this independently of the frontend, including for stale clients and concurrent requests.
- If two requests race, at most one match may be created for any team pair or participating team.
- Who a team is allowed to challenge must be in accordance with section 3 matchmaking

This rule applies to the challenge, acceptance, and match-creation lifecycle. A completed/reported match releases both teams for future legal matching, subject to their new roster states.

## 3. Matchmaking

### Default behavior

Teams MUST play another active team at the same roster level:

- 2 players versus 2 players
- 3 players versus 3 players
- 4 players versus 4 players

Waiting is intentional. A team without a same-level opponent should wait while other legal matches resolve.

Under normal matchmaking, teams do not automatically play larger or smaller teams.

#### Strict with emergency fallback

Use strict same-level matchmaking first. IF and only IF the entire active tournament is stuck, allow the nearest available levels to play as an emergency match from lowest to highest players.
Example: If 3 teams with the following count ( 4 players, 3 players, 2 players ) play then 3v2 must play first, then then winner of that game will be 4 players, allowing for a 4v4 in the next round.

### Emergency matches

Emergency matching is not normal matchmaking. It exists only to recover from a complete deadlock.

Example: if a 3-player team must play a 2-player team, the match is treated as 2v2:

- The 3-player team fields only two players.
- If the 3-player team wins: 3 -> 4 , and 2 -> 1 eliminated.
- If the 2-player team wins: 2 -> 3, and 3 -> 2.

If the same two teams keep trading the same player and are stuck. the third game will be golden goal, the loser will be eliminated from the tournament and team.size()-1 will be stolen:
Example: Team A = 3, Team B = 2
B beats A, steals player to have 3 players (A=2, B=3
A beats B, steals player back to have 3 players (A=3, B=2)
B beats A in golden goal (first to score wins). B steals A.size()-1 players (B steals 2 players, Team A's last player is eliminated, B now has 4 players).

Emergency matches must be recorded as such and must not allow a team below two players to participate.

## 4. State invariants

After every state transition:

- A player belongs to zero or one team.
- A player cannot simultaneously be on a team and in the substitute/eliminated pool.
- A team's roster size equals the number of player IDs assigned to it.
- Active teams have valid rosters of at least two players.
- Finalists have exactly five players and are inactive.
- Eliminated teams have one remaining historical player and are inactive.
- A match has two different teams.
- No active match contains the same team on both sides.
- No team appears in more than one active match.
- A reported match cannot be reported again.
- A winner and loser must be the two teams in that match.
- Exactly one player is transferred when a match is reported, unless the match is using golden goal rules under section 3.
- The total number of players is conserved except for players explicitly eliminated at level zero.


## 5. Tournament completion and edge cases

The qualification phase normally stops when two finalists exist. Number of maximum finalists can also be changed, a range between 1-5. Tests should also support and report:

- One finalist
- Two finalists
- More than two finalists under experimental policies
- Complete elimination without a second finalist
- Strict same-level deadlock
- Emergency recovery from a deadlock
- No possible legal match remaining
- Repeated, stale, duplicate, or concurrent challenge/accept/report requests

The grand final between two finalists is outside the first qualification-phase simulator unless explicitly implemented later.

## 6. Required test scenarios

At minimum, automated tests should cover:

1. A 3v3 win creates a 4-player winner and a 2-player loser.
2. A 2v2 win creates a 3-player winner and eliminates the loser.
3. A 4v4 win creates and locks a finalist and a 3 player loser.
3. A 3v4 match, if 3 team wins it creates a 4-player winner and 3-player loser and vise versa
3. A 2v3 match, if 3-player team wins creates a 4-player winner and eliminates the loser
3. A 2v3 match, if 2-player team wins creates a 3-player winner and 2 player loser
3. A 4v3 match, if 4-player team wins locks a finalist and 2 player loser
3. A 4v3 match, if 3-player team wins creates a 4-player winner and 3 player loser
4. A finalist cannot enter another match.
5. An eliminated team cannot enter another match.
6. A team cannot challenge itself.
7. A team cannot participate in two active matches.
8. A team can cancel its outgoing pending challenge and then issue a different challenge.
9. The frontend hides unavailable targets after room state refresh.
10. A stale frontend request receives a safe rejection and refreshes state.
11. Concurrent challenge or acceptance requests create at most one active match per team. At match creation challenge requests to any team in the active match are deleted.
12. Invalid winners, stolen players, duplicate reports, and unauthorized reports are rejected.
13. Strict matchmaking rejects unequal roster sizes.
14. Strict matchmaking waits when no same-level opponent exists.
15. Emergency matching is used only when the tournament is genuinely stuck.


The first priority is proving that the tournament state transitions, one-match-per-team rule, edge-case handling, and frontend behavior are correct.
