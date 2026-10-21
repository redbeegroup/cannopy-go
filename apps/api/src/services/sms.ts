import type { FastifyBaseLogger } from 'fastify';
import type { Config } from '../config.js';

/**
 * The seam between sign-in and whatever delivers text messages. Sign-in only
 * ever calls `send`; the provider is picked from SMS_PROVIDER at start.
 *
 * - `log`: the message is written to the API log. This is how UAT runs until
 *   an SMS gateway is chosen: the code is read from the container log in
 *   Portainer (or AUTH_DEV_CODE fixes the code for testing on a phone).
 * - `webhook`: POST `{ to, text, language }` as JSON to SMS_WEBHOOK_URL with an
 *   optional bearer token. Any gateway that can take an HTTP call works: an
 *   n8n flow, a local SMS provider's API, a phone running an SMS gateway app.
 *
 * A real provider later (Twilio, a Myanmar operator's API) is one more case
 * here and nothing else changes.
 */
export interface SmsMessage {
  to: string;
  text: string;
  language: 'en' | 'my';
}

export interface SmsSender {
  readonly kind: string;
  send(message: SmsMessage): Promise<void>;
}

export function createSmsSender(
  config: Pick<Config, 'SMS_PROVIDER' | 'SMS_WEBHOOK_URL' | 'SMS_WEBHOOK_TOKEN'>,
  log: FastifyBaseLogger,
): SmsSender {
  if (config.SMS_PROVIDER === 'webhook') {
    const url = config.SMS_WEBHOOK_URL;
    if (!url) throw new Error('SMS_WEBHOOK_URL is required when SMS_PROVIDER=webhook');
    return webhookSender(url, config.SMS_WEBHOOK_TOKEN, log);
  }
  return logSender(log);
}

export function logSender(log: FastifyBaseLogger): SmsSender {
  return {
    kind: 'log',
    async send(message) {
      log.info({ sms: message }, `SMS to ${message.to}: ${message.text}`);
    },
  };
}

export function webhookSender(
  url: string,
  token: string | undefined,
  log: FastifyBaseLogger,
): SmsSender {
  return {
    kind: 'webhook',
    async send(message) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (token) headers.authorization = `Bearer ${token}`;
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.error({ status: res.status, to: message.to }, 'SMS webhook refused the message');
        throw new Error(`SMS webhook answered ${res.status}`);
      }
    },
  };
}

/** A sender for tests that remembers what it was asked to send. */
export function memorySender(): SmsSender & { sent: SmsMessage[] } {
  const sent: SmsMessage[] = [];
  return {
    kind: 'memory',
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
