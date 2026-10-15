import type { ScanPayload, ScanRecord } from '@/lib/types';

/**
 * Envía un escaneo al endpoint público.
 * Funciona tanto online como offline: si no hay conexión o la API falla,
 * lanza el error y el registro queda como "pendiente"/"error" en SQLite
 * para reintentarse más tarde.
 */
export async function sendScan(apiUrl: string, payload: ScanPayload): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

export function buildPayload(scan: ScanRecord): ScanPayload {
  return {
    qr: scan.qrData,
    tipo: scan.direction,
    filtro: scan.filterId,
    filtroNombre: scan.filterName,
    fecha: scan.scannedAt,
  };
}

/**
 * Sincroniza todos los escaneos pendientes con la API (por orden cronológico).
 * Devuelve cuántos se enviaron correctamente. Se puede llamar cuando vuelve
 * la conexión; los que fallen quedan pendientes para el próximo intento.
 */
export async function syncPending(
  apiUrl: string,
  pendings: ScanRecord[],
  onSuccess: (id: number) => Promise<void>,
  onError: (id: number) => Promise<void>
): Promise<number> {
  let sent = 0;
  for (const scan of pendings) {
    try {
      await sendScan(apiUrl, buildPayload(scan));
      await onSuccess(scan.id);
      sent++;
    } catch {
      await onError(scan.id);
      // Sin conexión todavía: detenemos el reintento hasta la próxima sincronización
      break;
    }
  }
  return sent;
}
