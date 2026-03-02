import { RenfeAPI } from "./renfe-api.js";
import { sendTelegramMessage } from "./telegram.js";
import { formatConsole, formatTelegram, formatJSON } from "./formatter.js";
import type { SearchConfig, StationKey, TripType, TimeRange } from "./types.js";

const VALID_STATIONS: StationKey[] = ["ALCAZAR", "MADRID", "ARANJUEZ"];

/** Parsea la configuración desde variables de entorno */
function parseConfig(): SearchConfig {
  const fecha = process.env.FECHA;
  if (!fecha) {
    console.error("Error: Variable de entorno FECHA es obligatoria (formato DD/MM/YYYY)");
    console.error("");
    console.error("Variables de entorno:");
    console.error("  FECHA          - Fecha del viaje (DD/MM/YYYY) [obligatorio]");
    console.error("  ORIGEN         - ALCAZAR | MADRID | ARANJUEZ [obligatorio]");
    console.error("  DESTINO        - ALCAZAR | MADRID | ARANJUEZ [obligatorio]");
    console.error("  TIPO_VIAJE     - 'solo_ida' o 'ida_vuelta' [default: solo_ida]");
    console.error("  HORA_DESDE     - Hora inicio franja (HH:MM) [opcional]");
    console.error("  HORA_HASTA     - Hora fin franja (HH:MM) [opcional]");
    console.error("  TELEGRAM_BOT_TOKEN - Token del bot de Telegram [opcional]");
    console.error("  TELEGRAM_CHAT_ID   - Chat ID de Telegram [opcional]");
    console.error("  OUTPUT_JSON    - Si 'true', salida en formato JSON [opcional]");
    process.exit(1);
  }

  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
    console.error("Error: FECHA debe tener formato DD/MM/YYYY");
    process.exit(1);
  }

  const origenKey = (process.env.ORIGEN || "ALCAZAR") as StationKey;
  if (!VALID_STATIONS.includes(origenKey)) {
    console.error(`Error: ORIGEN debe ser uno de: ${VALID_STATIONS.join(", ")}`);
    process.exit(1);
  }

  const destinoKey = (process.env.DESTINO || "MADRID") as StationKey;
  if (!VALID_STATIONS.includes(destinoKey)) {
    console.error(`Error: DESTINO debe ser uno de: ${VALID_STATIONS.join(", ")}`);
    process.exit(1);
  }

  if (origenKey === destinoKey) {
    console.error("Error: ORIGEN y DESTINO no pueden ser la misma estación");
    process.exit(1);
  }

  const tipoViaje = (process.env.TIPO_VIAJE || "solo_ida") as TripType;
  if (tipoViaje !== "solo_ida" && tipoViaje !== "ida_vuelta") {
    console.error("Error: TIPO_VIAJE debe ser 'solo_ida' o 'ida_vuelta'");
    process.exit(1);
  }

  let franjaHoraria: TimeRange | undefined;
  const horaDesde = process.env.HORA_DESDE;
  const horaHasta = process.env.HORA_HASTA;
  if (horaDesde && horaHasta) {
    if (!/^\d{2}:\d{2}$/.test(horaDesde) || !/^\d{2}:\d{2}$/.test(horaHasta)) {
      console.error("Error: HORA_DESDE y HORA_HASTA deben tener formato HH:MM");
      process.exit(1);
    }
    franjaHoraria = { from: horaDesde, to: horaHasta };
  }

  return { fecha, origenKey, destinoKey, tipoViaje, franjaHoraria };
}

async function main(): Promise<void> {
  const config = parseConfig();
  const api = new RenfeAPI();

  try {
    const result = await api.searchTrains(config);

    const outputJson = process.env.OUTPUT_JSON === "true";
    if (outputJson) {
      console.log(formatJSON(result));
    } else {
      console.log(formatConsole(result));
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (botToken && chatId) {
      if (result.trenesDisponibles > 0) {
        const message = formatTelegram(result);
        const sent = await sendTelegramMessage(botToken, chatId, message);
        if (sent) {
          console.log("\nNotificación enviada por Telegram");
        } else {
          console.error("\nError enviando notificación por Telegram");
          process.exit(1);
        }
      } else {
        console.log("\nNo hay trenes disponibles. No se envía notificación.");
      }
    }
  } catch (error) {
    console.error("\nError durante la búsqueda:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

main();
