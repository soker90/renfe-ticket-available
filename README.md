# Renfe Ticket Checker

Consulta y seguimiento de disponibilidad de billetes de tren entre **Alcázar de San Juan**, **Madrid - Atocha Cercanías** y **Aranjuez** usando la API interna DWR de Renfe. Notificación automática vía Telegram.

---

## Características principales

- ✅ Consulta directa contra la API DWR oficial de Renfe (sin scraping)
- ✅ Busca por fecha, ruta y franja horaria
- ✅ Envío de resultados y avisos por Telegram
- ✅ Ejecución manual vía GitHub Actions o desde el bot
- ✅ Bot Telegram con **flujo conversacional guiado** (inline keyboards) o modo comando rápido (one-liner)
- ✅ Configurado para rutas fijas reales: Alcázar↔Madrid y Alcázar↔Aranjuez

---

## Uso rápido por consola

```bash
# Instala dependencias
npm install

# Busca trenes (modo CLI)
FECHA="01/03/2026" ORIGEN="ALCAZAR" DESTINO="MADRID" npm start
FECHA="01/03/2026" ORIGEN="ALCAZAR" DESTINO="ARANJUEZ" HORA_DESDE="08:00" HORA_HASTA="14:00" npm start
```

### Variables de entorno CLI

| Variable            | Descripción                                  | Obligatorio |
|---------------------|----------------------------------------------|-------------|
| `FECHA`             | Fecha (DD/MM/YYYY)                           | Sí          |
| `ORIGEN`            | `ALCAZAR`, `MADRID`, `ARANJUEZ`              | Sí          |
| `DESTINO`           | `ALCAZAR`, `MADRID`, `ARANJUEZ`              | Sí          |
| `TIPO_VIAJE`        | Tipo: `solo_ida` o `ida_vuelta`              | No          |
| `HORA_DESDE`        | Hora inicio (HH:MM, opcional)                | No          |
| `HORA_HASTA`        | Hora fin (HH:MM, opcional)                   | No          |
| `TELEGRAM_BOT_TOKEN`| Token del bot de Telegram                    | No          |
| `TELEGRAM_CHAT_ID`  | Chat ID de Telegram                          | No          |
| `OUTPUT_JSON`       | Si 'true', salida en JSON                    | No          |

---

## GitHub Actions

Incluye un workflow `.github/workflows/check-tickets.yml` ejecutable manualmente o desde el bot.

Variables requeridas (inputs):
- `fecha`, `origen`, `destino`, `hora_desde`, `hora_hasta`

Secrets necesarios para avisos:
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`

---

## Bot de Telegram (Cloudflare Workers)

### Instalación y despliegue

1. Instala dependencias y secrets:

```bash
cd worker
npm install
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GITHUB_TOKEN       # Personal Access Token actions:write
npx wrangler secret put ALLOWED_CHAT_ID    # Solo esa persona puede usar el bot
```

2. **Configura el KV para sesiones**:

En `wrangler.toml`, añade (solo la primera vez):

```toml
[[kv_namespaces]]
binding = "BOT_SESSIONS"
id = "<REEMPLAZA_POR_ID>"
```
Genera el id ejecutando:
```
npx wrangler kv namespace create BOT_SESSIONS
```

3. Despliega el worker:

```bash
npx wrangler deploy
```

4. Configura el webhook de Telegram (solo una vez):

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<TU_WORKER>.workers.dev"
```

### Comandos soportados en el bot

| Comando | Ejemplo | Descripción |
|---------|---------|-------------|
| `/buscar`             |  —         | Inicia el flujo conversacional guiado con botones |
| `/buscar <fecha> <ruta> [HH:MM-HH:MM]` | `/buscar 15/03/2026 ida 08:00-14:00` | Modo rápido (one-liner), soporta rutas: `ida`, `vuelta`, `alcazar-aranjuez`, `aranjuez-alcazar` |
| `/cancelar`           |  —         | Cancela el flujo en curso |
| `/ayuda` / `/start`   |  —         | Muestra ayuda detallada |

#### Ejemplos de rutas one-liner
- `/buscar 15/03/2026 ida`
- `/buscar mañana alcazar-aranjuez 08:00-12:00`
- `/buscar pasado vuelta`
- `/buscar 02/03/2026 aranjuez-alcazar 14:00-16:00`

#### Conversacional paso a paso
1. `/buscar` → seleccionas ruta con botones
2. Seleccionas fecha (botones: Lunes, Martes, …, 'Otra fecha...')
3. Seleccionas franja horaria (botones: Mañana, Tarde, Sin filtro, Personalizada…)
4. El bot lanza la búsqueda y te avisa cuando haya disponibilidad

#### Seguridad
Solo el `ALLOWED_CHAT_ID` configurado podrá interactuar con el bot.

#### Sesiones
El estado de la conversación se almacena en Cloudflare KV (namespace `BOT_SESSIONS`).

---

## Estructura del proyecto

```
src/
├── index.ts          # Punto de entrada CLI
├── renfe-api.ts      # Cliente API DWR de Renfe
├── telegram.ts       # Envío de mensajes
├── formatter.ts      # Formateo de resultados
└── types.ts          # Tipos TypeScript

worker/
└── src/index.ts      # Cloudflare Worker (webhook Telegram: flujo conversacional)

.github/workflows/
└── check-tickets.yml # GitHub Action
```

---

## Licencia

GPL-3.0
