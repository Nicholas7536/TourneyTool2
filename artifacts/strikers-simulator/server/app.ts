import dotenv from "dotenv";
import path from "node:path";

for (const envFile of [
  path.resolve(import.meta.dirname, "../../../.env.local"),
  path.resolve(process.cwd(), "artifacts/strikers-simulator/.env.local"),
  path.resolve(process.cwd(), ".env.local"),
  path.resolve(import.meta.dirname, "../../../.env"),
  path.resolve(process.cwd(), "artifacts/strikers-simulator/.env"),
  path.resolve(process.cwd(), ".env"),
]) {
  dotenv.config({ path: envFile });
}

import express, { type Request, type Response } from "express";
import { MongoClient } from "mongodb";
import { randomUUID } from "node:crypto";

type Policy = "strict" | "strict-emergency" | "nearest";
type Phase = "waiting" | "active" | "finished";
type Player = { id: string; name: string; token: string; teamId: string | null; substitute: boolean };
type Team = { id: string; name: string; leadPlayerId: string | null; playerIds: string[]; rosterSize: number; finalist: boolean; eliminated: boolean };
type Challenge = { id: string; fromTeamId: string; toTeamId: string; status: "pending" | "accepted" | "reported" | "declined"; matchId?: string };
type Match = { id: string; challengeId: string; teamAId: string; teamBId: string; lobbyMakerTeamId: string; status: "lobby" | "reported"; emergency?: boolean; goldenGoal?: boolean; winnerTeamId?: string; loserTeamId?: string; stolenPlayerId?: string; stolenPlayerIds?: string[] };
type Room = { roomCode: string; hostToken: string; rules: { startingPlayers: number; maxFinalists: number; matchmakingPolicy: Policy }; phase: Phase; players: Player[]; teams: Team[]; substitutes: string[]; challenges: Challenge[]; matches: Match[]; finalists: string[]; createdAt: number; expiresAt: number };

const WAITING_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
const ACTIVE_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FINISHED_ROOM_TTL_MS = 24 * 60 * 60 * 1000;

const app = express();
app.use(express.json({ limit: "32kb" }));

let clientPromise: Promise<MongoClient> | null = null;
let indexesReady: Promise<void> | null = null;
const roomLocks = new Map<string, Promise<void>>();

async function acquireRoomLock(roomCode: string) {
  const key = roomCode.toUpperCase();
  const previous = roomLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  roomLocks.set(key, queued);
  await previous;
  return () => {
    release();
    if (roomLocks.get(key) === queued) roomLocks.delete(key);
  };
}

app.use("/api/rooms/:roomCode", async (request, response, next) => {
  const release = await acquireRoomLock(request.params.roomCode);
  let released = false;
  const unlock = () => {
    if (released) return;
    released = true;
    release();
  };
  response.once("finish", unlock);
  response.once("close", unlock);
  next();
});

function collection() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not configured. Add it to .env.local or your deployment environment.");
  clientPromise ??= new MongoClient(uri).connect();
  return clientPromise.then(async (client) => {
    const rooms = client.db(process.env.MONGODB_DB || "strikers").collection<Room>("rooms");
    indexesReady ??= rooms.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).then(() => undefined);
    await indexesReady;
    return rooms;
  });
}

function code() {
  return randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

function token() {
  return randomUUID().replaceAll("-", "");
}

function publicRoom(room: Room, request: Request) {
  const roomToken = request.header("x-room-token");
  const host = roomToken === room.hostToken;
  const current = room.players.find((player) => player.token === roomToken);
  const view = {
    roomCode: room.roomCode,
    rules: room.rules,
    phase: room.phase,
    players: room.players.map(({ token: _token, ...player }) => player),
    teams: room.teams,
    substitutes: room.substitutes,
    challenges: room.challenges,
    matches: room.matches,
    finalists: room.finalists,
    viewer: {
      role: host ? "host" : current ? "player" : "spectator",
      playerId: current?.id ?? null,
      teamId: current?.teamId ?? null,
      isLead: current ? room.teams.find((team) => team.id === current.teamId)?.leadPlayerId === current.id : false,
    },
  };
  return view;
}

async function findRoom(roomCode: string) {
  const rooms = await collection();
  const now = Date.now();
  await rooms.deleteMany({
    $or: [
      { expiresAt: { $lte: now } },
      { expiresAt: { $exists: false }, phase: "waiting", createdAt: { $lte: now - WAITING_ROOM_TTL_MS } },
      { expiresAt: { $exists: false }, phase: "active", createdAt: { $lte: now - ACTIVE_ROOM_TTL_MS } },
      { expiresAt: { $exists: false }, phase: "finished", createdAt: { $lte: now - FINISHED_ROOM_TTL_MS } },
    ],
  });
  return rooms.findOne({ roomCode });
}

async function saveRoom(room: Room) {
  await (await collection()).replaceOne({ roomCode: room.roomCode }, room, { upsert: true });
}

function requireHost(room: Room, request: Request, response: Response) {
  if (request.header("x-room-token") !== room.hostToken) {
    response.status(403).json({ error: "Only the host can do that." });
    return false;
  }
  return true;
}

function currentPlayer(room: Room, request: Request) {
  return room.players.find((player) => player.token === request.header("x-room-token"));
}

function teamInMatch(room: Room, teamId: string) {
  return room.matches.some((match) => match.status === "lobby" && [match.teamAId, match.teamBId].includes(teamId));
}

function availableTeams(room: Room) {
  return room.teams.filter((team) => !team.finalist && !team.eliminated && team.playerIds.length >= 2 && !teamInMatch(room, team.id));
}

function hasSameLevelPair(room: Room) {
  const counts = new Map<number, number>();
  for (const team of availableTeams(room)) counts.set(team.rosterSize, (counts.get(team.rosterSize) ?? 0) + 1);
  return [...counts.values()].some((count) => count >= 2);
}

function nearestRosterDistance(room: Room) {
  const teams = availableTeams(room);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < teams.length; index += 1) {
    for (let next = index + 1; next < teams.length; next += 1) {
      distance = Math.min(distance, Math.abs(teams[index].rosterSize - teams[next].rosterSize));
    }
  }
  return distance;
}

function isEmergencyPair(room: Room, fromTeam: Team, toTeam: Team) {
  if (room.rules.matchmakingPolicy !== "strict-emergency" || hasSameLevelPair(room)) return false;
  const sizes = [...new Set(availableTeams(room).map((team) => team.rosterSize))].sort((a, b) => a - b);
  return sizes.length >= 2 && [sizes[0], sizes[1]].includes(fromTeam.rosterSize) && [sizes[0], sizes[1]].includes(toTeam.rosterSize) && fromTeam.rosterSize !== toTeam.rosterSize;
}

function legalMatchmakingPair(room: Room, fromTeam: Team, toTeam: Team) {
  if (room.rules.matchmakingPolicy === "strict") return fromTeam.rosterSize === toTeam.rosterSize;
  if (room.rules.matchmakingPolicy === "strict-emergency") {
    return fromTeam.rosterSize === toTeam.rosterSize || isEmergencyPair(room, fromTeam, toTeam);
  }
  return Math.abs(fromTeam.rosterSize - toTeam.rosterSize) === nearestRosterDistance(room);
}

function isRepeatedPair(room: Room, teamAId: string, teamBId: string) {
  const priorMatches = room.matches.filter((match) => match.status === "reported" && ((match.teamAId === teamAId && match.teamBId === teamBId) || (match.teamAId === teamBId && match.teamBId === teamAId)));
  if (priorMatches.length < 2) return false;
  const lastTwo = priorMatches.slice(-2);
  return Boolean(lastTwo[0].winnerTeamId && lastTwo[1].winnerTeamId && lastTwo[0].winnerTeamId !== lastTwo[1].winnerTeamId && lastTwo[0].stolenPlayerId && lastTwo[0].stolenPlayerId === lastTwo[1].stolenPlayerId);
}

function sendRoom(response: Response, room: Room, request: Request) {
  response.json({ room: publicRoom(room, request) });
}

function testHarnessEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.ENABLE_TEST_HARNESS ?? "").toLowerCase());
}

function requireTestHarness(response: Response) {
  if (!testHarnessEnabled()) {
    response.status(404).json({ error: "The manual test harness is disabled." });
    return false;
  }
  return true;
}

app.get("/api/test-harness/status", (_request, response) => {
  if (!testHarnessEnabled()) {
    response.status(404).json({ error: "The manual test harness is disabled." });
    return;
  }
  response.json({ enabled: true });
});

app.post("/api/test-harness/rooms", async (request, response) => {
  try {
    if (!requireTestHarness(response)) return undefined;
    const { matchmakingPolicy = "strict-emergency", maxFinalists = 2 } = request.body ?? {};
    if (!Number.isInteger(Number(maxFinalists)) || Number(maxFinalists) < 1 || Number(maxFinalists) > 5) {
      response.status(400).json({ error: "Maximum finalists must be between 1 and 5." });
      return undefined;
    }
    if (!["strict", "strict-emergency", "nearest"].includes(matchmakingPolicy)) {
      response.status(400).json({ error: "Invalid matchmaking policy." });
      return undefined;
    }
    const createdAt = Date.now();
    const room: Room = {
      roomCode: code(),
      hostToken: token(),
      rules: { startingPlayers: 15, maxFinalists: Number(maxFinalists), matchmakingPolicy },
      phase: "active",
      players: [],
      teams: Array.from({ length: 5 }, (_, index) => ({ id: `team-${index + 1}`, name: `Team ${String.fromCharCode(65 + index)}`, leadPlayerId: null, playerIds: [], rosterSize: 3, finalist: false, eliminated: false })),
      substitutes: [],
      challenges: [],
      matches: [],
      finalists: [],
      createdAt,
      expiresAt: createdAt + ACTIVE_ROOM_TTL_MS,
    };
    for (let index = 0; index < 15; index += 1) {
      const playerToken = token();
      const player: Player = { id: `player-${randomUUID()}`, name: `Test Player ${index + 1}`, token: playerToken, teamId: `team-${Math.floor(index / 3) + 1}`, substitute: false };
      const team = room.teams[Math.floor(index / 3)];
      team.playerIds.push(player.id);
      team.leadPlayerId ??= player.id;
      room.players.push(player);
    }
    await saveRoom(room);
    response.status(201).json({
      room: publicRoom(room, request),
      sessions: room.players.map((player) => ({
        playerId: player.id,
        name: player.name,
        token: player.token,
        teamId: player.teamId,
        teamName: room.teams.find((team) => team.id === player.teamId)?.name ?? player.teamId,
        isLead: room.teams.find((team) => team.id === player.teamId)?.leadPlayerId === player.id,
      })),
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create test room." });
  }
  return undefined;
});

app.post("/api/rooms", async (request, response) => {
  try {
    const { startingPlayers = 24, maxFinalists = 2, matchmakingPolicy = "strict-emergency" } = request.body ?? {};
    if (![15, 18, 21, 24, 27, 30].includes(Number(startingPlayers))) return response.status(400).json({ error: "Starting players must be 15, 18, 21, 24, 27, or 30." });
    if (!Number.isInteger(Number(maxFinalists)) || Number(maxFinalists) < 1 || Number(maxFinalists) > 5) return response.status(400).json({ error: "Maximum finalists must be between 1 and 5." });
    if (!["strict", "strict-emergency", "nearest"].includes(matchmakingPolicy)) return response.status(400).json({ error: "Invalid matchmaking policy." });
    const room: Room = {
      roomCode: code(),
      hostToken: token(),
      rules: { startingPlayers: Number(startingPlayers), maxFinalists: Number(maxFinalists), matchmakingPolicy },
      phase: "waiting",
      players: [],
      teams: Array.from({ length: Number(startingPlayers) / 3 }, (_, index) => ({ id: `team-${index + 1}`, name: `Team ${String.fromCharCode(65 + index)}`, leadPlayerId: null, playerIds: [], rosterSize: 0, finalist: false, eliminated: false })),
      substitutes: [],
      challenges: [],
      matches: [],
      finalists: [],
      createdAt: Date.now(),
       expiresAt: Date.now() + WAITING_ROOM_TTL_MS,
    };
    await saveRoom(room);
    response.status(201).json({ room: publicRoom(room, request), hostToken: room.hostToken });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create room." });
  }
  return undefined;
});

app.get("/api/rooms/:roomCode", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not load room." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/join", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    if (room.phase !== "waiting") return response.status(409).json({ error: "This tournament has already started." });
    const name = String(request.body?.name ?? "").trim().slice(0, 40);
    if (!name) return response.status(400).json({ error: "Enter a display name." });
    const playerToken = token();
    const player: Player = { id: `player-${randomUUID()}`, name, token: playerToken, teamId: null, substitute: false };
    const openTeam = room.teams.find((team) => team.playerIds.length < 3);
    if (openTeam) {
      openTeam.playerIds.push(player.id);
      openTeam.rosterSize = openTeam.playerIds.length;
      openTeam.leadPlayerId ??= player.id;
      player.teamId = openTeam.id;
    } else {
      player.substitute = true;
      room.substitutes.push(player.id);
    }
    room.players.push(player);
    await saveRoom(room);
    response.status(201).json({ room: publicRoom(room, request), playerToken });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not join room." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/start", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    if (!requireHost(room, request, response)) return;
    if (room.phase !== "waiting") return response.status(409).json({ error: "This tournament is not waiting to start." });
    if (room.teams.some((team) => team.playerIds.length !== 3)) return response.status(409).json({ error: "Every starting team needs 3 players before starting." });
    room.phase = "active";
    room.expiresAt = Date.now() + ACTIVE_ROOM_TTL_MS;
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not start room." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/rules", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    if (!requireHost(room, request, response)) return;
    if (room.phase !== "waiting") return response.status(409).json({ error: "Rules can only be changed before the tournament starts." });
    const { startingPlayers, maxFinalists, matchmakingPolicy } = request.body ?? {};
    if (Number(startingPlayers) !== room.rules.startingPlayers) return response.status(400).json({ error: "Starting player count cannot change after the room is created." });
    if (!Number.isInteger(Number(maxFinalists)) || Number(maxFinalists) < 1 || Number(maxFinalists) > 5) return response.status(400).json({ error: "Maximum finalists must be between 1 and 5." });
    if (!["strict", "strict-emergency", "nearest"].includes(matchmakingPolicy)) return response.status(400).json({ error: "Invalid matchmaking policy." });
    room.rules.maxFinalists = Number(maxFinalists);
    room.rules.matchmakingPolicy = matchmakingPolicy;
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not save rules." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/challenges", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const fromTeam = player && room?.teams.find((team) => team.id === player.teamId);
    const toTeam = room?.teams.find((team) => team.id === request.body?.toTeamId);
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    if (room.phase !== "active" || !player || !fromTeam || fromTeam.leadPlayerId !== player.id) return response.status(403).json({ error: "Only an active team lead can challenge." });
    if (!fromTeam || fromTeam.finalist || fromTeam.eliminated || fromTeam.playerIds.length < 2 || !toTeam || toTeam.id === fromTeam.id || toTeam.finalist || toTeam.eliminated || toTeam.playerIds.length < 2 || teamInMatch(room, fromTeam.id) || teamInMatch(room, toTeam.id)) return response.status(400).json({ error: "That team cannot be challenged right now." });
    if (!legalMatchmakingPair(room, fromTeam, toTeam)) return response.status(400).json({ error: "That team is not a legal matchmaking target right now." });
    if (room.challenges.some((challenge) => challenge.status === "pending" && challenge.fromTeamId === fromTeam.id)) return response.status(409).json({ error: "Your team already has a pending challenge." });
    room.challenges.push({ id: `challenge-${randomUUID()}`, fromTeamId: fromTeam.id, toTeamId: toTeam.id, status: "pending" });
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create challenge." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/challenges/:challengeId/cancel", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const challenge = room?.challenges.find((item) => item.id === request.params.challengeId);
    if (!room || !challenge) return response.status(404).json({ error: "Challenge not found." });
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (room.phase !== "active" || !player || !team || team.id !== challenge.fromTeamId || team.leadPlayerId !== player.id) {
      return response.status(403).json({ error: "Only the challenging team lead can cancel this challenge." });
    }
    if (challenge.status !== "pending") return response.status(409).json({ error: "That challenge is no longer pending." });
    challenge.status = "declined";
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not cancel challenge." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/replace", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const actor = room && currentPlayer(room, request);
    const team = room?.teams.find((item) => item.id === request.body?.teamId);
    const missingPlayer = room?.players.find((item) => item.id === request.body?.playerId);
    const substitute = room?.players.find((item) => item.id === request.body?.substituteId);
    const isHost = room && request.header("x-room-token") === room.hostToken;
    const isLead = actor && team?.leadPlayerId === actor.id && actor.teamId === team.id;
    if (!room) return response.status(404).json({ error: "Tournament room not found." });
    if (room.phase !== "waiting" && room.phase !== "active") return response.status(409).json({ error: "This tournament cannot accept substitutions." });
    if (!isHost && !isLead) return response.status(403).json({ error: "Only the host or team lead can make a replacement." });
    if (!team || team.finalist || team.eliminated || !missingPlayer || missingPlayer.teamId !== team.id || !substitute || !room.substitutes.includes(substitute.id)) return response.status(400).json({ error: "Choose a valid team player and substitute." });
    team.playerIds = team.playerIds.filter((id) => id !== missingPlayer.id);
    team.playerIds.push(substitute.id);
    team.rosterSize = team.playerIds.length;
    if (team.leadPlayerId === missingPlayer.id) team.leadPlayerId = substitute.id;
    missingPlayer.teamId = null;
    substitute.teamId = team.id;
    substitute.substitute = false;
    room.substitutes = room.substitutes.filter((id) => id !== substitute.id);
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not make replacement." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/challenges/:challengeId/accept", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const challenge = room?.challenges.find((item) => item.id === request.params.challengeId);
    if (!room || !challenge) return response.status(404).json({ error: "Challenge not found." });
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (room.phase !== "active") return response.status(409).json({ error: "This tournament is no longer accepting matches." });
    if (!player || !team || team.id !== challenge.toTeamId || team.leadPlayerId !== player.id) return response.status(403).json({ error: "Only the challenged team lead can accept." });
    if (challenge.status !== "pending") return response.status(409).json({ error: "That challenge is no longer pending." });
    const fromTeam = room.teams.find((item) => item.id === challenge.fromTeamId);
    if (!fromTeam || fromTeam.finalist || fromTeam.eliminated || fromTeam.playerIds.length < 2 || team.finalist || team.eliminated || team.playerIds.length < 2 || teamInMatch(room, challenge.fromTeamId) || teamInMatch(room, challenge.toTeamId)) return response.status(409).json({ error: "One of these teams cannot enter a match right now." });
    if (!legalMatchmakingPair(room, fromTeam, team)) return response.status(409).json({ error: "This challenge is no longer a legal matchmaking pair." });
    challenge.status = "accepted";
    room.challenges = room.challenges.filter((item) => item.id === challenge.id || item.status !== "pending" || (item.fromTeamId !== challenge.toTeamId && item.toTeamId !== challenge.toTeamId && item.fromTeamId !== challenge.fromTeamId && item.toTeamId !== challenge.fromTeamId));
    const match: Match = { id: `match-${randomUUID()}`, challengeId: challenge.id, teamAId: challenge.fromTeamId, teamBId: challenge.toTeamId, lobbyMakerTeamId: challenge.fromTeamId, status: "lobby", emergency: isEmergencyPair(room, fromTeam, team), goldenGoal: isRepeatedPair(room, fromTeam.id, team.id) };
    challenge.matchId = match.id;
    room.matches.push(match);
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not accept challenge." });
  }
  return undefined;
});

app.post("/api/rooms/:roomCode/matches/:matchId/report", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const match = room?.matches.find((item) => item.id === request.params.matchId);
    if (!room || !match) return response.status(404).json({ error: "Match not found." });
    if (room.phase !== "active") return response.status(409).json({ error: "This tournament has finished qualification." });
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (!player || !team || team.leadPlayerId !== player.id || ![match.teamAId, match.teamBId].includes(team.id)) return response.status(403).json({ error: "Only a participating team lead can report this match." });
    if (match.status !== "lobby") return response.status(409).json({ error: "This match has already been reported." });
    const winner = room.teams.find((item) => item.id === request.body?.winnerTeamId);
    const loser = room.teams.find((item) => item.id !== winner?.id && [match.teamAId, match.teamBId].includes(item.id));
    const stolenPlayerId = String(request.body?.stolenPlayerId ?? "");
    const requestedGoldenGoalPlayerIds: string[] = Array.isArray(request.body?.stolenPlayerIds) ? request.body.stolenPlayerIds.map((id: unknown) => String(id)) : [];
    const hasUniqueGoldenGoalPlayers = new Set(requestedGoldenGoalPlayerIds).size === requestedGoldenGoalPlayerIds.length;
    const validGoldenGoalSelection = requestedGoldenGoalPlayerIds.length === (loser?.playerIds.length ?? 0) - 1 && hasUniqueGoldenGoalPlayers && requestedGoldenGoalPlayerIds.every((id) => loser?.playerIds.includes(id));
    if (!winner || !loser || winner.finalist || winner.eliminated || loser.finalist || loser.eliminated || winner.rosterSize < 2 || winner.rosterSize >= 5 || ![match.teamAId, match.teamBId].includes(winner.id) || loser.playerIds.length < 2 || (match.goldenGoal ? !validGoldenGoalSelection : !loser.playerIds.includes(stolenPlayerId))) return response.status(400).json({ error: match.goldenGoal ? "Choose exactly one fewer player than the losing team has." : "Choose a valid winner and stolen player." });
    const stolenPlayerIds = match.goldenGoal ? requestedGoldenGoalPlayerIds : [stolenPlayerId];
    const remainingLoserPlayerIds = loser.playerIds.filter((id) => !stolenPlayerIds.includes(id));
    if (match.goldenGoal && stolenPlayerIds.length !== loser.playerIds.length - 1) return response.status(400).json({ error: "Golden-goal matches must transfer all but one player from the losing team." });
    if (winner.playerIds.length + stolenPlayerIds.length > 5) return response.status(400).json({ error: "A match cannot create a team larger than five players." });
    loser.playerIds = remainingLoserPlayerIds;
    winner.playerIds.push(...stolenPlayerIds);
    winner.rosterSize = winner.playerIds.length;
    loser.rosterSize = loser.playerIds.length;
    stolenPlayerIds.forEach((id) => {
      const stolen = room.players.find((item) => item.id === id);
      if (stolen) stolen.teamId = winner.id;
    });
    if (winner.rosterSize === 5) {
      winner.finalist = true;
      room.finalists.push(winner.id);
    }
    if (loser.rosterSize <= 1) {
      loser.eliminated = true;
      if (match.goldenGoal) {
        loser.playerIds.forEach((id) => {
          const playerToEliminate = room.players.find((item) => item.id === id);
          if (playerToEliminate) playerToEliminate.teamId = null;
        });
      }
    }
    if (!loser.playerIds.includes(loser.leadPlayerId ?? "")) loser.leadPlayerId = loser.playerIds[0] ?? null;
    match.status = "reported";
    match.winnerTeamId = winner.id;
    match.loserTeamId = loser.id;
    match.stolenPlayerId = stolenPlayerIds[0];
    match.stolenPlayerIds = stolenPlayerIds;
    const challenge = room.challenges.find((item) => item.id === match.challengeId);
    if (challenge) challenge.status = "reported";
    if (room.finalists.length >= room.rules.maxFinalists) {
      room.phase = "finished";
      room.expiresAt = Date.now() + FINISHED_ROOM_TTL_MS;
    }
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not report match." });
  }
  return undefined;
});

export default app;
