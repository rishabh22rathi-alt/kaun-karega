import { test, expect } from '@playwright/test';

test.describe('Task Entry Page', () => {
  test('should load task entry UI correctly', async ({ page }) => {
    await page.goto('http://localhost:3000/');
    
    // Check main CTA exists
    await expect(page.locator('text=Post a Request')).toBeVisible();
  });
});
