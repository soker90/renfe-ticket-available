import type { Monitor, RutaKey } from "../types.js";
import { KV_PREFIX } from "../types.js";

// ---------------------------------------------------------------------------
// Servicio de monitorizaciones en KV
// ---------------------------------------------------------------------------

/** Obtiene la lista de IDs de monitorizaciones de un chat */
export const getMonitorIndex = async (kv: KVNamespace, chatId: number): Promise<string[]> => {
  const raw = await kv.get(`${KV_PREFIX.MONITORS_INDEX}${chatId}`);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
};

/** Guarda la lista de IDs de monitorizaciones de un chat */
export const saveMonitorIndex = async (kv: KVNamespace, chatId: number, ids: string[]): Promise<void> => {
  if (ids.length === 0) {
    await kv.delete(`${KV_PREFIX.MONITORS_INDEX}${chatId}`);
  } else {
    await kv.put(`${KV_PREFIX.MONITORS_INDEX}${chatId}`, JSON.stringify(ids));
  }
};

/** Obtiene una monitorización por su ID */
export const getMonitor = async (kv: KVNamespace, id: string): Promise<Monitor | null> => {
  const raw = await kv.get(`${KV_PREFIX.MONITOR}${id}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Monitor;
  } catch {
    return null;
  }
};

/** Guarda una monitorización */
export const saveMonitor = async (kv: KVNamespace, monitor: Monitor): Promise<void> => {
  await kv.put(`${KV_PREFIX.MONITOR}${monitor.id}`, JSON.stringify(monitor));
};

/** Borra una monitorización y la quita del índice */
export const deleteMonitor = async (kv: KVNamespace, chatId: number, monitorId: string): Promise<void> => {
  await kv.delete(`${KV_PREFIX.MONITOR}${monitorId}`);
  const ids = await getMonitorIndex(kv, chatId);
  const filtered = ids.filter((id) => id !== monitorId);
  await saveMonitorIndex(kv, chatId, filtered);
};

/** Crea y guarda una nueva monitorización */
export const createMonitor = async (
  kv: KVNamespace,
  chatId: number,
  ruta: RutaKey,
  fecha: string,
  horaDesde?: string,
  horaHasta?: string
): Promise<Monitor> => {
  const monitor: Monitor = {
    id: crypto.randomUUID().slice(0, 8),
    chatId,
    ruta,
    fecha,
    horaDesde,
    horaHasta,
    createdAt: new Date().toISOString(),
    paused: false,
  };
  await saveMonitor(kv, monitor);
  const ids = await getMonitorIndex(kv, chatId);
  ids.push(monitor.id);
  await saveMonitorIndex(kv, chatId, ids);
  return monitor;
};

/** Obtiene todas las monitorizaciones activas de un chat */
export const getMonitors = async (kv: KVNamespace, chatId: number): Promise<Monitor[]> => {
  const ids = await getMonitorIndex(kv, chatId);
  const monitors: Monitor[] = [];
  for (const id of ids) {
    const m = await getMonitor(kv, id);
    if (m) monitors.push(m);
  }
  return monitors;
};
