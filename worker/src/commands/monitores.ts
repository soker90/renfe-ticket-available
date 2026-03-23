import type { Env, InlineKeyboardButton, InlineKeyboardMarkup } from "../types.js";
import { RUTAS, KV_PREFIX } from "../types.js";
import { sendMessage, editMessageText } from "../services/telegram.js";
import { getMonitors, getMonitor, getMonitorIndex, saveMonitorIndex, deleteMonitor, saveMonitor } from "../services/monitor.js";
import { buildMonitorDescription } from "./monitor.js";

// ---------------------------------------------------------------------------
// Comando /monitores — listar y gestionar monitorizaciones activas
// ---------------------------------------------------------------------------

/** Helper para responder cuando un monitor no se encuentra */
const monitorNotFound = async (env: Env, chatId: number, messageId?: number): Promise<void> => {
  if (messageId) {
    await editMessageText(env, chatId, messageId, "Monitorización no encontrada o ya eliminada.");
  }
};

export const handleListMonitors = async (env: Env, chatId: number): Promise<void> => {
  const monitors = await getMonitors(env.BOT_SESSIONS, chatId);

  if (monitors.length === 0) {
    await sendMessage(
      env,
      chatId,
      "No tienes monitorizaciones activas.\n\nUsa /monitor para crear una nueva."
    );
    return;
  }

  let msg = `<b>Monitorizaciones activas (${monitors.length})</b>\n`;

  const keyboard: InlineKeyboardButton[][] = [];

  for (const m of monitors) {
    msg += `\n• ${buildMonitorDescription(m)}`;
    keyboard.push([
      { text: `Borrar: ${RUTAS[m.ruta]?.label ?? m.ruta} ${m.fecha}`, callback_data: `mdel:${m.id}` },
    ]);
  }

  if (monitors.length > 1) {
    keyboard.push([{ text: "Borrar todas", callback_data: "mdel_all" }]);
  }

  const replyMarkup: InlineKeyboardMarkup = { inline_keyboard: keyboard };
  await sendMessage(env, chatId, msg, replyMarkup);
};

// --- Callbacks de gestión de monitores (mdel:/mdel_all/mkeep:/mstop:) ---

export const handleMonitoresCallback = async (
  env: Env,
  chatId: number,
  data: string,
  messageId?: number
): Promise<boolean> => {
  // Borrar una monitorización específica
  if (data.startsWith("mdel:")) {
    const monitorId = data.slice("mdel:".length);
    const monitor = await getMonitor(env.BOT_SESSIONS, monitorId);
    if (!monitor) {
      await monitorNotFound(env, chatId, messageId);
      return true;
    }
    await deleteMonitor(env.BOT_SESSIONS, chatId, monitorId);
    const desc = buildMonitorDescription(monitor);
    if (messageId) {
      await editMessageText(env, chatId, messageId, `Monitorización eliminada:\n${desc}`);
    }
    return true;
  }

  // Borrar todas las monitorizaciones
  if (data === "mdel_all") {
    const ids = await getMonitorIndex(env.BOT_SESSIONS, chatId);
    for (const id of ids) {
      await env.BOT_SESSIONS.delete(`${KV_PREFIX.MONITOR}${id}`);
    }
    await saveMonitorIndex(env.BOT_SESSIONS, chatId, []);
    if (messageId) {
      await editMessageText(
        env,
        chatId,
        messageId,
        `${ids.length} monitorización(es) eliminada(s).`
      );
    }
    return true;
  }

  // Seguir buscando (tras notificación de disponibilidad)
  if (data.startsWith("mkeep:")) {
    const monitorId = data.slice("mkeep:".length);
    const monitor = await getMonitor(env.BOT_SESSIONS, monitorId);
    if (!monitor) {
      await monitorNotFound(env, chatId, messageId);
      return true;
    }
    monitor.paused = false;
    await saveMonitor(env.BOT_SESSIONS, monitor);
    if (messageId) {
      await editMessageText(
        env,
        chatId,
        messageId,
        `OK, seguiré buscando.\n\n${buildMonitorDescription(monitor)}`
      );
    }
    return true;
  }

  // Borrar monitorización (tras notificación de disponibilidad)
  if (data.startsWith("mstop:")) {
    const monitorId = data.slice("mstop:".length);
    const monitor = await getMonitor(env.BOT_SESSIONS, monitorId);
    if (!monitor) {
      await monitorNotFound(env, chatId, messageId);
      return true;
    }
    await deleteMonitor(env.BOT_SESSIONS, chatId, monitorId);
    if (messageId) {
      await editMessageText(env, chatId, messageId, "Monitorización eliminada.");
    }
    return true;
  }

  return false;
};
