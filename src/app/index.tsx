import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect } from 'expo-router';

import { notifyFeedback } from '@/components/haptics.native';

import {
  getLastDirectionForQr,
  getPendingScans,
  getPersonStates,
  insertScan,
  markError,
  markSynced,
} from '@/db/scans';
import { sendScan } from '@/lib/api';
import type { AppConfig, Direction } from '@/lib/types';
import { loadConfig, subscribeConfig } from '@/store/config';

/** Invierte una dirección (entrada ↔ salida). */
const opposite = (d: Direction): Direction => (d === 'entrada' ? 'salida' : 'entrada');

export default function ScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [feedback, setFeedback] = useState<{
    qr: string;
    direction: Direction;
    online: boolean;
    nuevo: boolean; // primer escaneo de esa persona
  } | null>(null);
  /** Contadores en vivo derivados del estado por persona (SQLite local). */
  const [stats, setStats] = useState<{ dentro: number; fuera: number }>({
    dentro: 0,
    fuera: 0,
  });
  const [sending, setSending] = useState(false);
  const lockRef = useRef(false);
  const configRef = useRef<AppConfig | null>(null);

  // Mantener ref sincronizada para el callback de escaneo
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Cargar configuración guardada (filtro activo, dirección inicial por persona…)
  useEffect(() => {
    let cancelled = false;
    loadConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Refrescar cuando Ajustes guarda un cambio…
  useEffect(() => subscribeConfig(setConfig), []);

  const refreshStats = useCallback(async () => {
    try {
      const people = await getPersonStates();
      const fuera = people.filter((p) => p.lastDirection === 'salida').length;
      setStats({ dentro: people.length - fuera, fuera });
    } catch {
      // base de datos aún no disponible
    }
  }, []);

  // …y recargar también al volver a esta pestaña (garantiza lo último de AsyncStorage)
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      loadConfig().then((c) => {
        if (!cancelled) setConfig(c);
      });
      void refreshStats();
      return () => {
        cancelled = true;
      };
    }, [refreshStats])
  );

  // Reintentar envíos pendientes cuando se abre la app / cambia el endpoint
  const apiUrl = config?.apiUrl;
  useEffect(() => {
    if (!apiUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const pendings = await getPendingScans();
        for (const scan of pendings) {
          if (cancelled) return;
          try {
            await sendScan(apiUrl, {
              qr: scan.qrData,
              tipo: scan.direction,
              filtro: scan.filterId,
              filtroNombre: scan.filterName,
              fecha: scan.scannedAt,
            });
            await markSynced(scan.id);
          } catch {
            await markError(scan.id);
            break;
          }
        }
      } catch {
        // base de datos aún no disponible
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [apiUrl]);

  const handleBarcode = async (data: string) => {
    const cfg = configRef.current;
    if (!cfg || lockRef.current) return;
    lockRef.current = true;
    setTimeout(() => (lockRef.current = false), 2500);

    // La dirección se calcula POR PERSONA (cada QR):
    // - primer escaneo de ese QR → la dirección inicial configurada (por defecto SALIDA)
    // - escaneos siguientes     → lo contrario de su último movimiento
    // Así, si Ana sale al baño y Luis sale más tarde, cada uno tiene su propio
    // par salida→entrada sin afectarse entre sí.
    const last = await getLastDirectionForQr(data);
    const direction: Direction = last ? opposite(last) : cfg.primeraDireccion;
    const filter = cfg.filtros.find((f) => f.id === cfg.filtroActivo) ?? cfg.filtros[0];
    const scannedAt = new Date().toISOString();

    // 1. Guardar SIEMPRE en local (funciona offline)
    const id = await insertScan({
      qrData: data,
      direction,
      filterId: filter.id,
      filterName: filter.nombre,
      scannedAt,
    });

    // 2. Intentar enviar a la API pública
    setSending(true);
    let online = true;
    try {
      await sendScan(cfg.apiUrl, {
        qr: data,
        tipo: direction,
        filtro: filter.id,
        filtroNombre: filter.nombre,
        fecha: scannedAt,
      });
      await markSynced(id);
    } catch {
      online = false;
      await markError(id); // queda pendiente para sincronizar luego
    } finally {
      setSending(false);
    }

    // Ya no hay "próxima dirección" global: cada persona alterna según su historial.

    setFeedback({ qr: data, direction, online, nuevo: last === null });
    void refreshStats();
    notifyFeedback(direction);
  };

  if (!permission) {
    return (
      <Centered>
        <ActivityIndicator />
      </Centered>
    );
  }

  if (!permission.granted) {
    return (
      <Centered>
        <Text style={styles.title}>Filtro Garate</Text>
        <Text style={styles.subtitle}>
          Se necesita acceso a la cámara para escanear códigos QR.
        </Text>
        <Pressable style={styles.primaryBtn} onPress={() => requestPermission()}>
          <Text style={styles.primaryBtnText}>Permitir cámara</Text>
        </Pressable>
      </Centered>
    );
  }

  const filtroNombre =
    config?.filtros.find((f) => f.id === config?.filtroActivo)?.nombre ?? '—';

  return (
    <View style={styles.container}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={(result) => {
          if (result.data) void handleBarcode(result.data);
        }}
      />

      {/* Cabecera */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Filtro Garate</Text>
        <Text style={styles.headerSub}>{filtroNombre}</Text>
        <View style={styles.chipsRow}>
          <View style={[styles.chip, styles.chipIn]}>
            <Text style={styles.chipText}>Dentro: {stats.dentro}</Text>
          </View>
          <View style={[styles.chip, styles.chipOut]}>
            <Text style={styles.chipText}>Fuera: {stats.fuera}</Text>
          </View>
        </View>
        <Text style={styles.headerHint}>
          Cada QR alterna solo: su próximo escaneo será lo contrario de su último movimiento
        </Text>
      </View>

      {/* Marco del escáner */}
      <View pointerEvents="none" style={styles.frame}>
        <View style={[styles.corner, styles.cornerTL]} />
        <View style={[styles.corner, styles.cornerTR]} />
        <View style={[styles.corner, styles.cornerBL]} />
        <View style={[styles.corner, styles.cornerBR]} />
      </View>

      {sending && (
        <View style={styles.sendingBadge}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {/* Resultado del último escaneo */}
      {feedback && (
        <View
          style={[
            styles.feedback,
            feedback.direction === 'entrada' ? styles.feedbackIn : styles.feedbackOut,
          ]}>
          <Text style={styles.feedbackDirection}>
            {feedback.direction === 'entrada' ? 'ENTRADA ✓' : 'SALIDA ✓'}
          </Text>
          <Text style={styles.feedbackQr} numberOfLines={2}>
            {feedback.qr}
          </Text>
          <Text style={styles.feedbackNext}>
            {feedback.nuevo
              ? `Primer escaneo · su próximo movimiento será ${
                  feedback.direction === 'entrada' ? 'SALIDA' : 'ENTRADA'
                }`
              : `Su próximo escaneo será ${
                  feedback.direction === 'entrada' ? 'SALIDA' : 'ENTRADA'
                }`}
          </Text>
          <Text style={styles.feedbackSync}>
            {feedback.online
              ? 'Enviado a la API'
              : 'Sin conexión · guardado, se sincronizará'}
          </Text>
        </View>
      )}
    </View>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <View style={styles.centered}>{children}</View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 16,
    backgroundColor: '#0b0b0b',
  },
  title: { color: '#fff', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#bbb', textAlign: 'center', fontSize: 15 },
  primaryBtn: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  header: {
    position: 'absolute',
    top: 60,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: {
    color: '#dfe9f5',
    marginTop: 4,
    fontSize: 14,
    fontWeight: '600',
  },
  chipsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  chip: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  chipIn: { backgroundColor: 'rgba(16, 185, 129, 0.9)' },
  chipOut: { backgroundColor: 'rgba(245, 158, 11, 0.9)' },
  chipText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  headerHint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    marginTop: 6,
    textAlign: 'center',
  },
  frame: {
    position: 'absolute',
    top: '28%',
    left: '12%',
    right: '12%',
    height: 240,
  },
  corner: {
    position: 'absolute',
    width: 36,
    height: 36,
    borderColor: '#208AEF',
    borderWidth: 4,
  },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0 },
  sendingBadge: { position: 'absolute', bottom: 200, alignSelf: 'center' },
  feedback: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    borderRadius: 16,
    padding: 16,
    gap: 4,
  },
  feedbackIn: { backgroundColor: 'rgba(16, 185, 129, 0.95)' },
  feedbackOut: { backgroundColor: 'rgba(245, 158, 11, 0.95)' },
  feedbackDirection: { color: '#fff', fontSize: 22, fontWeight: '900' },
  feedbackQr: { color: '#fff', fontSize: 14, opacity: 0.95 },
  feedbackNext: { color: '#fff', fontSize: 13, fontWeight: '700' },
  feedbackSync: { color: '#fff', fontSize: 12, opacity: 0.85 },
});
