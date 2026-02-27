import type { SearchResult, TrainResult } from "./types.js";

/** Formatea un tren individual para consola (colores ANSI) */
function formatTrainConsole(train: TrainResult): string {
  const green = "\x1b[32m";
  const red = "\x1b[31m";
  const dim = "\x1b[2m";
  const reset = "\x1b[0m";

  const price = train.precio !== null ? `${train.precio.toFixed(2)}€` : "N/A";
  const duration = `${Math.floor(train.duracionMinutos / 60)}h${String(train.duracionMinutos % 60).padStart(2, "0")}m`;

  let status: string;
  let info: string;
  if (train.completo) {
    status = `${red}[X]${reset}`;
    info = `${dim}Tren Completo${reset}`;
  } else if (!train.disponible) {
    status = `${red}[X]${reset}`;
    info = `${dim}${price} (No disponible)${reset}`;
  } else {
    status = `${green}[✓]${reset}`;
    info = `${green}${price}${reset}`;
  }

  return `${status} ${train.horaSalida} → ${train.horaLlegada} | ${train.tipoTren.padEnd(9)} | ${duration} | ${info}`;
}

/** Formatea los resultados como tabla en consola */
export function formatConsole(result: SearchResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`  Billetes Renfe - ${result.fecha}`);
  lines.push(`  ${result.origen} → ${result.destino}`);
  lines.push("  " + "─".repeat(60));

  if (result.trenes.length === 0) {
    lines.push("  No se encontraron trenes para esta fecha.");
  } else {
    for (const train of result.trenes) {
      lines.push("  " + formatTrainConsole(train));
    }
    lines.push("  " + "─".repeat(60));
    lines.push(
      `  ${result.totalTrenes} trenes encontrados, ${result.trenesDisponibles} con plazas disponibles`
    );
  }

  lines.push("");
  return lines.join("\n");
}

/** Formatea los resultados para Telegram (HTML) */
export function formatTelegram(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(`🚂 <b>Billetes disponibles Renfe</b>`);
  lines.push(`📅 ${result.fecha} | ${result.origen} → ${result.destino}`);
  lines.push("");

  if (result.trenes.length === 0) {
    lines.push("No se encontraron trenes para esta fecha.");
  } else {
    for (const train of result.trenes) {
      const status = train.disponible ? "✅" : "❌";
      const price = train.precio !== null ? `${train.precio.toFixed(2)}€` : "N/A";
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
      `📊 ${result.totalTrenes} trenes, <b>${result.trenesDisponibles} disponibles</b>`
    );
  }

  return lines.join("\n");
}

/** Formatea el resultado como JSON */
export function formatJSON(result: SearchResult): string {
  return JSON.stringify(result, null, 2);
}
