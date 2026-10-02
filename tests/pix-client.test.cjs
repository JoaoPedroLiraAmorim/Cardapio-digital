const { test } = require('node:test');
const assert = require('node:assert/strict');
const { baseUrl, createClient, validateOrder, validatePayload } = require('../pix.js');
const orderRules = require('../pedido.js');
const config = { enabled: true, apiBaseUrl: 'https://worker.example' };
const cart = [{ id: 'item-1', quantity: 1, notes: '' }];
const details = { fulfillment: 'delivery', customer: 'Cliente', address: 'Rua 123', neighborhood: 'Centro', payerEmail: 'cliente@example.com' };
const payment = (changes = {}) => ({ id: 'order-1', status: 'pending', amountCents: 3300, subtotalCents: 3000, deliveryCents: 300, fulfillment: 'delivery', items: [{ id: 'item-1', name: 'Hambúrguer', quantity: 1, notes: '', priceCents: 3000 }], qrCode: '000201PIX', qrCodeBase64: 'iVBORw0KGgo=', expiresAt: '2026-10-01T12:00:00Z', ...changes });
const response = data => new Response(JSON.stringify(data));

test('opt-in exige HTTPS origem limpa e respeita configuração desativada', () => {
  // A HML pode ficar ativada para o teste manual; a proteção de opt-in
  // continua sendo verificada com uma configuração explicitamente desligada.
  assert.equal(baseUrl({ enabled: false, apiBaseUrl: config.apiBaseUrl }), null);
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
  assert.match(text, /✅ Pagamento: Pix confirmado\./);
  assert.doesNotMatch(text, /order-1|Mercado Pago/);
  client.reset(); assert.ok(client.getSession());
  client.finish(); assert.equal(client.getSession(), null);
});

test('validação antes da sessão mantém carrinho editável após dados e limites inválidos', async () => {
  let calls = 0;
  const client = createClient(config, { fetchImpl: async () => { calls++; return response(payment()); } });
  const invalid = [
    [cart, { ...details, payerEmail: 'invalido' }],
    [cart, { ...details, customer: ' ' }],
    [cart, { ...details, customer: {} }],
    [cart, { ...details, address: '' }],
    [[{ ...cart[0], quantity: 21 }], details],
    [[...cart, ...cart], details],
    [[{ ...cart[0], quantity: 20 }, { ...cart[0], id: 'item-2', quantity: 20 }, { ...cart[0], id: 'item-3', quantity: 11 }], details],
  ];
  for (const [items, fields] of invalid) {
    await assert.rejects(client.start(items, fields));
    assert.equal(client.getSession(), null);
  }
  assert.equal(calls, 0);
  await client.start(cart, details);
  assert.equal(calls, 1);
});

test('notas e dados multiline são normalizados antes do snapshot e POST idempotente', () => {
  const payload = validatePayload([{ ...cart[0], notes: ' Sem cebola\nSem sal\t ' }], { ...details, customer: ' Cliente ', notes: 'Tocar\r\na campainha' });
  assert.equal(payload.items[0].notes, 'Sem cebola Sem sal');
  assert.equal(payload.customer, 'Cliente');
  assert.equal(payload.notes, 'Tocar a campainha');
});

test('resumo é estável entre creating, pending e approved; rejeita itens/valor trocados', async () => {
  for (const changed of [
    payment({ status: 'approved', items: [{ ...payment().items[0], name: 'Outro produto' }] }),
    payment({ status: 'approved', amountCents: 3400, deliveryCents: 400 }),
    payment({ status: 'approved', items: [{ ...payment().items[0], notes: 'Outro pedido' }] }),
  ]) {
    const replies = [payment({ status: 'creating', qrCode: null, qrCodeBase64: null }), changed];
    const client = createClient(config, { fetchImpl: async () => response(replies.shift()) });
    await client.start(cart, details);
    await assert.rejects(client.refresh());
    assert.equal(client.getSession().order.status, 'creating');
  }
  const client = createClient(config, { fetchImpl: async () => response(payment({ items: [{ ...payment().items[0], id: 'item-2' }] })) });
  await assert.rejects(client.start(cart, details));
  assert.equal(client.getSession().order, null);
});

test('approved não regride; aceita estorno e approved tardio de expired', async () => {
  for (const status of ['creating', 'pending', 'rejected', 'cancelled', 'expired']) {
    const replies = [payment({ status: 'approved' }), payment({ status })];
    const client = createClient(config, { fetchImpl: async () => response(replies.shift()) });
    await client.start(cart, details);
    await assert.rejects(client.refresh());
    assert.equal(client.getSession().order.status, 'approved');
  }
  const replies = [payment({ status: 'expired' }), payment({ status: 'approved' }), payment({ status: 'refunded' }), payment({ status: 'approved' })];
  const client = createClient(config, { fetchImpl: async () => response(replies.shift()) });
  await client.start(cart, details);
  await client.refresh(); assert.equal(client.getSession().order.status, 'approved');
  await client.refresh(); assert.equal(client.getSession().order.status, 'refunded');
  await assert.rejects(client.refresh());
  assert.equal(client.getSession().order.status, 'refunded');
});

test('resposta atrasada após fechar não substitui estado e retry preserva chave', async () => {
  let resolve;
  const calls = [];
  const client = createClient(config, { fetchImpl: (_url, options) => {
    calls.push(options);
    return calls.length === 1 ? new Promise(done => { resolve = done; }) : Promise.resolve(response(payment()));
  } });
  const request = client.start(cart, details);
  client.pause();
  resolve(response(payment({ status: 'approved' })));
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(client.getSession().order, null);
  await client.refresh();
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[0].body, calls[1].body);
});

test('estorno pode progredir a contestação sem recuperar aprovação', async () => {
  const replies = [payment({ status: 'approved' }), payment({ status: 'refunded' }), payment({ status: 'charged_back' }), payment({ status: 'refunded' })];
  const client = createClient(config, { fetchImpl: async () => response(replies.shift()) });
  await client.start(cart, details);
  await client.refresh();
  await client.refresh();
  assert.equal(client.getSession().order.status, 'charged_back');
  await assert.rejects(client.refresh());
  assert.equal(client.getSession().order.status, 'charged_back');
});

test('approved WhatsApp click works with unavailable printing and exposes explicit new order', async () => {
  const fs = require('node:fs'); const vm = require('node:vm');
  const script = fs.readFileSync(require.resolve('../cardapio.js'), 'utf8');
  const handlers = new Map(); const buttons = new Map();
  for (const id of ['#pix-whatsapp', '#pix-new-order']) buttons.set(id, { hidden: true, addEventListener: (_event, handler) => handlers.set(id, handler) });
  const client = createClient(config, { fetchImpl: async () => response(payment({ status: 'approved' })) });
  await client.start(cart, details);
  const session = client.getSession(); const messages = []; let printCalls = 0; let closed = false; let saves = 0; let renders = 0;
  const context = vm.createContext({
    document: { querySelector: id => buttons.get(id) }, pix: client, pixBusy: false,
    products: { 'item-1': { price: 1, allowsNotes: true } }, order: orderRules,
    printer: { beginPix() { printCalls++; throw Error('printing disabled'); }, async confirmApproved() { printCalls++; throw Error('CORS / print service offline'); } },
    openWhatsapp: message => { assert.equal(client.getSession(), session); messages.push(message); },
    cart: [...cart], save: () => saves++, render: () => renders++, dialog: { close: () => { closed = true; } },
  });
  // Execute the actual registered production handlers, with a printer that would fail.
  for (const id of ['#pix-whatsapp', '#pix-new-order']) {
    const start = script.indexOf(`  document.querySelector("${id}").addEventListener`);
    const end = script.indexOf('\n  });', start) + '\n  });'.length;
    assert.ok(start >= 0); vm.runInContext(script.slice(start, end), context);
  }
  await handlers.get('#pix-whatsapp')();
  assert.equal(messages.length, 1); assert.match(messages[0], /33,00/);
  assert.equal(printCalls, 0); assert.equal(buttons.get('#pix-new-order').hidden, false);
  assert.equal(client.getSession(), session); assert.equal(client.getSession().order.status, 'approved');
  assert.equal(context.cart.length, 1);
  handlers.get('#pix-new-order')();
  assert.equal(client.getSession(), null); assert.equal(context.cart.length, 0);
  assert.equal(saves, 1); assert.equal(renders, 1); assert.equal(closed, true);
  assert.equal(buttons.get('#pix-new-order').hidden, true);
  await handlers.get('#pix-whatsapp')(); assert.equal(messages.length, 1);
});
