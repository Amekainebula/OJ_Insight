import { invoke } from '@tauri-apps/api/core';

import type {
  AccountConfig,
  ContestReviewExportResult,
  ContestReviewPreview,
  DayDetail,
  DifficultyDetail,
  Metric,
  Platform,
  Snapshot,
  SyncResult,
  SyncStatus,
  UpdateInfo,
  WatchedAcEvent,
  WatchedBindingInput,
  WatchedPerson,
  WatchedSyncResult,
} from '../types';
import type { XcpcContest } from '../lib/xcpc';

export interface StorageInfo {
  rootDir: string;
  dataDir: string;
  databasePath: string;
  exportDir: string;
  webviewDir: string;
  logDir: string;
}

export const api = {
  storageInfo: () => invoke<StorageInfo>('get_storage_info'),
  getAccounts: () => invoke<AccountConfig[]>('get_accounts'),
  saveAccount: (platform: Platform, account: string, secret: string) =>
    invoke<void>('save_account', { platform, account, secret }),
  saveAccounts: (platform: Platform, accounts: AccountConfig[]) =>
    invoke<void>('save_accounts', { platform, accounts }),
  saveAllAccounts: (accounts: AccountConfig[]) =>
    invoke<void>('save_all_accounts', { accounts }),
  getStatuses: () => invoke<SyncStatus[]>('get_sync_statuses'),
  getWatchedPeople: () => invoke<WatchedPerson[]>('get_watched_people'),
  getWatchedEvents: () => invoke<WatchedAcEvent[]>('get_watched_events'),
  saveWatchedPerson: (platform: Platform, account: string, nickname: string, relationship: string, secret: string) =>
    invoke<void>('save_watched_person', { platform, account, nickname, relationship, secret }),
  saveWatchedPeople: (nickname: string, relationship: string, bindings: WatchedBindingInput[]) =>
    invoke<void>('save_watched_people', { nickname, relationship, bindings }),
  editWatchedPerson: (personIds: number[], nickname: string, relationship: string, bindings: WatchedBindingInput[]) =>
    invoke<void>('edit_watched_person', { personIds, nickname, relationship, bindings }),
  deleteWatchedPerson: (personId: number) => invoke<void>('delete_watched_person', { personId }),
  syncWatchedPeople: () => invoke<WatchedSyncResult>('sync_watched_people'),
  syncWatchedPerson: (personId: number) => invoke<WatchedSyncResult>('sync_watched_person', { personId }),
  dismissWatchedEvent: (eventId: number) => invoke<void>('dismiss_watched_event', { eventId }),
  getXcpcContests: (forceRefresh = false, refreshRatings = false) =>
    invoke<XcpcContest[]>('get_xcpc_contests', { forceRefresh, refreshRatings }),
  inspectContestReview: (platform: Platform, account: string, contestInput: string, includePostContest: boolean) =>
    invoke<ContestReviewPreview>('inspect_contest_review', { platform, account, contestInput, includePostContest }),
  generateContestReview: (platform: Platform, account: string, contestInput: string, includePostContest: boolean, path: string) =>
    invoke<ContestReviewExportResult>('generate_contest_review', { platform, account, contestInput, includePostContest, path }),
  syncPlatform: (platform: Platform, full = false) =>
    invoke<SyncResult>('sync_platform', { platform, full }),
  syncAll: () => invoke<SyncResult[]>('sync_all'),
  clearPlatform: (platform: Platform) =>
    invoke<void>('clear_platform_records', { platform }),
  clearAll: () => invoke<void>('clear_all_records'),
  snapshot: (
    platform: Platform | null,
    startDay: string | null,
    endDay: string | null,
    metric: Metric,
    account: string | null = null,
    source: string | null = null,
    timeZone = 'Asia/Shanghai',
  ) =>
    invoke<Snapshot>('get_snapshot', {
      platform,
      startDay,
      endDay,
      metric,
      account,
      source,
      timeZone,
    }),
  dayDetail: (
    day: string,
    platform: Platform | null,
    account: string | null = null,
    source: string | null = null,
    timeZone = 'Asia/Shanghai',
  ) => invoke<DayDetail>('get_day_detail', { day, platform, account, source, timeZone }),
  difficultyDetail: (
    platform: Platform,
    label: string,
    account: string | null = null,
    source: string | null = null,
  ) => invoke<DifficultyDetail>('get_difficulty_detail', { platform, label, account, source }),
  checkForUpdates: () => invoke<UpdateInfo>('check_for_updates'),
  openExternal: (url: string) => invoke<void>('open_external', { url }),
  writeExportFile: (path: string, data: number[]) =>
    invoke<void>('write_export_file', { path, data }),
};
