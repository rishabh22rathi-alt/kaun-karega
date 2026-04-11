import { test, expect } from '@playwright/test';

test.describe('Admin Login Page Basic Load', () => {
  test('should load admin login flow entry without crashing', async ({ page }) => {
    await page.goto('http://localhost:3000/admin/login');
    await expect(page).toHaveURL(/admin\/login/);
    await expect(page.locator('text=Verify your phone')).toBeVisible();
  });
});
