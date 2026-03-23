import JSON5 from "json5";
import type { RawTrainData } from "../types.js";

// ---------------------------------------------------------------------------
// Utilidades del protocolo DWR (Direct Web Remoting) de Renfe
// ---------------------------------------------------------------------------

/** Codifica un entero en base-64 usando el charset de DWR */
export const tokenify = (value: number): string => {
  const charmap = "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ*$";
  const tokenbuf: string[] = [];
  let remainder = value;
  while (remainder > 0) {
    tokenbuf.push(charmap[remainder & 0x3f]);
    remainder = Math.floor(remainder / 64);
  }
  return tokenbuf.join("");
};

/** Genera un ID de búsqueda aleatorio: "_" + 4 chars alfanuméricos */
export const createSearchId = (): string => {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "_";
  for (let i = 0; i < 4; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
};

/** Crea el scriptSessionId a partir del token DWR */
export const createScriptSessionId = (dwrToken: string): string => {
  const dateToken = tokenify(Date.now());
  const randomToken = tokenify(Math.floor(Math.random() * 1e16));
  return `${dwrToken}/${dateToken}-${randomToken}`;
};

/** Extrae el token DWR de la respuesta */
export const extractDwrToken = (responseText: string): string => {
  const match = responseText.match(/r\.handleCallback\("[^"]+","[^"]+","([^"]+)"\)/);
  if (!match) {
    throw new Error(`No se pudo extraer el token DWR. Respuesta: ${responseText.substring(0, 200)}`);
  }
  return match[1];
};

/** Extrae la lista de trenes de la respuesta DWR */
export const extractTrainList = (responseText: string): { listadoTrenes?: Array<{ listviajeViewEnlaceBean?: RawTrainData[] }> } => {
  const exceptionMatch = responseText.match(/r\.handleException\([^,]+,\s*[^,]+,\s*(\{.*?\})\);/s);
  if (exceptionMatch) {
    const errorData = JSON5.parse(exceptionMatch[1]);
    throw new Error(`Error de Renfe: ${errorData.message || errorData.localizedMessage || "Error desconocido"}`);
  }

  const match = responseText.match(/r\.handleCallback\([^,]+,\s*[^,]+,\s*(\{.*\})\);/s);
  if (!match) {
    throw new Error(`No se pudo extraer la lista de trenes. Respuesta: ${responseText.substring(0, 500)}`);
  }
  return JSON5.parse(match[1]);
};
