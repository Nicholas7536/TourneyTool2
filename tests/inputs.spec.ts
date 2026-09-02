import { test, expect } from '@playwright/test';

test.describe('Input Validation & Character Edge Cases', () => {
  test('rejects empty or whitespace-only player names in API and UI', async ({ page, request }) => {
    // 1. API: Create a waiting room
    const createRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'strict-emergency' },
    });
    expect(createRes.status()).toBe(201);
    const { room } = await createRes.json();

    // 2. API: Attempt to join with empty and whitespace-only names
    const emptyJoin = await request.post(`/api/rooms/${room.roomCode}/join`, {
      data: { name: '' },
    });
    expect(emptyJoin.status()).toBe(400);

    const spaceJoin = await request.post(`/api/rooms/${room.roomCode}/join`, {
      data: { name: '     ' },
    });
    expect(spaceJoin.status()).toBe(400);

    // 3. UI: Navigate to room and verify joining with empty name is prevented
    await page.goto(`/?room=${room.roomCode}`);
    const joinInput = page.locator('input[placeholder*="name" i], input[type="text"]');
    const joinBtn = page.getByRole('button', { name: /join/i });

    await joinInput.fill('   ');
    // Verify the UI button is disabled for whitespace-only input
    await expect(joinBtn).toBeDisabled();

    // Verify room is still in waiting phase and no player was added
    const statusRes = await request.get(`/api/rooms/${room.roomCode}`);
    const statusData = await statusRes.json();
    expect(statusData.room.players.length).toBe(0);
  });

  test('handles Unicode, emoji, and special characters safely', async ({ page, request }) => {
    const createRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'strict-emergency' },
    });
    const { room } = await createRes.json();

    const complexNames = [
      '🔥 Strikër ⚽ 99',
      'José-María O\'Connor & Co.',
      '日本語の名前 (Tokyo)',
      '⚡!@#$%^&*()_+=-`~[]{}|;:",.<>?',
    ];

    let firstToken = '';
    for (const name of complexNames) {
      const joinRes = await request.post(`/api/rooms/${room.roomCode}/join`, {
        data: { name },
      });
      expect(joinRes.status()).toBe(201);
      const joinedData = await joinRes.json();
      if (!firstToken) firstToken = joinedData.playerToken;
      const savedPlayer = joinedData.room.players.find((p: { name: string }) => p.name === name);
      expect(savedPlayer).toBeDefined();
      expect(savedPlayer.name).toBe(name);
    }

    // Load page with the authenticated player session
    await page.goto(`/?room=${room.roomCode}&testToken=${firstToken}`);
    await expect(page.locator(`text=${complexNames[0]}`).first()).toBeVisible();
  });

  test('neutralizes HTML and XSS injection strings in player display names', async ({ page, request }) => {
    const createRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'strict-emergency' },
    });
    const { room } = await createRes.json();

    const xssPayload = '<script>window.__xss_flag = true;</script><img src=x onerror="window.__xss_flag=true">';
    const joinRes = await request.post(`/api/rooms/${room.roomCode}/join`, {
      data: { name: xssPayload },
    });
    expect(joinRes.status()).toBe(201);
    const { playerToken } = await joinRes.json();

    await page.goto(`/?room=${room.roomCode}&testToken=${playerToken}`);

    // Verify script did not execute
    const xssFlag = await page.evaluate(() => (window as any).__xss_flag);
    expect(xssFlag).toBeUndefined();

    // Verify the name is safely rendered as plain text
    await expect(page.locator('body')).toContainText('<script>');
  });

  test('trims leading/trailing whitespace and enforces max name length', async ({ request }) => {
    const createRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'strict-emergency' },
    });
    const { room } = await createRes.json();

    // Name with padding
    const paddedName = '   Padded Player Name   ';
    const joinRes = await request.post(`/api/rooms/${room.roomCode}/join`, {
      data: { name: paddedName },
    });
    expect(joinRes.status()).toBe(201);
    const joinData = await joinRes.json();
    const player = joinData.room.players[0];
    expect(player.name).toBe('Padded Player Name');

    // Very long name (over 40 chars)
    const longName = 'A'.repeat(60);
    const longJoinRes = await request.post(`/api/rooms/${room.roomCode}/join`, {
      data: { name: longName },
    });
    expect(longJoinRes.status()).toBe(201);
    const longData = await longJoinRes.json();
    const longPlayer = longData.room.players[1];
    expect(longPlayer.name.length).toBe(40);
    expect(longPlayer.name).toBe('A'.repeat(40));
  });

  test('validates room configuration parameters (startingPlayers, maxFinalists, policy)', async ({ request }) => {
    // Invalid starting player count
    const badPopRes = await request.post('/api/rooms', {
      data: { startingPlayers: 14, maxFinalists: 2, matchmakingPolicy: 'strict' },
    });
    expect(badPopRes.status()).toBe(400);

    // Invalid max finalists (< 1 or > 5)
    const badFinalistsRes0 = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 0, matchmakingPolicy: 'strict' },
    });
    expect(badFinalistsRes0.status()).toBe(400);

    const badFinalistsRes6 = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 6, matchmakingPolicy: 'strict' },
    });
    expect(badFinalistsRes6.status()).toBe(400);

    // Invalid policy
    const badPolicyRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'invalid-policy' },
    });
    expect(badPolicyRes.status()).toBe(400);
  });

  test('handles case-insensitive room codes', async ({ request }) => {
    const createRes = await request.post('/api/rooms', {
      data: { startingPlayers: 15, maxFinalists: 2, matchmakingPolicy: 'strict-emergency' },
    });
    const { room } = await createRes.json();
    const lowerCode = room.roomCode.toLowerCase();

    const lowerGetRes = await request.get(`/api/rooms/${lowerCode}`);
    expect(lowerGetRes.status()).toBe(200);
    const lowerData = await lowerGetRes.json();
    expect(lowerData.room.roomCode).toBe(room.roomCode);
  });
});
