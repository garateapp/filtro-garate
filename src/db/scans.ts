import * as SQLite from 'expo-sqlite';

import type { Direction, ScanRecord, SyncStatus } from '@/lib/types';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

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

/** Abre (una sola vez) la base de datos local. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('garate.db');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
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

function rowToRecord(row: ScanRow): ScanRecord {
  return {
    id: row.id,
    qrData: row.qrData,
    direction: row.direction,
    filterId: row.filterId,
    filterName: row.filterName,
    scannedAt: row.scannedAt,
    syncedAt: row.syncedAt,
    status: row.status,
  };
}

/** Guarda un escaneo localmente (siempre, incluso sin conexión). */
export async function insertScan(
  data: Omit<ScanRecord, 'id' | 'syncedAt' | 'status'>
): Promise<number> {
  const db = await getDb();
  const result = await db.runAsync(
    `INSERT INTO scans (qrData, direction, filterId, filterName, scannedAt, status)
     VALUES (?, ?, ?, ?, ?, 'pendiente')`,
    data.qrData,
    data.direction,
    data.filterId,
    data.filterName,
    data.scannedAt
  );
  return result.lastInsertRowId;
}

/** Historial más reciente primero. */
export async function getScans(limit = 200): Promise<ScanRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScanRow>(
    'SELECT * FROM scans ORDER BY id DESC LIMIT ?',
    limit
  );
  return rows.map(rowToRecord);
}

/** Escaneos que falta enviar a la API (pendientes o con error). */
export async function getPendingScans(): Promise<ScanRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ScanRow>(
    `SELECT * FROM scans WHERE status IN ('pendiente', 'error') ORDER BY id ASC`
  );
  return rows.map(rowToRecord);
}

export async function markSynced(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE scans SET status = 'sincronizado', syncedAt = ? WHERE id = ?`,
    new Date().toISOString(),
    id
  );
}

export async function markError(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE scans SET status = 'error' WHERE id = ?`, id);
}

export async function clearScans(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM scans');
}

export async function countScans(): Promise<{ total: number; pendientes: number }> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ total: number; pendientes: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN status != 'sincronizado' THEN 1 ELSE 0 END) AS pendientes
     FROM scans`
  );
  return { total: row?.total ?? 0, pendientes: row?.pendientes ?? 0 };
}
