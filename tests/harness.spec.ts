import { test, expect } from '@playwright/test';

test.describe('Manual Multiplayer Test Harness (/?harness=1)', () => {
  test('creates 15-player room and executes multi-tab challenge/accept/report flow', async ({ page, context }) => {
    // 1. Navigate to test harness
    await page.goto('/?harness=1');
    await expect(page.getByRole('heading', { name: 'Manual multiplayer test harness' })).toBeVisible();

    // 2. Click "Create fresh 15-player room"
    const createBtn = page.getByRole('button', { name: /create fresh 15-player room/i });
    await createBtn.click();

    // 3. Verify room created and 15 player cards are rendered
    await expect(page.locator('.harness-room')).toBeVisible({ timeout: 10000 });
    const cards = page.locator('.harness-card');
    await expect(cards).toHaveCount(15);

    // Extract room code
    const roomBadgeText = await page.locator('.harness-room strong').textContent();
    const roomCode = roomBadgeText?.trim();
    expect(roomCode).toBeTruthy();

    // 4. Open Team A Lead view and Team B Lead view in separate pages
    const playerCards = await cards.all();
    // Card 0: Test Player 1 (Team A Lead)
    // Card 3: Test Player 4 (Team B Lead)
    const playerAPagePromise = context.waitForEvent('page');
    await playerCards[0].getByRole('button', { name: /open player view/i }).click();
    const pageA = await playerAPagePromise;
    await pageA.waitForLoadState('domcontentloaded');

    const playerBPagePromise = context.waitForEvent('page');
    await playerCards[3].getByRole('button', { name: /open player view/i }).click();
    const pageB = await playerBPagePromise;
    await pageB.waitForLoadState('domcontentloaded');

    // 5. Verify player A and B roles and teams
    await expect(pageA.getByRole('heading', { name: /you are test player 1/i })).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByRole('heading', { name: /you are test player 4/i })).toBeVisible({ timeout: 10000 });

    // 6. Player A challenges Team B
    const challengeBtn = pageA.getByRole('button', { name: /challenge team b/i });
    await expect(challengeBtn).toBeVisible();
    await challengeBtn.click();

    // 7. Player B receives and accepts the challenge
    const acceptBtn = pageB.getByRole('button', { name: /accept/i });
    await expect(acceptBtn).toBeVisible({ timeout: 10000 });
    await acceptBtn.click();

    // 8. Both players see the Match Lobby
    await expect(pageA.getByRole('heading', { name: /match lobby/i })).toBeVisible({ timeout: 10000 });
    await expect(pageB.getByRole('heading', { name: /match lobby/i })).toBeVisible({ timeout: 10000 });

    // 9. Player A reports Team A as winner
    const reportBtn = pageA.getByRole('button', { name: /report result/i });
    await expect(reportBtn).toBeVisible();
    await reportBtn.click();

    // 10. Verify tournament board updates on both player screens
    // Team A should now have 4 players, Team B should have 2 players
    await expect(pageA.locator('.team', { hasText: 'Team A' })).toContainText('4 players', { timeout: 10000 });
    await expect(pageA.locator('.team', { hasText: 'Team B' })).toContainText('2 players', { timeout: 10000 });

    await expect(pageB.locator('.team', { hasText: 'Team A' })).toContainText('4 players', { timeout: 10000 });
    await expect(pageB.locator('.team', { hasText: 'Team B' })).toContainText('2 players', { timeout: 10000 });

    // 11. Refresh harness page and verify harness card states update
    await page.getByRole('button', { name: /refresh room/i }).click();
    await expect(page.locator('.harness-card').first()).toContainText('4 players · active', { timeout: 10000 });

    await pageA.close();
    await pageB.close();
  });

  test('opens admin view and allows room creator actions', async ({ page, context }) => {
    await page.goto('/?harness=1');
    await page.getByRole('button', { name: /create fresh 15-player room/i }).click();
    await expect(page.locator('.harness-room')).toBeVisible({ timeout: 10000 });

    // Open admin view
    const adminPagePromise = context.waitForEvent('page');
    await page.getByRole('button', { name: /open admin view/i }).click();
    const adminPage = await adminPagePromise;
    await adminPage.waitForLoadState('domcontentloaded');

    // Verify Admin panel components
    await expect(adminPage.getByRole('heading', { name: /admin panel/i })).toBeVisible({ timeout: 10000 });
    await expect(adminPage.getByText('15 players')).toBeVisible();

    await adminPage.close();
  });
});
