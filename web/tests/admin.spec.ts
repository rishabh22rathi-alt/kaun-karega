import { test, expect } from '@playwright/test';

test.describe('Public Home Page Basic Load', () => {
  test('should load home page without crashing', async ({ page }) => {
    await page.goto('http://localhost:3000/');
    await expect(page).toHaveURL(/localhost:3000/);
    await expect(page.locator('text=Kaun Karega')).toBeVisible();
  });
});
