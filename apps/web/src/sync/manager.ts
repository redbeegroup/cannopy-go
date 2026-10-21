import { useSyncExternalStore } from 'react';
import { getMeta, type LocalDb, localDb, META_KEYS } from '../db/local';
import { SyncClient } from './client';

/**
 * Runs sync in the background and tells the UI how it is going. One instance
 * per app: it syncs when the app opens, when the network comes back, when the
 * tab becomes visible, every few minutes, and shortly after every local write
 * (`requestSync`). Nothing in the UI waits for it; screens read IndexedDB.
 */
export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  phase: SyncPhase;
  online: boolean;
  pending: number;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Rejections from the last push, so the owner can see a record the server refused. */
  rejected: number;
}

type Listener = () => void;

export class SyncManager {
  readonly client: SyncClient;
  private status: SyncStatus = {
    phase: 'idle',
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    pending: 0,
    lastSyncAt: null,
    lastError: null,
    rejected: 0,
  };
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private businessId: string | null = null;

  constructor(private readonly db: LocalDb = localDb) {
    this.client = new SyncClient(db);
  }

  /** Call once, after the session is known. Safe to call again with the same id. */
  start(businessId: string): void {
    if (this.businessId === businessId && this.interval) return;
    this.businessId = businessId;
    void this.refreshCounts();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    if (this.interval) clearInterval(this.interval);
    this.interval = setInterval(() => void this.syncNow(), 3 * 60_000);
    void this.syncNow();
  }

  stop(): void {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    this.businessId = null;
  }

  /** Schedules a sync soon; many local writes in a row collapse into one. */
  requestSync(delayMs = 800): void {
    void this.refreshCounts();
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.syncNow(), delayMs);
  }

  async syncNow(): Promise<void> {
    if (this.running) return this.running;
    const businessId = this.businessId;
    if (!businessId) return;
    if (!this.status.online) {
      this.set({ phase: 'offline' });
      return;
    }
    this.set({ phase: 'syncing', lastError: null });
    this.running = (async () => {
      try {
        const result = await this.client.sync(businessId);
        this.set({
          phase: 'idle',
          lastSyncAt: new Date().toISOString(),
          rejected: result.rejected,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.set({ phase: this.status.online ? 'error' : 'offline', lastError: message });
      } finally {
        await this.refreshCounts();
        this.running = null;
      }
    })();
    return this.running;
  }

  getStatus = (): SyncStatus => this.status;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private async refreshCounts(): Promise<void> {
    const [pending, lastSyncAt] = await Promise.all([
      this.db.outbox.count(),
      getMeta<string>(this.db, META_KEYS.lastSyncAt),
    ]);
    this.set({ pending, lastSyncAt: lastSyncAt ?? this.status.lastSyncAt });
  }

  private set(patch: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...patch };
    for (const l of this.listeners) l();
  }

  private onOnline = () => {
    this.set({ online: true, phase: 'idle' });
    void this.syncNow();
  };
  private onOffline = () => this.set({ online: false, phase: 'offline' });
  private onVisible = () => {
    if (document.visibilityState === 'visible') void this.syncNow();
  };
}

export const syncManager = new SyncManager();

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(syncManager.subscribe, syncManager.getStatus, syncManager.getStatus);
}
