// ─── Domain types ─────────────────────────────────────────────────────────────

export type Policy = "strict" | "strict-emergency" | "nearest";
export type Phase = "waiting" | "active" | "finished";

export type Player = {
  id: string;
  name: string;
  token: string;
  teamId: string | null;
  substitute: boolean;
};

export type Team = {
  id: string;
  name: string;
  leadPlayerId: string | null;
  playerIds: string[];
  rosterSize: number;
  finalist: boolean;
  eliminated: boolean;
};

export type Challenge = {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  status: "pending" | "accepted" | "reported" | "declined";
  matchId?: string;
};

export type Match = {
  id: string;
  challengeId: string;
  teamAId: string;
  teamBId: string;
  lobbyMakerTeamId: string;
  status: "lobby" | "reported" | "voided";
  emergency?: boolean;
  goldenGoal?: boolean;
  winnerTeamId?: string;
  loserTeamId?: string;
  stolenPlayerId?: string;
  stolenPlayerIds?: string[];
};

export type Room = {
  roomCode: string;
  hostToken: string;
  rules: { startingPlayers: number; maxFinalists: number; matchmakingPolicy: Policy };
  phase: Phase;
  players: Player[];
  teams: Team[];
  substitutes: string[];
  eliminated: string[];
  challenges: Challenge[];
  matches: Match[];
  finalists: string[];
  createdAt: number;
  expiresAt: number;
};

// ─── Constants ────────────────────────────────────────────────────────────────

export const VALID_STARTING_PLAYERS = [15, 18, 21, 27, 30] as const;
export const VALID_POLICIES: Policy[] = ["strict", "strict-emergency", "nearest"];

export const WAITING_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
export const ACTIVE_ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const FINISHED_ROOM_TTL_MS = 24 * 60 * 60 * 1000;
