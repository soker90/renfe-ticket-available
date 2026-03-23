import type { SearchResult } from "./types.js";

/** Formatea los resultados para Telegram (HTML) */
export const formatTelegram = (result: SearchResult): string => {
  const lines: string[] = [];
  lines.push(`<b>Billetes disponibles Renfe</b>`);
  lines.push(`${result.fecha} | ${result.origen} → ${result.destino}`);
  lines.push("");

  if (result.trenes.length === 0) {
    lines.push("No se encontraron trenes para esta fecha.");
  } else {
    for (const train of result.trenes) {
      const status = train.disponible ? "+" : "-";
      const price = train.precio !== null ? `${train.precio.toFixed(2)}E` : "N/A";
      const duration = `${Math.floor(train.duracionMinutos / 60)}h${String(train.duracionMinutos % 60).padStart(2, "0")}m`;
      let info: string;
      if (train.completo) {
        info = "<i>Tren Completo</i>";
      } else if (!train.disponible) {
        info = `${price} <i>(No disponible)</i>`;
      } else {
        info = `<b>${price}</b>`;
      }
      lines.push(`${status} ${train.horaSalida} → ${train.horaLlegada} | ${train.tipoTren} | ${duration} | ${info}`);
    }
    lines.push("");
    lines.push(
      `${result.totalTrenes} trenes, <b>${result.trenesDisponibles} disponibles</b>`
    );
  }

  return lines.join("\n");
};
