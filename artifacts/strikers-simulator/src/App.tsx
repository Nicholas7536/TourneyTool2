import { useMemo, useState } from "react";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  FlaskConical,
  Gauge,
  Info,
  Layers3,
  Play,
  RotateCcw,
  ShieldAlert,
  Trophy,
  Users,
  Zap,
} from "lucide-react";
import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/components/error-boundary";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Switch, useLocation, Router as WouterRouter } from "wouter";

const queryClient = new QueryClient();
const POOLS = [15, 18, 21, 24, 27, 30] as const;
const POLICIES = ["strict", "strict-emergency", "nearest"] as const;
const OUTCOMES = ["random", "skill", "balanced"] as const;
type Pool = (typeof POOLS)[number];
type Policy = (typeof POLICIES)[number];
type OutcomeMode = (typeof OUTCOMES)[number];
type Rng = () => number;

type Team = {
  id: string;
  players: string[];
  rosterSize: number;
  level: number;
  active: boolean;
  finalist: boolean;
  eliminated: boolean;
  skill: number;
};

type Match = {
  matchNumber: number;
  teamA: string;
  teamB: string;
  matchSize: number;
  winner: string;
  loser: string;
  playersStolen: string[];
  emergency: boolean;
  winnerProbability: number;
  teamASize: number;
  teamBSize: number;
};

type HistoryMeta = {
  type: "intro" | "match" | "result";
  snapshotIndex: number;
};

type TournamentResult = {
  finalists: string[];
  eliminatedPlayers: number;
  matches: Match[];
  deadlock: boolean;
  terminationReason: string;
  emergencyMatches: number;
  waitingEvents: number;
  levelZeroMatches: number;
  finalTeams: Team[];
  history: string[];
  historyMeta: HistoryMeta[];
  stateSnapshots: Team[][];
  players: number;
  policy: Policy;
  outcomeMode: OutcomeMode;
};

type BatchSummary = {
  runs: number;
  finalistProbability: Record<string, number>;
  averageMatches: number;
  medianMatches: number;
  minMatches: number;
  maxMatches: number;
  averageEliminated: number;
  deadlockProbability: number;
  emergencyProbability: number;
};

const policyCopy: Record<Policy, { label: string; detail: string }> = {
  strict: { label: "Strict", detail: "Same roster level only" },
  "strict-emergency": {
    label: "Strict + emergency",
    detail: "Same level, then nearest fallback",
  },
  nearest: { label: "Nearest", detail: "Closest roster sizes first" },
};

const outcomeCopy: Record<OutcomeMode, { label: string; detail: string }> = {
  random: { label: "Random", detail: "50 / 50 outcomes" },
  skill: { label: "Skill weighted", detail: "Full skill advantage" },
  balanced: { label: "Balanced", detail: "Soft skill advantage" },
};

function seededRng(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function cloneTeams(teams: Team[]): Team[] {
  return teams.map((team) => ({ ...team, players: [...team.players] }));
}

function makeTeams(players: number, rng: Rng): Team[] {
  return Array.from({ length: players / 3 }, (_, index) => ({
    id: index < 26 ? String.fromCharCode(65 + index) : `T${index + 1}`,
    players: Array.from(
      { length: 3 },
      (_, playerIndex) =>
        `P${String(index * 3 + playerIndex + 1).padStart(2, "0")}`,
    ),
    rosterSize: 3,
    level: 1,
    active: true,
    finalist: false,
    eliminated: false,
    skill: 0.5 + rng(),
  }));
}

function activeTeams(teams: Team[]): Team[] {
  return teams.filter(
    (team) => team.active && !team.finalist && !team.eliminated,
  );
}

function boardState(teams: Team[]): string {
  return teams.map((team) => `${team.id}(${team.rosterSize})`).join("  ");
}

function sameLevelPairs(teams: Team[]): [Team, Team][] {
  const groups = new Map<number, Team[]>();
  activeTeams(teams).forEach((team) => {
    const group = groups.get(team.rosterSize) ?? [];
    group.push(team);
    groups.set(team.rosterSize, group);
  });
  const pairs: [Team, Team][] = [];
  groups.forEach((group) => {
    for (let index = 0; index < group.length - 1; index += 2) {
      pairs.push([group[index], group[index + 1]]);
    }
  });
  return pairs;
}

function closestPair(teams: Team[]): [Team, Team] | null {
  const candidates = activeTeams(teams);
  let best: [Team, Team] | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  candidates.forEach((teamA, index) => {
    candidates.slice(index + 1).forEach((teamB) => {
      const distance = Math.abs(teamA.rosterSize - teamB.rosterSize);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = [teamA, teamB];
      }
    });
  });
  return best;
}

function winnerFor(
  teamA: Team,
  teamB: Team,
  rng: Rng,
  outcome: OutcomeMode,
): [Team, Team, number] {
  const raw = teamA.skill / (teamA.skill + teamB.skill);
  const probability =
    outcome === "random"
      ? 0.5
      : outcome === "balanced"
        ? 0.25 + raw * 0.5
        : raw;
  return rng() < probability
    ? [teamA, teamB, probability]
    : [teamB, teamA, 1 - probability];
}

function runTournament(
  players: Pool,
  policy: Policy,
  outcomeMode: OutcomeMode,
  seed: number,
): TournamentResult {
  const rng = seededRng(seed);
  const teams = makeTeams(players, rng);
  const matches: Match[] = [];
  const history: string[] = [];
  const historyMeta: HistoryMeta[] = [];
  const stateSnapshots: Team[][] = [cloneTeams(teams)];
  let waitingEvents = 0;
  let emergencyMatches = 0;
  let levelZeroMatches = 0;
  let deadlock = false;
  let terminationReason = "two finalists reached";

  const record = (
    text: string,
    type: HistoryMeta["type"],
    snapshotIndex: number,
  ) => {
    history.push(text);
    historyMeta.push({ type, snapshotIndex });
  };

  record("TOURNAMENT READY", "intro", 0);
  record(
    `${players} players · ${teams.length} teams · ${policyCopy[policy].label}`,
    "intro",
    0,
  );
  record(`Initial board: ${boardState(teams)}`, "intro", 0);

  while (teams.filter((team) => team.finalist).length < 10) {
    if (matches.length >= 1000) {
      deadlock = true;
      terminationReason = "match limit reached";
      record(`TERMINATED · ${terminationReason}`, "result", matches.length);
      break;
    }
    const exactPairs = sameLevelPairs(teams);
    let pair: [Team, Team] | null = null;
    let emergency = false;
    if (exactPairs.length) {
      pair = exactPairs[Math.floor(rng() * exactPairs.length)];
    } else if (policy !== "strict") {
      pair = closestPair(teams);
      emergency = true;
      if (pair) waitingEvents += 1;
    } else {
      waitingEvents += 1;
      deadlock = activeTeams(teams).length > 0;
      terminationReason = deadlock
        ? "strict same-level matchmaking deadlock"
        : "no active teams remain";
      record(`TERMINATED · ${terminationReason}`, "result", matches.length);
      break;
    }
    if (!pair) {
      deadlock = activeTeams(teams).length > 0;
      terminationReason = deadlock
        ? "only one active team remains"
        : "no active teams remain";
      record(`TERMINATED · ${terminationReason}`, "result", matches.length);
      break;
    }

    const [teamA, teamB] = pair;
    const teamASize = teamA.rosterSize;
    const teamBSize = teamB.rosterSize;
    const [winner, loser, winnerProbability] = winnerFor(
      teamA,
      teamB,
      rng,
      outcomeMode,
    );
    const stolenPlayer = loser.players.pop() ?? "unknown";
    winner.players.push(stolenPlayer);
    loser.rosterSize = loser.players.length;
    loser.level = loser.rosterSize - 2;
    winner.rosterSize = winner.players.length;
    winner.level = winner.rosterSize - 2;
    if (loser.rosterSize === 1) {
      loser.active = false;
      loser.eliminated = true;
    }
    if (winner.rosterSize === 5) {
      winner.active = false;
      winner.finalist = true;
    }
    const isEmergency = emergency || teamASize !== teamBSize;
    const match: Match = {
      matchNumber: matches.length + 1,
      teamA: teamA.id,
      teamB: teamB.id,
      matchSize: Math.min(teamASize, teamBSize),
      winner: winner.id,
      loser: loser.id,
      playersStolen: [stolenPlayer],
      emergency: isEmergency,
      winnerProbability,
      teamASize,
      teamBSize,
    };
    matches.push(match);
    if (isEmergency) emergencyMatches += 1;
    if (match.matchSize === 2) levelZeroMatches += 1;
    stateSnapshots.push(cloneTeams(teams));
    const marker = isEmergency ? " · EMERGENCY" : "";
    record(
      `MATCH ${match.matchNumber} · ${teamA.id} (${teamASize}) vs ${teamB.id} (${teamBSize})`,
      "match",
      matches.length,
    );
    record(
      `${winner.id} wins · steals ${stolenPlayer}${marker}`,
      "match",
      matches.length,
    );
    if (winner.finalist)
      record(
        `${winner.id} reaches 5 and locks as a finalist`,
        "match",
        matches.length,
      );
    if (loser.eliminated)
      record(
        `${loser.id} drops to 1 and is eliminated`,
        "match",
        matches.length,
      );
    record(`Board: ${boardState(teams)}`, "match", matches.length);
  }

  const finalists = teams
    .filter((team) => team.finalist)
    .map((team) => team.id);
  if (finalists.length >= 10) terminationReason = "ten finalists reached";
  const playersRemaining = teams
    .filter((team) => team.active || team.finalist)
    .reduce((total, team) => total + team.rosterSize, 0);
  const eliminatedPlayers = players - playersRemaining;
  const finalSnapshot = stateSnapshots[stateSnapshots.length - 1];
  record(
    "RESULT · QUALIFICATION PHASE CLOSED",
    "result",
    stateSnapshots.length - 1,
  );
  record(
    `${finalists.length} finalists · ${eliminatedPlayers} eliminated players · ${matches.length} matches`,
    "result",
    stateSnapshots.length - 1,
  );
  record(`Reason: ${terminationReason}`, "result", stateSnapshots.length - 1);
  return {
    finalists,
    eliminatedPlayers,
    matches,
    deadlock,
    terminationReason,
    emergencyMatches,
    waitingEvents,
    levelZeroMatches,
    finalTeams: finalSnapshot,
    history,
    historyMeta,
    stateSnapshots,
    players,
    policy,
    outcomeMode,
  };
}

function summarize(results: TournamentResult[]): BatchSummary {
  const matches = results
    .map((result) => result.matches.length)
    .sort((a, b) => a - b);
  const finalistCounts: Record<string, number> = {
    "0": 0,
    "1": 0,
    "2": 0,
    "3": 0,
    "4": 0,
  };
  results.forEach((result) => {
    const key = String(Math.min(4, result.finalists.length));
    finalistCounts[key] += 1;
  });
  const average = (values: number[]) =>
    values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    runs: results.length,
    finalistProbability: Object.fromEntries(
      Object.entries(finalistCounts).map(([key, count]) => [
        key,
        count / results.length,
      ]),
    ),
    averageMatches: average(matches),
    medianMatches:
      matches.length % 2
        ? matches[Math.floor(matches.length / 2)]
        : (matches[matches.length / 2 - 1] + matches[matches.length / 2]) / 2,
    minMatches: matches[0],
    maxMatches: matches[matches.length - 1],
    averageEliminated: average(
      results.map((result) => result.eliminatedPlayers),
    ),
    deadlockProbability:
      results.filter((result) => result.deadlock).length / results.length,
    emergencyProbability:
      results.filter((result) => result.emergencyMatches > 0).length /
      results.length,
  };
}

function runBatch(
  players: Pool,
  policy: Policy,
  outcomeMode: OutcomeMode,
  runs: number,
): BatchSummary {
  const results = Array.from({ length: runs }, (_, index) =>
    runTournament(
      players,
      policy,
      outcomeMode,
      Date.now() + index * 7919 + Math.floor(Math.random() * 100000),
    ),
  );
  return summarize(results);
}

function SectionLabel({
  icon,
  children,
  count,
}: {
  icon: ReactNode;
  children: ReactNode;
  count?: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
        <span className="text-lime-300">{icon}</span>
        <span>{children}</span>
      </div>
      {count ? (
        <span className="mono text-[10px] text-slate-500">{count}</span>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  accent = false,
  testId,
}: {
  label: string;
  value: string;
  accent?: boolean;
  testId: string;
}) {
  return (
    <div className="min-w-0 border-l border-slate-700/70 pl-4 first:border-0 first:pl-0">
      <div className="mono text-[10px] uppercase tracking-[0.13em] text-slate-500">
        {label}
      </div>
      <div
        data-testid={testId}
        className={`mt-1 text-xl font-semibold tracking-tight ${accent ? "text-lime-300" : "text-slate-100"}`}
      >
        {value}
      </div>
    </div>
  );
}

function AppContent() {
  const [players, setPlayers] = useState<Pool>(24);
  const [policy, setPolicy] = useState<Policy>("strict-emergency");
  const [outcomeMode, setOutcomeMode] = useState<OutcomeMode>("random");
  const [result, setResult] = useState<TournamentResult | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [batchRuns, setBatchRuns] = useState(500);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const previewTeams = useMemo(
    () => makeTeams(players, seededRng(17 + players)),
    [players],
  );
  const shownTeams = result
    ? result.stateSnapshots[result.historyMeta[stepIndex]?.snapshotIndex ?? 0]
    : previewTeams;
  const currentHistory = result?.history[stepIndex] ?? "No match history yet";
  const currentMeta = result?.historyMeta[stepIndex];
  const currentMatchIndex = currentMeta?.snapshotIndex
    ? currentMeta.snapshotIndex - 1
    : -1;
  const currentMatch =
    result && currentMatchIndex >= 0 ? result.matches[currentMatchIndex] : null;

  const runSingle = () => {
    const tournament = runTournament(
      players,
      policy,
      outcomeMode,
      Math.floor(Math.random() * 2147483647),
    );
    setResult(tournament);
    setStepIndex(0);
  };

  const reset = () => {
    setResult(null);
    setBatchSummary(null);
    setStepIndex(0);
  };

  const runBatchClick = () => {
    const runs = Math.max(1, Math.min(10000, Math.floor(batchRuns) || 1));
    setBatchRuns(runs);
    setBatchRunning(true);
    window.setTimeout(() => {
      setBatchSummary(runBatch(players, policy, outcomeMode, runs));
      setBatchRunning(false);
    }, 30);
  };

  return (
    <main className="simulator-shell">
      <div className="shell-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 pb-16 sm:px-8 lg:px-12">
        <header className="flex items-center justify-between border-b border-slate-800/80 py-5">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-lime-300/30 bg-lime-300/10 text-lime-300">
              <CrosshairIcon />
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-slate-100">
                Strikers
              </div>
              <div className="mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                tournament simulator
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className="pulse-dot h-1.5 w-1.5 rounded-full bg-lime-300" />
            local rules lab
            <CircleHelp className="ml-2 h-4 w-4 text-slate-600" />
          </div>
        </header>

        <section className="fade-up grid gap-8 pb-8 pt-10 lg:grid-cols-[1fr_330px] lg:items-end lg:pt-14">
          <div>
            <div className="mb-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-lime-300">
              <FlaskConical className="h-4 w-4" /> Qualification phase / 01
            </div>
            <h1 className="max-w-3xl text-balance text-4xl font-semibold leading-[1.02] tracking-[-0.055em] text-slate-50 sm:text-6xl">
              Stress-test the roster ladder.
            </h1>
            <p className="mt-5 max-w-2xl text-sm leading-6 text-slate-400 sm:text-base">
              A compact rules lab for seeing whether steals, eliminations,
              recoveries, and finalist locks land where you expect.
            </p>
          </div>
          <div className="board-card rounded-xl p-4">
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] uppercase tracking-[0.16em] text-slate-500">
                Current protocol
              </span>
              <span className="rounded-full bg-lime-300/10 px-2 py-1 text-[10px] font-semibold text-lime-300">
                ready
              </span>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-slate-800 text-lime-300">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-medium text-slate-100">
                  {players} players / {players / 3} teams
                </div>
                <div className="mt-0.5 text-xs text-slate-500">
                  {policyCopy[policy].label} · {outcomeCopy[outcomeMode].label}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          className="fade-up fade-up-delay-1 board-card rounded-2xl p-5 sm:p-6"
          data-testid="panel-configuration"
        >
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <SectionLabel icon={<Layers3 className="h-4 w-4" />}>
                Protocol configuration
              </SectionLabel>
              <p className="text-xs text-slate-500">
                Change the inputs, then run an observed qualification phase.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={reset}
                data-testid="button-reset"
                className="control-chip inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-slate-100"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Reset
              </button>
              <button
                type="button"
                onClick={runSingle}
                data-testid="button-run-tournament"
                className="inline-flex items-center gap-2 rounded-lg bg-lime-300 px-4 py-2.5 text-xs font-bold text-slate-950 transition-transform hover:-translate-y-0.5"
              >
                <Play className="h-3.5 w-3.5 fill-current" /> Run tournament
              </button>
            </div>
          </div>
          <div className="grid gap-7 lg:grid-cols-[1fr_1.4fr_1fr]">
            <div>
              <SectionLabel icon={<Users className="h-4 w-4" />}>
                Starting pool
              </SectionLabel>
              <div className="grid grid-cols-3 gap-2">
                {POOLS.map((pool) => (
                  <button
                    key={pool}
                    type="button"
                    data-testid={`button-pool-${pool}`}
                    data-selected={players === pool}
                    onClick={() => setPlayers(pool)}
                    className="control-chip rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-sm font-semibold text-slate-400 hover:text-slate-100"
                  >
                    {pool}
                    <span className="ml-1 text-[10px] font-normal text-slate-600">
                      p
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel icon={<Activity className="h-4 w-4" />}>
                Matchmaking policy
              </SectionLabel>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                {POLICIES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-testid={`button-policy-${item}`}
                    data-selected={policy === item}
                    onClick={() => setPolicy(item)}
                    className="control-chip rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-left hover:text-slate-100"
                  >
                    <span className="block text-xs font-semibold">
                      {policyCopy[item].label}
                    </span>
                    <span className="mt-1 block text-[10px] leading-4 text-slate-500">
                      {policyCopy[item].detail}
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <SectionLabel icon={<Zap className="h-4 w-4" />}>
                Outcome model
              </SectionLabel>
              <div className="grid gap-2">
                {OUTCOMES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    data-testid={`button-outcome-${item}`}
                    data-selected={outcomeMode === item}
                    onClick={() => setOutcomeMode(item)}
                    className="control-chip flex items-center justify-between rounded-lg border border-slate-700 bg-slate-900/50 px-3 py-2 text-left hover:text-slate-100"
                  >
                    <span className="text-xs font-semibold">
                      {outcomeCopy[item].label}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {outcomeCopy[item].detail}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="fade-up fade-up-delay-2 mt-5 grid gap-5 xl:grid-cols-[1.18fr_.82fr]">
          <div
            className="board-card rounded-2xl p-5 sm:p-6"
            data-testid="panel-board"
          >
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <SectionLabel
                  icon={<Users className="h-4 w-4" />}
                  count={`${shownTeams.filter((team) => team.active).length} active`}
                >
                  Roster board
                </SectionLabel>
                <h2
                  data-testid="text-board-heading"
                  className="text-lg font-semibold tracking-tight text-slate-100"
                >
                  {result ? "Live tournament state" : "Starting formation"}
                </h2>
              </div>
              {result ? (
                <span
                  data-testid="status-termination"
                  className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${result.deadlock ? "bg-amber-300/10 text-amber-300" : "bg-lime-300/10 text-lime-300"}`}
                >
                  {result.deadlock ? "deadlock" : "completed"}
                </span>
              ) : (
                <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[10px] text-slate-500">
                  preview
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {shownTeams.map((team) => (
                <div
                  key={team.id}
                  data-testid={`team-cell-${team.id}`}
                  className={`team-cell rounded-xl border border-slate-700/80 bg-slate-900/50 p-3 ${team.finalist ? "finalist" : ""} ${team.eliminated ? "eliminated" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="mono text-sm font-medium text-slate-200">
                      {team.id}
                    </span>
                    {team.finalist ? (
                      <Trophy className="h-3.5 w-3.5 text-lime-300" />
                    ) : team.eliminated ? (
                      <span className="text-[9px] uppercase text-rose-300">
                        out
                      </span>
                    ) : (
                      <span className="mono text-[10px] text-slate-600">
                        L{Math.max(0, team.level)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <span
                      className={`text-2xl font-semibold tracking-tight ${team.finalist ? "text-lime-300" : "text-slate-100"}`}
                    >
                      {team.rosterSize}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {team.finalist
                        ? "finalist"
                        : team.eliminated
                          ? "eliminated"
                          : "players"}
                    </span>
                  </div>
                  <div className="mt-2 flex gap-1">
                    {Array.from({ length: 5 }, (_, index) => (
                      <span
                        key={index}
                        className={`h-1 flex-1 rounded-full ${index < team.rosterSize ? (team.finalist ? "bg-lime-300" : "bg-slate-500") : "bg-slate-800"}`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-5 flex items-start gap-2 rounded-lg border border-slate-800 bg-slate-950/30 p-3 text-xs leading-5 text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-lime-300" />
              <span>
                Every win permanently moves one player from loser to winner. A
                roster of 5 locks as a finalist; a roster of 1 leaves the
                tournament.
              </span>
            </div>
            {result ? (
              <div className="mt-6 grid grid-cols-2 gap-5 border-t border-slate-800 pt-5 sm:grid-cols-4">
                <Stat
                  label="finalists"
                  value={String(result.finalists.length)}
                  accent
                  testId="stat-finalists"
                />
                <Stat
                  label="matches"
                  value={String(result.matches.length)}
                  testId="stat-matches"
                />
                <Stat
                  label="steals"
                  value={String(result.matches.length)}
                  testId="stat-steals"
                />
                <Stat
                  label="emergencies"
                  value={String(result.emergencyMatches)}
                  testId="stat-emergencies"
                />
              </div>
            ) : null}
          </div>

          <div
            className="board-card flex min-h-[430px] flex-col rounded-2xl p-5 sm:p-6"
            data-testid="panel-history"
          >
            <div className="mb-5 flex items-start justify-between gap-3">
              <div>
                <SectionLabel
                  icon={<Clock3 className="h-4 w-4" />}
                  count={
                    result
                      ? `${stepIndex + 1} / ${result.history.length}`
                      : "awaiting run"
                  }
                >
                  Transition history
                </SectionLabel>
                <h2 className="text-lg font-semibold tracking-tight text-slate-100">
                  One step at a time
                </h2>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  aria-label="Previous history event"
                  disabled={!result || stepIndex === 0}
                  onClick={() =>
                    setStepIndex((current) => Math.max(0, current - 1))
                  }
                  data-testid="button-history-previous"
                  className="rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next history event"
                  disabled={
                    !result || stepIndex >= (result?.history.length ?? 1) - 1
                  }
                  onClick={() =>
                    setStepIndex((current) =>
                      Math.min((result?.history.length ?? 1) - 1, current + 1),
                    )
                  }
                  data-testid="button-history-next"
                  className="rounded-lg border border-slate-700 p-2 text-slate-400 transition-colors hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div
              data-testid="text-history-current"
              className="min-h-[88px] rounded-xl border border-lime-300/20 bg-lime-300/[0.045] p-4"
            >
              <div className="mono text-[10px] uppercase tracking-[0.16em] text-lime-300">
                {currentMeta?.type ?? "idle"} event
              </div>
              <div className="mt-3 text-sm leading-6 text-slate-200">
                {currentHistory}
              </div>
            </div>
            {currentMatch ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/30 p-4">
                <div className="flex items-center justify-between">
                  <span className="mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                    Match {currentMatch.matchNumber}
                  </span>
                  {currentMatch.emergency ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-300">
                      <ShieldAlert className="h-3.5 w-3.5" /> emergency
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-600">
                      same level
                    </span>
                  )}
                </div>
                <div className="mt-5 flex items-center justify-between gap-2">
                  <div className="text-center">
                    <div className="mono text-[10px] text-slate-500">
                      TEAM {currentMatch.teamA}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-100">
                      {currentMatch.teamASize}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-slate-600" />
                  <div className="text-center">
                    <div className="mono text-[10px] text-slate-500">
                      WINNER
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-lime-300">
                      {currentMatch.winner}
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 rotate-180 text-slate-600" />
                  <div className="text-center">
                    <div className="mono text-[10px] text-slate-500">
                      TEAM {currentMatch.teamB}
                    </div>
                    <div className="mt-1 text-2xl font-semibold text-slate-100">
                      {currentMatch.teamBSize}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3 text-xs text-slate-500">
                  <span>Transfer</span>
                  <span className="mono text-slate-300">
                    {currentMatch.playersStolen[0]} → {currentMatch.winner}
                  </span>
                </div>
              </div>
            ) : (
              <div className="mt-4 flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-slate-800 px-5 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-800/80 text-slate-500">
                  <Play className="h-4 w-4" />
                </div>
                <p className="mt-3 text-sm font-medium text-slate-300">
                  Run a tournament to open the tape
                </p>
                <p className="mt-1 max-w-[240px] text-xs leading-5 text-slate-600">
                  The board will record every pairing, steal, lock, and
                  termination reason.
                </p>
              </div>
            )}
            {result ? (
              <div className="mt-4 flex items-center justify-between text-[11px] text-slate-500">
                <span>
                  {result.waitingEvents} waiting event
                  {result.waitingEvents === 1 ? "" : "s"}
                </span>
                <span>{result.terminationReason}</span>
              </div>
            ) : null}
          </div>
        </section>

        <section
          className="fade-up fade-up-delay-3 board-card mt-5 rounded-2xl p-5 sm:p-6"
          data-testid="panel-batch"
        >
          <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
            <div>
              <SectionLabel icon={<BarChart3 className="h-4 w-4" />}>
                Batch simulation
              </SectionLabel>
              <h2 className="text-xl font-semibold tracking-tight text-slate-100">
                Find the shape of the format.
              </h2>
              <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500">
                Repeat the same protocol to expose finalist odds, deadlocks, and
                how often the emergency rule carries the phase.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <label className="block">
                <span className="mono mb-1.5 block text-[10px] uppercase tracking-[0.14em] text-slate-500">
                  Runs
                </span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={batchRuns}
                  onChange={(event) => setBatchRuns(Number(event.target.value))}
                  data-testid="input-batch-runs"
                  className="h-10 w-28 rounded-lg border border-slate-700 bg-slate-950/50 px-3 text-sm text-slate-100 outline-none focus:border-lime-300/60"
                />
              </label>
              <button
                type="button"
                onClick={runBatchClick}
                disabled={batchRunning}
                data-testid="button-run-batch"
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-amber-300/60 bg-amber-300/10 px-4 text-xs font-bold text-amber-200 transition-colors hover:bg-amber-300/20 disabled:cursor-wait disabled:opacity-60"
              >
                {batchRunning ? (
                  <>
                    <Activity className="h-3.5 w-3.5 animate-pulse" />{" "}
                    Simulating…
                  </>
                ) : (
                  <>
                    <BarChart3 className="h-3.5 w-3.5" /> Run batch
                  </>
                )}
              </button>
            </div>
          </div>
          {batchSummary ? (
            <div className="mt-7 border-t border-slate-800 pt-6">
              <div className="grid grid-cols-2 gap-5 md:grid-cols-4 lg:grid-cols-7">
                <Stat
                  label="runs"
                  value={batchSummary.runs.toLocaleString()}
                  accent
                  testId="batch-runs"
                />
                <Stat
                  label="avg matches"
                  value={batchSummary.averageMatches.toFixed(1)}
                  testId="batch-average-matches"
                />
                <Stat
                  label="median"
                  value={batchSummary.medianMatches.toFixed(1)}
                  testId="batch-median-matches"
                />
                <Stat
                  label="range"
                  value={`${batchSummary.minMatches}–${batchSummary.maxMatches}`}
                  testId="batch-range"
                />
                <Stat
                  label="avg eliminated"
                  value={batchSummary.averageEliminated.toFixed(1)}
                  testId="batch-average-eliminated"
                />
                <Stat
                  label="deadlock"
                  value={`${(batchSummary.deadlockProbability * 100).toFixed(1)}%`}
                  testId="batch-deadlock"
                />
                <Stat
                  label="emergency needed"
                  value={`${(batchSummary.emergencyProbability * 100).toFixed(1)}%`}
                  testId="batch-emergency"
                />
              </div>
              <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_1fr]">
                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <span className="mono text-[10px] uppercase tracking-[0.14em] text-slate-500">
                      Finalist count probability
                    </span>
                    <span className="text-[10px] text-slate-600">per run</span>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(batchSummary.finalistProbability).map(
                      ([count, probability]) => (
                        <div
                          key={count}
                          className="flex items-center gap-3"
                          data-testid={`row-finalist-probability-${count}`}
                        >
                          <span className="mono w-12 text-[10px] text-slate-500">
                            {count} finalist{count === "1" ? "" : "s"}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className="h-full rounded-full bg-lime-300 transition-[width] duration-500"
                              style={{
                                width: `${Math.max(probability * 100, probability > 0 ? 1 : 0)}%`,
                              }}
                            />
                          </div>
                          <span className="mono w-12 text-right text-[10px] text-slate-300">
                            {(probability * 100).toFixed(1)}%
                          </span>
                        </div>
                      ),
                    )}
                  </div>
                </div>
                <div className="rounded-xl border border-amber-300/15 bg-amber-300/[0.035] p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-200">
                    <ShieldAlert className="h-4 w-4" /> Emergency rule readout
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Emergency matching activates only after no same-level pair
                    remains. Strict mode stops instead, making its deadlock rate
                    a useful control.
                  </p>
                  <div className="mt-4 flex items-end gap-3">
                    <span className="text-3xl font-semibold tracking-tight text-amber-200">
                      {(batchSummary.emergencyProbability * 100).toFixed(1)}%
                    </span>
                    <span className="pb-1 text-[10px] text-slate-500">
                      of runs needed a fallback
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div
              data-testid="empty-batch-summary"
              className="mt-6 flex items-center gap-3 rounded-xl border border-dashed border-slate-800 bg-slate-950/20 p-4 text-xs text-slate-600"
            >
              <BarChart3 className="h-4 w-4 text-slate-500" /> Batch results
              will appear here. The same configuration above is used for every
              run.
            </div>
          )}
        </section>

        <footer className="flex flex-col gap-2 pt-8 text-[11px] leading-5 text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span className="mono uppercase tracking-[0.12em]">
            Rules lab / browser-local / no persistence
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Check className="h-3.5 w-3.5 text-lime-300" /> One steal per win ·
            finalist threshold 5 · elimination threshold 1
          </span>
        </footer>
      </div>
    </main>
  );
}

function CrosshairIcon() {
  return (
    <span className="relative block h-4 w-4 rounded-full border border-current">
      <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
    </span>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AppContent} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
