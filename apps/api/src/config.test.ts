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

  it('fails loudly when a secret is missing', () => {
    expect(() => loadConfig({ DATABASE_URL: 'postgres://u:p@db:5432/c' })).toThrow(/AUTH_SECRET/);
  });
});
