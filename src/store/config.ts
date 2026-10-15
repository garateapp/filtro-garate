import AsyncStorage from '@react-native-async-storage/async-storage';

import type { AppConfig, FilterConfig } from '@/lib/types';

const STORAGE_KEY = '@garate/config/v1';

export const DEFAULT_CONFIG: AppConfig = {
  apiUrl: 'https://api.ejemplo.com/escaneos',
  filtroActivo: 1,
  filtros: [
    { id: 1, nombre: 'Filtro 1' },
    { id: 2, nombre: 'Filtro 2' },
    { id: 3, nombre: 'Filtro 3' },
  ],
  // Por defecto: el PRIMER escaneo de cada persona es SALIDA
  // (sale de la nave, p. ej. al baño; su siguiente escaneo será ENTRADA,
  // y así se alterna automáticamente por persona).
  primeraDireccion: 'salida',
};

/** Claves obsoletas que ya no forman parte de la config (regla global antigua). */
const LEGACY_KEYS = ['proximaEsEntrada', 'autoAlternar'] as const;

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AppConfig> &
      Record<string, unknown>;
    // Migración: descartar opciones globales antiguas (ahora la dirección
    // se calcula POR PERSONA, no de forma global).
    for (const k of LEGACY_KEYS) delete parsed[k];
    const config: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
    if (config.primeraDireccion !== 'entrada' && config.primeraDireccion !== 'salida') {
      config.primeraDireccion = DEFAULT_CONFIG.primeraDireccion;
    }
    if (config.filtros.length === 0) config.filtros = DEFAULT_CONFIG.filtros;
    if (!config.filtros.some((f) => f.id === config.filtroActivo)) {
      config.filtroActivo = config.filtros[0].id;
    }
    return config;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AppConfig): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

let listeners: ((c: AppConfig) => void)[] = [];

/** Suscribe a las pantallas a los cambios de configuración (p. ej. Ajustes → Escáner). */
export function subscribeConfig(fn: (c: AppConfig) => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

/** Guarda y notifica a todas las pantallas abiertas. */
export async function updateConfig(config: AppConfig): Promise<void> {
  await saveConfig(config);
  for (const fn of listeners) fn(config);
}

/** Crea un nuevo filtro con el siguiente id disponible. */
export function makeFilter(filtros: FilterConfig[], nombre?: string): FilterConfig {
  const nextId = filtros.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  return { id: nextId, nombre: nombre?.trim() || `Filtro ${nextId}` };
}
