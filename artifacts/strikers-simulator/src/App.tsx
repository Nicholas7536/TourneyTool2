import { useMemo, useState } from "react";

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
  teamASize: number;
  teamBSize: number;
};

type HistoryEvent = {
  text: string;
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
  history: HistoryEvent[];
  stateSnapshots: Team[][];
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

const policyLabels: Record<Policy, string> = {
  strict: "Strict",
  "strict-emergency": "Strict + emergency",
  nearest: "Nearest level",
};

const outcomeLabels: Record<OutcomeMode, string> = {
  random: "Random",
  skill: "Skill weighted",
  balanced: "Balanced skill",
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
): [Team, Team] {
  const skillProbability = teamA.skill / (teamA.skill + teamB.skill);
  const probability =
    outcome === "random"
      ? 0.5
      : outcome === "balanced"
        ? 0.25 + skillProbability * 0.5
        : skillProbability;
  return rng() < probability ? [teamA, teamB] : [teamB, teamA];
}

function runTournament(
  players: Pool,
  policy: Policy,
  outcomeMode: OutcomeMode,
  maxFinalists: number,
  seed: number,
): TournamentResult {
  const rng = seededRng(seed);
  const teams = makeTeams(players, rng);
  const matches: Match[] = [];
  const history: HistoryEvent[] = [];
  const stateSnapshots: Team[][] = [cloneTeams(teams)];
  let waitingEvents = 0;
  let emergencyMatches = 0;
  let levelZeroMatches = 0;
  let deadlock = false;
  let terminationReason = `${maxFinalists} finalist${maxFinalists === 1 ? "" : "s"} reached`;

  const record = (text: string, snapshotIndex: number) => {
    history.push({ text, snapshotIndex });
  };

  record("TOURNAMENT READY", 0);
  record(
    `${players} players · ${teams.length} teams · max ${maxFinalists} finalist${maxFinalists === 1 ? "" : "s"}`,
    0,
  );
  record(`Initial board: ${boardState(teams)}`, 0);

  while (teams.filter((team) => team.finalist).length < maxFinalists) {
    if (matches.length >= 1000) {
      deadlock = true;
      terminationReason = "match limit reached";
      record(`TERMINATED · ${terminationReason}`, matches.length);
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
      record(`TERMINATED · ${terminationReason}`, matches.length);
      break;
    }

    if (!pair) {
      deadlock = activeTeams(teams).length > 0;
      terminationReason = deadlock
        ? "only one active team remains"
        : "no active teams remain";
      record(`TERMINATED · ${terminationReason}`, matches.length);
      break;
    }

    const [teamA, teamB] = pair;
    const teamASize = teamA.rosterSize;
    const teamBSize = teamB.rosterSize;
    const [winner, loser] = winnerFor(teamA, teamB, rng, outcomeMode);
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
      teamASize,
      teamBSize,
    };
    matches.push(match);
    if (isEmergency) emergencyMatches += 1;
    if (match.matchSize === 2) levelZeroMatches += 1;
    stateSnapshots.push(cloneTeams(teams));

    const snapshotIndex = stateSnapshots.length - 1;
    const marker = isEmergency ? " · EMERGENCY" : "";
    record(
      `MATCH ${match.matchNumber} · ${teamA.id} (${teamASize}) vs ${teamB.id} (${teamBSize})`,
      snapshotIndex,
    );
    record(
      `${winner.id} wins · steals ${stolenPlayer}${marker}`,
      snapshotIndex,
    );
    if (winner.finalist) {
      record(`${winner.id} reaches 5 and locks as a finalist`, snapshotIndex);
    }
    if (loser.eliminated) {
      record(`${loser.id} drops to 1 and is eliminated`, snapshotIndex);
    }
    record(`Board: ${boardState(teams)}`, snapshotIndex);
  }

  const finalists = teams
    .filter((team) => team.finalist)
    .map((team) => team.id);
  const playersRemaining = teams
    .filter((team) => team.active || team.finalist)
    .reduce((total, team) => total + team.rosterSize, 0);
  const eliminatedPlayers = players - playersRemaining;
  const finalSnapshot = stateSnapshots[stateSnapshots.length - 1];

  record("RESULT · QUALIFICATION PHASE CLOSED", stateSnapshots.length - 1);
  record(
    `${finalists.length} finalists · ${eliminatedPlayers} eliminated players · ${matches.length} matches`,
    stateSnapshots.length - 1,
  );
  record(`Reason: ${terminationReason}`, stateSnapshots.length - 1);

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
    stateSnapshots,
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
    finalistCounts[String(Math.min(4, result.finalists.length))] += 1;
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
  maxFinalists: number,
  runs: number,
): BatchSummary {
  const results = Array.from({ length: runs }, (_, index) =>
    runTournament(
      players,
      policy,
      outcomeMode,
      maxFinalists,
      Date.now() + index * 7919 + Math.floor(Math.random() * 100000),
    ),
  );
  return summarize(results);
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export default function App() {
  const [players, setPlayers] = useState<Pool>(24);
  const [maxFinalists, setMaxFinalists] = useState(2);
  const [policy, setPolicy] = useState<Policy>("strict-emergency");
  const [outcomeMode, setOutcomeMode] = useState<OutcomeMode>("random");
  const [result, setResult] = useState<TournamentResult | null>(null);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [batchRuns, setBatchRuns] = useState(500);
  const [batchSummary, setBatchSummary] = useState<BatchSummary | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);

  const previewTeams = useMemo(
    () => makeTeams(players, seededRng(17 + players)),
    [players],
  );
  const currentEvent = result?.history[historyIndex];
  const shownTeams = result
    ? result.stateSnapshots[currentEvent?.snapshotIndex ?? 0]
    : previewTeams;
  const currentMatchIndex = currentEvent
    ? currentEvent.snapshotIndex - 1
    : -1;
  const currentMatch =
    result && currentMatchIndex >= 0 ? result.matches[currentMatchIndex] : null;

  function runSingle() {
    setResult(
      runTournament(
        players,
        policy,
        outcomeMode,
        maxFinalists,
        Math.floor(Math.random() * 2147483647),
      ),
    );
    setHistoryIndex(0);
  }

  function reset() {
    setResult(null);
    setBatchSummary(null);
    setHistoryIndex(0);
  }

  function runBatchClick() {
    const runs = Math.max(1, Math.min(10000, Math.floor(batchRuns) || 1));
    setBatchRuns(runs);
    setBatchRunning(true);
    window.setTimeout(() => {
      setBatchSummary(
        runBatch(players, policy, outcomeMode, maxFinalists, runs),
      );
      setBatchRunning(false);
    }, 30);
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Strikers Tournament Simulator</h1>
          <p>Local proof of concept for the steal-a-player rules.</p>
        </div>
        <button type="button" onClick={reset} data-testid="button-reset">
          Reset
        </button>
      </header>

      <section className="panel" aria-labelledby="configuration-heading">
        <h2 id="configuration-heading">Simulation parameters</h2>
        <div className="form-grid">
          <label>
            Starting players
            <select
              value={players}
              onChange={(event) => setPlayers(Number(event.target.value) as Pool)}
              data-testid="select-players"
            >
              {POOLS.map((pool) => (
                <option value={pool} key={pool}>
                  {pool}
                </option>
              ))}
            </select>
          </label>
          <label>
            Maximum finalists
            <input
              type="number"
              min={1}
              max={4}
              value={maxFinalists}
              onChange={(event) =>
                setMaxFinalists(
                  Math.max(1, Math.min(4, Number(event.target.value) || 1)),
                )
              }
              data-testid="input-max-finalists"
            />
            <small>Qualification stops at this many teams reaching 5.</small>
          </label>
          <label>
            Matchmaking policy
            <select
              value={policy}
              onChange={(event) => setPolicy(event.target.value as Policy)}
              data-testid="select-policy"
            >
              {POLICIES.map((item) => (
                <option value={item} key={item}>
                  {policyLabels[item]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Outcome model
            <select
              value={outcomeMode}
              onChange={(event) =>
                setOutcomeMode(event.target.value as OutcomeMode)
              }
              data-testid="select-outcome"
            >
              {OUTCOMES.map((item) => (
                <option value={item} key={item}>
                  {outcomeLabels[item]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={runSingle}
            data-testid="button-run-tournament"
          >
            Run tournament
          </button>
        </div>
      </section>

      <div className="main-grid">
        <section className="panel" aria-labelledby="board-heading">
          <div className="section-heading">
            <h2 id="board-heading">
              {result ? "Tournament state" : "Starting formation"}
            </h2>
            <span>{shownTeams.filter((team) => team.active).length} active</span>
          </div>
          <div className="team-grid">
            {shownTeams.map((team) => (
              <div
                className={`team ${team.finalist ? "finalist" : ""} ${team.eliminated ? "eliminated" : ""}`}
                key={team.id}
                data-testid={`team-cell-${team.id}`}
              >
                <strong>{team.id}</strong>
                <span>{team.rosterSize} players</span>
                <small>
                  {team.finalist
                    ? "finalist"
                    : team.eliminated
                      ? "eliminated"
                      : `level ${Math.max(0, team.level)}`}
                </small>
              </div>
            ))}
          </div>
          {result ? (
            <div className="stats">
              <div>
                <strong>{result.finalists.length}</strong>
                <span>finalists</span>
              </div>
              <div>
                <strong>{result.matches.length}</strong>
                <span>matches</span>
              </div>
              <div>
                <strong>{result.eliminatedPlayers}</strong>
                <span>eliminated</span>
              </div>
              <div>
                <strong>{result.emergencyMatches}</strong>
                <span>emergencies</span>
              </div>
            </div>
          ) : (
            <p className="note">
              A win moves one player permanently to the winning team. Five
              players creates a finalist; one player is eliminated.
            </p>
          )}
        </section>

        <section className="panel" aria-labelledby="history-heading">
          <div className="section-heading">
            <h2 id="history-heading">Transition history</h2>
            <div className="history-controls">
              <button
                type="button"
                disabled={!result || historyIndex === 0}
                onClick={() => setHistoryIndex((index) => Math.max(0, index - 1))}
                data-testid="button-history-previous"
              >
                Previous
              </button>
              <button
                type="button"
                disabled={!result || historyIndex >= (result?.history.length ?? 1) - 1}
                onClick={() =>
                  setHistoryIndex((index) =>
                    Math.min((result?.history.length ?? 1) - 1, index + 1),
                  )
                }
                data-testid="button-history-next"
              >
                Next
              </button>
            </div>
          </div>
          <p className="history-count">
            {result ? `${historyIndex + 1} / ${result.history.length}` : "Run a tournament to view events"}
          </p>
          <pre className="history">
            {currentEvent?.text ?? "No match history yet"}
          </pre>
          {currentMatch ? (
            <div className="match-detail">
              Match {currentMatch.matchNumber}: {currentMatch.teamA} (
              {currentMatch.teamASize}) vs {currentMatch.teamB} (
              {currentMatch.teamBSize}) — {currentMatch.winner} wins and steals{" "}
              {currentMatch.playersStolen[0]}
              {currentMatch.emergency ? " — emergency" : ""}
            </div>
          ) : null}
          {result ? (
            <p className="note">
              {result.terminationReason}. Waiting events: {result.waitingEvents}.
            </p>
          ) : null}
        </section>
      </div>

      <section className="panel" aria-labelledby="batch-heading">
        <div className="section-heading">
          <div>
            <h2 id="batch-heading">Batch simulation</h2>
            <p>Runs the same parameters repeatedly.</p>
          </div>
          <div className="batch-controls">
            <label>
              Runs
              <input
                type="number"
                min={1}
                max={10000}
                value={batchRuns}
                onChange={(event) => setBatchRuns(Number(event.target.value))}
                data-testid="input-batch-runs"
              />
            </label>
            <button
              type="button"
              onClick={runBatchClick}
              disabled={batchRunning}
              className="primary"
              data-testid="button-run-batch"
            >
              {batchRunning ? "Running..." : "Run batch"}
            </button>
          </div>
        </div>

        {batchSummary ? (
          <>
            <div className="stats batch-stats">
              <div>
                <strong>{batchSummary.runs.toLocaleString()}</strong>
                <span>runs</span>
              </div>
              <div>
                <strong>{batchSummary.averageMatches.toFixed(1)}</strong>
                <span>average matches</span>
              </div>
              <div>
                <strong>{batchSummary.medianMatches.toFixed(1)}</strong>
                <span>median matches</span>
              </div>
              <div>
                <strong>
                  {batchSummary.minMatches}–{batchSummary.maxMatches}
                </strong>
                <span>match range</span>
              </div>
              <div>
                <strong>{batchSummary.averageEliminated.toFixed(1)}</strong>
                <span>average eliminated</span>
              </div>
              <div>
                <strong>{pct(batchSummary.deadlockProbability)}</strong>
                <span>deadlocks</span>
              </div>
              <div>
                <strong>{pct(batchSummary.emergencyProbability)}</strong>
                <span>emergency needed</span>
              </div>
            </div>
            <div className="probabilities">
              <h3>Finalist count probability</h3>
              {Object.entries(batchSummary.finalistProbability).map(
                ([count, probability]) => (
                  <div className="probability-row" key={count}>
                    <span>{count} finalist{count === "1" ? "" : "s"}</span>
                    <div className="bar">
                      <span style={{ width: `${probability * 100}%` }} />
                    </div>
                    <strong>{pct(probability)}</strong>
                  </div>
                ),
              )}
            </div>
          </>
        ) : (
          <p className="note">Batch results will appear here.</p>
        )}
      </section>
    </main>
  );
}