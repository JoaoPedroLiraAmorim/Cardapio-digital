import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { amountToCents, createPix, getPayment, verifyWebhook } from '../server/mercado-pago.js';

const fixture = (changes = {}) => ({ id: 12345, collector_id: 76543, status: 'pending', currency_id: 'BRL', payment_method_id: 'pix', transaction_amount: 35.1, external_reference: 'order-1', date_of_expiration: '2026-10-01T12:00:00Z', point_of_interaction: { transaction_data: { qr_code: '000201PIX', qr_code_base64: 'iVBORw0KGgo=' } }, ...changes });
const input = { accessToken: 'private-fixture', idempotencyKey: 'stable-order-1', amountCents: 3510, orderId: 'order-1', payerEmail: 'cliente@example.com', notificationUrl: 'https://worker.example/webhooks/mercado-pago' };
const reply = body => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

test('criação usa idempotência e retorna somente dados normalizados do Pix', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(url, 'https://api.mercadopago.com/v1/payments');
    assert.equal(options.headers['X-Idempotency-Key'], input.idempotencyKey);
    assert.equal(options.headers.Authorization, 'Bearer private-fixture');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body);
    assert.equal(body.transaction_amount, 35.1);
    assert.equal(body.external_reference, 'order-1');
    assert.equal(body.payment_method_id, 'pix');
    return reply(fixture({ payer: { email: 'never-return' } }));
  };
  const payment = await createPix({ ...input, fetchImpl });
  assert.equal(payment.amountCents, 3510);
  assert.equal(payment.collectorId, '76543');
  assert.equal(payment.payer, undefined);
  await createPix({ ...input, fetchImpl });
  assert.equal(calls, 2); // Chave e corpo idênticos nas tentativas; sem retry interno.
});

test('centavos não arredondam valores inválidos nem aceitam notação exponencial', () => {
  assert.equal(amountToCents(0.29), 29);
  assert.equal(amountToCents('123.01'), 12301);
  for (const value of [1.001, '1e3', '-1', 0, NaN, Infinity, '1.000', '1,00']) assert.throws(() => amountToCents(value));
});

test('criação rejeita preço divergente, referência diferente, moeda e método incorretos', async () => {
  for (const changes of [{ transaction_amount: 35.11 }, { external_reference: 'other' }, { currency_id: 'USD' }, { payment_method_id: 'visa' }, { collector_id: 9007199254740992 }, { point_of_interaction: null }]) {
    await assert.rejects(createPix({ ...input, fetchImpl: async () => reply(fixture(changes)) }), { code: 'INVALID_RESPONSE' });
  }
});

test('consulta valida ID e permite aprovado sem QR, sem inferir aprovação de payload webhook', async () => {
  const payment = await getPayment({ accessToken: input.accessToken, paymentId: '12345', fetchImpl: async () => reply(fixture({ status: 'approved', point_of_interaction: null })) });
  assert.equal(payment.status, 'approved');
  assert.equal(payment.qrCode, null);
  await assert.rejects(getPayment({ accessToken: input.accessToken, paymentId: '../other', fetchImpl: async () => { throw new Error('must not fetch'); } }), { code: 'INVALID_INPUT' });
  await assert.rejects(getPayment({ accessToken: input.accessToken, paymentId: '12345', fetchImpl: async () => reply(fixture({ id: 55 })) }), { code: 'INVALID_RESPONSE' });
});

test('não envia rede com URL HTTP, email inválido ou preço fracionário', async () => {
  for (const changes of [{ notificationUrl: 'http://example.com' }, { notificationUrl: 'https://user:pass@example.com' }, { payerEmail: 'invalid' }, { amountCents: 10.5 }]) {
    await assert.rejects(createPix({ ...input, ...changes, fetchImpl: () => { assert.fail('rede não deveria ser chamada'); } }), { code: 'INVALID_INPUT' });
  }
});

test('erro de API e exceção de rede não vazam PII/token e não fazem retry', async () => {
  let calls = 0;
  for (const fetchImpl of [async () => { calls++; return new Response('private-secret-personal-error', { status: 401 }); }, async () => { calls++; throw new Error('private-fixture cliente@example.com'); }]) {
    await assert.rejects(createPix({ ...input, fetchImpl }), error => error.code === 'PROVIDER_FAILURE' && !String(error).includes('private'));
  }
  assert.equal(calls, 2);
});

test('timeout aborta requisição sem repetir criação', async () => {
  // Fake timers retain the real API timeout setting while avoiding a 10s test.
  const original = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => original(callback, Math.min(delay, 5));
  let calls = 0;
  try {
    await assert.rejects(createPix({ ...input, fetchImpl: (_url, { signal }) => {
      calls++;
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    } }), { code: 'PROVIDER_TIMEOUT' });
    assert.equal(calls, 1);
  } finally { globalThis.setTimeout = original; }
});

test('HMAC verifica assinatura, lowercase do ID, janela e headers sem duplicação', async () => {
  const secret = 'test-webhook-secret';
  const now = 1800000000000;
  const ts = String(now / 1000);
  const requestId = 'request-1';
  const dataId = 'ABC123';
  const hash = createHmac('sha256', secret).update(`id:abc123;request-id:${requestId};ts:${ts};`).digest('hex');
  const signature = `ts=${ts},v1=${hash}`;
  const input = { secret, signature, requestId, dataId, now };
  assert.equal(await verifyWebhook(input), true);
  for (const change of [{ secret: 'other' }, { dataId: 'ABC124' }, { requestId: 'other' }, { now: now + 300001 }, { now: now - 300001 }, { signature: signature + ',ts=' + ts }, { signature: signature.replace(hash, '0'.repeat(64)) }, { requestId: '' }]) {
    assert.equal(await verifyWebhook({ ...input, ...change }), false);
  }
  const ms = String(now);
  const msHash = createHmac('sha256', secret).update(`id:abc123;request-id:${requestId};ts:${ms};`).digest('hex');
  assert.equal(await verifyWebhook({ ...input, signature: `ts=${ms},v1=${msHash}` }), true);
});
