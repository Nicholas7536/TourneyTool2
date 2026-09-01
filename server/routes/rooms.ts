import { Router } from "express";
import { randomUUID } from "node:crypto";
import { type Player, type Match, type Room, VALID_STARTING_PLAYERS, WAITING_ROOM_TTL_MS, ACTIVE_ROOM_TTL_MS, FINISHED_ROOM_TTL_MS } from "../types.js";
import { code, token, findRoom, saveRoom } from "../db.js";
import { syncTeamState, teamInMatch, legalMatchmakingPair, isEmergencyPair, isRepeatedPair } from "../tournament.js";
import { requireHost, currentPlayer, validateMaxFinalists, validateMatchmakingPolicy, publicRoom, sendRoom } from "../helpers.js";

const router = Router();

// ─── Room lifecycle ───────────────────────────────────────────────────────────

router.post("/", async (request, response) => {
  try {
    const { startingPlayers = 27, maxFinalists = 2, matchmakingPolicy = "strict-emergency" } = request.body ?? {};
    if (!VALID_STARTING_PLAYERS.includes(Number(startingPlayers) as (typeof VALID_STARTING_PLAYERS)[number])) {
      response.status(400).json({ error: "Starting players must be 15, 18, 21, 27, or 30." });
      return;
    }
    const finalistsError = validateMaxFinalists(maxFinalists);
    if (finalistsError) { response.status(400).json({ error: finalistsError }); return; }
    const policyError = validateMatchmakingPolicy(matchmakingPolicy);
    if (policyError) { response.status(400).json({ error: policyError }); return; }
    const now = Date.now();
    const room: Room = {
      roomCode: code(),
      hostToken: token(),
      rules: { startingPlayers: Number(startingPlayers), maxFinalists: Number(maxFinalists), matchmakingPolicy },
      phase: "waiting",
      players: [],
      teams: Array.from({ length: Number(startingPlayers) / 3 }, (_, index) => ({
        id: `team-${index + 1}`,
        name: `Team ${String.fromCharCode(65 + index)}`,
        leadPlayerId: null,
        playerIds: [],
        rosterSize: 0,
        finalist: false,
        eliminated: false,
      })),
      substitutes: [],
      eliminated: [],
      challenges: [],
      matches: [],
      finalists: [],
      createdAt: now,
      expiresAt: now + WAITING_ROOM_TTL_MS,
    };
    await saveRoom(room);
    response.status(201).json({ room: publicRoom(room, request), hostToken: room.hostToken });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create room." });
  }
});

router.get("/:roomCode", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not load room." });
  }
});

router.post("/:roomCode/join", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    const name = String(request.body?.name ?? "").trim().slice(0, 40);
    if (!name) { response.status(400).json({ error: "Enter a display name." }); return; }
    const playerToken = token();
    const player: Player = { id: `player-${randomUUID()}`, name, token: playerToken, teamId: null, substitute: false };
    const openTeam = room.phase === "waiting" ? room.teams.find((team) => team.playerIds.length < 3) : undefined;
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
});

router.post("/:roomCode/start", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (!requireHost(room, request, response)) return;
    if (room.phase !== "waiting") { response.status(409).json({ error: "This tournament is not waiting to start." }); return; }
    const validPopulation =
      VALID_STARTING_PLAYERS.includes(room.players.length as (typeof VALID_STARTING_PLAYERS)[number]) &&
      room.players.length === room.rules.startingPlayers &&
      !room.substitutes.length &&
      room.teams.every((team) => team.playerIds.length === 3);
    if (!validPopulation) {
      response.status(409).json({ error: "The room must contain a valid complete starting population (15, 18, 21, 27, or 30 players)." });
      return;
    }
    room.phase = "active";
    room.expiresAt = Date.now() + ACTIVE_ROOM_TTL_MS;
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not start room." });
  }
});

router.post("/:roomCode/rules", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (!requireHost(room, request, response)) return;
    if (room.phase !== "waiting") { response.status(409).json({ error: "Rules can only be changed before the tournament starts." }); return; }
    const { startingPlayers, maxFinalists, matchmakingPolicy } = request.body ?? {};
    if (Number(startingPlayers) !== room.rules.startingPlayers) {
      response.status(400).json({ error: "Starting player count cannot change after the room is created." });
      return;
    }
    const finalistsError = validateMaxFinalists(maxFinalists);
    if (finalistsError) { response.status(400).json({ error: finalistsError }); return; }
    const policyError = validateMatchmakingPolicy(matchmakingPolicy);
    if (policyError) { response.status(400).json({ error: policyError }); return; }
    room.rules.maxFinalists = Number(maxFinalists);
    room.rules.matchmakingPolicy = matchmakingPolicy;
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not save rules." });
  }
});

// ─── Challenges ───────────────────────────────────────────────────────────────

router.post("/:roomCode/challenges", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const fromTeam = player && room?.teams.find((team) => team.id === player.teamId);
    const toTeam = room?.teams.find((team) => team.id === request.body?.toTeamId);
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (room.phase !== "active" || !player || !fromTeam || fromTeam.leadPlayerId !== player.id) {
      response.status(403).json({ error: "Only an active team lead can challenge." });
      return;
    }
    const challengerBlocked = fromTeam.finalist || fromTeam.eliminated || fromTeam.playerIds.length < 2 || teamInMatch(room, fromTeam.id);
    const targetBlocked = !toTeam || toTeam.id === fromTeam.id || toTeam.finalist || toTeam.eliminated || toTeam.playerIds.length < 2 || teamInMatch(room, toTeam.id);
    if (challengerBlocked || targetBlocked) {
      response.status(400).json({ error: "That team cannot be challenged right now." });
      return;
    }
    if (!legalMatchmakingPair(room, fromTeam, toTeam)) {
      response.status(400).json({ error: "That team is not a legal matchmaking target right now." });
      return;
    }
    if (room.challenges.some((c) => c.status === "pending" && c.fromTeamId === fromTeam.id)) {
      response.status(409).json({ error: "Your team already has a pending challenge." });
      return;
    }
    room.challenges.push({ id: `challenge-${randomUUID()}`, fromTeamId: fromTeam.id, toTeamId: toTeam.id, status: "pending" });
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not create challenge." });
  }
});

router.post("/:roomCode/challenges/:challengeId/accept", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const challenge = room?.challenges.find((item) => item.id === request.params.challengeId);
    if (!room || !challenge) { response.status(404).json({ error: "Challenge not found." }); return; }
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (room.phase !== "active") { response.status(409).json({ error: "This tournament is no longer accepting matches." }); return; }
    if (!player || !team || team.id !== challenge.toTeamId || team.leadPlayerId !== player.id) {
      response.status(403).json({ error: "Only the challenged team lead can accept." });
      return;
    }
    if (challenge.status !== "pending") { response.status(409).json({ error: "That challenge is no longer pending." }); return; }
    const fromTeam = room.teams.find((item) => item.id === challenge.fromTeamId);
    const eitherTeamInvalid = !fromTeam || fromTeam.finalist || fromTeam.eliminated || fromTeam.playerIds.length < 2 || team.finalist || team.eliminated || team.playerIds.length < 2;
    const eitherInMatch = teamInMatch(room, challenge.fromTeamId) || teamInMatch(room, challenge.toTeamId);
    if (eitherTeamInvalid || eitherInMatch) {
      response.status(409).json({ error: "One of these teams cannot enter a match right now." });
      return;
    }
    if (!legalMatchmakingPair(room, fromTeam, team)) {
      response.status(409).json({ error: "This challenge is no longer a legal matchmaking pair." });
      return;
    }
    challenge.status = "accepted";
    // Remove all pending challenges involving either participating team.
    room.challenges = room.challenges.filter((item) =>
      item.id === challenge.id ||
      item.status !== "pending" ||
      (item.fromTeamId !== challenge.toTeamId &&
       item.toTeamId !== challenge.toTeamId &&
       item.fromTeamId !== challenge.fromTeamId &&
       item.toTeamId !== challenge.fromTeamId),
    );
    const match: Match = {
      id: `match-${randomUUID()}`,
      challengeId: challenge.id,
      teamAId: challenge.fromTeamId,
      teamBId: challenge.toTeamId,
      lobbyMakerTeamId: challenge.fromTeamId,
      status: "lobby",
      emergency: isEmergencyPair(room, fromTeam, team),
      goldenGoal: isRepeatedPair(room, fromTeam.id, team.id),
    };
    challenge.matchId = match.id;
    room.matches.push(match);
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not accept challenge." });
  }
});

router.post("/:roomCode/challenges/:challengeId/cancel", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const challenge = room?.challenges.find((item) => item.id === request.params.challengeId);
    if (!room || !challenge) { response.status(404).json({ error: "Challenge not found." }); return; }
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (room.phase !== "active" || !player || !team || team.id !== challenge.fromTeamId || team.leadPlayerId !== player.id) {
      response.status(403).json({ error: "Only the challenging team lead can cancel this challenge." });
      return;
    }
    if (challenge.status !== "pending") { response.status(409).json({ error: "That challenge is no longer pending." }); return; }
    challenge.status = "declined";
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not cancel challenge." });
  }
});

// ─── Matches ──────────────────────────────────────────────────────────────────

router.post("/:roomCode/matches/:matchId/void", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (!requireHost(room, request, response)) return;
    const match = room.matches.find((item) => item.id === request.params.matchId);
    if (!match) { response.status(404).json({ error: "Match not found." }); return; }
    if (match.status !== "lobby") { response.status(409).json({ error: "Only an active match can be voided." }); return; }
    match.status = "voided";
    const challenge = room.challenges.find((item) => item.id === match.challengeId);
    if (challenge) challenge.status = "declined";
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not void match." });
  }
});

router.post("/:roomCode/matches/:matchId/report", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const player = room && currentPlayer(room, request);
    const match = room?.matches.find((item) => item.id === request.params.matchId);
    if (!room || !match) { response.status(404).json({ error: "Match not found." }); return; }
    if (room.phase !== "active") { response.status(409).json({ error: "This tournament has finished qualification." }); return; }
    const team = player && room.teams.find((item) => item.id === player.teamId);
    if (!player || !team || team.leadPlayerId !== player.id || ![match.teamAId, match.teamBId].includes(team.id)) {
      response.status(403).json({ error: "Only a participating team lead can report this match." });
      return;
    }
    if (match.status !== "lobby") { response.status(409).json({ error: "This match has already been reported." }); return; }
    const winner = room.teams.find((item) => item.id === request.body?.winnerTeamId);
    const loser = room.teams.find((item) => item.id !== winner?.id && [match.teamAId, match.teamBId].includes(item.id));
    const stolenPlayerId = String(request.body?.stolenPlayerId ?? "");
    const requestedGoldenGoalPlayerIds: string[] = Array.isArray(request.body?.stolenPlayerIds)
      ? request.body.stolenPlayerIds.map((id: unknown) => String(id))
      : [];
    const hasUniqueGoldenGoalPlayers = new Set(requestedGoldenGoalPlayerIds).size === requestedGoldenGoalPlayerIds.length;
    const validGoldenGoalSelection =
      requestedGoldenGoalPlayerIds.length === (loser?.playerIds.length ?? 0) - 1 &&
      hasUniqueGoldenGoalPlayers &&
      requestedGoldenGoalPlayerIds.every((id) => loser?.playerIds.includes(id));
    const reportInvalid =
      !winner || !loser ||
      winner.finalist || winner.eliminated || loser.finalist || loser.eliminated ||
      winner.rosterSize < 2 || winner.rosterSize >= 5 ||
      ![match.teamAId, match.teamBId].includes(winner.id) ||
      loser.playerIds.length < 2 ||
      (match.goldenGoal ? !validGoldenGoalSelection : !loser.playerIds.includes(stolenPlayerId));
    if (reportInvalid) {
      response.status(400).json({ error: match.goldenGoal ? "Choose exactly one fewer player than the losing team has." : "Choose a valid winner and stolen player." });
      return;
    }
    const stolenPlayerIds = match.goldenGoal ? requestedGoldenGoalPlayerIds : [stolenPlayerId];
    const remainingLoserPlayerIds = loser.playerIds.filter((id) => !stolenPlayerIds.includes(id));
    if (match.goldenGoal && stolenPlayerIds.length !== loser.playerIds.length - 1) {
      response.status(400).json({ error: "Golden-goal matches must transfer all but one player from the losing team." });
      return;
    }
    if (winner.playerIds.length + stolenPlayerIds.length > 5) {
      response.status(400).json({ error: "A match cannot create a team larger than five players." });
      return;
    }
    loser.playerIds = remainingLoserPlayerIds;
    winner.playerIds.push(...stolenPlayerIds);
    winner.rosterSize = winner.playerIds.length;
    loser.rosterSize = loser.playerIds.length;
    for (const id of stolenPlayerIds) {
      const stolen = room.players.find((item) => item.id === id);
      if (stolen) stolen.teamId = winner.id;
    }
    if (winner.rosterSize === 5) {
      winner.finalist = true;
      room.finalists.push(winner.id);
    }
    if (loser.rosterSize <= 1) {
      loser.eliminated = true;
      if (match.goldenGoal) {
        for (const id of loser.playerIds) {
          const playerToEliminate = room.players.find((item) => item.id === id);
          if (playerToEliminate) playerToEliminate.teamId = null;
          if (!room.eliminated.includes(id)) room.eliminated.push(id);
        }
      } else {
        const eliminatedPlayer = room.players.find((item) => item.id === loser.playerIds[0]);
        if (eliminatedPlayer) eliminatedPlayer.teamId = null;
        if (loser.playerIds[0] && !room.eliminated.includes(loser.playerIds[0])) room.eliminated.push(loser.playerIds[0]);
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
    syncTeamState(room);
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not report match." });
  }
});

// ─── Admin ────────────────────────────────────────────────────────────────────

router.post("/:roomCode/replace", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    const team = room?.teams.find((item) => item.id === request.body?.teamId);
    const missingPlayer = room?.players.find((item) => item.id === request.body?.playerId);
    const substitute = room?.players.find((item) => item.id === request.body?.substituteId);
    const isHost = room && request.header("x-room-token") === room.hostToken;
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (room.phase !== "waiting" && room.phase !== "active") {
      response.status(409).json({ error: "This tournament cannot accept substitutions." });
      return;
    }
    if (!isHost) { response.status(403).json({ error: "Only the room creator can make a replacement." }); return; }
    if (!team || team.finalist || team.eliminated || !missingPlayer || missingPlayer.teamId !== team.id || !substitute || !room.substitutes.includes(substitute.id)) {
      response.status(400).json({ error: "Choose a valid team player and substitute." });
      return;
    }
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
});

router.post("/:roomCode/admin/move", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (!requireHost(room, request, response)) return;
    const player = room.players.find((item) => item.id === request.body?.playerId);
    const destination = String(request.body?.destination ?? "");
    if (!player || !["team", "substitute", "eliminated"].includes(destination)) {
      response.status(400).json({ error: "Choose a valid player and destination." });
      return;
    }
    const sourceTeam = player.teamId
      ? room.teams.find((team) => team.id === player.teamId)
      : room.teams.find((team) => team.playerIds.includes(player.id));
    if (sourceTeam && player.teamId && sourceTeam.playerIds.length <= 1) {
      response.status(409).json({ error: "A team's last player cannot be moved by this action." });
      return;
    }
    const destinationTeam = destination === "team" ? room.teams.find((team) => team.id === request.body?.teamId) : undefined;
    if (destination === "team" && (!destinationTeam || destinationTeam.id === sourceTeam?.id || destinationTeam.playerIds.length > 4)) {
      response.status(400).json({ error: "Choose a valid team with an open roster slot." });
      return;
    }
    room.substitutes = room.substitutes.filter((id) => id !== player.id);
    room.eliminated = room.eliminated.filter((id) => id !== player.id);
    if (sourceTeam) {
      sourceTeam.playerIds = sourceTeam.playerIds.filter((id) => id !== player.id);
      if (sourceTeam.leadPlayerId === player.id) sourceTeam.leadPlayerId = sourceTeam.playerIds[0] ?? null;
    }
    if (destination === "team" && destinationTeam) {
      destinationTeam.playerIds.push(player.id);
      destinationTeam.leadPlayerId ??= player.id;
      player.teamId = destinationTeam.id;
      player.substitute = false;
      const revived = destinationTeam.playerIds.find((id) => room.eliminated.includes(id));
      if (revived) {
        room.eliminated = room.eliminated.filter((id) => id !== revived);
        const revivedPlayer = room.players.find((item) => item.id === revived);
        if (revivedPlayer) revivedPlayer.teamId = destinationTeam.id;
      }
    } else {
      player.teamId = null;
      player.substitute = destination === "substitute";
      if (destination === "substitute") room.substitutes.push(player.id);
      else room.eliminated.push(player.id);
    }
    if (sourceTeam && sourceTeam.playerIds.length === 1) {
      const remaining = room.players.find((item) => item.id === sourceTeam.playerIds[0]);
      if (remaining) {
        remaining.teamId = null;
        remaining.substitute = false;
        if (!room.eliminated.includes(remaining.id)) room.eliminated.push(remaining.id);
      }
    }
    room.teams = room.teams.filter((team) => team.playerIds.length > 0);
    syncTeamState(room);
    if (room.finalists.length >= room.rules.maxFinalists) {
      room.phase = "finished";
      room.expiresAt = Date.now() + FINISHED_ROOM_TTL_MS;
    } else if (room.phase === "finished" && room.finalists.length < room.rules.maxFinalists) {
      room.phase = "active";
      room.expiresAt = Date.now() + ACTIVE_ROOM_TTL_MS;
    }
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not move player." });
  }
});

router.post("/:roomCode/admin/kick", async (request, response) => {
  try {
    const room = await findRoom(request.params.roomCode.toUpperCase());
    if (!room) { response.status(404).json({ error: "Tournament room not found." }); return; }
    if (!requireHost(room, request, response)) return;
    const player = room.players.find((item) => item.id === request.body?.playerId);
    if (!player) { response.status(404).json({ error: "Player not found." }); return; }
    const team = player.teamId
      ? room.teams.find((item) => item.id === player.teamId)
      : room.teams.find((item) => item.playerIds.includes(player.id));
    if (team) {
      team.playerIds = team.playerIds.filter((id) => id !== player.id);
      if (team.leadPlayerId === player.id) team.leadPlayerId = team.playerIds[0] ?? null;
    }
    room.players = room.players.filter((item) => item.id !== player.id);
    room.substitutes = room.substitutes.filter((id) => id !== player.id);
    room.eliminated = room.eliminated.filter((id) => id !== player.id);
    room.challenges = room.challenges.filter((c) => c.fromTeamId !== team?.id && c.toTeamId !== team?.id);
    room.matches = room.matches.map((match) =>
      [match.teamAId, match.teamBId].includes(team?.id ?? "") && match.status === "lobby"
        ? { ...match, status: "voided" as const }
        : match,
    );
    room.teams = room.teams.filter((item) => item.playerIds.length > 0);
    syncTeamState(room);
    await saveRoom(room);
    sendRoom(response, room, request);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : "Could not kick player." });
  }
});

export default router;
