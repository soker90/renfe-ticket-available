import type { Env, Monitor } from "../types.js";
import { RUTAS } from "../types.js";
import { sendMessage } from "../services/telegram.js";
import { createMonitor } from "../services/monitor.js";
import { startFlow, handleFlowCallback, handleFlowText } from "./flujo.js";
import type { FlowConfig } from "./flujo.js";

// ---------------------------------------------------------------------------
// Comando /monitor — crear monitorización con flujo guiado
// ---------------------------------------------------------------------------

// --- Helpers de mensajes ---

export const buildMonitorConfirmMessage = (monitor: Monitor): string => {
  const ruta = RUTAS[monitor.ruta];
  const rutaLabel = ruta?.label ?? monitor.ruta;
  let msg = `<b>Monitorización activada</b>\n\n`;
  msg += `<b>Ruta:</b> ${rutaLabel}\n`;
  msg += `<b>Fecha:</b> ${monitor.fecha}`;
  if (monitor.horaDesde && monitor.horaHasta) {
    msg += `\n<b>Franja:</b> ${monitor.horaDesde} - ${monitor.horaHasta}`;
  }
  msg += `\n\nComprobaré cada 10 minutos y te avisaré si hay plazas disponibles.`;
  msg += `\n<i>ID: ${monitor.id}</i>`;
  return msg;
};

export const buildMonitorDescription = (monitor: Monitor): string => {
  const ruta = RUTAS[monitor.ruta];
  const rutaLabel = ruta?.label ?? monitor.ruta;
  let desc = `${rutaLabel} | ${monitor.fecha}`;
  if (monitor.horaDesde && monitor.horaHasta) {
    desc += ` | ${monitor.horaDesde}-${monitor.horaHasta}`;
  }
  if (monitor.paused) {
    desc += " (pausada)";
  }
  return desc;
};

// --- Configuración del flujo guiado ---

const monitorFlowConfig: FlowConfig = {
  flowId: "monitor",
  callbackPrefix: { ruta: "mruta", fecha: "mfecha", franja: "mfranja" },
  messages: {
    ruta: "Selecciona la ruta a monitorizar:",
    fecha: "Selecciona la fecha a monitorizar:",
    franja: "Selecciona la franja horaria a monitorizar:",
  },
  onComplete: async (env, chatId, result) => {
    const monitor = await createMonitor(
      env.BOT_SESSIONS,
      chatId,
      result.ruta,
      result.fecha,
      result.horaDesde,
      result.horaHasta
    );
    await sendMessage(env, chatId, buildMonitorConfirmMessage(monitor));
  },
};

// --- Comando /monitor (entry point) ---

export const handleMonitor = async (env: Env, chatId: number): Promise<void> => {
  await startFlow(env, chatId, monitorFlowConfig);
};

// --- Callbacks del flujo guiado ---

export const handleMonitorCallback = async (
  env: Env,
  chatId: number,
  data: string,
  editMessage: (text: string) => Promise<void>
): Promise<boolean> =>
  handleFlowCallback(env, chatId, data, editMessage, monitorFlowConfig);

// --- Texto libre del flujo guiado ---

export const handleMonitorText = async (
  env: Env,
  chatId: number,
  text: string
): Promise<boolean> =>
  handleFlowText(env, chatId, text, monitorFlowConfig);
