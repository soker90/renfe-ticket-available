// ---------------------------------------------------------------------------
// Tipos de la API de Renfe
// ---------------------------------------------------------------------------

/** Estación de Renfe */
export interface Station {
  code: string; // ej: "0071,60400,60400"
  name: string; // ej: "ALCÁZAR DE SAN JUAN"
}

/** Clave de estación disponible */
export type StationKey = "ALCAZAR" | "MADRID" | "ARANJUEZ";

/** Tipo de viaje */
export type TripType = "solo_ida" | "ida_vuelta";

/** Franja horaria */
export interface TimeRange {
  from: string; // HH:MM
  to: string; // HH:MM
}

/** Configuración de búsqueda */
export interface SearchConfig {
  fecha: string; // DD/MM/YYYY
  origenKey: StationKey;
  destinoKey: StationKey;
  tipoViaje: TripType;
  franjaHoraria?: TimeRange;
}

/** Datos crudos de un tren tal como llegan de la API de Renfe (DWR) */
export interface RawTrainData {
  horaSalida?: string;
  horaLlegada?: string;
  duracionViajeTotalEnMinutos?: number;
  tipoTrenUno?: string;
  tarifaMinima?: string | null;
  completo?: boolean;
  razonNoDisponible?: string;
  soloPlazaH?: boolean;
}

/** Resultado de un tren individual (parseado) */
export interface TrainResult {
  horaSalida: string;
  horaLlegada: string;
  duracionMinutos: number;
  tipoTren: string;
  precio: number | null;
  disponible: boolean;
  completo: boolean;
}

/** Resultado de la búsqueda completa */
export interface SearchResult {
  origen: string;
  destino: string;
  fecha: string;
  trenes: TrainResult[];
  trenesDisponibles: number;
  totalTrenes: number;
}

/** Estaciones predefinidas */
export const STATIONS: Record<StationKey, Station> = {
  ALCAZAR: {
    code: "0071,60400,60400",
    name: "ALCÁZAR DE SAN JUAN",
  },
  MADRID: {
    code: "0071,18000,18000",
    name: "MADRID - ATOCHA CERCANÍAS",
  },
  ARANJUEZ: {
    code: "0071,10300,10300",
    name: "ARANJUEZ",
  },
};

// ---------------------------------------------------------------------------
// Tipos del Worker / Bot de Telegram
// ---------------------------------------------------------------------------

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  ALLOWED_CHAT_ID: string;
  GITHUB_REPO: string;
  GITHUB_WORKFLOW: string;
  BOT_SESSIONS: KVNamespace;
}

/** Identificador del flujo activo */
export type FlowId = "buscar" | "monitor";

export type Step =
  | "awaiting_ruta"
  | "awaiting_fecha"
  | "awaiting_fecha_manual"
  | "awaiting_franja"
  | "awaiting_franja_manual";

export interface Session {
  flow: FlowId;
  step: Step;
  ruta?: RutaKey;
  fecha?: string; // DD/MM/YYYY
}

export interface Monitor {
  id: string;
  chatId: number;
  ruta: RutaKey;
  fecha: string;          // DD/MM/YYYY
  horaDesde?: string;     // HH:MM
  horaHasta?: string;     // HH:MM
  createdAt: string;      // ISO timestamp
  lastNotified?: string;  // ISO timestamp de la última notificación con plazas
  paused: boolean;        // true cuando se notificó y espera respuesta del usuario
}

export interface TelegramMessage {
  chat: { id: number };
  text?: string;
  from?: { first_name?: string };
  message_id: number;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number; first_name?: string };
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface InlineKeyboardButton {
  text: string;
  callback_data: string;
}

export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface DispatchParams {
  fecha: string;
  origen: StationKey;
  destino: StationKey;
  horaDesde?: string;
  horaHasta?: string;
}

// ---------------------------------------------------------------------------
// Rutas soportadas
// ---------------------------------------------------------------------------

/** Clave de ruta disponible */
export type RutaKey = "alcazar-madrid" | "madrid-alcazar" | "alcazar-aranjuez" | "aranjuez-alcazar";

/** Aliases de ruta para el modo one-liner */
export const RUTA_ALIASES: Record<string, RutaKey> = {
  ida: "alcazar-madrid",
  vuelta: "madrid-alcazar",
};

export interface RutaInfo {
  origen: StationKey;
  destino: StationKey;
  label: string;
}

export const RUTAS: Record<RutaKey, RutaInfo> = {
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
// Constantes de KV
// ---------------------------------------------------------------------------

export const KV_PREFIX = {
  SESSION: "session:",
  MONITORS_INDEX: "monitors:",
  MONITOR: "monitor:",
} as const;

// ---------------------------------------------------------------------------
// Constantes de GitHub
// ---------------------------------------------------------------------------

export const GITHUB_DEFAULT_REF = "master";
