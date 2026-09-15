import type { Page } from '@playwright/test';
import type { Snapshot } from '../../src/types';
import type { XcpcContest } from '../../src/lib/xcpc';

const EMPTY_SNAPSHOT: Snapshot = {
  stats: { solved: 0, accepted_submissions: 0, active_days: 0, longest_streak: 0, current_streak: 0, peak_day: null, peak_count: 0 },
  career: { solved: 0, accepted_submissions: 0, active_days: 0, longest_streak: 0, current_streak: 0, peak_day: null, peak_count: 0 },
  daily: [],
  platforms: [],
  difficulty: [],
  difficulty_daily: [],
  ratings: [],
  recent: [],
  metric_available: true,
  warnings: [],
};

interface TauriFixtures {
  snapshot?: Snapshot;
  contests?: XcpcContest[];
}

export async function installTauriMock(page: Page, fixtures: TauriFixtures = {}) {
  await page.addInitScript(({ snapshot, contests }) => {
    const invoke = async (command: string, args: Record<string, unknown> = {}) => {
      switch (command) {
        case 'get_accounts':
        case 'get_sync_statuses':
          return [];
        case 'get_snapshot':
          return snapshot;
        case 'get_xcpc_contests':
          return contests;
        case 'get_day_detail': {
          const day = String(args.day || '');
          await fetch(`/__day?day=${encodeURIComponent(day)}`);
          return { day, items: [], aggregates: [] };
        }
        case 'open_external':
          await fetch(`/__open?url=${encodeURIComponent(String(args.url || ''))}`);
          return undefined;
        case 'prepare_tracker_session':
          return undefined;
        default:
          throw new Error(`Unhandled Tauri command in layout test: ${command}`);
      }
    };
    (window as unknown as { __TAURI_INTERNALS__: { invoke: typeof invoke } }).__TAURI_INTERNALS__ = { invoke };
  }, {
    snapshot: fixtures.snapshot || EMPTY_SNAPSHOT,
    contests: fixtures.contests || [],
  });
}
