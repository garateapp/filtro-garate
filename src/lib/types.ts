export type Direction = 'entrada' | 'salida';

export type SyncStatus = 'pendiente' | 'sincronizado' | 'error';

/** Filtro configurable: Filtro 1, Filtro 2, ... */
export interface FilterConfig {
  id: number;
  nombre: string;
}

export interface AppConfig {
  /** Endpoint público al que se envían los escaneos */
  apiUrl: string;
  /** Filtro seleccionado actualmente */
  filtroActivo: number;
  /** Lista de filtros configurados */
  filtros: FilterConfig[];
  /**
   * Dirección del PRIMER escaneo de cada persona (cada QR nuevo).
   * Por defecto 'salida': la persona sale de la nave (p. ej. al baño)
   * y a partir de ahí su dirección se alterna sola en cada escaneo.
   */
  primeraDireccion: Direction;
}

export interface ScanRecord {
  id: number;
  qrData: string;
  direction: Direction;
  filterId: number;
  filterName: string;
  scannedAt: string; // ISO local del escaneo
  syncedAt: string | null; // ISO cuando se envió a la API
  status: SyncStatus;
}

/** Payload enviado al endpoint público por cada escaneo */
export interface ScanPayload {
  qr: string;
  tipo: Direction;
  filtro: number;
  filtroNombre: string;
  fecha: string;
}
