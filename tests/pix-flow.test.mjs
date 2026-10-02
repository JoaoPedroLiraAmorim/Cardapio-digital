// Run in a review checkout containing both Pix branches; no real network/payment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
import { createWorker } from '../server/worker.js';
import * as mercadoPago from '../server/mercado-pago.js';

const require = createRequire(import.meta.url);
const { createClient } = require('../pix.js');
const orderMessage = require('../pedido.js');
const origin = 'https://jg-hamburgueria.web.app';
const api = 'https://pix.example.workers.dev';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0hkAAAAASUVORK5CYII=';

class D1 {
  constructor() {
    this.db = new DatabaseSync(':memory:');
    this.db.exec(readFileSync(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let params = [];
    const query = {
      bind(...values) { params = values; return query; },
      async first() { return statement.get(...params) || null; },
      async all() { return { results: statement.all(...params) }; },
      async run() { return { meta: { changes: statement.run(...params).changes } }; },
    };
    return query;
  }
  async batch(queries) {
    this.db.exec('BEGIN');
    try {
      const results = [];
      for (const query of queries) results.push(await query.run());
      this.db.exec('COMMIT'); return results;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

function fixture({ loseClientResponse = false, loseProviderResponse = false, collector = 123 } = {}) {
  const env = {
    DB: new D1(), PIX_ENABLED: 'true', PRINT_SERVICE_ENABLED: 'true', MP_ACCESS_TOKEN: 'test-only-token',
    MP_WEBHOOK_SECRET: 'test-only-webhook', RATE_LIMIT_SECRET: 'test-only-rate-limit',
    MP_COLLECTOR_ID: '123', PUBLIC_API_URL: api, ALLOWED_ORIGINS: origin,
  };
  const orders = new Map();
  const requests = [];
  let creates = 0;
  const gateway = async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${env.MP_ACCESS_TOKEN}`);
    assert.equal(new URL(url).origin, 'https://api.mercadopago.com');
    if (options.method === 'POST') {
      creates++;
      const body = JSON.parse(options.body);
      const key = options.headers['X-Idempotency-Key'];
      if (!orders.has(key)) orders.set(key, {
        id: 'ORD01TEST10001', status: 'action_required', status_detail: 'waiting_transfer', total_amount: body.total_amount,
        external_reference: body.external_reference, user_id: collector, currency_id: 'BRL',
        transactions: { payments: [{ id: 'PAY01TEST10001', status: 'action_required', status_detail: 'waiting_transfer', amount: body.total_amount,
          payment_method: { id: 'pix', type: 'bank_transfer', qr_code: 'test-pix-copia-e-cola', qr_code_base64: png } }] },
      });
      if (loseProviderResponse) { loseProviderResponse = false; throw new Error('Response lost after charge creation'); }
      return Response.json(orders.get(key));
    }
    assert.equal(url, 'https://api.mercadopago.com/v1/orders/ORD01TEST10001');
    return Response.json([...orders.values()][0]);
  };
  const worker = createWorker({
    createPix: args => mercadoPago.createPix({ ...args, fetchImpl: gateway }),
    getPayment: args => mercadoPago.getPayment({ ...args, fetchImpl: gateway }),
    verifyWebhook: mercadoPago.verifyWebhook,
  });
  const client = createClient({ enabled: true, apiBaseUrl: api }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      const result = await worker.fetch(new Request(url, { ...options, headers: { ...options.headers, Origin: origin } }), env);
      if (loseClientResponse) { loseClientResponse = false; throw new Error('Client response lost'); }
      return result;
    },
  });
  const cart = [{ id: 'item-1', quantity: 2, notes: 'Sem cebola', priceCents: 1 }];
  const details = { payment: 'pix', fulfillment: 'delivery', customer: 'Cliente teste',
    address: 'Rua de teste, 10', neighborhood: 'Centro', payerEmail: 'teste@example.com' };
  const webhook = async (valid = true) => {
    const ts = String(Math.floor(Date.now() / 1000));
    const requestId = 'test-request';
    const manifest = `id:ord01test10001;request-id:${requestId};ts:${ts};`;
    const signature = createHmac('sha256', env.MP_WEBHOOK_SECRET).update(manifest).digest('hex');
    return worker.fetch(new Request(`${api}/api/webhooks/mercado-pago?data.id=ORD01TEST10001`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-request-id': requestId,
        'x-signature': `ts=${ts},v1=${valid ? signature : '0'.repeat(64)}` },
      body: JSON.stringify({ type: 'order', data: { id: 'ORD01TEST10001' } }),
    }), env);
  };
  return { client, cart, details, env, worker, requests, orders, webhook, creates: () => creates };
}

test('client, Worker and real provider agree on totals, QR, signed approval and WhatsApp', async t => {
  const f = fixture();
  t.after(() => f.env.DB.db.close());
  const session = await f.client.start(f.cart, f.details);
  assert.equal(session.order.status, 'pending');
  assert.equal(session.order.amountCents, 5698); // Browser price cannot set server total.
  assert.equal(session.order.deliveryCents, 300);
  assert.equal(session.order.qrCodeBase64, png);
  assert.equal(session.order.customer, undefined);
  assert.equal(session.order.payerEmail, undefined);
  assert.ok(f.requests.every(({ url }) => !url.includes(session.token)));
  const stored = f.env.DB.db.prepare('SELECT * FROM orders').get();
  assert.notEqual(stored.token_hash, session.token);
  assert.equal(stored.token_hash.length, 64);
  const unauthorized = await f.worker.fetch(new Request(`${api}/api/orders/${session.order.id}`, {
    headers: { Origin: origin, Authorization: `Bearer ${'A'.repeat(43)}` },
  }), f.env);
  assert.equal(unauthorized.status, 404);

  [...f.orders.values()][0].status = 'processed';
  [...f.orders.values()][0].status_detail = 'accredited';
  assert.equal((await f.webhook(false)).status, 401);
  assert.equal((await f.client.refresh()).order.status, 'pending');
  assert.equal((await f.webhook()).status, 200);
  assert.equal((await f.webhook()).status, 200); // Duplicate approval.
  const approved = (await f.client.refresh()).order;
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM print_jobs WHERE order_id=?').get(approved.id).count, 1);
  assert.equal(approved.status, 'approved');
  assert.equal(approved.qrCode, undefined);
  const products = Object.fromEntries(approved.items.map(item => [item.id, { name: item.name, price: item.priceCents, allowsNotes: true }]));
  const message = orderMessage.message(approved.items, products, { ...f.details,
    confirmedPayment: { id: approved.id, subtotal: approved.subtotalCents,
      delivery: approved.deliveryCents, total: approved.amountCents } });
  assert.ok(!message.includes(approved.id));
  assert.match(message, /✅ Pagamento: Pix confirmado\./);
  assert.match(message, /56,98/);
  f.client.finish();
  assert.equal(f.client.getSession(), null);
});

test('lost browser response replays one durable order without creating another charge', async t => {
  const f = fixture({ loseClientResponse: true });
  t.after(() => f.env.DB.db.close());
  await assert.rejects(f.client.start(f.cart, f.details));
  const key = f.client.getSession().key;
  const token = f.client.getSession().token;
  const session = await f.client.refresh();
  assert.equal(session.order.status, 'pending');
  assert.equal(f.creates(), 1);
  assert.equal(f.orders.size, 1);
  assert.equal(f.requests[0].options.body, f.requests[1].options.body);
  assert.equal(f.requests[1].options.headers['Idempotency-Key'], key);
  assert.equal(f.requests[1].options.headers.Authorization, `Bearer ${token}`);
});

test('lost provider response retries the original MP key and recovers the accepted charge', async t => {
  const f = fixture({ loseProviderResponse: true });
  t.after(() => f.env.DB.db.close());
  await assert.rejects(f.client.start(f.cart, f.details));
  assert.equal((await f.client.refresh()).order.status, 'pending');
  assert.equal(f.creates(), 2);
  assert.equal(f.orders.size, 1);
  assert.equal(f.env.DB.db.prepare('SELECT COUNT(*) AS count FROM orders').get().count, 1);
});

test('provider payment for another receiver never reaches approved client state', async t => {
  const f = fixture({ collector: 999 });
  t.after(() => f.env.DB.db.close());
  await assert.rejects(f.client.start(f.cart, f.details));
  [...f.orders.values()][0].status = 'processed';
  [...f.orders.values()][0].status_detail = 'accredited';
  assert.equal((await f.webhook()).status, 502);
  assert.equal(f.client.getSession().order, null);
  assert.equal(f.env.DB.db.prepare('SELECT status FROM orders').get().status, 'creating');
});
