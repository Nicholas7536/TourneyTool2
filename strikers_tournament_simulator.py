#!/usr/bin/env python3
"""PoC simulator for the Strikers Club "Steal-a-Player" tournament format.

The simulator intentionally models roster mathematics rather than soccer
gameplay. Run one verbose tournament with:

    python strikers_tournament_simulator.py --runs 1

Run a statistical comparison across the requested pool sizes with:

    python strikers_tournament_simulator.py --compare --runs 10000

Policies:
    strict             Same-level matches only; stop when no legal match exists.
    strict-emergency   Same-level matches first, then nearest-level fallback.
    nearest             Always select the closest available roster sizes.
"""

from __future__ import annotations

import argparse
import json
import random
import statistics
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Iterable, Optional


MIN_ROSTER = 2
MAX_ROSTER = 5
DEFAULT_POOLS = (15, 18, 21, 24, 27, 30)
POLICIES = ("strict", "strict-emergency", "nearest")


@dataclass
class Team:
    id: str
    players: list[str]
    skill: float
    active: bool = True
    finalist: bool = False
    eliminated: bool = False

    @property
    def level(self) -> int:
        """Return the tournament level for a valid active roster."""
        return len(self.players) - 2

    @property
    def roster_size(self) -> int:
        return len(self.players)


@dataclass
class Match:
    match_number: int
    team_a: str
    team_b: str
    match_size: int
    winner: str
    loser: str
    players_stolen: list[str]
    emergency: bool = False
    winner_probability: float = 0.5


@dataclass
class TournamentResult:
    players: int
    starting_teams: int
    policy: str
    outcome_mode: str
    finalists: list[str]
    eliminated_players: int
    matches: list[Match]
    final_teams: list[Team]
    deadlock: bool
    termination_reason: str
    emergency_matches: int
    waiting_events: int
    level_zero_matches: int
    max_roster_seen: int
    history: list[str]

    @property
    def finalist_count(self) -> int:
        return len(self.finalists)

    @property
    def match_count(self) -> int:
        return len(self.matches)

    def to_json_dict(self) -> dict:
        result = asdict(self)
        result["finalist_count"] = self.finalist_count
        result["match_count"] = self.match_count
        return result


def validate_pool_size(players: int) -> None:
    if players < 6 or players % 3 != 0:
        raise ValueError("The starting population must be a multiple of 3 and at least 6.")


def make_teams(players: int, rng: random.Random) -> list[Team]:
    """Create the baseline population of groups of three."""
    validate_pool_size(players)
    player_ids = [f"P{i:02d}" for i in range(1, players + 1)]
    teams: list[Team] = []
    for index in range(0, players, 3):
        team_number = index // 3
        teams.append(
            Team(
                id=chr(ord("A") + team_number) if team_number < 26 else f"T{team_number + 1}",
                players=player_ids[index : index + 3],
                skill=rng.uniform(0.5, 1.5),
            )
        )
    return teams


def active_teams(teams: Iterable[Team]) -> list[Team]:
    return [team for team in teams if team.active and not team.finalist and not team.eliminated]


def state_string(teams: Iterable[Team]) -> str:
    """Render active, finalist, and eliminated rosters in a compact form."""
    ordered = sorted(teams, key=lambda team: (not team.active, team.id))
    parts: list[str] = []
    for team in ordered:
        if team.finalist:
            suffix = " finalist"
        elif team.eliminated:
            suffix = " eliminated"
        else:
            suffix = ""
        parts.append(f"{team.id}({team.roster_size}{suffix})")
    return " ".join(parts)


def same_level_pairs(teams: Iterable[Team]) -> list[tuple[Team, Team]]:
    by_size: dict[int, list[Team]] = {}
    for team in active_teams(teams):
        by_size.setdefault(team.roster_size, []).append(team)

    pairs: list[tuple[Team, Team]] = []
    for group in by_size.values():
        for index in range(0, len(group) - 1, 2):
            pairs.append((group[index], group[index + 1]))
    return pairs


def closest_pair(teams: Iterable[Team]) -> Optional[tuple[Team, Team]]:
    candidates = active_teams(teams)
    if len(candidates) < 2:
        return None

    best: Optional[tuple[Team, Team]] = None
    best_distance: Optional[int] = None
    for index, team_a in enumerate(candidates):
        for team_b in candidates[index + 1 :]:
            distance = abs(team_a.roster_size - team_b.roster_size)
            if best_distance is None or distance < best_distance:
                best_distance = distance
                best = (team_a, team_b)
    return best


def choose_winner(
    team_a: Team,
    team_b: Team,
    rng: random.Random,
    outcome_mode: str,
) -> tuple[Team, Team, float]:
    if outcome_mode == "random":
        probability_a = 0.5
    elif outcome_mode == "skill":
        probability_a = team_a.skill / (team_a.skill + team_b.skill)
    elif outcome_mode == "balanced":
        # Balanced outcomes retain a small advantage for the stronger team,
        # while preventing skill from making underdogs impossible.
        raw_probability = team_a.skill / (team_a.skill + team_b.skill)
        probability_a = 0.25 + raw_probability * 0.5
    else:
        raise ValueError(f"Unknown outcome mode: {outcome_mode}")

    if rng.random() < probability_a:
        return team_a, team_b, probability_a
    return team_b, team_a, 1.0 - probability_a


def resolve_match(
    team_a: Team,
    team_b: Team,
    *,
    match_number: int,
    rng: random.Random,
    outcome_mode: str,
    emergency: bool,
) -> Match:
    match_size = min(team_a.roster_size, team_b.roster_size)
    winner, loser, winner_probability = choose_winner(team_a, team_b, rng, outcome_mode)

    if not winner.active or not loser.active:
        raise RuntimeError("A match was scheduled for an inactive team.")
    if winner.roster_size >= MAX_ROSTER:
        raise RuntimeError("A finalist-sized team was scheduled before finalist locking.")
    if loser.roster_size < MIN_ROSTER:
        raise RuntimeError("A team below 2 players was scheduled.")

    stolen_player = loser.players.pop()
    winner.players.append(stolen_player)

    if len(loser.players) == 1:
        loser.active = False
        loser.eliminated = True
    if len(winner.players) == MAX_ROSTER:
        winner.active = False
        winner.finalist = True

    return Match(
        match_number=match_number,
        team_a=team_a.id,
        team_b=team_b.id,
        match_size=match_size,
        winner=winner.id,
        loser=loser.id,
        players_stolen=[stolen_player],
        emergency=emergency,
        winner_probability=winner_probability,
    )


def run_tournament(
    players: int = 24,
    policy: str = "strict-emergency",
    *,
    seed: Optional[int] = None,
    outcome_mode: str = "random",
    verbose: bool = False,
    max_matches: int = 1_000,
) -> TournamentResult:
    """Run one qualification phase and return all state transitions."""
    validate_pool_size(players)
    if policy not in POLICIES:
        raise ValueError(f"Unknown policy {policy!r}; choose from {', '.join(POLICIES)}.")
    if max_matches < 1:
        raise ValueError("max_matches must be at least 1.")

    rng = random.Random(seed)
    teams = make_teams(players, rng)
    matches: list[Match] = []
    history: list[str] = []
    waiting_events = 0
    level_zero_matches = 0
    emergency_matches = 0
    deadlock = False
    termination_reason = "two finalists reached"
    max_roster_seen = 3

    def record(message: str) -> None:
        history.append(message)
        if verbose:
            print(message)

    record("=== TOURNAMENT START ===")
    record(f"Players: {players}")
    record(f"Starting teams: {len(teams)}")
    record(f"Policy: {policy} | Outcome model: {outcome_mode}")
    record(f"State: {state_string(teams)}")

    while len([team for team in teams if team.finalist]) < 2:
        if len(matches) >= max_matches:
            deadlock = True
            termination_reason = f"match limit reached ({max_matches})"
            record(f"TERMINATED: {termination_reason}")
            break

        pairs = same_level_pairs(teams)
        emergency = False
        if pairs:
            # All exact-level pairs are legal. Do not impose an additional
            # level priority: match order is part of what this PoC needs to
            # measure, including the critical 4-with-2 deadlock state.
            team_a, team_b = rng.choice(pairs)
        elif policy in ("strict-emergency", "nearest"):
            pair = closest_pair(teams)
            if pair is None:
                deadlock = bool(active_teams(teams))
                termination_reason = (
                    "only one active team remains"
                    if len(active_teams(teams)) == 1
                    else "no active teams remain"
                )
                record(f"TERMINATED: {termination_reason}")
                break
            team_a, team_b = pair
            emergency = True
            waiting_events += 1
        else:
            waiting_events += 1
            deadlock = bool(active_teams(teams))
            termination_reason = (
                "strict same-level matchmaking deadlock"
                if deadlock
                else "no active teams remain"
            )
            record(f"TERMINATED: {termination_reason}")
            break

        match_number = len(matches) + 1
        record(f"\nMatch {match_number}")
        is_emergency_match = emergency or team_a.roster_size != team_b.roster_size
        match = resolve_match(
            team_a,
            team_b,
            match_number=match_number,
            rng=rng,
            outcome_mode=outcome_mode,
            emergency=is_emergency_match,
        )
        matches.append(match)
        max_roster_seen = max(max_roster_seen, team_a.roster_size, team_b.roster_size)
        if match.emergency:
            emergency_matches += 1
        if match.match_size == 2:
            level_zero_matches += 1
        marker = " [EMERGENCY]" if match.emergency else ""
        record(
            f"{match.team_a}({team_a.roster_size}) "
            f"vs {match.team_b}({team_b.roster_size}) "
            f"-> {match.winner} wins, steals {match.players_stolen[0]}{marker}"
        )
        if team_a.finalist:
            record(f"{team_a.id} reaches 5 and locks as a finalist.")
        if team_b.finalist:
            record(f"{team_b.id} reaches 5 and locks as a finalist.")
        if team_a.eliminated:
            record(f"{team_a.id} drops to 1 and is eliminated.")
        if team_b.eliminated:
            record(f"{team_b.id} drops to 1 and is eliminated.")

        record(f"State: {state_string(teams)}")

    finalists = [team.id for team in teams if team.finalist]
    # Eliminated teams keep their one-player roster in the history; count all
    # players no longer in active/finalist rosters instead.
    players_remaining = sum(team.roster_size for team in teams if team.active or team.finalist)
    eliminated_players = players - players_remaining
    if len(finalists) >= 2:
        termination_reason = "two finalists reached"

    record("\n=== TOURNAMENT RESULT ===")
    record(f"Finalists ({len(finalists)}): {', '.join(finalists) or 'none'}")
    record(f"Eliminated players: {eliminated_players}")
    record(f"Total matches: {len(matches)}")
    record(f"Deadlock: {'yes' if deadlock else 'no'}")
    record(f"Emergency matches: {emergency_matches}")

    return TournamentResult(
        players=players,
        starting_teams=len(teams),
        policy=policy,
        outcome_mode=outcome_mode,
        finalists=finalists,
        eliminated_players=eliminated_players,
        matches=matches,
        final_teams=teams,
        deadlock=deadlock,
        termination_reason=termination_reason,
        emergency_matches=emergency_matches,
        waiting_events=waiting_events,
        level_zero_matches=level_zero_matches,
        max_roster_seen=max_roster_seen,
        history=history,
    )


def percentile(values: list[int], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def summarize(results: list[TournamentResult]) -> dict:
    if not results:
        raise ValueError("Cannot summarize an empty result set.")
    matches = [result.match_count for result in results]
    finalist_counts = Counter(result.finalist_count for result in results)
    total = len(results)
    return {
        "runs": total,
        "players": results[0].players,
        "policy": results[0].policy,
        "outcome_mode": results[0].outcome_mode,
        "finalist_probability": {
            str(count): round(finalist_counts[count] / total, 6) for count in range(0, 5)
        },
        "average_matches": statistics.mean(matches),
        "median_matches": statistics.median(matches),
        "min_matches": min(matches),
        "max_matches": max(matches),
        "p90_matches": percentile(matches, 0.9),
        "average_eliminated": statistics.mean(result.eliminated_players for result in results),
        "average_level_zero_matches": statistics.mean(
            result.level_zero_matches for result in results
        ),
        "average_waiting_events": statistics.mean(result.waiting_events for result in results),
        "deadlock_probability": sum(result.deadlock for result in results) / total,
        "emergency_probability": sum(result.emergency_matches > 0 for result in results) / total,
        "average_emergency_matches": statistics.mean(
            result.emergency_matches for result in results
        ),
    }


def run_batch(
    players: int,
    runs: int,
    policy: str,
    *,
    seed: Optional[int],
    outcome_mode: str,
) -> list[TournamentResult]:
    if runs < 1:
        raise ValueError("runs must be at least 1.")
    master_rng = random.Random(seed)
    return [
        run_tournament(
            players=players,
            policy=policy,
            seed=master_rng.randrange(2**63),
            outcome_mode=outcome_mode,
        )
        for _ in range(runs)
    ]


def print_summary(summary: dict) -> None:
    probabilities = summary["finalist_probability"]
    print(f"\n{summary['players']} PLAYER SIMULATION — {summary['runs']:,} RUNS")
    print(f"Policy: {summary['policy']} | Outcome model: {summary['outcome_mode']}")
    print(
        "Finalists:       "
        + "  ".join(f"{count}: {probabilities[str(count)] * 100:5.1f}%" for count in range(5))
    )
    print(f"Average matches:  {summary['average_matches']:.2f}")
    print(f"Median matches:   {summary['median_matches']:.2f}")
    print(f"90th percentile:  {summary['p90_matches']:.2f}")
    print(f"Min / max:        {summary['min_matches']} / {summary['max_matches']}")
    print(f"Average eliminated:{summary['average_eliminated']:7.2f}")
    print(f"Avg level-0 matches:{summary['average_level_zero_matches']:6.2f}")
    print(f"Avg waiting events:{summary['average_waiting_events']:7.2f}")
    print(f"Deadlocks:        {summary['deadlock_probability'] * 100:5.1f}%")
    print(f"Emergency needed: {summary['emergency_probability'] * 100:5.1f}%")
    print(f"Avg emergencies:  {summary['average_emergency_matches']:.2f}")


def write_interesting_histories(
    results: Iterable[TournamentResult],
    path: Path,
    *,
    limit: int = 25,
) -> int:
    """Write edge cases and non-standard finalist outcomes as JSONL."""
    written = 0
    with path.open("w", encoding="utf-8") as output:
        for result in results:
            interesting = (
                result.deadlock
                or result.emergency_matches > 0
                or result.finalist_count != 2
            )
            if not interesting:
                continue
            output.write(json.dumps(result.to_json_dict()) + "\n")
            written += 1
            if written >= limit:
                break
    return written


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--players", type=int, default=24, help="Starting population (default: 24).")
    parser.add_argument("--runs", type=int, default=1, help="Number of tournaments (default: 1).")
    parser.add_argument(
        "--policy",
        choices=POLICIES,
        default="strict-emergency",
        help="Matchmaking policy (default: strict-emergency).",
    )
    parser.add_argument(
        "--outcome",
        choices=("random", "skill", "balanced"),
        default="random",
        help="Match winner model (default: random).",
    )
    parser.add_argument("--seed", type=int, help="Seed for reproducible simulations.")
    parser.add_argument(
        "--compare",
        action="store_true",
        help="Compare the default 15/18/21/24/27/30-player pools.",
    )
    parser.add_argument(
        "--compare-policies",
        action="store_true",
        help="Compare all three policies for the selected pool.",
    )
    parser.add_argument(
        "--save-histories",
        type=Path,
        metavar="FILE",
        help="Save up to 25 interesting tournament histories as JSONL.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print batch summaries as JSON instead of formatted text.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    policies = POLICIES if args.compare_policies else (args.policy,)
    pools = DEFAULT_POOLS if args.compare else (args.players,)
    all_results: list[TournamentResult] = []
    summaries: list[dict] = []

    for policy in policies:
        for players in pools:
            single_verbose_run = (
                args.runs == 1 and not args.compare and not args.compare_policies
            )
            if single_verbose_run:
                results = [
                    run_tournament(
                        players=players,
                        policy=policy,
                        seed=args.seed,
                        outcome_mode=args.outcome,
                        verbose=True,
                    )
                ]
            else:
                results = run_batch(
                    players=players,
                    runs=args.runs,
                    policy=policy,
                    seed=args.seed,
                    outcome_mode=args.outcome,
                )
            all_results.extend(results)
            summary = summarize(results)
            summaries.append(summary)

            if not single_verbose_run and not args.json:
                print_summary(summary)

    if args.json:
        print(json.dumps(summaries[0] if len(summaries) == 1 else summaries, indent=2))

    if args.save_histories:
        written = write_interesting_histories(all_results, args.save_histories)
        print(f"Saved {written} interesting histories to {args.save_histories}")


if __name__ == "__main__":
    main()