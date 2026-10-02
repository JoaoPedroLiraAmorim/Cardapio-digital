// Backend only. Never bundle this module or credentials into Firebase Hosting.
const API = 'https://api.mercadopago.com/v1/orders';
const TIMEOUT_MS = 10000;
const WEBHOOK_WINDOW_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

export class MercadoPagoError extends Error {
  constructor(code, status = 502) {
    super('Não foi possível processar o pagamento.');
    this.name = 'MercadoPagoError';
    this.code = code;
    this.status = status;
  }
}

function reject(code = 'INVALID_INPUT', status = 400) {
  throw new MercadoPagoError(code, status);
}

function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value);
}

function safeErrorBody(text) {
  const limited = String(text || '').slice(0, 4096)
    .replace(/(?:APP_USR|TEST)-[A-Za-z0-9_\-]+/gi, '[redacted-token]')
    .replace(/\bprivate[-_][A-Za-z0-9_-]+/gi, '[redacted-secret]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted-email]');
  try {
    const value = JSON.parse(limited);
    if (value && typeof value === 'object') {
      delete value.payer;
      delete value.authorization;
      delete value.access_token;
    }
    return value;
  } catch { return limited; }
}

function identifier(value, response = true) {
  const result = String(value ?? '');
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result)) reject(response ? 'INVALID_RESPONSE' : 'INVALID_INPUT', response ? 502 : 400);
  return result;
}

function collectorIdentifier(value) {
  const result = String(value ?? '');
  if (!/^\d{1,30}$/.test(result)) reject('INVALID_RESPONSE', 502);
  return result;
}

// Parse a decimal representation, without floating-point multiplication/rounding.
export function amountToCents(value) {
  const decimal = String(value ?? '');
  if (!/^(0|[1-9]\d{0,10})(\.\d{1,2})?$/.test(decimal)) reject('INVALID_RESPONSE', 502);
  const [whole, fractional = ''] = decimal.split('.');
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) reject('INVALID_RESPONSE', 502);
  return cents;
}

function normalizeStatus(status, statusDetail) {
  if (status === 'action_required' && statusDetail === 'waiting_transfer') return 'pending';
  if (status === 'processed' && statusDetail === 'accredited') return 'approved';
  if (status === 'canceled') return 'cancelled';
  if (status === 'failed') return 'rejected';
  if (status === 'refunded' || status === 'expired') return status;
  if (status === 'created' || status === 'processing') return 'creating';
  reject('INVALID_RESPONSE', 502);
}

function normalize(order) {
  if (!order || !boundedString(order.status, 40) || !boundedString(order.external_reference, 64)) reject('INVALID_RESPONSE', 502);
  const statusDetail = order.status_detail ?? null;
  if (statusDetail !== null && !boundedString(statusDetail, 80)) reject('INVALID_RESPONSE', 502);
  const payment = order.transactions?.payments?.[0];
  const method = payment?.payment_method;
  const status = normalizeStatus(order.status, statusDetail);
  if (status !== 'creating' && (!payment || method?.id !== 'pix' || method?.type !== 'bank_transfer')) reject('INVALID_RESPONSE', 502);
  if (method && (method.id !== 'pix' || method.type !== 'bank_transfer')) reject('INVALID_RESPONSE', 502);
  const qrCode = method?.qr_code ?? null;
  const qrCodeBase64 = method?.qr_code_base64 ?? null;
  const ticketUrl = method?.ticket_url ?? null;
  if (qrCode !== null && !boundedString(qrCode, 8192)) reject('INVALID_RESPONSE', 502);
  if (qrCodeBase64 !== null && (!boundedString(qrCodeBase64, 700000) || !/^[A-Za-z0-9+/]*={0,2}$/.test(qrCodeBase64))) reject('INVALID_RESPONSE', 502);
  if (ticketUrl !== null) {
    try {
      const url = new URL(ticketUrl);
      if (!boundedString(ticketUrl, 4096) || url.protocol !== 'https:' || url.username || url.password) reject('INVALID_RESPONSE', 502);
    } catch { reject('INVALID_RESPONSE', 502); }
  }
  return {
    id: identifier(order.id), status, statusDetail,
    amountCents: amountToCents(order.total_amount), externalReference: order.external_reference,
    qrCode, qrCodeBase64, ticketUrl, expiresAt: null,
    collectorId: order.user_id === undefined || order.user_id === null ? null : collectorIdentifier(order.user_id),
    currencyId: order.currency_id || 'BRL', paymentMethodId: method?.id || 'pix',
  };
}

async function readResponse(response) {
  if (!response.body) reject('INVALID_RESPONSE', 502);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_RESPONSE_BYTES) { await reader.cancel(); reject('INVALID_RESPONSE', 502); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(bytes);
}

async function request({ accessToken, fetchImpl, url, body, idempotencyKey }) {
  if (!boundedString(accessToken, 2048) || typeof fetchImpl !== 'function') reject();
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => { controller.abort(); fail(new MercadoPagoError('PROVIDER_TIMEOUT', 504)); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const raw = await readResponse(response);
      if (!response.ok) {
        const responseBody = safeErrorBody(raw);
        console.error('Mercado Pago HTTP error', {
          status: response.status,
          error: responseBody?.error,
          message: responseBody?.message,
          cause: responseBody?.cause,
          errors: responseBody?.errors,
          responseBody,
        });
        throw new MercadoPagoError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_FAILURE', response.status === 429 ? 503 : 502);
      }
      try { return normalize(JSON.parse(raw)); }
      catch (error) {
        if (error instanceof MercadoPagoError) throw error;
        console.error('Mercado Pago invalid response', { status: response.status, responseBody: safeErrorBody(raw) });
        reject('INVALID_RESPONSE', 502);
      }
    })()]);
  } catch (error) {
    console.error('Mercado Pago request failed', {
      name: error?.name,
      code: error?.code,
      status: error?.status,
      message: typeof error?.message === 'string' ? error.message.slice(0, 120) : undefined,
    });
    if (error instanceof MercadoPagoError) throw error;
    throw new MercadoPagoError('PROVIDER_FAILURE');
  } finally { clearTimeout(timer); }
}

export async function createPix({ accessToken, idempotencyKey, amountCents, orderId, payerEmail, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000 ||
      !boundedString(idempotencyKey, 64) || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey) ||
      !boundedString(orderId, 64) || !/^[A-Za-z0-9_-]+$/.test(orderId) ||
      !boundedString(payerEmail, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) reject();
  const amount = (amountCents / 100).toFixed(2);
  let order = await request({ accessToken, fetchImpl, url: API, idempotencyKey, body: {
    type: 'online', total_amount: amount, external_reference: orderId,
    processing_mode: 'automatic',
    transactions: { payments: [{ amount, payment_method: { id: 'pix', type: 'bank_transfer' } }] },
    payer: { email: payerEmail },
  } });
  // The creation response may omit user_id. Re-query the new order before the Worker
  // validates the receiver, so a successfully created Pix is never reported as failed.
  if (!order.collectorId) order = await request({ accessToken, fetchImpl, url: `${API}/${encodeURIComponent(order.id)}` });
  if (!order.collectorId || order.amountCents !== amountCents || order.externalReference !== orderId || order.currencyId !== 'BRL' ||
      (order.status === 'pending' && (!order.qrCode || !order.qrCodeBase64))) reject('INVALID_RESPONSE', 502);
  return order;
}

export async function getPayment({ accessToken, paymentId, fetchImpl = fetch }) {
  const id = identifier(paymentId, false);
  const order = await request({ accessToken, fetchImpl, url: `${API}/${encodeURIComponent(id)}` });
  if (order.id !== id) reject('INVALID_RESPONSE', 502);
  return order;
}

// Signature proves authenticity, not approval. Caller must re-query the order.
export async function verifyWebhook({ secret, signature, requestId, dataId, now = Date.now() }) {
  if (!boundedString(secret, 2048) || !boundedString(signature, 300) ||
      !boundedString(requestId, 128) || !/^[A-Za-z0-9_-]+$/.test(requestId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(String(dataId ?? ''))) return false;
  const fields = signature.split(',').map(part => part.trim().split('='));
  if (fields.length !== 2 || fields.some(part => part.length !== 2) || new Set(fields.map(part => part[0])).size !== 2) return false;
  const values = Object.fromEntries(fields);
  if (!/^\d{10,13}$/.test(values.ts ?? '') || !/^[a-fA-F0-9]{64}$/.test(values.v1 ?? '')) return false;
  const timestamp = Number(values.ts) * (values.ts.length <= 10 ? 1000 : 1);
  if (!Number.isFinite(now) || Math.abs(now - timestamp) > WEBHOOK_WINDOW_MS) return false;
  const manifest = `id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${values.ts};`;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = Uint8Array.from(values.v1.match(/../g), pair => parseInt(pair, 16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(manifest));
}
