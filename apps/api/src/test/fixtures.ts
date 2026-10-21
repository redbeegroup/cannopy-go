import { randomInt } from 'node:crypto';
import {
  type Account,
  type Contact,
  type Document,
  type DocumentLine,
  type Item,
  newId,
  SYSTEM_ACCOUNT_CODES,
} from '@cannopy/core';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { expect } from 'vitest';

/** A fresh, valid Myanmar number per client so tests never share a user, across worker processes too. */
export function testPhone(): string {
  return `+9597${String(randomInt(0, 10_000_000)).padStart(7, '0')}`;
}

/** Drives the API through app.inject the way the web app does: sign in, then bearer token. */
export class ApiClient {
  userId = '';
  token = '';
  readonly phone: string;
  readonly businessId = newId();
  accounts: Account[] = [];

  constructor(
    private readonly app: FastifyInstance,
    phone?: string,
  ) {
    this.phone = phone ?? testPhone();
  }

  /** Requests a code, reads it back (test environments reveal it) and verifies it. */
  async signIn(deviceId = 'test-device') {
    const res = await this.app.inject({
      method: 'POST',
      url: '/api/auth/request-code',
      payload: { phone: this.phone, language: 'my' },
    });
    expect(res.statusCode, res.body).toBe(200);
    const { devCode } = res.json() as { devCode?: string };
    if (!devCode) throw new Error('Test environment did not reveal the sign-in code');
    const verify = await this.app.inject({
      method: 'POST',
      url: '/api/auth/verify-code',
      payload: { phone: this.phone, code: devCode, deviceId },
    });
    expect(verify.statusCode, verify.body).toBe(200);
    const body = verify.json() as { token: string; user: { id: string }; isNewUser: boolean };
    this.token = body.token;
    this.userId = body.user.id;
    return body;
  }

  async request(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<LightMyRequestResponse> {
    if (!this.token) await this.signIn();
    const opts: InjectOptions = {
      method,
      url: `/api${url}`,
      headers: { authorization: `Bearer ${this.token}` },
    };
    if (payload !== undefined) {
      opts.headers = { ...opts.headers, 'content-type': 'application/json' };
      opts.payload = JSON.stringify(payload);
    }
    return this.app.inject(opts);
  }

  async ok<T = unknown>(
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    payload?: unknown,
  ): Promise<T> {
    const res = await this.request(method, url, payload);
    expect(res.statusCode, `${method} ${url}: ${res.body}`).toBeLessThan(300);
    return res.statusCode === 204 ? (undefined as T) : (res.json() as T);
  }

  async createBusiness(mode: 'cash' | 'accrual' = 'cash') {
    const now = '2026-04-01T00:00:00Z';
    if (!this.token) await this.signIn();
    await this.ok('PUT', '/me', { name: 'Owner' });
    const body = await this.ok<{ accounts: Account[] }>('POST', '/businesses', {
      business: {
        id: this.businessId,
        name: { en: 'Test shop', my: 'စမ်းသပ်ဆိုင်' },
        type: 'shop',
        primaryLanguage: 'my',
        accountingMode: mode,
        createdAt: now,
        updatedAt: now,
      },
    });
    this.accounts = body.accounts;
    return body;
  }

  account(code: string): string {
    const a = this.accounts.find((x) => x.code === code);
    if (!a) throw new Error(`No account ${code}`);
    return a.id;
  }

  get cash() {
    return this.account(SYSTEM_ACCOUNT_CODES.CASH);
  }

  async contact(partial: Partial<Contact> = {}): Promise<Contact> {
    const id = partial.id ?? newId();
    const now = '2026-04-01T00:00:00Z';
    return this.ok<Contact>('PUT', `/businesses/${this.businessId}/contacts/${id}`, {
      businessId: this.businessId,
      name: { en: 'Daw Hla', my: 'ဒေါ်လှ' },
      isCustomer: true,
      isSupplier: true,
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  async item(partial: Partial<Item> = {}): Promise<Item> {
    const id = partial.id ?? newId();
    const now = '2026-04-01T00:00:00Z';
    return this.ok<Item>('PUT', `/businesses/${this.businessId}/items/${id}`, {
      businessId: this.businessId,
      name: { en: 'Rice bag', my: 'ဆန်အိတ်' },
      type: 'stocked',
      createdAt: now,
      updatedAt: now,
      ...partial,
    });
  }

  line(partial: Partial<DocumentLine> & { amount: number }): DocumentLine {
    return {
      id: newId(),
      itemId: null,
      accountId: null,
      description: '',
      quantityMilli: 1000,
      unitPrice: 0,
      taxAmount: 0,
      ...partial,
    };
  }

  documentBody(partial: Partial<Document> & { type: Document['type']; total: number }) {
    const now = `${partial.date ?? '2026-04-10'}T06:00:00Z`;
    return {
      businessId: this.businessId,
      date: '2026-04-10',
      lines: [],
      allocations: [],
      createdByUserId: this.userId,
      deviceId: 'test-device',
      createdAt: now,
      updatedAt: now,
      ...partial,
    };
  }

  async post(partial: Partial<Document> & { type: Document['type']; total: number }) {
    const id = partial.id ?? newId();
    return this.ok<{ document: Document; warnings: unknown[] }>(
      'PUT',
      `/businesses/${this.businessId}/documents/${id}`,
      this.documentBody(partial),
    );
  }

  async report<T>(name: string, query = ''): Promise<T> {
    return this.ok<T>('GET', `/businesses/${this.businessId}/reports/${name}${query}`);
  }
}
