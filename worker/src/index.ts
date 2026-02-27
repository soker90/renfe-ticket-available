/**
 * Cloudflare Worker - Webhook de Telegram para Renfe Ticket Checker
 *
 * Recibe comandos de Telegram y dispara GitHub Actions para buscar trenes.
 *
 * Secretos necesarios (configurar con `wrangler secret put`):
 *   - TELEGRAM_BOT_TOKEN: Token del bot de Telegram
 *   - GITHUB_TOKEN: Personal Access Token con permisos actions:write
 *   - ALLOWED_CHAT_ID: Chat ID permitido (seguridad)
 *
 * Variables (en wrangler.toml):
 *   - GITHUB_REPO: "usuario/repo"
 *   - GITHUB_WORKFLOW: "check-tickets.yml"
 */

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
}

interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
    from?: { first_name?: string };
  };
}

interface ParsedCommand {
  fecha: string;
  direccion: "ida" | "vuelta";
  horaDesde?: string;
  horaHasta?: string;
}

/** Envía un mensaje de respuesta a Telegram */
async function sendTelegram(token: string, chatId: number, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
    }),
  });
}

/** Resuelve "hoy", "mañana", "pasado" a DD/MM/YYYY */
function resolveDate(input: string): string | null {
  const dateMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, "0");
    const month = dateMatch[2].padStart(2, "0");
    return `${day}/${month}/${dateMatch[3]}`;
  }

  // Formato sin año: DD/MM → asume año actual o siguiente
  const shortMatch = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch) {
    const now = new Date();
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    let year = now.getFullYear();
    const target = new Date(year, parseInt(month) - 1, parseInt(day));
    if (target < now) {
      year++;
    }
    return `${day}/${month}/${year}`;
  }

  const today = new Date();
  const normalizedInput = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (normalizedInput === "hoy") {
    return formatDate(today);
  }
  if (normalizedInput === "manana" || normalizedInput === "mañana") {
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return formatDate(tomorrow);
  }
  if (normalizedInput === "pasado") {
    const dayAfter = new Date(today);
    dayAfter.setDate(dayAfter.getDate() + 2);
    return formatDate(dayAfter);
  }

  return null;
}

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

/** Parsea el comando /buscar */
function parseCommand(text: string): ParsedCommand | string {
  // /buscar <fecha> <ida|vuelta> [HH:MM-HH:MM]
  const parts = text.trim().split(/\s+/);

  if (parts.length < 3) {
    return "Formato: /buscar <fecha> <ida|vuelta> [HH:MM-HH:MM]\n\nEjemplos:\n/buscar 15/03/2026 ida\n/buscar mañana vuelta 08:00-14:00\n/buscar 20/03 ida 06:00-10:00";
  }

  const fechaInput = parts[1];
  const fecha = resolveDate(fechaInput);
  if (!fecha) {
    return `Fecha no válida: "${fechaInput}"\nUsa: DD/MM/YYYY, DD/MM, hoy, mañana, pasado`;
  }

  const dir = parts[2].toLowerCase();
  if (dir !== "ida" && dir !== "vuelta") {
    return `Dirección no válida: "${parts[2]}"\nUsa: ida (Alcázar→Madrid) o vuelta (Madrid→Alcázar)`;
  }

  const result: ParsedCommand = { fecha, direccion: dir };

  // Parsear franja horaria opcional
  if (parts[3]) {
    const timeMatch = parts[3].match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!timeMatch) {
      return `Franja horaria no válida: "${parts[3]}"\nFormato: HH:MM-HH:MM (ej: 08:00-14:00)`;
    }
    result.horaDesde = timeMatch[1];
    result.horaHasta = timeMatch[2];
  }

  return result;
}

/** Dispara la GitHub Action */
async function triggerGitHubAction(env: Env, command: ParsedCommand): Promise<boolean> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "renfe-telegram-bot",
    },
    body: JSON.stringify({
      ref: "master",
      inputs: {
        fecha: command.fecha,
        direccion: command.direccion,
        tipo_viaje: "solo_ida",
        hora_desde: command.horaDesde || "",
        hora_hasta: command.horaHasta || "",
      },
    }),
  });

  return response.status === 204;
}

/** Genera el mensaje de ayuda */
function getHelpMessage(): string {
  return [
    "<b>🚂 Renfe Ticket Checker</b>",
    "",
    "<b>Comandos:</b>",
    "/buscar &lt;fecha&gt; &lt;ida|vuelta&gt; [HH:MM-HH:MM]",
    "",
    "<b>Parámetros:</b>",
    "• <b>fecha</b>: DD/MM/YYYY, DD/MM, hoy, mañana, pasado",
    "• <b>dirección</b>: ida (Alcázar→Madrid) o vuelta (Madrid→Alcázar)",
    "• <b>franja</b>: HH:MM-HH:MM (opcional)",
    "",
    "<b>Ejemplos:</b>",
    "/buscar 15/03/2026 ida",
    "/buscar mañana vuelta 08:00-14:00",
    "/buscar 20/03 ida 06:00-10:00",
    "",
    "El bot buscará los trenes disponibles y te enviará los resultados.",
  ].join("\n");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update: TelegramUpdate = await request.json();
      const message = update.message;

      if (!message?.text) {
        return new Response("OK", { status: 200 });
      }

      const chatId = message.chat.id;

      // Verificar que el chat está autorizado
      if (String(chatId) !== env.ALLOWED_CHAT_ID) {
        await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, "No autorizado.");
        return new Response("OK", { status: 200 });
      }

      const text = message.text.trim();

      // Comando /ayuda o /start o /help
      if (text === "/ayuda" || text === "/start" || text === "/help") {
        await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, getHelpMessage());
        return new Response("OK", { status: 200 });
      }

      // Comando /buscar
      if (text.startsWith("/buscar")) {
        const result = parseCommand(text);

        if (typeof result === "string") {
          // Error de validación
          await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, result);
          return new Response("OK", { status: 200 });
        }

        // Disparar GitHub Action
        const triggered = await triggerGitHubAction(env, result);

        if (triggered) {
          const dirLabel =
            result.direccion === "ida"
              ? "Alcázar de San Juan → Madrid"
              : "Madrid → Alcázar de San Juan";
          let msg = `🔍 <b>Búsqueda lanzada</b>\n\n📅 ${result.fecha}\n🚂 ${dirLabel}`;
          if (result.horaDesde && result.horaHasta) {
            msg += `\n🕐 ${result.horaDesde} - ${result.horaHasta}`;
          }
          msg += "\n\nTe enviaré los resultados en unos segundos...";
          await sendTelegram(env.TELEGRAM_BOT_TOKEN, chatId, msg);
        } else {
          await sendTelegram(
            env.TELEGRAM_BOT_TOKEN,
            chatId,
            "❌ Error al lanzar la búsqueda. Verifica la configuración de GitHub."
          );
        }

        return new Response("OK", { status: 200 });
      }

      // Comando no reconocido
      await sendTelegram(
        env.TELEGRAM_BOT_TOKEN,
        chatId,
        "Comando no reconocido. Usa /ayuda para ver los comandos disponibles."
      );

      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error:", error);
      return new Response("Error", { status: 500 });
    }
  },
};
