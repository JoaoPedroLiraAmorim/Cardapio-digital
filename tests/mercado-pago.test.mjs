import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { amountToCents, createPix, getPayment, verifyWebhook } from '../server/mercado-pago.js';

const fixture = (changes = {}, paymentChanges = {}, methodChanges = {}) => ({
  id: 'ORD01TEST123', user_id: 76543, status: 'action_required', status_detail: 'waiting_transfer',
  currency_id: 'BRL', total_amount: '35.10', external_reference: 'order-1',
  transactions: { payments: [{ id: 'PAY01TEST123', status: 'action_required', status_detail: 'waiting_transfer', amount: '35.10',
    payment_method: { id: 'pix', type: 'bank_transfer', ticket_url: 'https://www.mercadopago.com.br/sandbox/test',
      qr_code: '000201PIX', qr_code_base64: 'iVBORw0KGgo=', ...methodChanges }, ...paymentChanges }] },
  ...changes,
});
const input = { accessToken: 'private-fixture', idempotencyKey: 'stable-order-1', amountCents: 3510,
  orderId: 'order-1', payerEmail: 'cliente@example.com' };
const reply = body => Response.json(body);

test('criação usa Orders API, idempotência e payload Pix atual', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.mercadopago.com/v1/orders');
    assert.equal(options.headers['X-Idempotency-Key'], input.idempotencyKey);
    assert.equal(options.headers.Authorization, 'Bearer private-fixture');
    assert.equal(options.redirect, 'manual');
    const body = JSON.parse(options.body);
    assert.deepEqual(body, {
      type: 'online', total_amount: '35.10', external_reference: 'order-1', processing_mode: 'automatic',
      transactions: { payments: [{ amount: '35.10', payment_method: { id: 'pix', type: 'bank_transfer' } }] },
      payer: { email: 'cliente@example.com' },
    });
    assert.equal(body.notification_url, undefined);
    return reply(fixture({ payer: { email: 'never-return' } }));
  };
  const order = await createPix({ ...input, fetchImpl });
  assert.equal(order.id, 'ORD01TEST123');
  assert.equal(order.status, 'pending');
  assert.equal(order.amountCents, 3510);
  assert.equal(order.collectorId, '76543');
  assert.equal(order.ticketUrl, 'https://www.mercadopago.com.br/sandbox/test');
  assert.equal(order.payer, undefined);
  await createPix({ ...input, fetchImpl });
  assert.equal(calls, 2);
});

test('criação consulta a order quando resposta inicial omite o recebedor', async () => {
  const calls = [];
  const created = fixture();
  delete created.user_id;
  const order = await createPix({ ...input, fetchImpl: async (url, options) => {
    calls.push([url, options.method]);
    return reply(options.method === 'POST' ? created : fixture());
  } });
  assert.deepEqual(calls, [
    ['https://api.mercadopago.com/v1/orders', 'POST'],
    ['https://api.mercadopago.com/v1/orders/ORD01TEST123', 'GET'],
  ]);
  assert.equal(order.collectorId, '76543');
  assert.equal(order.status, 'pending');
});

test('centavos não arredondam valores inválidos nem aceitam notação exponencial', () => {
  assert.equal(amountToCents(0.29), 29);
  assert.equal(amountToCents('123.01'), 12301);
  for (const value of [1.001, '1e3', '-1', 0, NaN, Infinity, '1.000', '1,00']) assert.throws(() => amountToCents(value));
});

test('criação rejeita valor, referência, moeda, método, recebedor e QR divergentes', async () => {
  const invalid = [
    fixture({ total_amount: '35.11' }), fixture({ external_reference: 'other' }), fixture({ currency_id: 'USD' }),
    fixture({}, {}, { id: 'visa', type: 'credit_card' }), fixture({ user_id: 'invalid' }), fixture({ transactions: null }),
  ];
  for (const body of invalid) await assert.rejects(createPix({ ...input, fetchImpl: async () => reply(body) }), { code: 'INVALID_RESPONSE' });
});

test('consulta aceita ID alfanumérico e mapeia aprovação sem QR', async () => {
  const approved = fixture({ status: 'processed', status_detail: 'accredited' },
    { status: 'processed', status_detail: 'accredited' }, { qr_code: undefined, qr_code_base64: undefined });
  const order = await getPayment({ accessToken: input.accessToken, paymentId: 'ORD01TEST123', fetchImpl: async () => reply(approved) });
  assert.equal(order.status, 'approved');
  assert.equal(order.qrCode, null);
  await assert.rejects(getPayment({ accessToken: input.accessToken, paymentId: '../other', fetchImpl: async () => { throw new Error('must not fetch'); } }), { code: 'INVALID_INPUT' });
  await assert.rejects(getPayment({ accessToken: input.accessToken, paymentId: 'ORD01TEST123', fetchImpl: async () => reply(fixture({ id: 'ORD-DIFFERENT' })) }), { code: 'INVALID_RESPONSE' });
});

test('mapeia estados oficiais de order sem regressão inventada', async () => {
  const samples = [
    ['created', null, 'creating'], ['processing', null, 'creating'], ['canceled', 'by_admin', 'cancelled'],
    ['failed', 'rejected_by_bank', 'rejected'], ['expired', 'expired', 'expired'], ['refunded', 'refunded', 'refunded'],
  ];
  for (const [status, status_detail, expected] of samples) {
    const result = await getPayment({ accessToken: input.accessToken, paymentId: 'ORD01TEST123', fetchImpl: async () => reply(fixture({ status, status_detail })) });
    assert.equal(result.status, expected);
  }
});

test('não envia rede com email inválido ou preço fracionário', async () => {
  for (const changes of [{ payerEmail: 'invalid' }, { amountCents: 10.5 }]) {
    await assert.rejects(createPix({ ...input, ...changes, fetchImpl: () => { assert.fail('rede não deveria ser chamada'); } }), { code: 'INVALID_INPUT' });
  }
});

test('erro de API não vaza credencial e não faz retry', async () => {
  let calls = 0;
  await assert.rejects(createPix({ ...input, fetchImpl: async () => {
    calls++;
    return Response.json({ error: 'invalid_credentials', message: 'APP_USR-private cliente@example.com', cause: ['test'] }, { status: 401 });
  } }), error => error.code === 'PROVIDER_FAILURE' && !String(error).includes('APP_USR'));
  assert.equal(calls, 1);
});

test('timeout aborta requisição sem repetir criação', async () => {
  const original = globalThis.setTimeout;
  globalThis.setTimeout = callback => original(callback, 5);
  let calls = 0;
  try {
    await assert.rejects(createPix({ ...input, fetchImpl: (_url, { signal }) => {
      calls++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } }), { code: 'PROVIDER_TIMEOUT' });
    assert.equal(calls, 1);
  } finally { globalThis.setTimeout = original; }
});

test('HMAC verifica assinatura de ID de order, lowercase, janela e duplicação', async () => {
  const secret = 'test-webhook-secret';
  const now = 1800000000000;
  const ts = String(now / 1000);
  const requestId = 'request-1';
  const dataId = 'ORD01ABC123';
  const hash = createHmac('sha256', secret).update(`id:ord01abc123;request-id:${requestId};ts:${ts};`).digest('hex');
  const signature = `ts=${ts},v1=${hash}`;
  const input = { secret, signature, requestId, dataId, now };
  assert.equal(await verifyWebhook(input), true);
  for (const change of [{ secret: 'other' }, { dataId: 'ORD01OTHER' }, { requestId: 'other' }, { now: now + 300001 },
    { signature: signature + ',ts=' + ts }, { signature: signature.replace(hash, '0'.repeat(64)) }]) {
    assert.equal(await verifyWebhook({ ...input, ...change }), false);
  }
});
