import { test, expect } from '@playwright/test';
import {
  createHarnessRoom,
  getRoom,
  issueChallenge,
  acceptChallenge,
  cancelChallenge,
  reportMatch,
  HarnessSetup,
} from './helpers/room-fixture.js';

test.describe('Tournament Rules & Behavioral Invariants (TOURNAMENT_RULES.md)', () => {
  let harness: HarnessSetup;

  test.beforeEach(async ({ request }) => {
    // Create a fresh 15-player active room for each test
    harness = await createHarnessRoom(request, { matchmakingPolicy: 'strict-emergency', maxFinalists: 2 });
  });

  function getLeadToken(teamId: string) {
    const session = harness.sessions.find((s) => s.teamId === teamId && s.isLead);
    if (!session) throw new Error(`Lead session for ${teamId} not found`);
    return session.token;
  }

  test('Scenario 1: 3v3 win produces a 4-player winner and 2-player loser', async ({ request }) => {
    const teamA = harness.room.teams[0];
    const teamB = harness.room.teams[1];
    const leadAToken = getLeadToken(teamA.id);
    const leadBToken = getLeadToken(teamB.id);

    // 1. Issue challenge Team A -> Team B
    const challengeRes = await issueChallenge(request, harness.room.roomCode, leadAToken, teamB.id);
    expect(challengeRes.status()).toBe(200);
    const afterChallenge = await challengeRes.json();
    const challenge = afterChallenge.room.challenges.find((c: any) => c.status === 'pending');
    expect(challenge).toBeDefined();

    // 2. Team B accepts challenge
    const acceptRes = await acceptChallenge(request, harness.room.roomCode, leadBToken, challenge.id);
    expect(acceptRes.status()).toBe(200);
    const afterAccept = await acceptRes.json();
    const match = afterAccept.room.matches.find((m: any) => m.status === 'lobby');
    expect(match).toBeDefined();

    // 3. Team A wins and steals a player from Team B
    const stolenPlayerId = teamB.playerIds[0];
    const reportRes = await reportMatch(request, harness.room.roomCode, leadAToken, match.id, {
      winnerTeamId: teamA.id,
      stolenPlayerId,
    });
    expect(reportRes.status()).toBe(200);

    // 4. Verify post-match state
    const { room } = await getRoom(request, harness.room.roomCode);
    const updatedA = room.teams.find((t) => t.id === teamA.id)!;
    const updatedB = room.teams.find((t) => t.id === teamB.id)!;

    expect(updatedA.rosterSize).toBe(4);
    expect(updatedA.playerIds).toContain(stolenPlayerId);
    expect(updatedA.finalist).toBe(false);

    expect(updatedB.rosterSize).toBe(2);
    expect(updatedB.playerIds).not.toContain(stolenPlayerId);
    expect(updatedB.eliminated).toBe(false);
  });

  test('Scenario 2: 2v2 win produces a 3-player winner and eliminates the loser', async ({ request }) => {
    // Setup two 2-player teams (Team B and Team D) by having them lose in previous 3v3 matches
    // Match 1: Team A beats Team B -> A=4, B=2 (steal non-lead so leadB remains lead)
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');
    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];
    const m1 = (await (await acceptChallenge(request, harness.room.roomCode, leadB, c1.id)).json()).room.matches[0];
    await reportMatch(request, harness.room.roomCode, leadA, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[1].playerIds[2],
    });

    // Match 2: Team C beats Team D -> C=4, D=2 (steal non-lead so leadD remains lead)
    const leadC = getLeadToken('team-3');
    const leadD = getLeadToken('team-4');
    const c2 = (await (await issueChallenge(request, harness.room.roomCode, leadC, 'team-4')).json()).room.challenges.find((c: any) => c.status === 'pending');
    const m2 = (await (await acceptChallenge(request, harness.room.roomCode, leadD, c2.id)).json()).room.matches.find((m: any) => m.status === 'lobby');
    await reportMatch(request, harness.room.roomCode, leadC, m2.id, {
      winnerTeamId: 'team-3',
      stolenPlayerId: harness.room.teams[3].playerIds[2],
    });

    // 2v2 Match: Team B (2) vs Team D (2)
    const { room: before2v2 } = await getRoom(request, harness.room.roomCode);
    const teamB2 = before2v2.teams.find((t) => t.id === 'team-2')!;
    const teamD2 = before2v2.teams.find((t) => t.id === 'team-4')!;
    expect(teamB2.rosterSize).toBe(2);
    expect(teamD2.rosterSize).toBe(2);

    const stolenFromD = teamD2.playerIds[1];
    const c3Res = await issueChallenge(request, harness.room.roomCode, leadB, 'team-4');
    expect(c3Res.status()).toBe(200);
    const c3 = (await c3Res.json()).room.challenges.find((c: any) => c.status === 'pending');
    const m3 = (await (await acceptChallenge(request, harness.room.roomCode, leadD, c3.id)).json()).room.matches.find((m: any) => m.status === 'lobby');

    // Team B wins 2v2
    const report2v2 = await reportMatch(request, harness.room.roomCode, leadB, m3.id, {
      winnerTeamId: 'team-2',
      stolenPlayerId: stolenFromD,
    });
    expect(report2v2.status()).toBe(200);

    const { room: after2v2 } = await getRoom(request, harness.room.roomCode);
    const finalB = after2v2.teams.find((t) => t.id === 'team-2')!;
    const finalD = after2v2.teams.find((t) => t.id === 'team-4')!;

    // Team B should have 3 players
    expect(finalB.rosterSize).toBe(3);
    expect(finalB.playerIds).toContain(stolenFromD);

    // Team D should be eliminated with exactly 1 player
    expect(finalD.rosterSize).toBe(1);
    expect(finalD.eliminated).toBe(true);
    expect(after2v2.eliminated).toContain(finalD.playerIds[0]);
  });

  test('Scenario 3: 4v4 win locks finalist (5 players) and leaves 3-player loser', async ({ request }) => {
    // Setup two 4-player teams (Team A and Team C)
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');
    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];
    const m1 = (await (await acceptChallenge(request, harness.room.roomCode, leadB, c1.id)).json()).room.matches[0];
    await reportMatch(request, harness.room.roomCode, leadA, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[1].playerIds[2],
    });

    const leadC = getLeadToken('team-3');
    const leadD = getLeadToken('team-4');
    const c2 = (await (await issueChallenge(request, harness.room.roomCode, leadC, 'team-4')).json()).room.challenges.find((c: any) => c.status === 'pending');
    const m2 = (await (await acceptChallenge(request, harness.room.roomCode, leadD, c2.id)).json()).room.matches.find((m: any) => m.status === 'lobby');
    await reportMatch(request, harness.room.roomCode, leadC, m2.id, {
      winnerTeamId: 'team-3',
      stolenPlayerId: harness.room.teams[3].playerIds[2],
    });

    // Now Team A (4) vs Team C (4)
    const { room: before4v4 } = await getRoom(request, harness.room.roomCode);
    const teamA4 = before4v4.teams.find((t) => t.id === 'team-1')!;
    const teamC4 = before4v4.teams.find((t) => t.id === 'team-3')!;
    expect(teamA4.rosterSize).toBe(4);
    expect(teamC4.rosterSize).toBe(4);

    const c4v4 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-3')).json()).room.challenges.find((c: any) => c.status === 'pending');
    const m4v4 = (await (await acceptChallenge(request, harness.room.roomCode, leadC, c4v4.id)).json()).room.matches.find((m: any) => m.status === 'lobby');

    const stolenFromC = teamC4.playerIds[2];
    const report4v4 = await reportMatch(request, harness.room.roomCode, leadA, m4v4.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: stolenFromC,
    });
    expect(report4v4.status()).toBe(200);

    const { room: after4v4 } = await getRoom(request, harness.room.roomCode);
    const finalA = after4v4.teams.find((t) => t.id === 'team-1')!;
    const finalC = after4v4.teams.find((t) => t.id === 'team-3')!;

    // Team A is locked as finalist with 5 players
    expect(finalA.rosterSize).toBe(5);
    expect(finalA.finalist).toBe(true);
    expect(after4v4.finalists).toContain('team-1');

    // Team C has 3 players
    expect(finalC.rosterSize).toBe(3);
    expect(finalC.finalist).toBe(false);
  });

  test('Invariants: Finalist and eliminated teams cannot challenge, accept, or be challenged', async ({ request }) => {
    // 1. Create a finalist (Team A=5) and an eliminated team (Team D=1)
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');
    const leadC = getLeadToken('team-3');
    const leadD = getLeadToken('team-4');
    const leadE = getLeadToken('team-5');

    // A beats B -> A=4, B=2
    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];
    const m1 = (await (await acceptChallenge(request, harness.room.roomCode, leadB, c1.id)).json()).room.matches[0];
    await reportMatch(request, harness.room.roomCode, leadA, m1.id, { winnerTeamId: 'team-1', stolenPlayerId: harness.room.teams[1].playerIds[2] });

    // C beats D -> C=4, D=2
    const c2 = (await (await issueChallenge(request, harness.room.roomCode, leadC, 'team-4')).json()).room.challenges.find((c: any) => c.status === 'pending');
    const m2 = (await (await acceptChallenge(request, harness.room.roomCode, leadD, c2.id)).json()).room.matches.find((m: any) => m.status === 'lobby');
    await reportMatch(request, harness.room.roomCode, leadC, m2.id, { winnerTeamId: 'team-3', stolenPlayerId: harness.room.teams[3].playerIds[2] });

    // A beats C -> A=5 (finalist), C=3
    const c3 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-3')).json()).room.challenges.find((c: any) => c.status === 'pending');
    const m3 = (await (await acceptChallenge(request, harness.room.roomCode, leadC, c3.id)).json()).room.matches.find((m: any) => m.status === 'lobby');
    await reportMatch(request, harness.room.roomCode, leadA, m3.id, { winnerTeamId: 'team-1', stolenPlayerId: harness.room.teams[2].playerIds[2] });

    // B beats D -> B=3, D=1 (eliminated)
    const c4Res = await issueChallenge(request, harness.room.roomCode, leadB, 'team-4');
    expect(c4Res.status()).toBe(200);
    const c4 = (await c4Res.json()).room.challenges.find((c: any) => c.status === 'pending');
    const m4 = (await (await acceptChallenge(request, harness.room.roomCode, leadD, c4.id)).json()).room.matches.find((m: any) => m.status === 'lobby');
    await reportMatch(request, harness.room.roomCode, leadB, m4.id, { winnerTeamId: 'team-2', stolenPlayerId: harness.room.teams[3].playerIds[1] });

    // Verify Finalist cannot challenge
    const finalistChallenge = await issueChallenge(request, harness.room.roomCode, leadA, 'team-5');
    expect(finalistChallenge.status()).toBe(400);

    // Verify Finalist cannot be challenged
    const challengeFinalist = await issueChallenge(request, harness.room.roomCode, leadE, 'team-1');
    expect(challengeFinalist.status()).toBe(400);

    // Verify Eliminated team cannot challenge (player has no active team -> 403)
    const eliminatedChallenge = await issueChallenge(request, harness.room.roomCode, leadD, 'team-5');
    expect(eliminatedChallenge.status()).toBe(403);

    // Verify Eliminated team cannot be challenged (target team eliminated -> 400)
    const challengeEliminated = await issueChallenge(request, harness.room.roomCode, leadE, 'team-4');
    expect(challengeEliminated.status()).toBe(400);
  });

  test('Invariants: Self-challenge and concurrent active matches are blocked', async ({ request }) => {
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');
    const leadC = getLeadToken('team-3');

    // 1. Team A cannot challenge itself
    const selfChallenge = await issueChallenge(request, harness.room.roomCode, leadA, 'team-1');
    expect(selfChallenge.status()).toBe(400);

    // 2. Team A challenges Team B
    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];

    // 3. Team A cannot issue a second challenge while pending
    const secondChallenge = await issueChallenge(request, harness.room.roomCode, leadA, 'team-3');
    expect(secondChallenge.status()).toBe(409);

    // 4. Team C challenges Team B (allowed while challenge is only pending)
    const c2 = (await (await issueChallenge(request, harness.room.roomCode, leadC, 'team-2')).json()).room.challenges.find((c: any) => c.fromTeamId === 'team-3');
    expect(c2).toBeDefined();

    // 5. Team B accepts Team A's challenge -> Team A and Team B enter match
    await acceptChallenge(request, harness.room.roomCode, leadB, c1.id);

    // 6. Pending challenge from Team C to Team B should be automatically removed / invalid
    const { room: afterMatchCreated } = await getRoom(request, harness.room.roomCode);
    expect(afterMatchCreated.challenges.some((c) => c.id === c2.id)).toBe(false);

    // 7. Team A or Team B cannot be challenged while in match
    const challengeTeamInMatch = await issueChallenge(request, harness.room.roomCode, leadC, 'team-1');
    expect(challengeTeamInMatch.status()).toBe(400);
  });

  test('Challenge cancellation: Team lead can cancel pending challenge and issue a new one', async ({ request }) => {
    const leadA = getLeadToken('team-1');

    // 1. Team A challenges Team B
    const c1Res = await issueChallenge(request, harness.room.roomCode, leadA, 'team-2');
    const c1 = (await c1Res.json()).room.challenges[0];

    // 2. Team A cancels challenge
    const cancelRes = await cancelChallenge(request, harness.room.roomCode, leadA, c1.id);
    expect(cancelRes.status()).toBe(200);

    // 3. Team A challenges Team C successfully
    const c2Res = await issueChallenge(request, harness.room.roomCode, leadA, 'team-3');
    expect(c2Res.status()).toBe(200);
    const { room } = await c2Res.json();
    expect(room.challenges.some((c: any) => c.fromTeamId === 'team-1' && c.toTeamId === 'team-3' && c.status === 'pending')).toBe(true);
  });

  test('Emergency Matchmaking: Unequal matches allowed only when no same-level pair exists', async ({ request }) => {
    // In our 5-team room: A=3, B=3, C=3, D=3, E=3
    // All teams are level 3, so unequal emergency challenges must be blocked
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');

    // Setup: A beats B -> A=4, B=2, C=3, D=3, E=3
    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];
    const m1 = (await (await acceptChallenge(request, harness.room.roomCode, leadB, c1.id)).json()).room.matches[0];
    await reportMatch(request, harness.room.roomCode, leadA, m1.id, { winnerTeamId: 'team-1', stolenPlayerId: harness.room.teams[1].playerIds[0] });

    // Active rosters: A=4, B=2, C=3, D=3, E=3.
    // There are three 3-player teams (C, D, E), so same-level pairs exist!
    // Team A (4) trying to challenge Team B (2) or Team C (3) must be rejected
    const illegalUnequal = await issueChallenge(request, harness.room.roomCode, leadA, 'team-2');
    expect(illegalUnequal.status()).toBe(400);

    const illegalUnequal2 = await issueChallenge(request, harness.room.roomCode, leadA, 'team-3');
    expect(illegalUnequal2.status()).toBe(400);
  });

  test('Invalid report rejections: Duplicate reports, unauthorized reports, wrong stolen player', async ({ request }) => {
    const leadA = getLeadToken('team-1');
    const leadB = getLeadToken('team-2');
    const leadC = getLeadToken('team-3');

    const c1 = (await (await issueChallenge(request, harness.room.roomCode, leadA, 'team-2')).json()).room.challenges[0];
    const m1 = (await (await acceptChallenge(request, harness.room.roomCode, leadB, c1.id)).json()).room.matches[0];

    // Unauthorized reporter (Team C lead attempting to report match between A and B)
    const unauthorized = await reportMatch(request, harness.room.roomCode, leadC, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[1].playerIds[0],
    });
    expect(unauthorized.status()).toBe(403);

    // Invalid stolen player (player doesn't belong to losing team B)
    const invalidSteal = await reportMatch(request, harness.room.roomCode, leadA, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[2].playerIds[0], // Player from Team C
    });
    expect(invalidSteal.status()).toBe(400);

    // Valid report succeeds
    const validReport = await reportMatch(request, harness.room.roomCode, leadA, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[1].playerIds[0],
    });
    expect(validReport.status()).toBe(200);

    // Duplicate report on already reported match
    const duplicateReport = await reportMatch(request, harness.room.roomCode, leadA, m1.id, {
      winnerTeamId: 'team-1',
      stolenPlayerId: harness.room.teams[1].playerIds[0],
    });
    expect(duplicateReport.status()).toBe(409);
  });
});
