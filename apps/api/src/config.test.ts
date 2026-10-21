import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('config', () => {
  it('parses a complete environment', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://u:p@db:5432/cannopy',
      AUTH_SECRET: 'a-long-enough-dev-secret',
      CORS_ORIGINS: 'http://localhost:5173, https://uat.example.com',
      API_PORT: '4000',
    });
    expect(c.API_PORT).toBe(4000);
    expect(c.corsOrigins).toEqual(['http://localhost:5173', 'https://uat.example.com']);
  });

  it('treats empty optional settings as unset, as compose passes them', () => {
    const c = loadConfig({
      DATABASE_URL: 'postgres://u:p@db:5432/cannopy',
      AUTH_SECRET: 'a-long-enough-dev-secret',
      SMS_PROVIDER: 'log',
      SMS_WEBHOOK_URL: '',
      SMS_WEBHOOK_TOKEN: '',
      AUTH_DEV_CODE: '',
    });
    expect(c.SMS_PROVIDER).toBe('log');
    expect(c.SMS_WEBHOOK_URL).toBeUndefined();
    expect(c.AUTH_DEV_CODE).toBeUndefined();
  });

  it('requires a webhook URL for the webhook SMS provider and six digits for a dev code', () => {
    const base = {
      DATABASE_URL: 'postgres://u:p@db:5432/c',
      AUTH_SECRET: 'a-long-enough-dev-secret',
    };
    expect(() => loadConfig({ ...base, SMS_PROVIDER: 'webhook' })).toThrow(/SMS_WEBHOOK_URL/);
    expect(() => loadConfig({ ...base, AUTH_DEV_CODE: '12' })).toThrow(/AUTH_DEV_CODE/);
    expect(
      loadConfig({ ...base, SMS_PROVIDER: 'webhook', SMS_WEBHOOK_URL: 'https://sms.example/send' })
        .SMS_PROVIDER,
    ).toBe('webhook');
  });

  it('fails loudly when a secret is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@db:5432/c' })).toThrow(/AUTH_SECRET/);
  });
});
