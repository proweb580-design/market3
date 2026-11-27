/**
 * Minimal Telegram Bot API client (https://core.telegram.org/bots/api) — only the methods we use.
 * Injected by token so tests replace the network layer.
 */
export const BOT_API = Symbol('BOT_API');

export interface BotApi {
  getMe(token: string): Promise<{ id: number; username: string; first_name: string }>;
  setWebhook(token: string, url: string, secretToken: string, allowedUpdates?: string[]): Promise<void>;
  deleteWebhook(token: string): Promise<void>;
  setChatMenuButton(token: string, text: string, webAppUrl: string): Promise<void>;
  sendMessage(token: string, chatId: number, text: string, button?: { text: string; webAppUrl: string }): Promise<void>;
  /** A photo (by HTTPS URL) with an HTML caption and rows of Mini App buttons. */
  sendPhoto(token: string, chatId: number, photoUrl: string, caption: string, rows: WebAppButton[][]): Promise<void>;
  /** What an empty chat shows before /start, the bot's profile line, and its command menu. */
  describeBot(token: string, info: { shortDescription: string; description: string; commands: { command: string; description: string }[] }): Promise<void>;
  /** A message with one row of callback buttons; returns its message_id. */
  sendButtons(token: string, chatId: number, text: string, buttons: CallbackButton[]): Promise<number>;
  editButtons(token: string, chatId: number, messageId: number, text: string, buttons: CallbackButton[]): Promise<void>;
  answerCallback(token: string, callbackQueryId: string, text?: string): Promise<void>;
}

export interface WebAppButton {
  text: string;
  webAppUrl: string;
}

export interface CallbackButton {
  text: string;
  /** callback_data, at most 64 bytes. */
  data: string;
}

const keyboard = (buttons: CallbackButton[]) => ({ inline_keyboard: buttons.length ? [buttons.map((b) => ({ text: b.text, callback_data: b.data }))] : [] });

export class BotApiError extends Error {}

export class HttpBotApi implements BotApi {
  private async call<T>(token: string, method: string, body: object = {}): Promise<T> {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok: boolean; result?: T; description?: string } | null;
    // Never include the token (it is in the URL) in errors or logs.
    if (!json?.ok) throw new BotApiError(`Telegram ${method} failed: ${json?.description ?? res.status}`);
    return json.result as T;
  }

  getMe(token: string) {
    return this.call<{ id: number; username: string; first_name: string }>(token, 'getMe');
  }

  async setWebhook(token: string, url: string, secretToken: string, allowedUpdates = ['message']) {
    await this.call(token, 'setWebhook', { url, secret_token: secretToken, allowed_updates: allowedUpdates, drop_pending_updates: true });
  }

  async deleteWebhook(token: string) {
    await this.call(token, 'deleteWebhook', { drop_pending_updates: true });
  }

  async setChatMenuButton(token: string, text: string, webAppUrl: string) {
    await this.call(token, 'setChatMenuButton', { menu_button: { type: 'web_app', text, web_app: { url: webAppUrl } } });
  }

  async sendMessage(token: string, chatId: number, text: string, button?: { text: string; webAppUrl: string }) {
    await this.call(token, 'sendMessage', {
      chat_id: chatId,
      text,
      ...(button ? { reply_markup: { inline_keyboard: [[{ text: button.text, web_app: { url: button.webAppUrl } }]] } } : {}),
    });
  }

  async sendPhoto(token: string, chatId: number, photoUrl: string, caption: string, rows: WebAppButton[][]) {
    await this.call(token, 'sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows.map((r) => r.map((b) => ({ text: b.text, web_app: { url: b.webAppUrl } }))) },
    });
  }

  async describeBot(token: string, info: { shortDescription: string; description: string; commands: { command: string; description: string }[] }) {
    await this.call(token, 'setMyShortDescription', { short_description: info.shortDescription.slice(0, 120) });
    await this.call(token, 'setMyDescription', { description: info.description.slice(0, 512) });
    await this.call(token, 'setMyCommands', { commands: info.commands });
  }

  async sendButtons(token: string, chatId: number, text: string, buttons: CallbackButton[]) {
    const sent = await this.call<{ message_id: number }>(token, 'sendMessage', { chat_id: chatId, text, reply_markup: keyboard(buttons) });
    return sent.message_id;
  }

  async editButtons(token: string, chatId: number, messageId: number, text: string, buttons: CallbackButton[]) {
    await this.call(token, 'editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: keyboard(buttons) });
  }

  async answerCallback(token: string, callbackQueryId: string, text?: string) {
    await this.call(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, ...(text ? { text } : {}) });
  }
}
