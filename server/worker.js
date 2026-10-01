import { catalog, deliveryFeeCents } from './catalog.js';
import * as mercadoPago from './mercado-pago.js';

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const fail = (status, message) => { throw new HttpError(status, message); };
const encoder = new TextEncoder();
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
const query = (env, sql, ...args) => env.DB.prepare(sql).bind(...args);
const safeText = (value, max, required = false) => {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail(400, 'Dados inválidos.');
  const text = value.trim();
  if (required && !text) fail(400, 'Preencha os campos obrigatórios.');
  return text;
};
export function validateOrder(body) {
  if (!body || body.payment !== 'pix' || !['delivery', 'pickup'].includes(body.fulfillment) || !Array.isArray(body.items) || !body.items.length || body.items.length > 12) fail(400, 'Pedido inválido.');
  const seen = new Set();
  let quantity = 0;
  const items = body.items.map(item => {
    const product = item && Object.hasOwn(catalog, item.id) && catalog[item.id];
    if (!product || seen.has(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) fail(400, 'Itens inválidos.');
    seen.add(item.id); quantity += item.quantity;
    const notes = safeText(item.notes, 240);
    if (!product.allowsNotes && notes) fail(400, 'Bebidas não aceitam observações.');
    return {id: item.id, name: product.name, quantity: item.quantity, notes, priceCents: product.priceCents};
  });
  if (quantity > 50) fail(400, 'Limite de itens excedido.');
  const payerEmail = safeText(body.payerEmail, 254, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) fail(400, 'E-mail inválido.');
  const subtotalCents = items.reduce((sum, item) => sum + item.priceCents * item.quantity, 0);
  const deliveryCents = body.fulfillment === 'delivery' ? deliveryFeeCents : 0;
  const payload = {items, payment: 'pix', fulfillment: body.fulfillment, customer: safeText(body.customer, 80, true),
    address: safeText(body.address, 180, body.fulfillment === 'delivery'), neighborhood: safeText(body.neighborhood, 80, body.fulfillment === 'delivery'),
    reference: safeText(body.reference, 180), notes: safeText(body.notes, 500), payerEmail, subtotalCents, deliveryCents, amountCents: subtotalCents + deliveryCents};
  if (payload.amountCents > 150000) fail(400, 'Valor máximo excedido.');
  return payload;
}
async function readBody(request) {
  if (!(request.headers.get('content-type') || '').startsWith('application/json')) fail(415, 'Envie JSON.');
  if (Number(request.headers.get('content-length') || 0) > 16384) fail(413, 'Pedido muito grande.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Corpo obrigatório.');
  const chunks = []; let length = 0;
  while (true) {
    const {done, value} = await reader.read(); if (done) break;
    length += value.length; if (length > 16384) { await reader.cancel(); fail(413, 'Pedido muito grande.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail(400, 'JSON inválido.'); }
}
async function tokenHash(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
  if (!token) fail(401, 'Acesso inválido.');
  return sha(token);
}
async function bearer(request, pattern = /^[A-Za-z0-9_-]{43}$/) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if (!token || !pattern.test(token)) fail(401, 'Acesso inválido.');
  return {token, hash: await sha(token)};
}
function randomToken() {
  const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function printDevice(request, env, now) {
  const {hash} = await bearer(request);
  const device = await query(env, 'SELECT id,name FROM print_devices WHERE token_hash=? AND revoked_at IS NULL', hash).first();
  if (!device) fail(401, 'Dispositivo não autorizado.');
  await query(env, 'UPDATE print_devices SET last_seen_at=? WHERE id=?', now, device.id).run();
  return device;
}
function printOrder(row) {
  const payload = JSON.parse(row.payload);
  return {id: row.id, number: row.id.slice(0, 8).toUpperCase(), createdAt: row.created_at, customer: payload.customer,
    fulfillment: payload.fulfillment, address: payload.address, neighborhood: payload.neighborhood, reference: payload.reference,
    notes: payload.notes, items: payload.items, subtotalCents: payload.subtotalCents, deliveryCents: payload.deliveryCents,
    totalCents: row.amount_cents, payment: payload.payment, paymentStatus: row.status};
}
async function enqueuePrint(env, orderId, now) {
  if (env.PRINT_SERVICE_ENABLED !== 'true') return;
  await query(env, `INSERT INTO print_jobs(id,order_id,status,available_at,created_at,updated_at)
    VALUES(?,?,'queued',?,?,?) ON CONFLICT(order_id) DO NOTHING`, crypto.randomUUID(), orderId, now, now, now).run();
}
async function handlePrintRoute(request, env, url, headers, now) {
  if (env.PRINT_SERVICE_ENABLED !== 'true' || !env.DB || !env.PRINT_PAIRING_SECRET || env.PRINT_PAIRING_SECRET.length < 32) fail(503, 'Impressão HML indisponível.');
  if (url.pathname === '/api/print/pair' && request.method === 'POST') {
    const {token} = await bearer(request, /^[A-Za-z0-9_-]{32,128}$/);
    if (await sha(token) !== await sha(env.PRINT_PAIRING_SECRET)) fail(401, 'Código de pareamento inválido.');
    const body = await readBody(request); const name = safeText(body.name, 80, true);
    const deviceToken = randomToken(); const id = crypto.randomUUID();
    await query(env, 'INSERT INTO print_devices(id,name,token_hash,last_seen_at,created_at) VALUES(?,?,?,?,?)', id, name, await sha(deviceToken), now, now).run();
    return new Response(JSON.stringify({deviceId:id, token:deviceToken}), {status:201, headers});
  }
  const device = await printDevice(request, env, now);
  if (url.pathname === '/api/print/jobs/claim' && request.method === 'POST') {
    const leaseToken = randomToken(); const leaseHash = await sha(leaseToken);
    const job = await query(env, `UPDATE print_jobs SET status='leased',attempt=attempt+1,lease_token_hash=?,lease_until=?,device_id=?,updated_at=?
      WHERE id=(SELECT id FROM print_jobs WHERE status='queued' AND available_at<=? ORDER BY created_at LIMIT 1)
      RETURNING *`, leaseHash, now + 300000, device.id, now, now).first();
    if (!job) return new Response(null, {status:204, headers});
    const order = await query(env, 'SELECT * FROM orders WHERE id=? AND status="approved"', job.order_id).first();
    if (!order) fail(409, 'Pedido não está aprovado.');
    return new Response(JSON.stringify({job:{id:job.id, attempt:job.attempt, leaseToken, order:printOrder(order)}}), {headers});
  }
  const result = url.pathname.match(/^\/api\/print\/jobs\/([0-9a-f-]{36})\/result$/);
  if (result && request.method === 'POST') {
    const body = await readBody(request);
    if (!['printed','failed','uncertain'].includes(body.status)) fail(400, 'Resultado inválido.');
    const leaseHash = await sha(safeText(body.leaseToken, 128, true));
    const error = safeText(body.error, 240);
    const retryAt = now + Math.max(30, Math.min(3600, Number(env.PRINT_RETRY_SECONDS) || 60)) * 1000;
    const next = body.status === 'failed' ? 'queued' : body.status;
    const changed = await query(env, `UPDATE print_jobs SET status=?,lease_token_hash=NULL,lease_until=0,available_at=?,last_error=?,updated_at=?
      WHERE id=? AND device_id=? AND status='leased' AND lease_token_hash=? RETURNING id`,
      next, body.status === 'failed' ? retryAt : now, error || null, now, result[1], device.id, leaseHash).first();
    if (!changed) {
      const existing = await query(env, 'SELECT status FROM print_jobs WHERE id=?', result[1]).first();
      if (existing?.status !== 'printed' || body.status !== 'printed') fail(409, 'Reserva de impressão inválida.');
    }
    return new Response(JSON.stringify({ok:true, status:next}), {headers});
  }
  const retry = url.pathname.match(/^\/api\/print\/jobs\/([0-9a-f-]{36})\/retry$/);
  if (retry && request.method === 'POST') {
    const changed = await query(env, `UPDATE print_jobs SET status='queued',lease_token_hash=NULL,lease_until=0,available_at=?,last_error=NULL,updated_at=?
      WHERE id=? AND status='uncertain' RETURNING id`, now, now, retry[1]).first();
    if (!changed) fail(409, 'Impressão não está incerta.');
    return new Response(JSON.stringify({ok:true}), {headers});
  }
  fail(404, 'Rota não encontrada.');
}
async function throttle(env, scope, identity, limit, seconds, now) {
  const bucket = Math.floor(now / (seconds * 1000));
  const key = await sha(`${env.RATE_LIMIT_SECRET}:${scope}:${identity}:${bucket}`);
  const result = await query(env, 'INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count', key, now + seconds * 2000).first();
  if (result.count > limit) fail(429, 'Muitas tentativas. Aguarde e tente novamente.');
}
function response(row) {
  const payload = JSON.parse(row.payload);
  return {id: row.id, status: row.status, amountCents: row.amount_cents, subtotalCents: payload.subtotalCents, deliveryCents: payload.deliveryCents,
    items: payload.items, fulfillment: payload.fulfillment, expiresAt: row.expires_at,
    ...(row.status === 'pending' ? {qrCode: row.qr_code, qrCodeBase64: row.qr_code_base64} : {})};
}
export function matchesPayment(row, payment, env) {
  return String(payment.externalReference) === row.id && payment.amountCents === row.amount_cents &&
    (!row.payment_id || String(payment.id) === row.payment_id) && String(payment.collectorId) === String(env.MP_COLLECTOR_ID) &&
    payment.currencyId === 'BRL' && payment.paymentMethodId === 'pix';
}
async function applyPayment(env, row, payment, now) {
  if (!matchesPayment(row, payment, env)) fail(502, 'Pagamento não corresponde ao pedido.');
  if (!['creating', 'pending', 'approved', 'rejected', 'cancelled', 'refunded', 'charged_back'].includes(payment.status)) fail(502, 'Estado de pagamento desconhecido.');
  const status = payment.status === 'pending' && payment.expiresAt && Date.parse(payment.expiresAt) <= now ? 'expired' : payment.status;
  // Expiration never regresses to pending; verified late approvals and reversals still advance.
  await query(env, `UPDATE orders SET payment_id=?, status=CASE WHEN status='expired' AND ?='pending' THEN 'expired' ELSE ? END,
    qr_code=COALESCE(?,qr_code), qr_code_base64=COALESCE(?,qr_code_base64), expires_at=?, lease_until=0, updated_at=?
    WHERE id=? AND (payment_id IS NULL OR payment_id=?)
    AND (status IN ('creating','pending','expired') OR status=?
      OR (status IN ('cancelled','rejected') AND ? IN ('approved','refunded','charged_back'))
      OR (status='approved' AND ? IN ('refunded','charged_back'))
      OR (status='refunded' AND ?='charged_back'))`,
    String(payment.id), status, status, payment.qrCode || null, payment.qrCodeBase64 || null, payment.expiresAt || row.expires_at, now,
    row.id, String(payment.id), status, status, status, status).run();
  const updated = await query(env, 'SELECT * FROM orders WHERE id=?', row.id).first();
  if (updated.status === 'approved') await enqueuePrint(env, row.id, now);
  return updated;
}
async function ensurePayment(env, row, provider, now) {
  if (row.status !== 'creating') return row;
  if (now - row.created_at > 23 * 3600000) return row;
  const claimed = await query(env, "UPDATE orders SET lease_until=? WHERE id=? AND status='creating' AND lease_until<=? RETURNING id", now + 45000, row.id, now).first();
  if (!claimed) return row;
  const payload = JSON.parse(row.payload);
  try {
    const payment = await provider.createPix({accessToken: env.MP_ACCESS_TOKEN, idempotencyKey: row.idempotency_key, amountCents: row.amount_cents,
      orderId: row.id, payerEmail: payload.payerEmail, notificationUrl: `${env.PUBLIC_API_URL}/api/webhooks/mercado-pago`});
    return await applyPayment(env, row, payment, Date.now());
  } catch (error) {
    console.error('Pix creation failed', { name: error?.name, code: error?.code, status: error?.status });
    // A timeout can happen after MP accepted the charge. Always reuse the same durable key.
    await query(env, "UPDATE orders SET lease_until=0, updated_at=? WHERE id=? AND status='creating'", now, row.id).run();
    fail(503, 'Não foi possível confirmar a criação do Pix. Repita com a mesma chave.');
  }
}
async function refreshPayment(env, row, provider, now) {
  if (!row.payment_id || !['pending', 'expired'].includes(row.status)) return row;
  const claimed = await query(env, `UPDATE orders SET lease_until=? WHERE id=? AND status IN ('pending','expired')
    AND updated_at<=? AND lease_until<=? RETURNING id`, now + 30000, row.id, now - 10000, now).first();
  if (claimed) {
    try {
      const payment = await provider.getPayment({accessToken: env.MP_ACCESS_TOKEN, paymentId: row.payment_id});
      await applyPayment(env, row, payment, Date.now());
    } catch {
      await query(env, 'UPDATE orders SET lease_until=0,updated_at=? WHERE id=?', now, row.id).run();
    }
  }
  // Reload after the claim: a webhook or another request may have already confirmed payment.
  return query(env, 'SELECT * FROM orders WHERE id=?', row.id).first();
}
function configured(env) {
  if (env.PIX_ENABLED !== 'true' || !env.DB || !env.MP_ACCESS_TOKEN || !env.MP_WEBHOOK_SECRET || !env.RATE_LIMIT_SECRET || !/^\d+$/.test(env.MP_COLLECTOR_ID || '') || !/^https:\/\/[^/?#]+$/.test(env.PUBLIC_API_URL || '')) fail(503, 'Pix online indisponível.');
}
export function createWorker(provider = mercadoPago) {
  return {
    async fetch(request, env) {
      const url = new URL(request.url); const origin = request.headers.get('origin');
      const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean).includes(origin);
      const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Origin'};
      if (allowed) headers['Access-Control-Allow-Origin'] = origin;
      try {
        const now = Date.now();
        if (url.pathname.startsWith('/api/print/')) return await handlePrintRoute(request, env, url, headers, now);
        configured(env);
        const webhook = url.pathname === '/api/webhooks/mercado-pago';
        if (!webhook && !allowed) fail(403, 'Origem não permitida.');
        if (request.method === 'OPTIONS' && !webhook) return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, Idempotency-Key'}});
        const ip = request.headers.get('CF-Connecting-IP') || 'local';
        if (webhook && request.method === 'POST') {
          const body = await readBody(request);
          const dataId = url.searchParams.get('data.id');
          if (!dataId || !/^[A-Za-z0-9_-]{1,128}$/.test(dataId) || String(body.data?.id) !== dataId || body.type !== 'order') fail(400, 'Notificação inválida.');
          const valid = await provider.verifyWebhook({secret: env.MP_WEBHOOK_SECRET, signature: request.headers.get('x-signature'), requestId: request.headers.get('x-request-id'), dataId, now});
          if (!valid) fail(401, 'Assinatura inválida.');
          const payment = await provider.getPayment({accessToken: env.MP_ACCESS_TOKEN, paymentId: dataId});
          const row = await query(env, 'SELECT * FROM orders WHERE id=?', payment.externalReference).first();
          if (row) await applyPayment(env, row, payment, now);
          return new Response(JSON.stringify({received: true}), {headers});
        }
        if (url.pathname === '/api/orders' && request.method === 'POST') {
          await throttle(env, 'create-ip', ip, 20, 600, now);
          const hash = await tokenHash(request);
          const key = request.headers.get('idempotency-key')?.toLowerCase();
          if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key || '')) fail(400, 'Chave de tentativa inválida.');
          const payload = validateOrder(await readBody(request));
          const payloadHash = await sha(JSON.stringify(payload));
          let row = await query(env, 'SELECT * FROM orders WHERE idempotency_key=?', key).first();
          if (!row) {
            await throttle(env, 'create-global', 'all', Number(env.MAX_DAILY_ORDERS) || 500, 86400, now);
            await query(env, 'INSERT INTO orders(id,idempotency_key,token_hash,payload_hash,payload,amount_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING', crypto.randomUUID(), key, hash, payloadHash, JSON.stringify(payload), payload.amountCents, now, now).run();
            row = await query(env, 'SELECT * FROM orders WHERE idempotency_key=?', key).first();
          }
          if (row.token_hash !== hash || row.payload_hash !== payloadHash) fail(409, 'A tentativa não corresponde ao pedido original.');
          row = await ensurePayment(env, row, provider, now);
          return new Response(JSON.stringify(response(row)), {status: row.status === 'creating' ? 202 : 200, headers});
        }
        const match = url.pathname.match(/^\/api\/orders\/([0-9a-f-]{36})$/);
        if (match && request.method === 'GET') {
          await throttle(env, 'read-ip', ip, 120, 60, now);
          const hash = await tokenHash(request);
          let row = await query(env, 'SELECT * FROM orders WHERE id=? AND token_hash=?', match[1], hash).first();
          if (!row) fail(404, 'Pedido não encontrado.');
          row = await ensurePayment(env, row, provider, now);
          row = await refreshPayment(env, row, provider, now);
          if (row.status === 'pending' && row.expires_at && Date.parse(row.expires_at) <= now) {
            await query(env, "UPDATE orders SET status='expired' WHERE id=? AND status='pending'", row.id).run();
            row = await query(env, 'SELECT * FROM orders WHERE id=?', row.id).first();
          }
          return new Response(JSON.stringify(response(row)), {status: row.status === 'creating' ? 202 : 200, headers});
        }
        fail(404, 'Rota não encontrada.');
      } catch (error) {
        return new Response(JSON.stringify({error: error instanceof HttpError ? error.message : 'Serviço indisponível.'}), {status: error instanceof HttpError ? error.status : 503, headers});
      }
    },
    async scheduled(_event, env) {
      if (env.PIX_ENABLED !== 'true') return;
      configured(env); const now = Date.now();
      const rows = await query(env, "SELECT * FROM orders WHERE (status='creating' AND created_at>?) OR (status IN ('pending','expired') AND created_at>?) ORDER BY updated_at LIMIT 50", now - 23 * 3600000, now - 48 * 3600000).all();
      for (const row of rows.results) {
        try {
          if (row.status === 'creating') await ensurePayment(env, row, provider, now);
          else {
            const updated = await refreshPayment(env, row, provider, now);
            if (updated.status === 'pending' && updated.expires_at && Date.parse(updated.expires_at) <= now) {
              await query(env, "UPDATE orders SET status='expired' WHERE id=? AND status='pending'", row.id).run();
            }
          }
        } catch { await query(env, 'UPDATE orders SET updated_at=? WHERE id=?', now, row.id).run(); }
      }
      await env.DB.batch([
        query(env, "UPDATE print_jobs SET status='uncertain',lease_token_hash=NULL,lease_until=0,last_error='Serviço interrompido durante envio ao spooler',updated_at=? WHERE status='leased' AND lease_until<?", now, now),
        query(env, 'DELETE FROM rate_limits WHERE expires_at<?', now),
        query(env, 'DELETE FROM orders WHERE created_at<?', now - 7 * 86400000),
      ]);
    },
  };
}
export default createWorker();
