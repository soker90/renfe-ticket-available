import { RenfeAPI } from "./renfe-api.js";
import { sendTelegramMessage } from "./telegram.js";
import { formatConsole, formatTelegram, formatJSON } from "./formatter.js";
import type { SearchConfig, Direction, TripType, TimeRange } from "./types.js";

/** Parsea la configuración desde variables de entorno o argumentos CLI */
function parseConfig(): SearchConfig {
  const fecha = process.env.FECHA;
  if (!fecha) {
    console.error("Error: Variable de entorno FECHA es obligatoria (formato DD/MM/YYYY)");
    console.error("");
    console.error("Variables de entorno:");
    console.error("  FECHA          - Fecha del viaje (DD/MM/YYYY) [obligatorio]");
    console.error("  DIRECCION      - 'ida' (Alcázar→Madrid) o 'vuelta' (Madrid→Alcázar) [default: ida]");
    console.error("  TIPO_VIAJE     - 'solo_ida' o 'ida_vuelta' [default: solo_ida]");
    console.error("  HORA_DESDE     - Hora inicio franja (HH:MM) [opcional]");
    console.error("  HORA_HASTA     - Hora fin franja (HH:MM) [opcional]");
    console.error("  TELEGRAM_BOT_TOKEN - Token del bot de Telegram [opcional]");
    console.error("  TELEGRAM_CHAT_ID   - Chat ID de Telegram [opcional]");
    console.error("  OUTPUT_JSON    - Si 'true', salida en formato JSON [opcional]");
    process.exit(1);
  }

  // Validar formato de fecha
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(fecha)) {
    console.error("Error: FECHA debe tener formato DD/MM/YYYY");
    process.exit(1);
  }

  const direccion = (process.env.DIRECCION || "ida") as Direction;
  if (direccion !== "ida" && direccion !== "vuelta") {
    console.error("Error: DIRECCION debe ser 'ida' o 'vuelta'");
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

  return { fecha, direccion, tipoViaje, franjaHoraria };
}

async function main(): Promise<void> {
  const config = parseConfig();
  const api = new RenfeAPI();

  try {
    const result = await api.searchTrains(config);

    // Salida en consola
    const outputJson = process.env.OUTPUT_JSON === "true";
    if (outputJson) {
      console.log(formatJSON(result));
    } else {
      console.log(formatConsole(result));
    }

    // Notificación por Telegram si hay trenes disponibles
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

    // Código de salida: 0 si hay disponibles, 1 si no
    if (result.trenesDisponibles === 0) {
      process.exitCode = 0; // No es un error, simplemente no hay disponibilidad
    }
  } catch (error) {
    console.error("\nError durante la búsqueda:", error instanceof Error ? error.message : error);
    process.exit(2);
  }
}

main();
