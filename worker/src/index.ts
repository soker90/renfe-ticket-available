/**
 * Cloudflare Worker — Webhook de Telegram para Renfe Ticket Checker
 *
 * Soporta dos modos de interacción:
 *   1. Conversacional: /buscar sin argumentos → flujo guiado con botones inline
 *   2. One-liner:      /buscar <fecha> <ruta> [HH:MM-HH:MM]
 *
 * Secretos (configurar con `wrangler secret put`):
 *   TELEGRAM_BOT_TOKEN  — Token del bot de Telegram
 *   GITHUB_TOKEN        — PAT con permiso actions:write
 *   ALLOWED_CHAT_ID     — Chat ID autorizado
 *
 * Variables en wrangler.toml:
 *   GITHUB_REPO         — "usuario/repo"
 *   GITHUB_WORKFLOW     — "check-tickets.yml"
 *
 * KV namespace en wrangler.toml:
 *   BOT_SESSIONS        — Estado de sesiones conversacionales (TTL 600s)
 */

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  BOT_SESSIONS: KVNamespace;
}

type Step =
  | "awaiting_ruta"
  | "awaiting_fecha"
  | "awaiting_fecha_manual"
  | "awaiting_franja"
  | "awaiting_franja_manual";

interface Session {
  step: Step;
  ruta?: string;  // "alcazar-madrid" | "madrid-alcazar" | "alcazar-aranjuez" | "aranjuez-alcazar"
  fecha?: string; // DD/MM/YYYY
}

interface TelegramMessage {
  chat: { id: number };
  text?: string;
  from?: { first_name?: string };
  message_id: number;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name?: string };
  message?: TelegramMessage;
  data?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

interface DispatchParams {
  fecha: string;
  origen: string;
  destino: string;
  horaDesde?: string;
  horaHasta?: string;
}

// ---------------------------------------------------------------------------
// Rutas soportadas
// ---------------------------------------------------------------------------

const RUTAS: Record<string, { origen: string; destino: string; label: string }> = {
  "alcazar-madrid": {
    origen: "ALCAZAR",
    destino: "MADRID",
    label: "Alcázar de San Juan → Madrid Atocha",
  },
  "madrid-alcazar": {
    origen: "MADRID",
    destino: "ALCAZAR",
    label: "Madrid Atocha → Alcázar de San Juan",
  },
  "alcazar-aranjuez": {
    origen: "ALCAZAR",
    destino: "ARANJUEZ",
    label: "Alcázar de San Juan → Aranjuez",
  },
  "aranjuez-alcazar": {
    origen: "ARANJUEZ",
    destino: "ALCAZAR",
    label: "Aranjuez → Alcázar de San Juan",
  },
};

// ---------------------------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------------------------

const DIAS_ES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES_ES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatDateLabel(date: Date): string {
  const diaSemana = DIAS_ES[date.getDay()];
  const dia = String(date.getDate()).padStart(2, "0");
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  return `${diaSemana} ${dia}/${mes}`;
}

/** Resuelve texto libre a DD/MM/YYYY o null si no es válido */
function resolveDate(input: string): string | null {
  const normalized = input.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (normalized === "hoy") return formatDate(new Date());
  if (normalized === "manana") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (normalized === "pasado") {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }

  // DD/MM/YYYY
  const fullMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, "0");
    const month = fullMatch[2].padStart(2, "0");
    const year = fullMatch[3];
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (d.getDate() !== parseInt(day)) return null; // fecha inválida
    return `${day}/${month}/${year}`;
  }

  // DD/MM (asume año actual o siguiente)
  const shortMatch = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch) {
    const now = new Date();
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    let year = now.getFullYear();
    const target = new Date(year, parseInt(month) - 1, parseInt(day));
    if (isNaN(target.getTime()) || target.getDate() !== parseInt(day)) return null;
    if (target < now) year++;
    return `${day}/${month}/${year}`;
  }

  return null;
}

/** Genera los botones de fecha: próximos 7 días + "Otra fecha" */
function buildFechaKeyboard(): InlineKeyboardButton[][] {
  const rows: InlineKeyboardButton[][] = [];
  const today = new Date();
  // 2 botones por fila
  for (let i = 0; i < 7; i += 2) {
    const row: InlineKeyboardButton[] = [];
    for (let j = i; j < Math.min(i + 2, 7); j++) {
      const d = new Date(today);
      d.setDate(today.getDate() + j);
      const value = formatDate(d);
      row.push({ text: formatDateLabel(d), callback_data: `fecha:${value}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "Otra fecha...", callback_data: "fecha:manual" }]);
  return rows;
}

// ---------------------------------------------------------------------------
// Telegram API helpers
// ---------------------------------------------------------------------------

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

async function sendMessage(
  token: string,
  chatId: number,
  text: string,
  replyMarkup?: object
): Promise<void> {
  await fetch(TG_API(token, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function editMessageText(
  token: string,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: object
): Promise<void> {
  await fetch(TG_API(token, "editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
}

async function answerCallbackQuery(token: string, callbackQueryId: string): Promise<void> {
  await fetch(TG_API(token, "answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

// ---------------------------------------------------------------------------
// KV — sesión
// ---------------------------------------------------------------------------

const SESSION_TTL = 600; // segundos

async function getSession(kv: KVNamespace, chatId: number): Promise<Session | null> {
  const raw = await kv.get(`session:${chatId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
}

async function saveSession(kv: KVNamespace, chatId: number, session: Session): Promise<void> {
  await kv.put(`session:${chatId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
}

async function deleteSession(kv: KVNamespace, chatId: number): Promise<void> {
  await kv.delete(`session:${chatId}`);
}

// ---------------------------------------------------------------------------
// GitHub Actions dispatch
// ---------------------------------------------------------------------------

async function triggerGitHubAction(env: Env, params: DispatchParams): Promise<boolean> {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/${env.GITHUB_WORKFLOW}/dispatches`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "renfe-telegram-bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: "master",
      inputs: {
        fecha: params.fecha,
        origen: params.origen,
        destino: params.destino,
        hora_desde: params.horaDesde ?? "",
        hora_hasta: params.horaHasta ?? "",
      },
    }),
  });
  return response.status === 204;
}

/** Construye el mensaje de confirmación de búsqueda lanzada */
function buildConfirmMessage(params: DispatchParams): string {
  const ruta = Object.values(RUTAS).find(
    (r) => r.origen === params.origen && r.destino === params.destino
  );
  const rutaLabel = ruta?.label ?? `${params.origen} → ${params.destino}`;
  let msg = `<b>Busqueda lanzada</b>\n\n<b>Ruta:</b> ${rutaLabel}\n<b>Fecha:</b> ${params.fecha}`;
  if (params.horaDesde && params.horaHasta) {
    msg += `\n<b>Franja:</b> ${params.horaDesde} - ${params.horaHasta}`;
  }
  msg += "\n\nTe avisaré si hay plazas disponibles.";
  return msg;
}

// ---------------------------------------------------------------------------
// Mensaje de ayuda
// ---------------------------------------------------------------------------

function getHelpMessage(): string {
  return [
    "<b>Renfe Ticket Checker</b>",
    "",
    "<b>Modo guiado:</b>",
    "Escribe /buscar y sigue los pasos con los botones.",
    "",
    "<b>Modo directo:</b>",
    "<code>/buscar &lt;fecha&gt; &lt;ruta&gt; [HH:MM-HH:MM]</code>",
    "",
    "<b>Rutas disponibles:</b>",
    "• <code>ida</code> — Alcázar → Madrid",
    "• <code>vuelta</code> — Madrid → Alcázar",
    "• <code>alcazar-aranjuez</code> — Alcázar → Aranjuez",
    "• <code>aranjuez-alcazar</code> — Aranjuez → Alcázar",
    "",
    "<b>Fecha:</b> DD/MM/YYYY, DD/MM, hoy, mañana, pasado",
    "",
    "<b>Ejemplos:</b>",
    "<code>/buscar 15/03/2026 ida</code>",
    "<code>/buscar mañana vuelta 08:00-14:00</code>",
    "<code>/buscar 20/03 alcazar-aranjuez 06:00-10:00</code>",
    "",
    "/cancelar — Cancela una búsqueda en curso",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// One-liner: parseo de /buscar con argumentos
// ---------------------------------------------------------------------------

interface OneLinearResult {
  params?: DispatchParams;
  error?: string;
}

function parseOneLiner(text: string): OneLinearResult {
  const parts = text.trim().split(/\s+/);
  // parts[0] = "/buscar", parts[1] = fecha, parts[2] = ruta, parts[3] = franja (opt)

  if (parts.length < 3) {
    return {
      error:
        "Faltan parámetros. Uso: <code>/buscar &lt;fecha&gt; &lt;ruta&gt; [HH:MM-HH:MM]</code>\n\nEscribe /ayuda para más información.",
    };
  }

  const fecha = resolveDate(parts[1]);
  if (!fecha) {
    return {
      error: `Fecha no válida: <code>${parts[1]}</code>\nUsa DD/MM/YYYY, DD/MM, hoy, mañana o pasado.`,
    };
  }

  // Alias de compatibilidad
  const rutaInput = parts[2].toLowerCase();
  const rutaKey =
    rutaInput === "ida"
      ? "alcazar-madrid"
      : rutaInput === "vuelta"
      ? "madrid-alcazar"
      : rutaInput;

  const ruta = RUTAS[rutaKey];
  if (!ruta) {
    return {
      error: `Ruta no válida: <code>${parts[2]}</code>\nUsa: ida, vuelta, alcazar-aranjuez, aranjuez-alcazar.`,
    };
  }

  let horaDesde: string | undefined;
  let horaHasta: string | undefined;

  if (parts[3]) {
    const timeMatch = parts[3].match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!timeMatch) {
      return {
        error: `Franja horaria no válida: <code>${parts[3]}</code>\nFormato esperado: HH:MM-HH:MM (ej: 08:00-14:00)`,
      };
    }
    horaDesde = timeMatch[1];
    horaHasta = timeMatch[2];
  }

  return {
    params: {
      fecha,
      origen: ruta.origen,
      destino: ruta.destino,
      horaDesde,
      horaHasta,
    },
  };
}

// ---------------------------------------------------------------------------
// Flujo conversacional — envío de preguntas con teclados inline
// ---------------------------------------------------------------------------

async function askRuta(token: string, chatId: number): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Alcázar → Madrid", callback_data: "ruta:alcazar-madrid" },
        { text: "Madrid → Alcázar", callback_data: "ruta:madrid-alcazar" },
      ],
      [
        { text: "Alcázar → Aranjuez", callback_data: "ruta:alcazar-aranjuez" },
        { text: "Aranjuez → Alcázar", callback_data: "ruta:aranjuez-alcazar" },
      ],
    ],
  };
  await sendMessage(token, chatId, "Selecciona la ruta:", keyboard);
}

async function askFecha(token: string, chatId: number): Promise<void> {
  await sendMessage(token, chatId, "Selecciona la fecha:", {
    inline_keyboard: buildFechaKeyboard(),
  });
}

async function askFranja(token: string, chatId: number): Promise<void> {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "Mañana (06:00-14:00)", callback_data: "franja:06:00-14:00" },
        { text: "Tarde (14:00-22:00)", callback_data: "franja:14:00-22:00" },
      ],
      [
        { text: "Sin filtro", callback_data: "franja:ninguna" },
        { text: "Personalizada...", callback_data: "franja:manual" },
      ],
    ],
  };
  await sendMessage(token, chatId, "Selecciona la franja horaria:", keyboard);
}

// ---------------------------------------------------------------------------
// Manejador de mensajes de texto
// ---------------------------------------------------------------------------

async function handleMessage(
  token: string,
  env: Env,
  chatId: number,
  text: string
): Promise<void> {
  const normalizedText = text.trim();

  // --- Comandos globales ---
  if (
    normalizedText === "/start" ||
    normalizedText === "/ayuda" ||
    normalizedText === "/help"
  ) {
    await deleteSession(env.BOT_SESSIONS, chatId);
    await sendMessage(token, chatId, getHelpMessage());
    return;
  }

  if (normalizedText === "/cancelar") {
    await deleteSession(env.BOT_SESSIONS, chatId);
    await sendMessage(token, chatId, "Búsqueda cancelada.");
    return;
  }

  // --- Comando /buscar ---
  if (normalizedText.startsWith("/buscar")) {
    const args = normalizedText.slice("/buscar".length).trim();

    if (!args) {
      // Modo conversacional: inicia flujo
      await saveSession(env.BOT_SESSIONS, chatId, { step: "awaiting_ruta" });
      await askRuta(token, chatId);
      return;
    }

    // Modo one-liner
    const result = parseOneLiner(normalizedText);
    if (result.error) {
      await sendMessage(token, chatId, result.error);
      return;
    }

    const triggered = await triggerGitHubAction(env, result.params!);
    if (triggered) {
      await sendMessage(token, chatId, buildConfirmMessage(result.params!));
    } else {
      await sendMessage(
        token,
        chatId,
        "Error al lanzar la búsqueda. Verifica la configuración de GitHub."
      );
    }
    return;
  }

  // --- Texto libre: puede ser respuesta a un paso del flujo conversacional ---
  const session = await getSession(env.BOT_SESSIONS, chatId);

  if (!session) {
    await sendMessage(
      token,
      chatId,
      "Comando no reconocido. Escribe /buscar para iniciar una búsqueda o /ayuda para ver la ayuda."
    );
    return;
  }

  if (session.step === "awaiting_fecha_manual") {
    const fecha = resolveDate(normalizedText);
    if (!fecha) {
      await sendMessage(
        token,
        chatId,
        "Fecha no válida. Usa el formato DD/MM/YYYY, DD/MM, hoy, mañana o pasado."
      );
      return;
    }
    session.fecha = fecha;
    session.step = "awaiting_franja";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFranja(token, chatId);
    return;
  }

  if (session.step === "awaiting_franja_manual") {
    const timeMatch = normalizedText.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
    if (!timeMatch) {
      await sendMessage(
        token,
        chatId,
        "Franja no válida. Usa el formato HH:MM-HH:MM (ej: 08:00-14:00)."
      );
      return;
    }
    const ruta = RUTAS[session.ruta!];
    const params: DispatchParams = {
      fecha: session.fecha!,
      origen: ruta.origen,
      destino: ruta.destino,
      horaDesde: timeMatch[1],
      horaHasta: timeMatch[2],
    };
    await deleteSession(env.BOT_SESSIONS, chatId);
    const triggered = await triggerGitHubAction(env, params);
    if (triggered) {
      await sendMessage(token, chatId, buildConfirmMessage(params));
    } else {
      await sendMessage(
        token,
        chatId,
        "Error al lanzar la búsqueda. Verifica la configuración de GitHub."
      );
    }
    return;
  }

  // En cualquier otro paso, ignorar texto libre y recordar al usuario qué se espera
  await sendMessage(
    token,
    chatId,
    "Por favor, usa los botones para continuar, o escribe /cancelar para empezar de nuevo."
  );
}

// ---------------------------------------------------------------------------
// Manejador de callback queries (botones inline)
// ---------------------------------------------------------------------------

async function handleCallbackQuery(
  token: string,
  env: Env,
  query: TelegramCallbackQuery
): Promise<void> {
  await answerCallbackQuery(token, query.id);

  const chatId = query.from.id;
  const data = query.data ?? "";
  const messageId = query.message?.message_id;

  const session = await getSession(env.BOT_SESSIONS, chatId);
  if (!session) {
    // Sesión expirada
    if (messageId) {
      await editMessageText(
        token,
        chatId,
        messageId,
        "La sesión ha expirado. Escribe /buscar para iniciar una nueva búsqueda."
      );
    }
    return;
  }

  // --- Selección de ruta ---
  if (data.startsWith("ruta:") && session.step === "awaiting_ruta") {
    const rutaKey = data.slice("ruta:".length);
    const ruta = RUTAS[rutaKey];
    if (!ruta) return;

    if (messageId) {
      await editMessageText(
        token,
        chatId,
        messageId,
        `<b>Ruta:</b> ${ruta.label}`
      );
    }

    session.ruta = rutaKey;
    session.step = "awaiting_fecha";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFecha(token, chatId);
    return;
  }

  // --- Selección de fecha ---
  if (data.startsWith("fecha:") && session.step === "awaiting_fecha") {
    const valor = data.slice("fecha:".length);

    if (valor === "manual") {
      if (messageId) {
        await editMessageText(token, chatId, messageId, "Escribe la fecha (DD/MM/YYYY o DD/MM):");
      }
      session.step = "awaiting_fecha_manual";
      await saveSession(env.BOT_SESSIONS, chatId, session);
      return;
    }

    if (messageId) {
      await editMessageText(token, chatId, messageId, `<b>Fecha:</b> ${valor}`);
    }

    session.fecha = valor;
    session.step = "awaiting_franja";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFranja(token, chatId);
    return;
  }

  // --- Selección de franja ---
  if (data.startsWith("franja:") && session.step === "awaiting_franja") {
    const valor = data.slice("franja:".length);

    if (valor === "manual") {
      if (messageId) {
        await editMessageText(
          token,
          chatId,
          messageId,
          "Escribe la franja horaria (HH:MM-HH:MM, ej: 08:00-14:00):"
        );
      }
      session.step = "awaiting_franja_manual";
      await saveSession(env.BOT_SESSIONS, chatId, session);
      return;
    }

    const ruta = RUTAS[session.ruta!];
    let horaDesde: string | undefined;
    let horaHasta: string | undefined;

    if (valor !== "ninguna") {
      const timeMatch = valor.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
      if (timeMatch) {
        horaDesde = timeMatch[1];
        horaHasta = timeMatch[2];
      }
    }

    const franjaLabel =
      valor === "ninguna"
        ? "Sin filtro"
        : `${horaDesde} - ${horaHasta}`;

    if (messageId) {
      await editMessageText(token, chatId, messageId, `<b>Franja:</b> ${franjaLabel}`);
    }

    const params: DispatchParams = {
      fecha: session.fecha!,
      origen: ruta.origen,
      destino: ruta.destino,
      horaDesde,
      horaHasta,
    };

    await deleteSession(env.BOT_SESSIONS, chatId);
    const triggered = await triggerGitHubAction(env, params);
    if (triggered) {
      await sendMessage(token, chatId, buildConfirmMessage(params));
    } else {
      await sendMessage(
        token,
        chatId,
        "Error al lanzar la búsqueda. Verifica la configuración de GitHub."
      );
    }
    return;
  }
}

// ---------------------------------------------------------------------------
// Handler principal del Worker
// ---------------------------------------------------------------------------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update: TelegramUpdate = await request.json();

      // --- Callback query (botones inline) ---
      if (update.callback_query) {
        const query = update.callback_query;
        if (String(query.from.id) !== env.ALLOWED_CHAT_ID) {
          return new Response("OK", { status: 200 });
        }
        await handleCallbackQuery(env.TELEGRAM_BOT_TOKEN, env, query);
        return new Response("OK", { status: 200 });
      }

      // --- Mensaje de texto ---
      const message = update.message;
      if (!message?.text) {
        return new Response("OK", { status: 200 });
      }

      const chatId = message.chat.id;
      if (String(chatId) !== env.ALLOWED_CHAT_ID) {
        await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, "No autorizado.");
        return new Response("OK", { status: 200 });
      }

      await handleMessage(env.TELEGRAM_BOT_TOKEN, env, chatId, message.text);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error:", error);
      return new Response("Error", { status: 500 });
    }
  },
};
