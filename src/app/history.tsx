import { useCallback, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { clearScans, getPendingScans, getScans, markError, markSynced } from '@/db/scans';
import { sendScan } from '@/lib/api';
import type { ScanRecord } from '@/lib/types';
import { loadConfig } from '@/store/config';
import { useFocusEffect } from 'expo-router';

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function HistoryScreen() {
  const [scans, setScans] = useState<ScanRecord[]>([]);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    setScans(await getScans());
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh])
  );

  const syncNow = async () => {
    setSyncing(true);
    try {
      const cfg = await loadConfig();
      const pendings = await getPendingScans();
      for (const scan of pendings) {
        try {
          await sendScan(cfg.apiUrl, {
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
      await refresh();
    } finally {
      setSyncing(false);
    }
  };

  const wipe = async () => {
    await clearScans();
    await refresh();
  };

  const pendientes = scans.filter((s) => s.status !== 'sincronizado').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.toolbar}>
        <Text style={styles.title}>Historial</Text>
        <View style={styles.actions}>
          <Pressable
            style={[styles.btn, syncing && styles.btnDisabled]}
            onPress={() => void syncNow()}
            disabled={syncing}>
            <Text style={styles.btnText}>
              {syncing ? 'Sincronizando…' : `Sincronizar${pendientes ? ` (${pendientes})` : ''}`}
            </Text>
          </Pressable>
          <Pressable style={[styles.btn, styles.dangerBtn]} onPress={() => void wipe()}>
            <Text style={styles.btnText}>Borrar</Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        data={scans}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={false} onRefresh={() => void refresh()} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            Aún no hay escaneos. {'\n'}Escanea un QR desde la pestaña Escáner.
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View
              style={[
                styles.badge,
                item.direction === 'entrada' ? styles.badgeIn : styles.badgeOut,
              ]}>
              <Text style={styles.badgeText}>
                {item.direction === 'entrada' ? 'ENT' : 'SAL'}
              </Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.qr} numberOfLines={1}>
                {item.qrData}
              </Text>
              <Text style={styles.meta}>
                {item.filterName} · {formatTime(item.scannedAt)}
              </Text>
            </View>
            <StatusPill status={item.status} />
          </View>
        )}
      />
    </SafeAreaView>
  );
}

function StatusPill({ status }: { status: ScanRecord['status'] }) {
  const label =
    status === 'sincronizado' ? 'OK' : status === 'pendiente' ? 'Pendiente' : 'Reintentar';
  const color =
    status === 'sincronizado'
      ? '#10b981'
      : status === 'pendiente'
        ? '#f59e0b'
        : '#ef4444';
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0b' },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    gap: 8,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  actions: { flexDirection: 'row', gap: 8 },
  btn: {
    backgroundColor: '#208AEF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  btnDisabled: { opacity: 0.6 },
  dangerBtn: { backgroundColor: '#7f1d1d' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  empty: {
    color: '#8a8f98',
    textAlign: 'center',
    marginTop: 60,
    paddingHorizontal: 24,
    lineHeight: 22,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#2a2a2a',
  },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeIn: { backgroundColor: '#10b981' },
  badgeOut: { backgroundColor: '#f59e0b' },
  badgeText: { color: '#fff', fontWeight: '900', fontSize: 12 },
  info: { flex: 1, gap: 2 },
  qr: { color: '#fff', fontSize: 15, fontWeight: '600' },
  meta: { color: '#8a8f98', fontSize: 12 },
  pill: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  pillText: { fontSize: 12, fontWeight: '700' },
});
