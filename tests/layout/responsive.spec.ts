import { expect, test, type Page } from '@playwright/test';
import { installTauriMock } from './mock-tauri';

// Deterministic local data; these tests never sync accounts or contact a tracker.
async function openPage(page: Page, startup: string, compact = false) {
  await page.addInitScript(({ startup, compact }) => {
    localStorage.setItem('oj-insight.preferences', JSON.stringify({
      theme: 'gray', autoSync: false, autoCheckUpdates: false, startupPage: 'last',
      reduceMotion: true, density: compact ? 'compact' : 'comfortable', fontSize: compact ? 'xlarge' : 'standard',
    }));
    localStorage.setItem('oj-insight.last-page', startup);
    localStorage.setItem('oj-insight.time-scope', '2024');
  }, { startup, compact });
  await installTauriMock(page, {
    snapshot: {
      stats: { solved: 0, accepted_submissions: 0, active_days: 0, longest_streak: 0, current_streak: 0, peak_day: null, peak_count: 0 },
      career: { solved: 0, accepted_submissions: 0, active_days: 0, longest_streak: 0, current_streak: 0, peak_day: null, peak_count: 0 },
      daily: [{ day: '2024-06-03', count: 4 }],
      platforms: [],
      difficulty: [],
      difficulty_daily: [{ platform: 'codeforces', day: '2024-06-03', label: '1600', order: 1600 }],
      ratings: [],
      recent: [],
      metric_available: true,
      warnings: [],
    },
  });
  await page.route('**/__day?*', route => route.fulfill({ body: 'ok' }));
  await page.route(/^https:\/\/(kenkoooo\.com|cftracker\.netlify\.app|www\.nowcoder\.com)\//,
    route => route.fulfill({ contentType: 'text/html', body: '<body style="margin:0;background:#152e23"><main style="height:200vh;color:white">Tracker fixture</main></body>' }));
  await page.goto('/');
}

async function checkHeatmaps(page: Page, fill: boolean) {
  await expect(page.locator('.heatmap')).toHaveCount(2);
  await expect.poll(async () => page.locator('.heatmap').evaluateAll(elements => elements.every(element => {
    const scroll = element.parentElement!;
    const grid = element.getBoundingClientRect();
    return grid.width >= scroll.clientWidth - 1;
  }))).toBe(true);
  for (const heatmap of await page.locator('.heatmap').all()) {
    await expect(heatmap.locator('.heat-cell')).toHaveCount(366);
    const metrics = await heatmap.evaluate(element => {
      const grid = element.getBoundingClientRect();
      const first = element.querySelector('.heat-cell')!.getBoundingClientRect();
      const last = element.querySelector('.heat-cell:last-child')!.getBoundingClientRect();
      const scroll = element.parentElement!;
      return { cellWidth: first.width, cellHeight: first.height, bottom: last.bottom - grid.bottom,
        rightGap: grid.right - last.right, overflow: scroll.scrollWidth - scroll.clientWidth };
    });
    expect(Math.abs(metrics.cellWidth - metrics.cellHeight)).toBeLessThan(1);
    expect(metrics.cellWidth).toBeGreaterThanOrEqual(12);
    expect(metrics.bottom).toBeLessThanOrEqual(0);
    expect(metrics.rightGap).toBeLessThan(25);
    if (fill) expect(metrics.overflow).toBeLessThanOrEqual(1);
    else expect(metrics.overflow).toBeGreaterThan(0);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

for (const [width, height, dpr] of [[1920, 1080, 1], [2560, 1440, 1], [3840, 2160, 1], [1920, 1080, 2], [1707, 960, 1.5]]) {
  test.describe(`${width}x${height} @${dpr}`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: dpr });

    test('activity and difficulty fill the panel with square, clickable cells', async ({ page }) => {
      const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
      await openPage(page, 'codeforces');
      await checkHeatmaps(page, true);
      if (width === 1920 && dpr === 1) {
        await page.evaluate(() => window.scrollTo(0, 200));
        await page.screenshot({ path: test.info().outputPath('dashboard-1080p.png') });
      }
      const day = page.locator('.difficulty-map').getByRole('button', { name: '2024-06-03: 1600', exact: true });
      const request = page.waitForRequest('**/__day?day=2024-06-03');
      await day.click(); await request;
      expect(errors).toEqual([]);
    });

    test('embedded tracker fills the available viewport in both axes', async ({ page }) => {
      await openPage(page, 'tracker-atcoder');
      await expect(page.locator('iframe')).toBeVisible();
      const metrics = await page.locator('.embedded-tracker-frame').evaluate(frame => {
        const inner = frame.querySelector('iframe')!.getBoundingClientRect();
        const outer = frame.getBoundingClientRect();
        return { heightGap: frame.clientHeight - inner.height, widthGap: frame.clientWidth - inner.width,
          bottomGap: innerHeight - outer.bottom, rightGap: innerWidth - outer.right,
          documentHeight: document.documentElement.scrollHeight, viewportHeight: innerHeight };
      });
      expect(Math.abs(metrics.heightGap)).toBeLessThan(1);
      expect(Math.abs(metrics.widthGap)).toBeLessThan(1);
      expect(metrics.bottomGap).toBeGreaterThanOrEqual(0);
      expect(metrics.bottomGap).toBeLessThanOrEqual(56);
      expect(metrics.rightGap).toBeLessThanOrEqual(40);
      expect(metrics.documentHeight).toBeLessThanOrEqual(metrics.viewportHeight);
      if (width === 1920 && dpr === 1) await page.screenshot({ path: test.info().outputPath('tracker-1080p.png') });
    });
  });
}

test('resizing and folding the sidebar recalculates heatmaps; small windows scroll to the last day', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openPage(page, 'codeforces', true);
  await checkHeatmaps(page, false);
  const last = page.locator('.heatmap').first().getByRole('button', { name: '2024-12-31: 0', exact: true });
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  await page.setViewportSize({ width: 1400, height: 900 });
  await checkHeatmaps(page, true);
  const before = await page.locator('.heatmap .heat-cell').first().boundingBox();
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect.poll(async () => (await page.locator('.heatmap .heat-cell').first().boundingBox())!.width).toBeGreaterThan(before!.width);
  await checkHeatmaps(page, true);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.getByRole('button', { name: '展开侧栏' }).click();
  await checkHeatmaps(page, false);
});

test('Luogu half-year stays inside its panel after resizing', async ({ page }) => {
  await openPage(page, 'luogu');
  await expect(page.locator('.heat-cell')).toHaveCount(183);
  for (const width of [1024, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    await expect.poll(async () => page.locator('.heatmap-scroll').evaluate(scroll => Math.abs(scroll.scrollWidth - scroll.clientWidth))).toBeLessThanOrEqual(1);
  }
});

test('all external trackers also fill a compact window with large fonts', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await openPage(page, 'tracker-nowcoder', true);
  for (const name of ['NowCoder', 'Codeforces', 'AtCoder']) {
    await page.locator('.tracker-items').getByRole('button', { name, exact: true }).click();
    await expect(page.locator('iframe')).toBeVisible();
    const gap = await page.locator('.embedded-tracker-frame').evaluate(frame => frame.clientHeight - frame.querySelector('iframe')!.getBoundingClientRect().height);
    expect(Math.abs(gap)).toBeLessThan(1);
    expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  }
});

test('resizing the tracker and collapsing the sidebar fills its new bounds without reloading', async ({ page }) => {
  await openPage(page, 'tracker-atcoder');
  await page.frameLocator('iframe').getByText('Tracker fixture').waitFor();
  const frame = page.frameLocator('iframe');
  await frame.locator('body').evaluate(body => body.setAttribute('data-loaded', 'retained'));
  for (const viewport of [{ width: 2560, height: 1440 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.sidebar-toggle').click();
    const gap = await page.locator('.embedded-tracker-frame').evaluate(element => {
      const iframe = element.querySelector('iframe')!;
      return Math.abs(element.clientWidth - iframe.clientWidth) + Math.abs(element.clientHeight - iframe.clientHeight);
    });
    expect(gap).toBeLessThan(1);
    await expect(frame.locator('body')).toHaveAttribute('data-loaded', 'retained');
  }
});
