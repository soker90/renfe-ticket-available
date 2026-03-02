# Renfe Ticket Checker

Busca disponibilidad de billetes de tren entre **Alcázar de San Juan** y **Madrid - Atocha Cercanías** usando la API interna de Renfe. Envía los resultados por Telegram.

## Características

- ✅ Consulta la API DWR de Renfe directamente (sin scraping de navegador)
- ✅ Búsqueda por fecha, dirección (ida/vuelta) y franja horaria
- ✅ Notificaciones por Telegram cuando hay billetes disponibles
- ✅ Ejecución via GitHub Actions o CLI local
- ✅ Bot de Telegram integrado via Cloudflare Workers

## Uso rápido

```bash
# Instalar dependencias
npm install

# Buscar trenes (CLI)
FECHA="01/03/2026" DIRECCION="ida" npm start
FECHA="01/03/2026" DIRECCION="vuelta" HORA_DESDE="08:00" HORA_HASTA="14:00" npm start
```

## Variables de entorno

| Variable | Descripción | Obligatorio |
|----------|-------------|-------------|
| `FECHA` | Fecha (DD/MM/YYYY) | Sí |
| `DIRECCION` | `ida` o `vuelta` | No (default: ida) |
| `TIPO_VIAJE` | `solo_ida` o `ida_vuelta` | No (default: solo_ida) |
| `HORA_DESDE` | Hora inicio (HH:MM) | No |
| `HORA_HASTA` | Hora fin (HH:MM) | No |
| `TELEGRAM_BOT_TOKEN` | Token del bot de Telegram | No |
| `TELEGRAM_CHAT_ID` | Chat ID de Telegram | No |
| `OUTPUT_JSON` | `true` para salida JSON | No |

## GitHub Actions

El proyecto incluye un workflow en `.github/workflows/check-tickets.yml` que se puede ejecutar manualmente o desde Telegram.

### Secrets necesarios en GitHub

- `TELEGRAM_BOT_TOKEN` - Token del bot de Telegram
- `TELEGRAM_CHAT_ID` - Tu Chat ID

## Bot de Telegram (Cloudflare Workers)

Para usar el bot de Telegram, despliega el Worker:

```bash
cd worker
npm install
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put GITHUB_TOKEN  # PAT con permisos actions:write
npx wrangler secret put ALLOWED_CHAT_ID
npx wrangler deploy
```

### Comandos del bot

| Comando | Ejemplo | Descripción |
|---------|---------|-------------|
| `/buscar` | `/buscar 15/03/2026 ida 08:00-14:00` | Buscar trenes |
| `/buscar` | `/buscar manana vuelta` | Buscar para mañana |
| `/ayuda` | | Mostrar ayuda |

### Configurar webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://tu-worker.workers.dev"
```

## Estructura del proyecto

```
src/
├── index.ts          # Punto de entrada CLI
├── renfe-api.ts     # Cliente API DWR de Renfe
├── telegram.ts      # Envío de mensajes
├── formatter.ts     # Formateo de resultados
└── types.ts         # Tipos TypeScript

worker/
└── src/index.ts     # Cloudflare Worker (webhook Telegram)

.github/workflows/
└── check-tickets.yml  # GitHub Action
```

## Licencia

GPL-3.0
