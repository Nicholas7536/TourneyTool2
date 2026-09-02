import { APIRequestContext, expect } from '@playwright/test';

export type Policy = 'strict' | 'strict-emergency' | 'nearest';
export type Phase = 'waiting' | 'active' | 'finished';

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
  status: 'pending' | 'accepted' | 'reported' | 'declined';
  matchId?: string;
};

export type Match = {
  id: string;
  challengeId: string;
  teamAId: string;
  teamBId: string;
  lobbyMakerTeamId: string;
  status: 'lobby' | 'reported' | 'voided';
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
};

export type HarnessSession = {
  playerId: string;
  name: string;
  token: string;
  teamId: string;
  teamName: string;
  isLead: boolean;
};

export type HarnessSetup = {
  room: Room;
  hostToken: string;
  sessions: HarnessSession[];
};

/**
 * Creates a standard active 15-player test room using the test-harness endpoint.
 */
export async function createHarnessRoom(
  request: APIRequestContext,
  options: { matchmakingPolicy?: Policy; maxFinalists?: number } = {},
): Promise<HarnessSetup> {
  const response = await request.post('/api/test-harness/rooms', {
    data: {
      matchmakingPolicy: options.matchmakingPolicy ?? 'strict-emergency',
      maxFinalists: options.maxFinalists ?? 2,
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as HarnessSetup;
}

/**
 * Loads the current public/authorized room state.
 */
export async function getRoom(
  request: APIRequestContext,
  roomCode: string,
  token?: string,
): Promise<{ room: Room; you?: { id: string; name: string; teamId: string | null; substitute: boolean; isHost: boolean; isLead: boolean } }> {
  const headers: Record<string, string> = {};
  if (token) headers['x-room-token'] = token;
  const response = await request.get(`/api/rooms/${roomCode}`, { headers });
  expect(response.status()).toBe(200);
  return (await response.json()) as { room: Room; you?: any };
}

/**
 * Sends a challenge from a team lead to another team.
 */
export async function issueChallenge(
  request: APIRequestContext,
  roomCode: string,
  fromPlayerToken: string,
  toTeamId: string,
) {
  return await request.post(`/api/rooms/${roomCode}/challenges`, {
    headers: { 'x-room-token': fromPlayerToken },
    data: { toTeamId },
  });
}

/**
 * Accepts a pending challenge.
 */
export async function acceptChallenge(
  request: APIRequestContext,
  roomCode: string,
  toPlayerToken: string,
  challengeId: string,
) {
  return await request.post(`/api/rooms/${roomCode}/challenges/${challengeId}/accept`, {
    headers: { 'x-room-token': toPlayerToken },
  });
}

/**
 * Cancels an outgoing pending challenge.
 */
export async function cancelChallenge(
  request: APIRequestContext,
  roomCode: string,
  fromPlayerToken: string,
  challengeId: string,
) {
  return await request.post(`/api/rooms/${roomCode}/challenges/${challengeId}/cancel`, {
    headers: { 'x-room-token': fromPlayerToken },
  });
}

/**
 * Reports a match result with stolen player(s).
 */
export async function reportMatch(
  request: APIRequestContext,
  roomCode: string,
  leadToken: string,
  matchId: string,
  data: {
    winnerTeamId: string;
    stolenPlayerId?: string;
    stolenPlayerIds?: string[];
  },
) {
  return await request.post(`/api/rooms/${roomCode}/matches/${matchId}/report`, {
    headers: { 'x-room-token': leadToken },
    data,
  });
}
