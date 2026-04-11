import { test, expect } from '@playwright/test';

test.describe('Login Page Basic Load', () => {
  test('should load login page without crashing', async ({ page }) => {
    await page.goto('http://localhost:3000/login');
    await expect(page).toHaveURL(/login/);
    await expect(page.locator('text=Verify your phone')).toBeVisible();
  });
});
