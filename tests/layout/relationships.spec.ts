import { expect, test } from '@playwright/test';
import type { WatchedAcEvent, WatchedPerson } from '../../src/types';
import { installTauriMock } from './mock-tauri';

const person: WatchedPerson = {
  id: 7, platform: 'codeforces', account: 'teammate', nickname: '小明', relationship: '队友', secret: '',
  enabled: true, initialized: true, status: 'ok', message: '检查成功', lastChecked: 1_767_196_800, lastSuccess: 1_767_196_800,
};
const event: WatchedAcEvent = {
  id: 11, personId: 7, platform: 'codeforces', account: 'teammate', nickname: '小明', relationship: '队友',
  submissionId: '123', problemId: '1A', problemName: 'Theatre Square', problemUrl: 'https://codeforces.com/contest/1/problem/A',
  epochSecond: 1_767_196_800, language: 'C++', difficulty: '800', createdAt: 1_767_196_800, dismissed: false,
};

test('关系人页面展示新 AC 并允许关闭提醒', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page, { watchedPeople: [person], watchedEvents: [event] });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '关系人', exact: true })).toBeVisible();
  await expect(page.getByText('小明 刚刚 AC 了')).toBeVisible();
  await expect(page.locator('.relationship-person')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭 AC 提醒' }).click();
  await expect(page.getByText('小明 刚刚 AC 了')).toHaveCount(0);
  await expect(page.locator('.relationship-event-row.dismissed')).toHaveCount(1);
});

test('添加关系人时可以一次保存多个平台', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page);
  await page.goto('/');

  await page.getByPlaceholder('例如：小明').fill('小明');
  await page.getByPlaceholder('例如：队友、学弟').fill('队友');
  await page.getByPlaceholder('Handle').fill('cf-handle');
  await page.getByRole('checkbox', { name: 'AtCoder' }).check();
  await page.getByPlaceholder('用户名').fill('atcoder-id');
  await page.getByRole('button', { name: '保存 2 个平台' }).click();

  const saved = await page.evaluate(() => (window as unknown as { __WATCHED_SAVE__: unknown }).__WATCHED_SAVE__);
  expect(saved).toEqual({
    nickname: '小明',
    relationship: '队友',
    bindings: [
      { platform: 'codeforces', account: 'cf-handle', secret: '' },
      { platform: 'atcoder', account: 'atcoder-id', secret: '' },
    ],
  });
});

