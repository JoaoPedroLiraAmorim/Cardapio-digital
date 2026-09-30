/* Cliente Pix: estado e autorização ficam somente na memória desta página. */
(function (root) {
  const terminal = new Set(['approved', 'rejected', 'cancelled', 'expired', 'refunded', 'charged_back']);
  function baseUrl(config) {
    if (!config?.enabled) return null;
    try {
      const url = new URL(config.apiBaseUrl);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
      return url.origin;
    } catch { return null; }
  }
  function validateOrder(value) {
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        !['creating', 'pending', ...terminal].includes(value.status) ||
        !Number.isSafeInteger(value.amountCents) || value.amountCents <= 0 ||
        !Number.isSafeInteger(value.subtotalCents) || value.subtotalCents < 0 ||
        !Number.isSafeInteger(value.deliveryCents) || value.deliveryCents < 0 ||
        value.subtotalCents + value.deliveryCents !== value.amountCents ||
        !Array.isArray(value.items) || !value.items.length || value.items.length > 50 ||
        !['delivery', 'pickup'].includes(value.fulfillment)) throw new Error('Resposta de pagamento inválida.');
    let subtotal = 0;
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || item.name.length > 160 ||
          typeof item.notes !== 'string' || item.notes.length > 240 || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 99 ||
          !Number.isSafeInteger(item.priceCents) || item.priceCents < 0) throw new Error('Resposta de pagamento inválida.');
      subtotal += item.priceCents * item.quantity;
    }
    if (subtotal !== value.subtotalCents) throw new Error('Resposta de pagamento inválida.');
    if (value.status === 'pending' && (typeof value.qrCode !== 'string' || !value.qrCode || value.qrCode.length > 8192 ||
        typeof value.qrCodeBase64 !== 'string' || value.qrCodeBase64.length > 700000 ||
        !/^iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value.qrCodeBase64))) throw new Error('QR Code inválido.');
    if (value.expiresAt && !Number.isFinite(Date.parse(value.expiresAt))) throw new Error('Prazo de pagamento inválido.');
    return value;
  }
  function createClient(config, { fetchImpl = root.fetch.bind(root), cryptoImpl = root.crypto } = {}) {
    const base = baseUrl(config);
    let session = null;
    let inFlight = null;
    let controller = null;
    function pause() { controller?.abort(); }
    async function send(method, path, body) {
      const current = session;
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 15000);
      try {
        const response = await fetchImpl(base + path, {
          method, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { Authorization: `Bearer ${current.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': current.key } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error('Não conseguimos confirmar o pagamento. Tente atualizar em instantes.');
        const result = validateOrder(await response.json());
        if ((current.order && result.id !== current.order.id) || result.fulfillment !== current.details.fulfillment) throw new Error('Resposta de pagamento inválida.');
        if (current.order?.status === 'approved' && result.status === 'pending') throw new Error('Resposta de pagamento inválida.');
        current.order = result;
        return current;
      } finally { clearTimeout(timer); controller = null; }
    }
    function exclusive(action) {
      if (inFlight) return inFlight;
      inFlight = action().finally(() => { inFlight = null; });
      return inFlight;
    }
    function start(cart, details) {
      if (!base) return Promise.reject(new Error('Pagamento online indisponível.'));
      if (!session) {
        const bytes = cryptoImpl.getRandomValues(new Uint8Array(32));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        session = { token, key: cryptoImpl.randomUUID(), details: { ...details }, order: null,
          payload: { items: cart.map(item => ({ ...item })), payment: 'pix', fulfillment: details.fulfillment,
            customer: details.customer, address: details.address || '', neighborhood: details.neighborhood || '',
            reference: details.reference || '', notes: details.notes || '', payerEmail: details.payerEmail } };
      }
      // Always replay the original body and key after an ambiguous network error.
      return exclusive(() => session.order ? send('GET', `/api/orders/${session.order.id}`) : send('POST', '/api/orders', session.payload));
    }
    function refresh() {
      if (!session) return Promise.reject(new Error('Pedido não iniciado.'));
      return start([], session.details);
    }
    return { enabled: !!base, start, refresh, pause, getSession: () => session,
      reset: () => { if (!inFlight && session?.order && terminal.has(session.order.status) && session.order.status !== 'approved') session = null; },
      finish: () => { if (!inFlight && session?.order?.status === 'approved') session = null; },
      isTerminal: status => terminal.has(status) };
  }
  const api = { baseUrl, createClient, validateOrder };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JGPix = api;
})(typeof window !== 'undefined' ? window : globalThis);
