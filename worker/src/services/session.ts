import type { Session } from "../types.js";
import { KV_PREFIX } from "../types.js";

// ---------------------------------------------------------------------------
// Servicio de sesiones conversacionales en KV
// ---------------------------------------------------------------------------

const SESSION_TTL = 600; // segundos

export const getSession = async (kv: KVNamespace, chatId: number): Promise<Session | null> => {
  const raw = await kv.get(`${KV_PREFIX.SESSION}${chatId}`);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Session;
  } catch {
    return null;
  }
};

export const saveSession = async (kv: KVNamespace, chatId: number, session: Session): Promise<void> => {
  await kv.put(`${KV_PREFIX.SESSION}${chatId}`, JSON.stringify(session), { expirationTtl: SESSION_TTL });
};

export const deleteSession = async (kv: KVNamespace, chatId: number): Promise<void> => {
  await kv.delete(`${KV_PREFIX.SESSION}${chatId}`);
};
