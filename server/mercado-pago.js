// Backend only. Never bundle this module or credentials into Firebase Hosting.
const API = 'https://api.mercadopago.com/v1/payments';
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

function identifier(value) {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) reject('INVALID_RESPONSE', 502);
  const result = String(value ?? '');
  if (!/^[0-9]{1,30}$/.test(result)) reject('INVALID_RESPONSE', 502);
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

function normalize(payment) {
  if (!payment || payment.currency_id !== 'BRL' || payment.payment_method_id !== 'pix' ||
      !boundedString(payment.status, 40) || !boundedString(payment.external_reference, 128)) {
    reject('INVALID_RESPONSE', 502);
  }
  const data = payment.point_of_interaction?.transaction_data;
  const qrCode = data?.qr_code ?? null;
  const qrCodeBase64 = data?.qr_code_base64 ?? null;
  if (qrCode !== null && !boundedString(qrCode, 8192)) reject('INVALID_RESPONSE', 502);
  if (qrCodeBase64 !== null && (!boundedString(qrCodeBase64, 700000) || !/^[A-Za-z0-9+/]*={0,2}$/.test(qrCodeBase64))) reject('INVALID_RESPONSE', 502);
  const expiresAt = payment.date_of_expiration ?? null;
  if (expiresAt !== null && (!boundedString(expiresAt, 64) || !Number.isFinite(Date.parse(expiresAt)))) reject('INVALID_RESPONSE', 502);
  return {
    id: identifier(payment.id), status: payment.status,
    amountCents: amountToCents(payment.transaction_amount), externalReference: payment.external_reference,
    qrCode, qrCodeBase64, expiresAt,
    collectorId: identifier(payment.collector_id), currencyId: 'BRL', paymentMethodId: 'pix',
  };
}

async function request({ accessToken, fetchImpl, url, body, idempotencyKey }) {
  if (!boundedString(accessToken, 2048) || typeof fetchImpl !== 'function') reject();
  const controller = new AbortController();
  let timer;
  // Race bounds even injected fetch implementations that ignore AbortSignal.
  const timeout = new Promise((_, fail) => {
    timer = setTimeout(() => { controller.abort(); fail(new MercadoPagoError('PROVIDER_TIMEOUT', 504)); }, TIMEOUT_MS);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await fetchImpl(url, {
        method: body ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new MercadoPagoError(response.status === 429 ? 'PROVIDER_RATE_LIMIT' : 'PROVIDER_FAILURE', response.status === 429 ? 503 : 502);
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
      return normalize(JSON.parse(new TextDecoder().decode(bytes)));
    })()]);
  } catch (error) {
    if (error instanceof MercadoPagoError) throw error;
    throw new MercadoPagoError('PROVIDER_FAILURE');
  } finally { clearTimeout(timer); }
}

export async function createPix({ accessToken, idempotencyKey, amountCents, orderId, payerEmail, notificationUrl, fetchImpl = fetch }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 100000000 ||
      !boundedString(idempotencyKey, 64) || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey) ||
      !boundedString(orderId, 128) || !/^[A-Za-z0-9_-]+$/.test(orderId) ||
      !boundedString(payerEmail, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) reject();
  let webhook;
  try { webhook = new URL(notificationUrl); } catch { reject(); }
  if (webhook.protocol !== 'https:' || webhook.username || webhook.password || webhook.hash) reject();
  const payment = await request({ accessToken, fetchImpl, url: API, idempotencyKey, body: {
    transaction_amount: amountCents / 100, payment_method_id: 'pix',
    description: 'Pedido JG Hamburgueria', external_reference: orderId,
    payer: { email: payerEmail }, notification_url: webhook.href,
  } });
  if (payment.amountCents !== amountCents || payment.externalReference !== orderId ||
      (payment.status === 'pending' && (!payment.qrCode || !payment.qrCodeBase64))) reject('INVALID_RESPONSE', 502);
  return payment;
}

export async function getPayment({ accessToken, paymentId, fetchImpl = fetch }) {
  if (!/^[0-9]{1,30}$/.test(String(paymentId ?? '')) || (typeof paymentId === 'number' && !Number.isSafeInteger(paymentId))) reject();
  const payment = await request({ accessToken, fetchImpl, url: `${API}/${paymentId}` });
  if (payment.id !== String(paymentId)) reject('INVALID_RESPONSE', 502);
  return payment;
}

// Signature proves authenticity, not approval. Caller must re-query the payment.
// D1 must also make duplicate notifications/fulfillment idempotent.
export async function verifyWebhook({ secret, signature, requestId, dataId, now = Date.now() }) {
  if (!boundedString(secret, 2048) || !boundedString(signature, 300) ||
      !boundedString(requestId, 128) || !/^[A-Za-z0-9_-]+$/.test(requestId) ||
      !boundedString(String(dataId ?? ''), 128) || !/^[A-Za-z0-9_-]+$/.test(String(dataId))) return false;
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
