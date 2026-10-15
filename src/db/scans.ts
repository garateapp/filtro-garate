import * as SQLite from 'expo-sqlite';

import type { Direction, ScanRecord, SyncStatus } from '@/lib/types';

interface LocalScan {
  id: number;
  qrData: string;
  direction: Direction;
  filterId: number;
  filterName: string;
  scannedAt: string;
  syncedAt?: string | null;
  status: SyncStatus;
}

const MEMORY_KEY = '@garate/scans/v1';
const MAX_ROWS = 5000;

let dbPromise: Promise<SQLite.SQLiteDatabase | null> | null = null;

async function migrate(db: SQLite.SQLiteDatabase) {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      qrData TEXT NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('entrada', 'salida')),
      filterId INTEGER NOT NULL,
      filterName TEXT NOT NULL,
      scannedAt TEXT NOT NULL,
      syncedAt TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente'
    );
    CREATE INDEX IF NOT EXISTS idx_scans_status ON scans (status);
  `);
}

/** Abre la base de datos local; devuelve null si no está disponible (p. ej. Expo Go). */
export function getDb(): Promise<SQLite.SQLiteDatabase | null> {
  if (!dbPromise) {
    dbPromise = (async () => {
      try {
        const db = await SQLite.openDatabaseAsync('garate.db');
        await migrate(db);
        return db;
      } catch {
        // Expo Go no incluye expo-sqlite → usar almacenamiento en memoria.
        return null;
      }
    })();
  }
  return dbPromise;
}

// ---------------------------------------------------------------------------
// Almacén alternativo en memoria (Expo Go / sin SQLite nativo)
// ---------------------------------------------------------------------------

let memoryRows: LocalScan[] | null = null;
let memSeq = 1;

async function ensureMemory(): Promise<LocalScan[]> {
  if (memoryRows === null) {
    memoryRows = [];
    try {
      const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
      const raw = await AsyncStorage.getItem(MEMORY_KEY);
      if (raw) {
        memoryRows = JSON.parse(raw) as LocalScan[];
        memSeq = memoryRows.reduce((m, r) => Math.max(m, r.id), 0) + 1;
      }
    } catch {
      /* sin persistencia disponible */
    }
  }
  return memoryRows;
}

async function persistMemory() {
  if (memoryRows === null) return;
  try {
    const { default: AsyncStorage } = await import('@react-native-async-storage/async-storage');
    await AsyncStorage.setItem(MEMORY_KEY, JSON.stringify(memoryRows.slice(-MAX_ROWS)));
  } catch {
    /* mejor esfuerzo */
  }
}

interface ScanRow {
  id: number;
  qrData: string;
  direction: Direction;
  filterId: number;
  filterName: string;
  scannedAt: string;
  syncedAt: string | null;
  status: SyncStatus;
}

export interface NewScan {
  qrData: string;
  direction: Direction;
  filterId: number;
  filterName: string;
  scannedAt: string;
}

/** Inserta un escaneo y devuelve su id. Guarda SIEMPRE (offline-first). */
export async function insertScan(scan: NewScan): Promise<number> {
  const db = await getDb();
  if (db) {
    const result = await db.runAsync(
      `INSERT INTO scans (qrData, direction, filterId, filterName, scannedAt, status)
       VALUES (?, ?, ?, ?, ?, 'pendiente')`,
      scan.qrData,
      scan.direction,
      scan.filterId,
      scan.filterName,
      scan.scannedAt
    );
    return result.lastInsertRowId;
  }
  const rows = await ensureMemory();
  const row: LocalScan = { id: memSeq++, ...scan, syncedAt: null, status: 'pendiente' };
  rows.push(row);
  void persistMemory();
  return row.id;
}

export async function markSynced(id: number): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.runAsync(
      `UPDATE scans SET status = 'sincronizado', syncedAt = ? WHERE id = ?`,
      new Date().toISOString(),
      id
    );
    return;
  }
  const rows = await ensureMemory();
  const r = rows.find((x) => x.id === id);
  if (r) {
    r.status = 'sincronizado';
    r.syncedAt = new Date().toISOString();
    void persistMemory();
  }
}

export async function markError(id: number): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.runAsync(`UPDATE scans SET status = 'error' WHERE id = ?`, id);
    return;
  }
  const rows = await ensureMemory();
  const r = rows.find((x) => x.id === id);
  if (r) {
    r.status = 'error';
    void persistMemory();
  }
}

export async function getPendingScans(): Promise<ScanRecord[]> {
  const db = await getDb();
  if (db) {
    const rows = await db.getAllAsync<ScanRow>(
      `SELECT * FROM scans WHERE status != 'sincronizado' ORDER BY id ASC`
    );
    return rows.map(toRecord);
  }
  const rows = await ensureMemory();
  return rows.filter((r) => r.status !== 'sincronizado').map(toRecord);
}

export async function getAllScans(limit = 200): Promise<ScanRecord[]> {
  const db = await getDb();
  if (db) {
    const rows = await db.getAllAsync<ScanRow>(
      `SELECT * FROM scans ORDER BY id DESC LIMIT ?`,
      limit
    );
    return rows.map(toRecord);
  }
  const rows = await ensureMemory();
  return [...rows].reverse().slice(0, limit).map(toRecord);
}

export async function clearAllScans(): Promise<void> {
  const db = await getDb();
  if (db) {
    await db.runAsync(`DELETE FROM scans`);
    return;
  }
  const rows = await ensureMemory();
  rows.length = 0;
  void persistMemory();
}

function toRecord(r: ScanRow | LocalScan): ScanRecord {
  return {
    id: r.id,
    qrData: r.qrData,
    direction: r.direction,
    filterId: r.filterId,
    filterName: r.filterName,
    scannedAt: r.scannedAt,
    syncedAt: r.syncedAt ?? null,
    status: r.status,
  };
}

/** Última dirección registrada para un QR concreto (null si es su primer escaneo). */
export async function getLastDirectionForQr(qrData: string): Promise<Direction | null> {
  const db = await getDb();
  if (db) {
    const row = await db.getFirstAsync<{ direction: Direction }>(
      `SELECT direction FROM scans WHERE qrData = ? ORDER BY id DESC LIMIT 1`,
      qrData
    );
    return row?.direction ?? null;
  }
  const rows = await ensureMemory();
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].qrData === qrData) return rows[i].direction;
  }
  return null;
}

export interface PersonState {
  qrData: string;
  lastDirection: Direction;
  lastScannedAt: string;
  total: number;
}

/** Estado actual por persona (último movimiento de cada QR distinto). */
export async function getPersonStates(): Promise<PersonState[]> {
  const db = await getDb();
  if (db) {
    const rows = await db.getAllAsync<{
      qrData: string;
      direction: Direction;
      scannedAt: string;
      total: number;
    }>(
      `SELECT s.qrData, s.direction, s.scannedAt, c.total
       FROM scans s
       JOIN (
         SELECT qrData, MAX(id) AS max_id, COUNT(*) AS total
         FROM scans GROUP BY qrData
       ) c ON c.max_id = s.id
       ORDER BY s.id DESC`
    );
    return rows.map((r) => ({
      qrData: r.qrData,
      lastDirection: r.direction,
      lastScannedAt: r.scannedAt,
      total: r.total,
    }));
  }
  const rows = await ensureMemory();
  const byQr = new Map<string, PersonState>();
  for (const r of rows) {
    const prev = byQr.get(r.qrData);
    byQr.set(r.qrData, {
      qrData: r.qrData,
      lastDirection: r.direction,
      lastScannedAt: r.scannedAt,
      total: (prev?.total ?? 0) + 1,
    });
  }
  return [...byQr.values()].reverse();
}
