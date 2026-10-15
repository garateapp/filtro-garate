# Prompt — Backend "Filtro Garate" (Laravel 11 + React Inertia)

Copia y pega el siguiente prompt en un agente de código para generar el backend. Está diseñado para ser **compatible 100% con la app Expo** ya construida (mismo contrato JSON del POST).

---

## PROMPT

Construye el backend de **"Filtro Garate"**, un sistema de control de entrada/salida por escaneo de QR, usando **Laravel 11 + Inertia.js v2 + React 18 + TypeScript + Tailwind CSS**. Debe incluir una API pública que consumirá una app móvil Expo y un panel web (Inertia/React) para consultar los registros.

### 1. Stack y setup

- Laravel 11 (PHP 8.3), SQLite en desarrollo y MySQL/MariaDB en producción (configurable por `.env`).
- `composer require inertiajs/inertia-laravel tightenco/ziggy laravel/sanctum`
- Frontend: Vite + React + TypeScript + Tailwind + `@inertiajs/react` (usar el scaffold oficial de Inertia para Laravel: `php artisan inertia:start-frontend`, page components en `resources/js/Pages/`).
- Componentes UI reutilizables tipo shadcn/ui (Card, Badge, Button, Table, Dialog, Select).
- Iconos: lucide-react.

### 2. Modelo de datos

Migraciones y modelos Eloquent:

**`filters`** — filtros configurables (Filtro 1, Filtro 2, Filtro 3…):
- `id`, `name` (string, ej. "Filtro 1"), `code` (string único, opcional), `position` (int, orden), `is_active` (bool default true), `timestamps`.
- Seed inicial: "Filtro 1", "Filtro 2", "Filtro 3".

**`scans`** — cada escaneo recibido de la app móvil:
- `id`
- `qr_data` (string, requerido) — contenido del QR escaneado
- `direction` (enum: `entrada`, `salida`; default `entrada`) — el primer escaneo de la app es ENTRADA por defecto
- `filter_id` (foreign key a `filters`, onDelete restrict)
- `filter_name` (string) — nombre del filtro en el momento del escaneo (snapshot, no se re-escribe al renombrar)
- `scanned_at` (timestamp) — fecha/hora local del escaneo enviada por la app
- `source_ip` (string nullable), `device_id` (string nullable)
- `created_at`, `updated_at`

Índices: `(filter_id, scanned_at)`, `(qr_data)`, `(direction, scanned_at)`.

**`api_tokens` (opcional, auth por dispositivo):** tabla simple `device_tokens`: `id`, `token` (único, hash), `device_name`, `last_used_at`, `timestamps`. Alternativa: Sanctum tokens. Ver sección 4.

### 3. API pública (contrato EXACTO — no cambiar nombres de campos)

La app Expo envía por cada escaneo un **POST** con `Content-Type: application/json` a `/api/escaneos` con este payload literal:

```json
{
  "qr": "ABC123XYZ",
  "tipo": "entrada",
  "filtro": 1,
  "filtroNombre": "Filtro 1",
  "fecha": "2026-10-16T09:32:11.512"
}
```

- `qr`: string, requerido, max 500 → columna `qr_data`
- `tipo`: `"entrada"` | `"salida"`, requerido → columna `direction`
- `filtro`: integer, requerido, debe existir en `filters.id`
- `filtroNombre`: string, requerido, max 100 → snapshot en `filter_name`
- `fecha`: ISO 8601, requerido, válida → columna `scanned_at`

**Respuestas:**
- `201 Created`:
```json
{
  "ok": true,
  "scan": { "id": 123, "qr": "...", "tipo": "entrada", "filtro": 1, "filtroNombre": "Filtro 1", "fecha": "..." },
  "received_at": "2026-10-16T09:32:12+00:00"
}
```
- `422 Unprocessable Entity` con errores de validación estándar Laravel (`{ "message": "...", "errors": { "qr": ["..."] } }`).
- La app trata cualquier `!res.ok` como fallo y reintentará luego, así que las respuestas deben ser rápidas (<2 s).

**Rutas API adicionales (solo lectura, protegidas por token):**
- `GET /api/filtros` → lista de filtros activos `{ id, name }[]` (la app puede usarlos para validar/sincronizar su config local).
- `GET /api/escaneos?desde=&hasta=&filtro=&tipo=&page=` → historial paginado (Laravel `paginate(50)`).
- `GET /api/resumen?filtro=&dia=` → conteos `{ entradas: int, salidas: int, pendientes_conteo_no_aplica }` para widgets del dashboard.

Implementar en `routes/api.php` con un `ScanController` (invokable methods), FormRequest `StoreScanRequest` para validación, y Resource `ScanResource` que devuelva SIEMPRE las claves `qr`, `tipo`, `filtro`, `filtroNombre`, `fecha` (camelCase, igual que el payload de entrada).

### 4. Seguridad de la API

- Middleware propio `ValidateApiToken`: exige header `Authorization: Bearer <token>` en `/api/*`.
- Panel web permite generar/revocar **tokens de dispositivo** (uno por teléfono); el token se crea una vez y se muestra solo en ese momento (guardar solo el hash SHA-256).
- Rate limiting por IP y token: `throttle:60,1` en `/api/escaneos`.
- CORS: configurar `config/cors.php` permitiendo el origen de la app Expo (`*` en desarrollo, dominio concreto en producción) para `POST /api/escaneos`.
- Idempotencia opcional: si llega el mismo `qr` + `filtro` con el mismo `fecha` (±2 s), responder `200` con el registro existente en lugar de duplicar (útil cuando la app reintenta su cola offline).

### 5. Panel web (Inertia + React)

Rutas web con middleware `web` + auth de Laravel (Breeze/Fortify opcional; mínimo login simple con `User` por defecto admin):

- **Dashboard `/`** (`Pages/Dashboard.tsx`): tarjetas con totales del día (entradas, salidas, escaneos por filtro), gráfico simple de líneas/barras por hora (recharts), últimos 10 escaneos en tabla con badge verde ENT / ámbar SAL.
- **Historial `/escaneos`** (`Pages/Scans/Index.tsx`): tabla paginada con filtros por rango de fechas, filtro (select), dirección (entrada/salida) y búsqueda por contenido QR; botón export CSV (`GET /escaneos/export`, descarga streaming con `fputcsv`).
- **Filtros `/filtros`** (`Pages/Filters/Index.tsx`): CRUD completo — crear (nombre, code), renombrar, reordenar (drag o position numérico), activar/desactivar. Al renombrar NO tocar los `scans` históricos (usan `filter_name` snapshot).
- **Dispositivos `/dispositivos`** (`Pages/Tokens/Index.tsx`): listar/generar/revocar tokens de la app móvil; al generar, mostrar el token en un dialog con botón copiar.

Diseño: layout Inertia común con sidebar (Escaneos, Filtros, Dispositivos), modo claro, tipografía limpia; todo en español (etiquetas: Entrada/Salida, Filtro, Historial, Resumen del día…).

### 6. Validaciones y reglas de negocio

- `StoreScanRequest`: ver sección 3 (reglas `required|string|max:500`, `Rule::in(['entrada','salida'])`, `integer|exists:filters,id`, `date_format:c` o `after_or_equal:2000-01-01`).
- Normalizar `qr` (trim). Rechazar QR vacío.
- Guardar `scanned_at` tal cual lo envía la app (hora local del dispositivo); almacenar también `created_at` (servidor) para auditoría de sincronización offline (un escaneo guardado offline puede llegar horas después: `scanned_at ≠ created_at`).

### 7. Tests (obligatorio)

Feature tests con Pest o PHPUnit:
- `POST /api/escaneos` exitoso → 201 y fila creada con las columnas correctas.
- Payload exacto de la app Expo (el JSON de la sección 3) → 201 (test de compatibilidad del contrato).
- Validaciones: sin token → 401; `tipo` inválido → 422; `filtro` inexistente → 422; `qr` vacío → 422.
- Idempotencia: mismo `qr+filtro+fecha` dos veces → un solo registro.
- Test del contrato del `ScanResource`: respuesta contiene exactamente `qr`, `tipo`, `filtro`, `filtroNombre`, `fecha`.

### 8. Seeds y datos demo

- `FilterSeeder`: Filtro 1/2/3.
- `ScanSeeder`: ~200 escaneos aleatorios de los últimos 7 días (mezcla entrada/salida, timestamps pasados) para poblar el dashboard.
- `AdminUserSeeder`: usuario admin demo (email/password en `.env.example`).

### 9. Entregables

- Código completo listo para correr: `composer install && npm i && php artisan migrate --seed && npm run build && php artisan serve`.
- `.env.example` con: `DB_*`, `APP_URL`, `CORS_ALLOWED_ORIGINS`, `SCAN_RATE_LIMIT`.
- README con: cómo generar un token de dispositivo, ejemplo `curl` del POST compatible con la app Expo, y nota de que la app funciona offline y reenvía la cola (por eso `scanned_at` puede diferir de `created_at`).

No inventes rutas ni cambies nombres de campos del contrato de la sección 3: la app móvil Expo ya está construida contra ese payload exacto.

---

## Notas de integración con la app Expo (para referencia)

| App Expo (ya implementado) | Backend Laravel |
|---|---|
| `POST apiUrl` con `{ qr, tipo, filtro, filtroNombre, fecha }` | `POST /api/escaneos` valida y persiste → 201 |
| Cola offline en SQLite (`pendiente` → `sincronizado`) | Acepta reintentos; idempotencia evita duplicados |
| Config editable del endpoint en Ajustes | URL real: `https://tudominio.com/api/escaneos` |
| Primer escaneo = ENTRADA por defecto | Default `direction='entrada'` coherente |
| Filtros 1/2/3 configurables en el teléfono | Tabla `filters` + CRUD web; `filtro` debe existir (422 si no) |
