const { test } = require('node:test');
const assert = require('node:assert/strict');
const { baseUrl, createClient, validateOrder } = require('../pix.js');
const orderRules = require('../pedido.js');
const config = { enabled: true, apiBaseUrl: 'https://worker.example' };
const cart = [{ id: 'item-1', quantity: 1, notes: '' }];
const details = { fulfillment: 'delivery', customer: 'Cliente', address: 'Rua 123', neighborhood: 'Centro', payerEmail: 'cliente@example.com' };
const payment = (changes = {}) => ({ id: 'order-1', status: 'pending', amountCents: 3300, subtotalCents: 3000, deliveryCents: 300, fulfillment: 'delivery', items: [{ id: 'item-1', name: 'Hambúrguer', quantity: 1, notes: '', priceCents: 3000 }], qrCode: '000201PIX', qrCodeBase64: 'iVBORw0KGgo=', expiresAt: '2026-10-01T12:00:00Z', ...changes });
const response = data => new Response(JSON.stringify(data));

test('opt-in exige HTTPS origem limpa e permanece desativado por padrão', () => {
  assert.equal(baseUrl(orderRules.config.pix), null);
  for (const apiBaseUrl of ['http://worker.example', 'https://u:p@worker.example', 'https://worker.example/?token=x', 'https://worker.example/#secret', 'https://worker.example/path']) assert.equal(baseUrl({ enabled: true, apiBaseUrl }), null);
  assert.equal(baseUrl(config), 'https://worker.example');
});

test('rede incerta repete mesmo corpo/chave/token e consulta só depois de obter id', async () => {
  const calls = [];
  const client = createClient(config, { fetchImpl: async (url, options) => {
    calls.push({ url, ...options });
    if (calls.length === 1) throw new Error('falha de rede após criar no provedor');
    return response(payment());
  } });
  const mutableCart = cart.map(item => ({ ...item }));
  const mutableDetails = { ...details };
  await assert.rejects(client.start(mutableCart, mutableDetails));
  mutableCart[0].quantity = 3; mutableDetails.customer = 'Alterado';
  await client.start(mutableCart, mutableDetails);
  await client.refresh();
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[0].headers.Authorization, calls[2].headers.Authorization);
  assert.match(calls[0].headers.Authorization, /^Bearer [A-Za-z0-9_-]{43}$/);
  assert.equal(client.getSession().details.customer, 'Cliente');
  assert.equal(calls[2].method, 'GET');
  assert.equal(calls[2].url, 'https://worker.example/api/orders/order-1');
  assert.equal(calls[2].credentials, 'omit');
  assert.equal(calls[2].cache, 'no-store');
  assert.ok(!calls[2].url.includes(calls[0].headers.Authorization.slice(7)));
});

test('cliques concorrentes usam uma requisição e fechar aborta mantendo sessão retry', async () => {
  let calls = 0;
  const client = createClient(config, { fetchImpl: (_url, { signal }) => {
    calls++;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  } });
  const first = client.start(cart, details);
  const second = client.start(cart, details);
  assert.equal(first, second);
  client.pause();
  await assert.rejects(first);
  assert.equal(calls, 1);
  assert.ok(client.getSession());
});

test('resposta adulterada não libera sessão aprovada', async () => {
  for (const changes of [{ amountCents: 3301 }, { subtotalCents: 2999, amountCents: 3299 }, { qrCodeBase64: 'data:text/html,<script>' }, { status: 'paid' }, { id: '../order' }]) assert.throws(() => validateOrder(payment(changes)));
  const replies = [payment(), payment({ id: 'other', status: 'approved' })];
  const client = createClient(config, { fetchImpl: async () => response(replies.shift()) });
  await client.start(cart, details);
  await assert.rejects(client.refresh());
  assert.equal(client.getSession().order.status, 'pending');
  client.reset();
  assert.ok(client.getSession()); // Não abandona Pix potencialmente pagável.
});

test('pagamento aprovado usa valores server na mensagem e conclusão explícita limpa sessão', async () => {
  const client = createClient(config, { fetchImpl: async () => response(payment({ status: 'approved', qrCode: null, qrCodeBase64: null })) });
  await client.start(cart, details);
  const text = orderRules.message(cart, { 'item-1': { name: 'Hambúrguer', price: 3000, allowsNotes: true } }, { ...details, payment: 'pix', confirmedPayment: { id: 'order-1', subtotal: 3000, delivery: 400, total: 3400 } });
  assert.match(text, /Total: R\$\s*34,00/);
  assert.match(text, /Pix confirmado pelo Mercado Pago/);
  assert.match(text, /Pedido: order-1/);
  client.reset(); assert.ok(client.getSession());
  client.finish(); assert.equal(client.getSession(), null);
});
