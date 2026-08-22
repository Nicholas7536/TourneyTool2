import { FormEvent, useEffect, useMemo, useState } from "react";

type Policy = "strict" | "strict-emergency" | "nearest";
type Phase = "waiting" | "active" | "finished";

type Rules = {
  startingPlayers: number;
  maxFinalists: number;
  matchmakingPolicy: Policy;
};

type Player = {
  id: string;
  name: string;
  teamId: string | null;
  substitute: boolean;
};

type Team = {
  id: string;
  name: string;
  leadPlayerId: string | null;
  playerIds: string[];
  rosterSize: number;
  finalist: boolean;
  eliminated: boolean;
};

type Challenge = {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  status: "pending" | "accepted" | "reported" | "declined";
  matchId?: string;
};

type Match = {
  id: string;
  challengeId: string;
  teamAId: string;
  teamBId: string;
  lobbyMakerTeamId: string;
  status: "lobby" | "reported";
  winnerTeamId?: string;
  loserTeamId?: string;
  stolenPlayerId?: string;
};

type Room = {
  roomCode: string;
  rules: Rules;
  phase: Phase;
  players: Player[];
  teams: Team[];
  substitutes: string[];
  challenges: Challenge[];
  matches: Match[];
  finalists: string[];
  viewer: {
    role: "host" | "player" | "spectator";
    playerId: string | null;
    teamId: string | null;
    isLead: boolean;
  };
};

const PLAYER_POOLS = [15, 18, 21, 24, 27, 30];
const POLICY_LABELS: Record<Policy, string> = {
  strict: "Same roster size only",
  "strict-emergency": "Same size, then emergency",
  nearest: "Nearest roster size",
};

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("x-room-token", token);
  const response = await fetch(`/api${path}`, { ...options, headers });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error ?? "Request failed");
  return body;
}

function roomToken(roomCode: string): string | undefined {
  return localStorage.getItem(`strikers-room-token:${roomCode}`) ?? undefined;
}

function saveRoomToken(roomCode: string, token: string) {
  localStorage.setItem(`strikers-room-token:${roomCode}`, token);
}

function roomFromUrl(): string {
  return new URLSearchParams(window.location.search).get("room")?.toUpperCase() ?? "";
}

export default function App() {
  const [roomCode, setRoomCode] = useState(roomFromUrl());
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hostToken, setHostToken] = useState("");
  const [playerToken, setPlayerToken] = useState("");
  const [playerName, setPlayerName] = useState("");
  const [rules, setRules] = useState<Rules>({
    startingPlayers: 24,
    maxFinalists: 2,
    matchmakingPolicy: "strict-emergency",
  });

  async function loadRoom(code = roomCode, token = playerToken || hostToken) {
    if (!code) return;
    try {
      const result = await request<{ room: Room }>(
        `/rooms/${code}`,
        {},
        token || roomToken(code) || playerToken || hostToken,
      );
      setRoom(result.room);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load room");
    }
  }

  useEffect(() => {
    if (!roomCode) return;
    setPlayerToken(roomToken(roomCode) ?? "");
    void loadRoom(roomCode, roomToken(roomCode));
    const interval = window.setInterval(() => void loadRoom(), 2000);
    return () => window.clearInterval(interval);
  }, [roomCode]);

  async function createRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request<{ room: Room; hostToken: string }>("/rooms", {
        method: "POST",
        body: JSON.stringify(rules),
      });
      setHostToken(result.hostToken);
      saveRoomToken(result.room.roomCode, result.hostToken);
      setPlayerToken(result.hostToken);
      setRoomCode(result.room.roomCode);
      window.history.replaceState(
        {},
        "",
        `${window.location.pathname}?room=${result.room.roomCode}`,
      );
      await loadRoom(result.room.roomCode, result.hostToken);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not create room");
    } finally {
      setBusy(false);
    }
  }

  async function joinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!roomCode || !playerName.trim()) return;
    setBusy(true);
    setError("");
    try {
      const result = await request<{ room: Room; playerToken: string }>(
        `/rooms/${roomCode}/join`,
        { method: "POST", body: JSON.stringify({ name: playerName }) },
      );
      saveRoomToken(roomCode, result.playerToken);
      setPlayerToken(result.playerToken);
      await loadRoom(roomCode, result.playerToken);
      setPlayerName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join room");
    } finally {
      setBusy(false);
    }
  }

  async function roomAction(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await request(path, { method: "POST", body: JSON.stringify(body ?? {}) }, playerToken || hostToken);
      await loadRoom();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const viewer = room?.viewer;
  const myTeam = useMemo(
    () => room?.teams.find((team) => team.id === viewer?.teamId) ?? null,
    [room, viewer?.teamId],
  );
  const myPendingChallenges = room?.challenges.filter(
    (challenge) =>
      challenge.status === "pending" &&
      (challenge.toTeamId === viewer?.teamId || challenge.fromTeamId === viewer?.teamId),
  ) ?? [];
  const activeMatches = room?.matches.filter((match) => match.status === "lobby") ?? [];

  if (!room) {
    return (
      <main className="app narrow">
        <header className="header">
          <div>
            <h1>Strikers Tournament</h1>
            <p>Create a room or join one with a shared link.</p>
          </div>
        </header>
        {roomCode ? (
          <section className="panel">
            <h2>Join room {roomCode}</h2>
            <form onSubmit={joinRoom} className="stack">
              <label>
                Your display name
                <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} autoFocus />
              </label>
              <button className="primary" disabled={busy || !playerName.trim()}>
                {busy ? "Joining..." : "Join tournament"}
              </button>
            </form>
            <p className="note">If all starting team spots are taken, you will enter the substitute queue.</p>
          </section>
        ) : (
          <>
            <section className="panel">
              <h2>Join a tournament</h2>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setRoomCode(roomCode.trim().toUpperCase());
                  window.history.replaceState({}, "", `?room=${roomCode.trim().toUpperCase()}`);
                }}
                className="stack"
              >
                <label>
                  Room code
                  <input value={roomCode} onChange={(event) => setRoomCode(event.target.value.toUpperCase())} />
                </label>
                <button className="primary" disabled={!roomCode.trim()}>Continue</button>
              </form>
            </section>
            <section className="panel">
              <h2>Host a tournament</h2>
              <form onSubmit={createRoom} className="stack">
                <RulesForm rules={rules} setRules={setRules} />
                <button className="primary" disabled={busy}>
                  {busy ? "Creating..." : "Create tournament room"}
                </button>
              </form>
            </section>
          </>
        )}
        {error ? <p className="error">{error}</p> : null}
      </main>
    );
  }

  return (
    <main className="app">
      <header className="header">
        <div>
          <h1>Strikers Tournament</h1>
          <p>
            Room <strong>{room.roomCode}</strong> · {room.phase}
          </p>
        </div>
        <button type="button" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
          Copy link
        </button>
      </header>

      {viewer?.role === "host" && room.phase === "waiting" ? (
        <section className="panel">
          <h2>Host rules</h2>
          <RulesForm rules={rules} setRules={setRules} />
          <button className="secondary" disabled={busy} onClick={() => roomAction("/rooms/" + room.roomCode + "/rules", rules)}>
            Save rules
          </button>
          <button className="primary" disabled={busy || room.teams.some((team) => team.playerIds.length < 3)} onClick={() => roomAction("/rooms/" + room.roomCode + "/start")}>
            Start tournament
          </button>
          <p className="note">Every starting team must have 3 players. Extra players wait in the substitute queue.</p>
        </section>
      ) : null}

      {room.phase === "waiting" ? (
        <WaitingRoom room={room} viewer={viewer} onJoin={joinRoom} playerName={playerName} setPlayerName={setPlayerName} busy={busy} />
      ) : (
        <>
          <section className="panel">
            <h2>{room.phase === "finished" ? "Finalists" : "Tournament board"}</h2>
            <div className="team-grid">
              {room.teams.map((team) => (
                <div className={`team ${team.finalist ? "finalist" : ""} ${team.eliminated ? "eliminated" : ""}`} key={team.id}>
                  <strong>{team.name}</strong>
                  <span>{team.rosterSize} players</span>
                  <small>{team.finalist ? "finalist" : team.eliminated ? "eliminated" : team.id === viewer?.teamId ? "your team" : "active"}</small>
                </div>
              ))}
            </div>
            <p className="note">Finalists: {room.finalists.length} / {room.rules.maxFinalists}</p>
          </section>
          {room.phase === "active" && viewer?.isLead ? (
            <ChallengePanel room={room} myTeam={myTeam} busy={busy} onAction={roomAction} />
          ) : null}
          {room.phase === "active" && myPendingChallenges.length ? (
            <section className="panel">
              <h2>Pending challenges</h2>
              {myPendingChallenges.map((challenge) => (
                <div className="row" key={challenge.id}>
                  <span>{teamName(room, challenge.fromTeamId)} challenged {teamName(room, challenge.toTeamId)}</span>
                  {challenge.toTeamId === viewer?.teamId ? (
                    <button onClick={() => roomAction(`/rooms/${room.roomCode}/challenges/${challenge.id}/accept`)} disabled={busy}>Accept</button>
                  ) : <small>Waiting for acceptance</small>}
                </div>
              ))}
            </section>
          ) : null}
          {activeMatches.map((match) => (
            <MatchPanel key={match.id} room={room} match={match} viewer={viewer} busy={busy} onAction={roomAction} />
          ))}
          {room.phase === "active" && (viewer?.role === "host" || viewer?.isLead) ? (
            <SubstitutionPanel room={room} viewer={viewer} busy={busy} onAction={roomAction} />
          ) : null}
          <section className="panel">
            <h2>Substitute queue</h2>
            {room.substitutes.length ? room.substitutes.map((id) => <p key={id}>{room.players.find((player) => player.id === id)?.name}</p>) : <p className="note">No substitutes waiting.</p>}
          </section>
        </>
      )}
      {error ? <p className="error">{error}</p> : null}
    </main>
  );
}

function RulesForm({ rules, setRules }: { rules: Rules; setRules: (rules: Rules) => void }) {
  return (
    <div className="form-grid">
      <label>
        Starting players
        <select value={rules.startingPlayers} onChange={(event) => setRules({ ...rules, startingPlayers: Number(event.target.value) })}>
          {PLAYER_POOLS.map((value) => <option value={value} key={value}>{value}</option>)}
        </select>
      </label>
      <label>
        Maximum finalists
        <input type="number" min={1} max={4} value={rules.maxFinalists} onChange={(event) => setRules({ ...rules, maxFinalists: Math.max(1, Math.min(4, Number(event.target.value) || 1)) })} />
      </label>
      <label>
        Matchmaking policy
        <select value={rules.matchmakingPolicy} onChange={(event) => setRules({ ...rules, matchmakingPolicy: event.target.value as Policy })}>
          {Object.entries(POLICY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
        </select>
      </label>
    </div>
  );
}

function WaitingRoom({ room, viewer, onJoin, playerName, setPlayerName, busy }: { room: Room; viewer: Room["viewer"] | undefined; onJoin: (event: FormEvent<HTMLFormElement>) => void; playerName: string; setPlayerName: (value: string) => void; busy: boolean }) {
  const joined = Boolean(viewer?.playerId);
  return (
    <section className="panel">
      <div className="section-heading"><h2>Choose a team</h2><span>{room.players.length} / {room.rules.startingPlayers} starting players</span></div>
      {!joined ? (
        <form onSubmit={onJoin} className="join-row">
          <input placeholder="Display name" value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
          <button className="primary" disabled={busy || !playerName.trim()}>Join</button>
        </form>
      ) : <p className="note">You are in the room. Team spots are assigned in join order.</p>}
      <div className="team-grid">
        {room.teams.map((team) => (
          <div className="team" key={team.id}>
            <strong>{team.name}</strong>
            {team.playerIds.map((id) => <span className="player" key={id}>{room.players.find((player) => player.id === id)?.name}</span>)}
            <small>{team.playerIds.length} / 3 players</small>
          </div>
        ))}
      </div>
      <h3>Substitute queue</h3>
      {room.substitutes.length ? room.substitutes.map((id) => <p key={id}>{room.players.find((player) => player.id === id)?.name}</p>) : <p className="note">No substitutes yet.</p>}
    </section>
  );
}

function ChallengePanel({ room, myTeam, busy, onAction }: { room: Room; myTeam: Team | null; busy: boolean; onAction: (path: string, body?: unknown) => void }) {
  if (!myTeam || myTeam.finalist || myTeam.eliminated) return null;
  const occupiedTeamIds = new Set(
    room.matches
      .filter((match) => match.status === "lobby")
      .flatMap((match) => [match.teamAId, match.teamBId]),
  );
  if (occupiedTeamIds.has(myTeam.id)) return null;
  const targets = room.teams.filter((team) => {
    if (team.id === myTeam.id || occupiedTeamIds.has(team.id) || team.finalist || team.eliminated || team.playerIds.length < 2) return false;
    if (room.rules.matchmakingPolicy === "strict") return team.rosterSize === myTeam.rosterSize;
    return true;
  });
  return (
    <section className="panel">
      <h2>Challenge a team</h2>
      <p className="note">Policy: {POLICY_LABELS[room.rules.matchmakingPolicy]}</p>
      <div className="challenge-grid">
        {targets.map((team) => (
          <button key={team.id} disabled={busy} onClick={() => onAction(`/rooms/${room.roomCode}/challenges`, { toTeamId: team.id })}>
            Challenge {team.name} ({team.rosterSize})
          </button>
        ))}
      </div>
      {!targets.length ? <p className="note">No legal targets are available.</p> : null}
    </section>
  );
}

function MatchPanel({ room, match, viewer, busy, onAction }: { room: Room; match: Match; viewer: Room["viewer"] | undefined; busy: boolean; onAction: (path: string, body?: unknown) => void }) {
  const canReport = viewer?.isLead && (viewer.teamId === match.teamAId || viewer.teamId === match.teamBId);
  const [winnerTeamId, setWinnerTeamId] = useState(match.teamAId);
  const loserTeamId = winnerTeamId === match.teamAId ? match.teamBId : match.teamAId;
  const loser = room.teams.find((team) => team.id === loserTeamId);
  return (
    <section className="panel">
      <h2>Match lobby</h2>
      <p>{teamName(room, match.teamAId)} vs {teamName(room, match.teamBId)}</p>
      <p className="note">Lobby maker: {teamName(room, match.lobbyMakerTeamId)}</p>
      {canReport ? (
        <form className="form-grid" onSubmit={(event) => { event.preventDefault(); const stolen = new FormData(event.currentTarget).get("stolenPlayerId"); onAction(`/rooms/${room.roomCode}/matches/${match.id}/report`, { winnerTeamId, stolenPlayerId: stolen }); }}>
          <label>Winner<select value={winnerTeamId} onChange={(event) => setWinnerTeamId(event.target.value)}><option value={match.teamAId}>{teamName(room, match.teamAId)}</option><option value={match.teamBId}>{teamName(room, match.teamBId)}</option></select></label>
          <label>Player stolen<select name="stolenPlayerId">{loser?.playerIds.map((id) => <option value={id} key={id}>{room.players.find((player) => player.id === id)?.name}</option>)}</select></label>
          <button className="primary" disabled={busy || !loser?.playerIds.length}>Report result</button>
        </form>
      ) : <p className="note">Team leads report the winner and stolen player after the lobby match.</p>}
    </section>
  );
}

function SubstitutionPanel({ room, viewer, busy, onAction }: { room: Room; viewer: Room["viewer"] | undefined; busy: boolean; onAction: (path: string, body?: unknown) => void }) {
  const teams = room.teams.filter((team) => !team.finalist && !team.eliminated && (viewer?.role === "host" || team.id === viewer?.teamId));
  const [teamId, setTeamId] = useState(teams[0]?.id ?? "");
  const team = teams.find((item) => item.id === teamId) ?? teams[0];
  const [playerId, setPlayerId] = useState(team?.playerIds[0] ?? "");
  const [substituteId, setSubstituteId] = useState(room.substitutes[0] ?? "");
  if (!teams.length || !room.substitutes.length) return null;
  return (
    <section className="panel">
      <h2>Replace a missing player</h2>
      <form className="form-grid" onSubmit={(event) => { event.preventDefault(); onAction(`/rooms/${room.roomCode}/replace`, { teamId: team?.id, playerId, substituteId }); }}>
        <label>Team<select value={team?.id} onChange={(event) => { setTeamId(event.target.value); setPlayerId(teams.find((item) => item.id === event.target.value)?.playerIds[0] ?? ""); }}>{teams.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label>Missing player<select value={playerId} onChange={(event) => setPlayerId(event.target.value)}>{team?.playerIds.map((id) => <option value={id} key={id}>{room.players.find((player) => player.id === id)?.name}</option>)}</select></label>
        <label>Substitute<select value={substituteId} onChange={(event) => setSubstituteId(event.target.value)}>{room.substitutes.map((id) => <option value={id} key={id}>{room.players.find((player) => player.id === id)?.name}</option>)}</select></label>
        <button className="primary" disabled={busy}>Make replacement</button>
      </form>
    </section>
  );
}

function teamName(room: Room, teamId: string) {
  return room.teams.find((team) => team.id === teamId)?.name ?? teamId;
}