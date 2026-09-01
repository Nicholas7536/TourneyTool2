import { Router } from "express";
import { randomUUID } from "node:crypto";
import { type Player, type Room, ACTIVE_ROOM_TTL_MS } from "../types.js";
import { code, token, saveRoom } from "../db.js";
import { syncTeamState } from "../tournament.js";
import { validateMaxFinalists, validateMatchmakingPolicy, publicRoom } from "../helpers.js";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function testHarnessEnabled() {
  return ["1", "true", "yes"].includes(String(process.env.ENABLE_TEST_HARNESS ?? "").toLowerCase());
}

// ─── Routes ───────────────────────────────────────────────────────────────────

router.get("/status", (_request, response) => {
  if (!testHarnessEnabled()) {
    response.status(404).json({ error: "The manual test harness is disabled." });
    return;
  }
  response.json({ enabled: true });
});

router.post("/rooms", async (request, response) => {
  try {
    if (!testHarnessEnabled()) { response.status(404).json({ error: "The manual test harness is disabled." }); return; }
    const { matchmakingPolicy = "strict-emergency", maxFinalists = 2 } = request.body ?? {};
    const policyError = validateMatchmakingPolicy(matchmakingPolicy);
    if (policyError) { response.status(400).json({ error: policyError }); return; }
    const finalistsError = validateMaxFinalists(maxFinalists);
    if (finalistsError) { response.status(400).json({ error: finalistsError }); return; }
    const createdAt = Date.now();
    const room: Room = {
      roomCode: code(),
      hostToken: token(),
      rules: { startingPlayers: 15, maxFinalists: Number(maxFinalists), matchmakingPolicy },
      phase: "active",
      players: [],
      teams: Array.from({ length: 5 }, (_, index) => ({
        id: `team-${index + 1}`,
        name: `Team ${String.fromCharCode(65 + index)}`,
        leadPlayerId: null,
        playerIds: [],
        rosterSize: 3,
        finalist: false,
        eliminated: false,
      })),
      substitutes: [],
      eliminated: [],
      challenges: [],
      matches: [],
      finalists: [],
      createdAt,
      expiresAt: createdAt + ACTIVE_ROOM_TTL_MS,
    };
    for (let i = 0; i < 15; i += 1) {
      const playerToken = token();
      const player: Player = {
        id: `player-${randomUUID()}`,
        name: `Test Player ${i + 1}`,
        token: playerToken,
        teamId: `team-${Math.floor(i / 3) + 1}`,
        substitute: false,
      };
      const team = room.teams[Math.floor(i / 3)];
      team.playerIds.push(player.id);
      team.leadPlayerId ??= player.id;
      room.players.push(player);
    }
    syncTeamState(room);
    await saveRoom(room);
    response.status(201).json({
      room: publicRoom(room, request),
      hostToken: room.hostToken,
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
});

export default router;
