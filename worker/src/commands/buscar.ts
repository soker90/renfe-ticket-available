import type { Env, DispatchParams, RutaKey } from "../types.js";
import { RUTAS, RUTA_ALIASES } from "../types.js";
import { sendMessage } from "../services/telegram.js";
import { triggerGitHubAction } from "../services/github.js";
import { resolveDate, parseTimeRange } from "../helpers.js";
import { startFlow, handleFlowCallback, handleFlowText } from "./flujo.js";
import type { FlowConfig } from "./flujo.js";

// ---------------------------------------------------------------------------
// Comando /buscar — búsqueda puntual (one-liner y flujo guiado)
// ---------------------------------------------------------------------------

// --- Helpers de mensajes ---

const buildConfirmMessage = (params: DispatchParams): string => {
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
};

// --- Lanzar búsqueda y confirmar ---

const launchSearch = async (env: Env, chatId: number, params: DispatchParams): Promise<void> => {
  const triggered = await triggerGitHubAction(env, params);
  if (triggered) {
    await sendMessage(env, chatId, buildConfirmMessage(params));
  } else {
    await sendMessage(
      env,
      chatId,
      "Error al lanzar la búsqueda. Verifica la configuración de GitHub."
    );
  }
};

// --- Validación de ruta ---

const isRutaKey = (key: string): key is RutaKey => key in RUTAS;

// --- One-liner ---

interface OneLinearResult {
  params?: DispatchParams;
  error?: string;
}

const parseOneLiner = (text: string): OneLinearResult => {
  const parts = text.trim().split(/\s+/);

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

  const rutaInput = parts[2].toLowerCase();
  const rutaKey = RUTA_ALIASES[rutaInput] ?? rutaInput;

  if (!isRutaKey(rutaKey)) {
    return {
      error: `Ruta no válida: <code>${parts[2]}</code>\nUsa: ida, vuelta, alcazar-aranjuez, aranjuez-alcazar.`,
    };
  }

  const ruta = RUTAS[rutaKey];

  let horaDesde: string | undefined;
  let horaHasta: string | undefined;

  if (parts[3]) {
    const range = parseTimeRange(parts[3]);
    if (!range) {
      return {
        error: `Franja horaria no válida: <code>${parts[3]}</code>\nFormato esperado: HH:MM-HH:MM (ej: 08:00-14:00)`,
      };
    }
    horaDesde = range.from;
    horaHasta = range.to;
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
};

// --- Configuración del flujo guiado ---

const buscarFlowConfig: FlowConfig = {
  flowId: "buscar",
  callbackPrefix: { ruta: "ruta", fecha: "fecha", franja: "franja" },
  messages: {
    ruta: "Selecciona la ruta:",
    fecha: "Selecciona la fecha:",
    franja: "Selecciona la franja horaria:",
  },
  onComplete: async (env, chatId, result) => {
    const ruta = RUTAS[result.ruta];
    await launchSearch(env, chatId, {
      fecha: result.fecha,
      origen: ruta.origen,
      destino: ruta.destino,
      horaDesde: result.horaDesde,
      horaHasta: result.horaHasta,
    });
  },
};

// --- Comando /buscar (entry point) ---

export const handleBuscar = async (env: Env, chatId: number, args: string): Promise<void> => {
  if (!args) {
    await startFlow(env, chatId, buscarFlowConfig);
    return;
  }

  // Modo one-liner
  const result = parseOneLiner(`/buscar ${args}`);
  if (result.error) {
    await sendMessage(env, chatId, result.error);
    return;
  }

  if (result.params) {
    await launchSearch(env, chatId, result.params);
  }
};

// --- Callbacks del flujo guiado ---

export const handleBuscarCallback = async (
  env: Env,
  chatId: number,
  data: string,
  editMessage: (text: string) => Promise<void>
): Promise<boolean> =>
  handleFlowCallback(env, chatId, data, editMessage, buscarFlowConfig);

// --- Texto libre del flujo guiado ---

export const handleBuscarText = async (
  env: Env,
  chatId: number,
  text: string
): Promise<boolean> =>
  handleFlowText(env, chatId, text, buscarFlowConfig);
