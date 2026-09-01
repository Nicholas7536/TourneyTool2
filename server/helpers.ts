import { type Request, type Response } from "express";
import { type Room, type Policy, VALID_POLICIES } from "./types.js";

// ─── Input validation ─────────────────────────────────────────────────────────

export function validateMaxFinalists(value: unknown): string | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) return "Maximum finalists must be between 1 and 5.";
  return null;
}

export function validateMatchmakingPolicy(value: unknown): string | null {
  if (!VALID_POLICIES.includes(value as Policy)) return "Invalid matchmaking policy.";
  return null;
}

// ─── Request helpers ──────────────────────────────────────────────────────────

export function requireHost(room: Room, request: Request, response: Response) {
  if (request.header("x-room-token") !== room.hostToken) {
    response.status(403).json({ error: "Only the host can do that." });
    return false;
  }
  return true;
}

export function currentPlayer(room: Room, request: Request) {
  return room.players.find((player) => player.token === request.header("x-room-token"));
}

// ─── Response helpers ─────────────────────────────────────────────────────────

export function publicRoom(room: Room, request: Request) {
  const roomToken = request.header("x-room-token");
  const host = roomToken === room.hostToken;
  const current = room.players.find((player) => player.token === roomToken);
  return {
    roomCode: room.roomCode,
    rules: room.rules,
    phase: room.phase,
    players: room.players.map(({ token: _token, ...player }) => player),
    teams: room.teams.map((team) => ({ ...team, rosterSize: team.playerIds.length })),
    substitutes: room.substitutes,
    eliminated: room.eliminated,
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
}

export function sendRoom(response: Response, room: Room, request: Request) {
  response.json({ room: publicRoom(room, request) });
}
