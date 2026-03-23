import type { RawTrainData, TrainResult, TimeRange } from "../types.js";

// ---------------------------------------------------------------------------
// Parseo y filtrado de resultados de trenes
// ---------------------------------------------------------------------------

/** Determina si un tren tiene plazas disponibles */
export const isTrainAvailable = (train: RawTrainData): boolean => (
  !train.completo &&
  (train.razonNoDisponible === "" || train.razonNoDisponible === "8") &&
  train.tarifaMinima !== null &&
  train.tarifaMinima !== undefined &&
  !train.soloPlazaH
);

/** Parsea el precio de Renfe (formato español: "16,65") a número */
export const parsePrice = (price: unknown): number | null => {
  if (price === null || price === undefined) return null;
  const priceStr = String(price);
  if (priceStr === "NaN" || priceStr === "") return null;
  return parseFloat(priceStr.replace(",", "."));
};

/** Filtra trenes por franja horaria */
export const filterByTimeRange = (trains: TrainResult[], range: TimeRange): TrainResult[] =>
  trains.filter((train) => train.horaSalida >= range.from && train.horaSalida <= range.to);
