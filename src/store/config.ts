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
  // Por defecto: el primer escaneo es ENTRADA
  proximaEsEntrada: true,
  autoAlternar: false,
};

export async function loadConfig(): Promise<AppConfig> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<AppConfig>;
    const config: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
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

/** Crea un nuevo filtro con el siguiente id disponible. */
export function makeFilter(filtros: FilterConfig[], nombre?: string): FilterConfig {
  const nextId = filtros.reduce((max, f) => Math.max(max, f.id), 0) + 1;
  return { id: nextId, nombre: nombre?.trim() || `Filtro ${nextId}` };
}
