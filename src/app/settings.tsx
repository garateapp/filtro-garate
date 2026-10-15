import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppConfig, FilterConfig } from '@/lib/types';
import { loadConfig, makeFilter, updateConfig } from '@/store/config';

export default function SettingsScreen() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [saved, setSaved] = useState(false);
  const [newFilterName, setNewFilterName] = useState('');

  // Recargar SIEMPRE al abrir la pestaña (puede haber cambios desde el escáner)
  useEffect(() => {
    let cancelled = false;
    loadConfig().then((c) => {
      if (!cancelled) setConfig(c);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!config) {
    return <SafeAreaView style={styles.container} />;
  }

  const update = async (patch: Partial<AppConfig>) => {
    // Partimos de la config recargada de AsyncStorage para no pisar cambios externos
    const base = await loadConfig();
    const next = { ...base, ...patch };
    setConfig(next);
    setSaved(false);
    await updateConfig(next); // guarda + notifica al escáner
    setSaved(true);
  };

  const addFilter = () => {
    const f = makeFilter(config.filtros, newFilterName);
    void update({ filtros: [...config.filtros, f] });
    setNewFilterName('');
  };

  const renameFilter = (id: number, nombre: string) => {
    void update({
      filtros: config.filtros.map((f) => (f.id === id ? { ...f, nombre } : f)),
    });
  };

  const removeFilter = (id: number) => {
    if (config.filtros.length <= 1) return; // siempre al menos un filtro
    const filtros = config.filtros.filter((f) => f.id !== id);
    const filtroActivo = filtros.some((f) => f.id === config.filtroActivo)
      ? config.filtroActivo
      : filtros[0].id;
    void update({ filtros, filtroActivo });
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={styles.screenTitle}>Configuración</Text>

          {/* Endpoint */}
          <Text style={styles.section}>Endpoint de la API pública</Text>
          <TextInput
            style={styles.input}
            value={config.apiUrl}
            onChangeText={(apiUrl) => setConfig({ ...config, apiUrl })}
            onBlur={() => void update({ apiUrl: config.apiUrl.trim() })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="https://api.ejemplo.com/escaneos"
            placeholderTextColor="#6b7280"
            keyboardType="url"
          />
          <Text style={styles.hint}>
            Cada escaneo se envía por POST como {'{ qr, tipo, filtro, filtroNombre, fecha }'}. Si no
            hay conexión, queda guardado y se sincroniza automáticamente.
          </Text>

          {/* Dirección por defecto */}
          <Text style={styles.section}>Dirección del escaneo</Text>
          <View style={styles.segmentRow}>
            <SegmentButton
              label="Entrada"
              active={config.proximaEsEntrada}
              color="#10b981"
              onPress={() => void update({ proximaEsEntrada: true })}
            />
            <SegmentButton
              label="Salida"
              active={!config.proximaEsEntrada}
              color="#f59e0b"
              onPress={() => void update({ proximaEsEntrada: false })}
            />
          </View>
          <Text style={styles.hint}>
            Por defecto el primer escaneo es ENTRADA. Pulsa aquí para forzar la dirección del
            próximo escaneo.
          </Text>

          <Pressable
            style={styles.switchRow}
            onPress={() => void update({ autoAlternar: !config.autoAlternar })}
            accessibilityRole="switch"
            accessibilityState={{ checked: config.autoAlternar }}>
            <View style={styles.flex}>
              <Text style={styles.switchLabel}>Alternar automáticamente</Text>
              <Text style={styles.hint}>
                Entrada → Salida → Entrada… después de cada escaneo.
              </Text>
            </View>
            <SimpleSwitch toggled={config.autoAlternar} />
          </Pressable>

          {/* Filtros */}
          <Text style={styles.section}>Filtros (Escanea en el filtro activo)</Text>
          {config.filtros.map((f) => (
            <FilterRow
              key={f.id}
              filter={f}
              active={f.id === config.filtroActivo}
              canRemove={config.filtros.length > 1}
              onSelect={() => void update({ filtroActivo: f.id })}
              onRename={(nombre) => renameFilter(f.id, nombre)}
              onRemove={() => void removeFilter(f.id)}
            />
          ))}

          <View style={styles.addRow}>
            <TextInput
              style={[styles.input, styles.flex]}
              value={newFilterName}
              onChangeText={setNewFilterName}
              placeholder={`Filtro ${config.filtros.reduce((m, x) => Math.max(m, x.id), 0) + 1}`}
              placeholderTextColor="#6b7280"
            />
            <Pressable style={styles.addBtn} onPress={addFilter}>
              <Text style={styles.addBtnText}>Añadir</Text>
            </Pressable>
          </View>

          <Text style={[styles.hint, styles.saved]}>{saved ? 'Guardado ✓' : ' '}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function SegmentButton({
  label,
  active,
  color,
  onPress,
}: {
  label: string;
  active: boolean;
  color: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[
        styles.segment,
        { borderColor: color, backgroundColor: active ? color : 'transparent' },
      ]}
      onPress={onPress}>
      <Text style={[styles.segmentText, { color: active ? '#fff' : color }]}>{label}</Text>
    </Pressable>
  );
}

function FilterRow({
  filter,
  active,
  canRemove,
  onSelect,
  onRename,
  onRemove,
}: {
  filter: FilterConfig;
  active: boolean;
  canRemove: boolean;
  onSelect: () => void;
  onRename: (nombre: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(filter.nombre);

  return (
    <View style={[styles.filterRow, active && styles.filterRowActive]}>
      <Pressable style={styles.radio} onPress={onSelect}>
        <View style={[styles.radioCircle, active && styles.radioCircleActive]} />
      </Pressable>
      <View style={[styles.flex, styles.filterInfo]}>
        {editing ? (
          <TextInput
            style={styles.filterInput}
            value={name}
            onChangeText={setName}
            autoCorrect={false}
            onFocus={() => {}}
            onBlur={() => {
              setEditing(false);
              if (name.trim() && name !== filter.nombre) onRename(name);
              else setName(filter.nombre);
            }}
            onSubmitEditing={() => {
              setEditing(false);
              if (name.trim()) onRename(name);
            }}
          />
        ) : (
          <Pressable onPress={() => setEditing(true)}>
            <Text style={styles.filterName}>{filter.nombre}</Text>
            <Text style={styles.hint}>Toca el nombre para renombrar</Text>
          </Pressable>
        )}
      </View>
      {active && <Text style={styles.activeTag}>Activo</Text>}
      {canRemove && (
        <Pressable style={styles.removeBtn} onPress={onRemove}>
          <Text style={styles.removeBtnText}>✕</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Switch simple dibujado con Views. */
function SimpleSwitch({ toggled }: { toggled: boolean }) {
  return (
    <View style={[styles.switchTrack, toggled && styles.switchTrackOn]}>
      <View style={[styles.switchThumb, toggled && styles.switchThumbOn]} />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { flex: 1, backgroundColor: '#0b0b0b' },
  scroll: { padding: 16, paddingBottom: 48, gap: 8 },
  screenTitle: { color: '#fff', fontSize: 22, fontWeight: '800', marginBottom: 8 },
  section: {
    color: '#208AEF',
    fontSize: 13,
    fontWeight: '800',
    textTransform: 'uppercase',
    marginTop: 20,
    marginBottom: 4,
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: '#1c1d20',
    borderRadius: 10,
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#2e3135',
    fontSize: 15,
  },
  hint: { color: '#8a8f98', fontSize: 12, lineHeight: 17 },
  saved: { minHeight: 16, color: '#10b981', fontWeight: '700' },
  segmentRow: { flexDirection: 'row', gap: 10 },
  segment: {
    flex: 1,
    borderWidth: 2,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  segmentText: { fontWeight: '800', fontSize: 15 },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  switchLabel: { color: '#fff', fontSize: 15, fontWeight: '600' },
  switchTrack: {
    width: 52,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#3a3d42',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  switchTrackOn: { backgroundColor: '#208AEF' },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#fff',
  },
  switchThumbOn: { alignSelf: 'flex-end' as const },
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1c1d20',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#2e3135',
  },
  filterRowActive: { borderColor: '#208AEF' },
  radio: { padding: 4 },
  radioCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#5a5f66',
  },
  radioCircleActive: {
    borderColor: '#208AEF',
    backgroundColor: '#208AEF',
  },
  filterInfo: { gap: 2 },
  filterName: { color: '#fff', fontSize: 16, fontWeight: '600' },
  filterInput: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    borderBottomWidth: 1,
    borderBottomColor: '#208AEF',
    paddingVertical: 2,
  },
  activeTag: {
    color: '#208AEF',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  removeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#7f1d1d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtnText: { color: '#fff', fontWeight: '800' },
  addRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  addBtn: {
    backgroundColor: '#208AEF',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addBtnText: { color: '#fff', fontWeight: '800' },
});
