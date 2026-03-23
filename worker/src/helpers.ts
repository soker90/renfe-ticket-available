import type { InlineKeyboardMarkup, TimeRange } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers de fecha
// ---------------------------------------------------------------------------

const getDiaSemana = (date: Date): string => {
  const dia = date.toLocaleDateString("es-ES", { weekday: "short" });
  const limpio = dia.replace(".", "");
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
};

export const formatDate = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
};

export const formatDateLabel = (date: Date): string => {
  const diaSemana = getDiaSemana(date);
  const dia = String(date.getDate()).padStart(2, "0");
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  return `${diaSemana} ${dia}/${mes}`;
};

/** Resuelve texto libre a DD/MM/YYYY o null si no es válido */
export const resolveDate = (input: string): string | null => {
  const normalized = input.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  if (normalized === "hoy") return formatDate(new Date());
  if (normalized === "manana") {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return formatDate(d);
  }
  if (normalized === "pasado") {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return formatDate(d);
  }

  // DD/MM/YYYY
  const fullMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (fullMatch) {
    const day = fullMatch[1].padStart(2, "0");
    const month = fullMatch[2].padStart(2, "0");
    const year = fullMatch[3];
    const d = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    if (d.getDate() !== parseInt(day)) return null;
    return `${day}/${month}/${year}`;
  }

  // DD/MM (asume año actual o siguiente)
  const shortMatch = input.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (shortMatch) {
    const now = new Date();
    const day = shortMatch[1].padStart(2, "0");
    const month = shortMatch[2].padStart(2, "0");
    let year = now.getFullYear();
    const target = new Date(year, parseInt(month) - 1, parseInt(day));
    if (isNaN(target.getTime()) || target.getDate() !== parseInt(day)) return null;
    if (target < now) year++;
    return `${day}/${month}/${year}`;
  }

  return null;
};

/** Parsea una fecha DD/MM/YYYY a Date (medianoche local) */
export const parseFecha = (fecha: string): Date | null => {
  const m = fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
};

/** Parsea una franja horaria "HH:MM-HH:MM" a TimeRange o null */
export const parseTimeRange = (input: string): TimeRange | null => {
  const match = input.match(/^(\d{2}:\d{2})-(\d{2}:\d{2})$/);
  if (!match) return null;
  return { from: match[1], to: match[2] };
};

// ---------------------------------------------------------------------------
// Teclados inline compartidos
// ---------------------------------------------------------------------------

/** Genera los botones de fecha: próximos 7 días + "Otra fecha" */
export const buildFechaKeyboard = (prefix: string): InlineKeyboardMarkup => {
  const rows: InlineKeyboardMarkup["inline_keyboard"] = [];
  const today = new Date();
  for (let i = 0; i < 7; i += 2) {
    const row: InlineKeyboardMarkup["inline_keyboard"][number] = [];
    for (let j = i; j < Math.min(i + 2, 7); j++) {
      const d = new Date(today);
      d.setDate(today.getDate() + j);
      const value = formatDate(d);
      row.push({ text: formatDateLabel(d), callback_data: `${prefix}:${value}` });
    }
    rows.push(row);
  }
  rows.push([{ text: "Otra fecha...", callback_data: `${prefix}:manual` }]);
  return { inline_keyboard: rows };
};

export const buildRutaKeyboard = (prefix: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Alcázar → Madrid", callback_data: `${prefix}:alcazar-madrid` },
      { text: "Madrid → Alcázar", callback_data: `${prefix}:madrid-alcazar` },
    ],
    [
      { text: "Alcázar → Aranjuez", callback_data: `${prefix}:alcazar-aranjuez` },
      { text: "Aranjuez → Alcázar", callback_data: `${prefix}:aranjuez-alcazar` },
    ],
  ],
});

export const buildFranjaKeyboard = (prefix: string): InlineKeyboardMarkup => ({
  inline_keyboard: [
    [
      { text: "Mañana (06:00-14:00)", callback_data: `${prefix}:06:00-14:00` },
      { text: "Tarde (14:00-22:00)", callback_data: `${prefix}:14:00-22:00` },
    ],
    [
      { text: "Sin filtro", callback_data: `${prefix}:ninguna` },
      { text: "Personalizada...", callback_data: `${prefix}:manual` },
    ],
  ],
});
