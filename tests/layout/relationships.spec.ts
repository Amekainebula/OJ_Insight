import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
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

test('关注页面展示新 AC 并允许关闭提醒', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page, { watchedPeople: [person], watchedEvents: [event] });
  await page.goto('/');

  await expect(page.getByRole('heading', { name: '关注', exact: true })).toBeVisible();
  await expect(page.getByText('小明 刚刚 AC 了')).toBeVisible();
  await expect(page.getByText('AC 了 Theatre Square')).toBeVisible();
  await expect(page.locator('.relationship-person-group')).toHaveCount(1);
  await page.getByRole('button', { name: '关闭 AC 提醒' }).click();
  await expect(page.locator('.relationship-notice')).toHaveCount(0);
  await expect(page.locator('.relationship-event-row.dismissed')).toHaveCount(1);
});

test('添加关注时可以一次保存多个平台', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page);
  await page.goto('/');

  await page.getByRole('button', { name: '添加关注' }).click();
  await page.getByLabel('称呼（必填）').fill('小明');
  await page.getByLabel('备注（选填）').fill('队友');
  await page.getByPlaceholder('Handle').fill('cf-handle');
  await page.locator('.relationship-platform-toggle').filter({ hasText: 'AtCoder' }).click();
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

test('编辑关注新增平台保持默认顺序并拒绝重复账号', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  const atcoder: WatchedPerson = { ...person, id: 8, platform: 'atcoder', account: 'atcoder-id' };
  const duplicate: WatchedPerson = { ...person, id: 9, platform: 'luogu', account: 'taken-id', nickname: '小红' };
  await installTauriMock(page, { watchedPeople: [atcoder, person, duplicate] });
  await page.goto('/');

  const group = page.locator('.relationship-person-group').filter({ hasText: '小明' });
  await group.getByRole('button', { name: /小明 2 个平台账号/ }).click();
  await expect(group.locator('.relationship-account-main strong')).toHaveText(['Codeforces', 'AtCoder']);
  await expect(group.getByRole('button', { name: '添加平台' })).toBeVisible();
  await expect(group.locator('.relationship-account-list > .relationship-account-row')).toHaveCount(2);
  await group.getByRole('button', { name: '添加平台' }).click();
  await expect(page.getByText('已绑定平台', { exact: true })).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: '添加平台' }).click();
  await expect(page.locator('.relationship-platform-option').filter({ hasText: 'Codeforces' })).toHaveCount(0);
  await expect(page.locator('.relationship-platform-option').filter({ hasText: 'AtCoder' })).toHaveCount(0);
  await page.locator('.relationship-platform-option').filter({ hasText: 'Luogu' }).click();
  const accountInput = page.getByLabel('账号 ID');
  await accountInput.fill('taken-id');
  await page.getByRole('button', { name: '添加 1 个平台' }).click();
  await expect(page.getByText(/该用户已经被添加了/)).toBeVisible();

  await accountInput.fill('new-luogu-id');
  await page.getByRole('button', { name: '添加 1 个平台' }).click();
  const edited = await page.evaluate(() => (window as unknown as { __WATCHED_EDIT__: { personIds: number[]; nickname: string; bindings: Array<{ platform: string; account: string }> } }).__WATCHED_EDIT__);
  expect(edited.personIds).toEqual([7, 8]);
  expect(edited.nickname).toBe('小明');
  expect(edited.bindings.map(({ platform, account }) => [platform, account])).toEqual([
    ['codeforces', 'teammate'],
    ['atcoder', 'atcoder-id'],
    ['luogu', 'new-luogu-id'],
  ]);
});

test('平台编辑只显示当前账号并仅提交该平台', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  const atcoder: WatchedPerson = { ...person, id: 8, platform: 'atcoder', account: 'atcoder-id' };
  await installTauriMock(page, { watchedPeople: [person, atcoder] });
  await page.goto('/');

  const group = page.locator('.relationship-person-group');
  await group.getByRole('button', { name: /小明 2 个平台账号/ }).click();
  await group.locator('.relationship-account-row').filter({ hasText: 'AtCoder' }).getByRole('button', { name: '编辑' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑 AtCoder' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Codeforces')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '添加平台' })).toHaveCount(0);
  await dialog.getByLabel('账号 ID').fill('new-atcoder-id');
  await dialog.getByRole('button', { name: '保存修改' }).click();
  const edited = await page.evaluate(() => (window as unknown as { __WATCHED_EDIT__: unknown }).__WATCHED_EDIT__);
  expect(edited).toEqual({ personIds: [8], nickname: '小明', relationship: '队友', bindings: [{ platform: 'atcoder', account: 'new-atcoder-id', secret: '' }] });
});

test('关注头像按平台顺序回退并压缩显示', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  const atcoder: WatchedPerson = { ...person, id: 8, platform: 'atcoder', account: 'atcoder-id' };
  const bytes = [...readFileSync(new URL('../../src/assets/platforms/atcoder.png', import.meta.url))];
  await installTauriMock(page, { watchedPeople: [atcoder, person], watchedAvatars: { 'atcoder:atcoder-id': { mime: 'image/png', bytes } } });
  await page.goto('/');

  const avatar = page.locator('.relationship-person-heading .relationship-person-avatar > img');
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('src', /^data:image\/webp;base64,/);
  const dimensions = await avatar.evaluate((element) => ({ width: (element as HTMLImageElement).naturalWidth, height: (element as HTMLImageElement).naturalHeight }));
  expect(dimensions).toEqual({ width: 64, height: 64 });
  const requests = await page.evaluate(() => (window as unknown as { __WATCHED_AVATAR_REQUESTS__: string[] }).__WATCHED_AVATAR_REQUESTS__);
  expect(requests).toEqual(['codeforces:teammate', 'atcoder:atcoder-id']);
});

test('单平台关注默认折叠，点击后显示账号操作', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page, { watchedPeople: [person] });
  await page.goto('/');

  const group = page.locator('.relationship-person-group');
  const heading = group.getByRole('button', { name: /小明 1 个平台账号/ });
  await expect(heading).toHaveAttribute('aria-expanded', 'false');
  await expect(group.locator('.relationship-account-row')).toHaveCount(0);
  await heading.click();
  await expect(heading).toHaveAttribute('aria-expanded', 'true');
  await expect(group.locator('.relationship-account-row')).toHaveCount(1);
});

test('自动检查完成后不会因关注列表刷新而重复触发', async ({ page }) => {
  test.setTimeout(20_000);
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'true');
  });
  await installTauriMock(page, { watchedPeople: [person] });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '关注', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __WATCHED_SYNC_COUNT__?: number }).__WATCHED_SYNC_COUNT__ || 0), { timeout: 5_000 }).toBe(1);
  await page.waitForTimeout(5_000);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __WATCHED_SYNC_COUNT__?: number }).__WATCHED_SYNC_COUNT__ || 0)).toBe(1);
});

test('添加关注弹窗可以通过取消关闭', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({ theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last' }));
    localStorage.setItem('oj-insight.last-page', 'relationships');
    localStorage.setItem('oj-insight.relationship-auto-check', 'false');
  });
  await installTauriMock(page);
  await page.goto('/');

  await page.getByRole('button', { name: '添加关注' }).click();
  await expect(page.getByRole('dialog', { name: '添加关注' })).toBeVisible();
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

