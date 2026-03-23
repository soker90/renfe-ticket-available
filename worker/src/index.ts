/**
 * Cloudflare Worker — Webhook de Telegram para Renfe Ticket Checker
 *
 * Soporta tres modos de interacción:
 *   1. Conversacional: /buscar sin argumentos → flujo guiado con botones inline
 *   2. One-liner:      /buscar <fecha> <ruta> [HH:MM-HH:MM]
 *   3. Monitorización: /monitor → flujo guiado para monitorizar disponibilidad
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
 *                          y monitorizaciones activas (sin TTL)
 *
 * Cron Trigger en wrangler.toml:
 *   Cada 10 minutos     — Comprueba monitorizaciones activas
 */

import type { Env, TelegramUpdate, TelegramCallbackQuery, SearchConfig, Monitor, InlineKeyboardMarkup } from "./types.js";
import { RUTAS, KV_PREFIX } from "./types.js";
import { sendMessage, editMessageText, answerCallbackQuery } from "./services/telegram.js";
import { getSession, deleteSession } from "./services/session.js";
import { getMonitorIndex, getMonitor, saveMonitor, deleteMonitor, saveMonitorIndex } from "./services/monitor.js";
import { getHelpMessage } from "./commands/ayuda.js";
import { handleBuscar, handleBuscarCallback, handleBuscarText } from "./commands/buscar.js";
import { handleMonitor, handleMonitorCallback, handleMonitorText, buildMonitorDescription } from "./commands/monitor.js";
import { handleListMonitors, handleMonitoresCallback } from "./commands/monitores.js";
import { RenfeAPI } from "./renfe-api/index.js";
import { formatTelegram } from "./formatter.js";
import { parseFecha } from "./helpers.js";

// ---------------------------------------------------------------------------
// Manejador de mensajes de texto
// ---------------------------------------------------------------------------

const handleMessage = async (env: Env, chatId: number, text: string): Promise<void> => {
  const normalizedText = text.trim();

  // --- Comandos globales ---
  if (
    normalizedText === "/start" ||
    normalizedText === "/ayuda" ||
    normalizedText === "/help"
  ) {
    await deleteSession(env.BOT_SESSIONS, chatId);
    await sendMessage(env, chatId, getHelpMessage());
    return;
  }

  if (normalizedText === "/cancelar") {
    await deleteSession(env.BOT_SESSIONS, chatId);
    await sendMessage(env, chatId, "Operación cancelada.");
    return;
  }

  // --- Comando /monitor ---
  if (normalizedText === "/monitor") {
    await handleMonitor(env, chatId);
    return;
  }

  // --- Comando /monitores ---
  if (normalizedText === "/monitores") {
    await handleListMonitors(env, chatId);
    return;
  }

  // --- Comando /buscar ---
  if (normalizedText.startsWith("/buscar")) {
    const args = normalizedText.slice("/buscar".length).trim();
    await handleBuscar(env, chatId, args);
    return;
  }

  // --- Texto libre: puede ser respuesta a un paso del flujo conversacional ---
  const session = await getSession(env.BOT_SESSIONS, chatId);

  if (!session) {
    await sendMessage(
      env,
      chatId,
      "Comando no reconocido. Escribe /buscar para iniciar una búsqueda, /monitor para monitorizar, o /ayuda para ver la ayuda."
    );
    return;
  }

  // Intentar flujo de búsqueda
  if (await handleBuscarText(env, chatId, normalizedText)) return;

  // Intentar flujo de monitor
  if (await handleMonitorText(env, chatId, normalizedText)) return;

  // En cualquier otro paso, recordar al usuario qué se espera
  await sendMessage(
    env,
    chatId,
    "Por favor, usa los botones para continuar, o escribe /cancelar para empezar de nuevo."
  );
};

// ---------------------------------------------------------------------------
// Manejador de callback queries (botones inline)
// ---------------------------------------------------------------------------

const handleCallbackQuery = async (env: Env, query: TelegramCallbackQuery): Promise<void> => {
  await answerCallbackQuery(env, query.id);

  const chatId = query.from.id;
  const data = query.data ?? "";
  const messageId = query.message?.message_id;

  // Helper para editar el mensaje del callback
  const editMessage = async (text: string): Promise<void> => {
    if (messageId) {
      await editMessageText(env, chatId, messageId, text);
    }
  };

  // --- Callbacks de gestión de monitores (no requieren sesión) ---
  if (await handleMonitoresCallback(env, chatId, data, messageId)) return;

  // --- Callbacks que requieren sesión ---

  // Flujo de búsqueda
  if (await handleBuscarCallback(env, chatId, data, editMessage)) return;

  // Flujo de monitorización
  if (await handleMonitorCallback(env, chatId, data, editMessage)) return;

  // Sesión expirada
  if (messageId) {
    await editMessageText(
      env,
      chatId,
      messageId,
      "La sesión ha expirado. Escribe /buscar o /monitor para iniciar."
    );
  }
};

// ---------------------------------------------------------------------------
// Handler scheduled() — Cron Trigger para comprobar monitorizaciones
// ---------------------------------------------------------------------------

/** Comprueba si una monitorización ha expirado (fecha pasada) */
const isMonitorExpired = (monitor: Monitor): boolean => {
  const fechaDate = parseFecha(monitor.fecha);
  if (!fechaDate) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return fechaDate < today;
};

/** Notifica que un monitor ha expirado y lo borra */
const handleExpiredMonitor = async (env: Env, chatId: number, monitor: Monitor): Promise<void> => {
  await deleteMonitor(env.BOT_SESSIONS, chatId, monitor.id);
  const desc = buildMonitorDescription(monitor);
  await sendMessage(env, chatId, `La monitorización ha expirado (fecha pasada):\n${desc}`);
};

/** Ejecuta la búsqueda de un monitor y notifica si hay disponibilidad */
const checkMonitor = async (env: Env, chatId: number, monitor: Monitor): Promise<void> => {
  const ruta = RUTAS[monitor.ruta];
  if (!ruta) return;

  const config: SearchConfig = {
    fecha: monitor.fecha,
    origenKey: ruta.origen,
    destinoKey: ruta.destino,
    tipoViaje: "solo_ida",
    franjaHoraria:
      monitor.horaDesde && monitor.horaHasta
        ? { from: monitor.horaDesde, to: monitor.horaHasta }
        : undefined,
  };

  const api = new RenfeAPI();
  const result = await api.searchTrains(config);

  if (result.trenesDisponibles > 0) {
    // Pausar hasta que el usuario responda
    monitor.paused = true;
    monitor.lastNotified = new Date().toISOString();
    await saveMonitor(env.BOT_SESSIONS, monitor);

    const msg = formatTelegram(result);
    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: "Borrar monitorización", callback_data: `mstop:${monitor.id}` },
          { text: "Seguir buscando", callback_data: `mkeep:${monitor.id}` },
        ],
      ],
    };
    await sendMessage(
      env,
      chatId,
      `<b>Plazas disponibles!</b>\n\n${msg}\n\n<i>Monitor: ${buildMonitorDescription(monitor)}</i>`,
      keyboard
    );
  }
};

/** Procesa un monitor individual: expira, salta si pausado, o busca */
const processMonitor = async (env: Env, chatId: number, monitorId: string): Promise<void> => {
  const monitor = await getMonitor(env.BOT_SESSIONS, monitorId);
  if (!monitor) {
    // Limpieza: quitar ID huérfano del índice
    const currentIds = await getMonitorIndex(env.BOT_SESSIONS, chatId);
    await saveMonitorIndex(env.BOT_SESSIONS, chatId, currentIds.filter((id) => id !== monitorId));
    return;
  }

  if (isMonitorExpired(monitor)) {
    await handleExpiredMonitor(env, chatId, monitor);
    return;
  }

  // Si está pausada (esperando respuesta del usuario), no comprobar
  if (monitor.paused) return;

  try {
    await checkMonitor(env, chatId, monitor);
  } catch (error) {
    console.error(`Error comprobando monitor ${monitorId}:`, error);
    // No notificar al usuario de errores transitorios, se reintentará en 10 min
  }
};

const handleScheduled = async (env: Env): Promise<void> => {
  // Buscar todas las claves de índice de monitorizaciones
  const indexList = await env.BOT_SESSIONS.list({ prefix: KV_PREFIX.MONITORS_INDEX });

  for (const key of indexList.keys) {
    // key.name = "monitors:<chatId>"
    const chatId = parseInt(key.name.slice(KV_PREFIX.MONITORS_INDEX.length));
    if (isNaN(chatId)) continue;

    const ids = await getMonitorIndex(env.BOT_SESSIONS, chatId);
    if (ids.length === 0) continue;

    for (const monitorId of ids) {
      await processMonitor(env, chatId, monitorId);
    }
  }
};

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
        await handleCallbackQuery(env, query);
        return new Response("OK", { status: 200 });
      }

      // --- Mensaje de texto ---
      const message = update.message;
      if (!message?.text) {
        return new Response("OK", { status: 200 });
      }

      const chatId = message.chat.id;
      if (String(chatId) !== env.ALLOWED_CHAT_ID) {
        await sendMessage(env, chatId, "No autorizado.");
        return new Response("OK", { status: 200 });
      }

      await handleMessage(env, chatId, message.text);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Error:", error);
      return new Response("Error", { status: 500 });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(env));
  },
};
