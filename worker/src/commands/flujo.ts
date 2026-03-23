import type { Env, FlowId, RutaKey, Session } from "../types.js";
import { RUTAS } from "../types.js";
import { sendMessage } from "../services/telegram.js";
import { getSession, saveSession, deleteSession } from "../services/session.js";
import { resolveDate, parseTimeRange, buildRutaKeyboard, buildFechaKeyboard, buildFranjaKeyboard } from "../helpers.js";

// ---------------------------------------------------------------------------
// Flujo guiado genérico — ruta → fecha → franja → acción final
//
// Parametrizado por FlowConfig:
//   - flowId:          identifica el flujo en la sesión
//   - callbackPrefix:  prefijos para los callbacks (ruta/fecha/franja)
//   - messages:        textos de cada pregunta
//   - onComplete:      acción final con los datos recopilados
// ---------------------------------------------------------------------------

export interface FlowResult {
  ruta: RutaKey;
  fecha: string;
  horaDesde?: string;
  horaHasta?: string;
}

export interface FlowConfig {
  flowId: FlowId;
  callbackPrefix: { ruta: string; fecha: string; franja: string };
  messages: { ruta: string; fecha: string; franja: string };
  onComplete: (env: Env, chatId: number, result: FlowResult) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Preguntas del flujo
// ---------------------------------------------------------------------------

const askRuta = async (env: Env, chatId: number, config: FlowConfig): Promise<void> => {
  await sendMessage(env, chatId, config.messages.ruta, buildRutaKeyboard(config.callbackPrefix.ruta));
};

const askFecha = async (env: Env, chatId: number, config: FlowConfig): Promise<void> => {
  await sendMessage(env, chatId, config.messages.fecha, buildFechaKeyboard(config.callbackPrefix.fecha));
};

const askFranja = async (env: Env, chatId: number, config: FlowConfig): Promise<void> => {
  await sendMessage(env, chatId, config.messages.franja, buildFranjaKeyboard(config.callbackPrefix.franja));
};

// ---------------------------------------------------------------------------
// Validación de ruta
// ---------------------------------------------------------------------------

const isRutaKey = (key: string): key is RutaKey => key in RUTAS;

// ---------------------------------------------------------------------------
// Completar flujo con franja
// ---------------------------------------------------------------------------

const completeWithFranja = async (
  env: Env,
  chatId: number,
  session: Session,
  horaDesde?: string,
  horaHasta?: string,
  config?: FlowConfig
): Promise<void> => {
  await deleteSession(env.BOT_SESSIONS, chatId);
  if (!session.ruta || !session.fecha || !config) return;
  await config.onComplete(env, chatId, {
    ruta: session.ruta,
    fecha: session.fecha,
    horaDesde,
    horaHasta,
  });
};

// ---------------------------------------------------------------------------
// Iniciar flujo guiado
// ---------------------------------------------------------------------------

export const startFlow = async (env: Env, chatId: number, config: FlowConfig): Promise<void> => {
  await saveSession(env.BOT_SESSIONS, chatId, { flow: config.flowId, step: "awaiting_ruta" });
  await askRuta(env, chatId, config);
};

// ---------------------------------------------------------------------------
// Manejar callbacks del flujo guiado
// ---------------------------------------------------------------------------

export const handleFlowCallback = async (
  env: Env,
  chatId: number,
  data: string,
  editMessage: (text: string) => Promise<void>,
  config: FlowConfig
): Promise<boolean> => {
  const session = await getSession(env.BOT_SESSIONS, chatId);
  if (!session || session.flow !== config.flowId) return false;

  const { callbackPrefix } = config;

  // Selección de ruta
  if (data.startsWith(`${callbackPrefix.ruta}:`) && session.step === "awaiting_ruta") {
    const rutaKey = data.slice(callbackPrefix.ruta.length + 1);
    if (!isRutaKey(rutaKey)) return true;

    const ruta = RUTAS[rutaKey];
    await editMessage(`<b>Ruta:</b> ${ruta.label}`);
    session.ruta = rutaKey;
    session.step = "awaiting_fecha";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFecha(env, chatId, config);
    return true;
  }

  // Selección de fecha
  if (data.startsWith(`${callbackPrefix.fecha}:`) && session.step === "awaiting_fecha") {
    const valor = data.slice(callbackPrefix.fecha.length + 1);

    if (valor === "manual") {
      await editMessage("Escribe la fecha (DD/MM/YYYY o DD/MM):");
      session.step = "awaiting_fecha_manual";
      await saveSession(env.BOT_SESSIONS, chatId, session);
      return true;
    }

    await editMessage(`<b>Fecha:</b> ${valor}`);
    session.fecha = valor;
    session.step = "awaiting_franja";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFranja(env, chatId, config);
    return true;
  }

  // Selección de franja
  if (data.startsWith(`${callbackPrefix.franja}:`) && session.step === "awaiting_franja") {
    const valor = data.slice(callbackPrefix.franja.length + 1);

    if (valor === "manual") {
      await editMessage("Escribe la franja horaria (HH:MM-HH:MM, ej: 08:00-14:00):");
      session.step = "awaiting_franja_manual";
      await saveSession(env.BOT_SESSIONS, chatId, session);
      return true;
    }

    let horaDesde: string | undefined;
    let horaHasta: string | undefined;

    if (valor !== "ninguna") {
      const range = parseTimeRange(valor);
      if (range) {
        horaDesde = range.from;
        horaHasta = range.to;
      }
    }

    const franjaLabel = valor === "ninguna" ? "Sin filtro" : `${horaDesde} - ${horaHasta}`;
    await editMessage(`<b>Franja:</b> ${franjaLabel}`);

    await completeWithFranja(env, chatId, session, horaDesde, horaHasta, config);
    return true;
  }

  return false;
};

// ---------------------------------------------------------------------------
// Manejar texto libre del flujo guiado (fecha manual, franja manual)
// ---------------------------------------------------------------------------

export const handleFlowText = async (
  env: Env,
  chatId: number,
  text: string,
  config: FlowConfig
): Promise<boolean> => {
  const session = await getSession(env.BOT_SESSIONS, chatId);
  if (!session || session.flow !== config.flowId) return false;

  // Fecha manual
  if (session.step === "awaiting_fecha_manual") {
    const fecha = resolveDate(text);
    if (!fecha) {
      await sendMessage(
        env,
        chatId,
        "Fecha no válida. Usa el formato DD/MM/YYYY, DD/MM, hoy, mañana o pasado."
      );
      return true;
    }
    session.fecha = fecha;
    session.step = "awaiting_franja";
    await saveSession(env.BOT_SESSIONS, chatId, session);
    await askFranja(env, chatId, config);
    return true;
  }

  // Franja manual
  if (session.step === "awaiting_franja_manual") {
    const range = parseTimeRange(text);
    if (!range) {
      await sendMessage(
        env,
        chatId,
        "Franja no válida. Usa el formato HH:MM-HH:MM (ej: 08:00-14:00)."
      );
      return true;
    }
    await completeWithFranja(env, chatId, session, range.from, range.to, config);
    return true;
  }

  return false;
};
