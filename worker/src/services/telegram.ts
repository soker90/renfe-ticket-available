import type { Env, InlineKeyboardMarkup } from "../types.js";

// ---------------------------------------------------------------------------
// Servicio de Telegram — envío de mensajes y respuestas a callbacks
// ---------------------------------------------------------------------------

const TG_API = (token: string, method: string) =>
  `https://api.telegram.org/bot${token}/${method}`;

export const sendMessage = async (
  env: Env,
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> => {
  const resp = await fetch(TG_API(env.TELEGRAM_BOT_TOKEN, "sendMessage"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  await resp.text();
};

export const editMessageText = async (
  env: Env,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup
): Promise<void> => {
  const resp = await fetch(TG_API(env.TELEGRAM_BOT_TOKEN, "editMessageText"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      parse_mode: "HTML",
      ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    }),
  });
  await resp.text();
};

export const answerCallbackQuery = async (env: Env, callbackQueryId: string): Promise<void> => {
  const resp = await fetch(TG_API(env.TELEGRAM_BOT_TOKEN, "answerCallbackQuery"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
  await resp.text();
};
