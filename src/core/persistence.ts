import { parseJobFile, serializeJob, type JobImportResult } from './jobfile';
import type { Job } from './job';

export const STORAGE_KEYS = {
  optIn: 'feed-repair-desk.persistence',
  job: 'feed-repair-desk.job',
} as const;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveOutcome {
  ok: boolean;
  message: string;
  savedAt?: string;
  bytes?: number;
}

export function getStorage(): StorageLike | null {
  try {
    const storage = globalThis.localStorage;
    if (!storage) {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

export function readOptIn(storage: StorageLike | null): boolean {
  try {
    return storage?.getItem(STORAGE_KEYS.optIn) === 'on';
  } catch {
    return false;
  }
}

export function writeOptIn(storage: StorageLike | null, enabled: boolean): boolean {
  if (!storage) {
    return false;
  }
  try {
    if (enabled) {
      storage.setItem(STORAGE_KEYS.optIn, 'on');
      return storage.getItem(STORAGE_KEYS.optIn) === 'on';
    }
    storage.removeItem(STORAGE_KEYS.optIn);
    storage.removeItem(STORAGE_KEYS.job);
    return storage.getItem(STORAGE_KEYS.optIn) === null && storage.getItem(STORAGE_KEYS.job) === null;
  } catch {
    return false;
  }
}

/** Writes the job and verifies it by reading it back. Never claims success without a matching readback. */
export function saveJob(storage: StorageLike | null, job: Job, now: Date = new Date()): SaveOutcome {
  if (!storage) {
    return { ok: false, message: 'Browser storage is unavailable here. Your work stays in memory; download the JSON job to keep it.' };
  }
  const serialized = serializeJob(job, now.toISOString());
  try {
    storage.setItem(STORAGE_KEYS.job, serialized);
  } catch (error) {
    const detail = error instanceof Error && error.name ? error.name : 'write failed';
    return { ok: false, message: `Not saved (${detail}). Your work stays in memory; download the JSON job to keep it.` };
  }
  let readback: string | null;
  try {
    readback = storage.getItem(STORAGE_KEYS.job);
  } catch {
    readback = null;
  }
  if (readback !== serialized) {
    return { ok: false, message: 'Not saved: the readback did not match what was written. Your work stays in memory; download the JSON job to keep it.' };
  }
  const bytes = new TextEncoder().encode(serialized).length;
  return { ok: true, message: `Saved to this browser and verified by readback.`, savedAt: now.toISOString(), bytes };
}

export function clearSavedJob(storage: StorageLike | null): SaveOutcome {
  if (!storage) return { ok: false, message: 'Browser storage is unavailable; removal could not be verified.' };
  try {
    storage.removeItem(STORAGE_KEYS.job);
    if (storage.getItem(STORAGE_KEYS.job) !== null) {
      return { ok: false, message: 'The stored copy remains; removal could not be verified.' };
    }
    return { ok: true, message: 'The stored copy was removed and its absence verified.' };
  } catch {
    return { ok: false, message: 'Removal could not be verified; the stored copy may remain.' };
  }
}

export function loadSavedJob(storage: StorageLike | null): JobImportResult | null {
  if (!storage) {
    return null;
  }
  let stored: string | null;
  try {
    stored = storage.getItem(STORAGE_KEYS.job);
  } catch {
    return { ok: false, message: 'Browser storage could not be read. No stored data was changed.' };
  }
  if (stored === null) {
    return null;
  }
  return parseJobFile(stored);
}
