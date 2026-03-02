/** Estación de Renfe */
export interface Station {
  code: string; // ej: "0071,60400,60400"
  name: string; // ej: "ALCÁZAR DE SAN JUAN"
}

/** Clave de estación disponible */
export type StationKey = "ALCAZAR" | "MADRID" | "ARANJUEZ";

/** Dirección del viaje */
export type Direction = "ida" | "vuelta";

/** Tipo de viaje */
export type TripType = "solo_ida" | "ida_vuelta";

/** Franja horaria opcional */
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

/** Resultado de un tren individual */
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
