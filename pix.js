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
  function normalizeText(value, max, required = false) {
    if (typeof (value ?? '') !== 'string') throw new Error('Revise os dados do pedido antes de gerar o Pix.');
    const text = (value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
    if (text.length > max || /[\x00-\x1f\x7f]/.test(text) || (required && !text)) {
      throw new Error('Revise os dados do pedido antes de gerar o Pix.');
    }
    return text;
  }
  function validatePayload(cart, details) {
    if (!Array.isArray(cart) || !cart.length || cart.length > 12 || !['delivery', 'pickup'].includes(details?.fulfillment)) {
      throw new Error('Revise os itens do pedido antes de gerar o Pix.');
    }
    const ids = new Set();
    let count = 0;
    const items = cart.map(item => {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id) ||
          !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 20) {
        throw new Error('O Pix aceita até 20 unidades por produto. Ajuste o carrinho.');
      }
      ids.add(item.id); count += item.quantity;
      return { id: item.id, quantity: item.quantity, notes: normalizeText(item.notes, 240) };
    });
    if (count > 50) throw new Error('O Pix aceita até 50 unidades por pedido. Ajuste o carrinho.');
    const delivery = details.fulfillment === 'delivery';
    const payerEmail = normalizeText(details.payerEmail, 254, true);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail)) throw new Error('Informe um e-mail válido para gerar o Pix.');
    return { items, payment: 'pix', fulfillment: details.fulfillment,
      customer: normalizeText(details.customer, 80, true), address: normalizeText(details.address, 180, delivery),
      neighborhood: normalizeText(details.neighborhood, 80, delivery), reference: normalizeText(details.reference, 180),
      notes: normalizeText(details.notes, 500), payerEmail };
  }
  function summary(value) {
    return JSON.stringify([value.amountCents, value.subtotalCents, value.deliveryCents, value.fulfillment,
      value.items.map(item => [item.id, item.name, item.quantity, item.notes, item.priceCents]).sort((a, b) => a[0].localeCompare(b[0]))]);
  }
  function validateOrder(value) {
    if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) ||
        !['creating', 'pending', ...terminal].includes(value.status) ||
        !Number.isSafeInteger(value.amountCents) || value.amountCents <= 0 || value.amountCents > 150000 ||
        !Number.isSafeInteger(value.subtotalCents) || value.subtotalCents < 0 ||
        !Number.isSafeInteger(value.deliveryCents) || value.deliveryCents < 0 ||
        value.subtotalCents + value.deliveryCents !== value.amountCents ||
        !Array.isArray(value.items) || !value.items.length || value.items.length > 12 ||
        !['delivery', 'pickup'].includes(value.fulfillment)) throw new Error('Resposta de pagamento inválida.');
    let subtotal = 0, count = 0;
    const ids = new Set();
    for (const item of value.items) {
      if (!item || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) || ids.has(item.id) ||
          typeof item.name !== 'string' || !item.name || item.name.length > 160 ||
          typeof item.notes !== 'string' || item.notes.length > 240 || !Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 20 ||
          !Number.isSafeInteger(item.priceCents) || item.priceCents < 0) throw new Error('Resposta de pagamento inválida.');
      ids.add(item.id); count += item.quantity;
      subtotal += item.priceCents * item.quantity;
    }
    if (count > 50 || subtotal !== value.subtotalCents || (value.fulfillment === 'pickup' && value.deliveryCents !== 0)) throw new Error('Resposta de pagamento inválida.');
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
      const requestController = new AbortController();
      controller = requestController;
      const timer = setTimeout(() => requestController.abort(), 15000);
      try {
        const response = await fetchImpl(base + path, {
          method, mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: requestController.signal,
          headers: { Authorization: `Bearer ${current.token}`, ...(method === 'POST' ? { 'Content-Type': 'application/json', 'Idempotency-Key': current.key } : {}) },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        if (!response.ok) throw new Error('Não conseguimos confirmar o pagamento. Tente atualizar em instantes.');
        const result = validateOrder(await response.json());
        if ((current.order && result.id !== current.order.id) || result.fulfillment !== current.details.fulfillment) throw new Error('Resposta de pagamento inválida.');
        if (requestController.signal.aborted) throw new DOMException('Consulta interrompida.', 'AbortError');
        const previous = current.order;
        const invalidTransition = previous && (
          (previous.status !== 'creating' && result.status === 'creating') ||
          (terminal.has(previous.status) && result.status === 'pending') ||
          (previous.status === 'approved' && !['approved', 'refunded', 'charged_back'].includes(result.status)) ||
          (previous.status === 'refunded' && !['refunded', 'charged_back'].includes(result.status)) ||
          (previous.status === 'charged_back' && result.status !== 'charged_back'));
        if (invalidTransition || (previous && summary(previous) !== summary(result)) ||
            result.items.length !== current.payload.items.length || result.items.some(item => {
              const requested = current.payload.items.find(entry => entry.id === item.id);
              return !requested || requested.quantity !== item.quantity || requested.notes !== item.notes;
            })) throw new Error('Resposta de pagamento inválida.');
        current.order = result;
        return current;
      } finally { clearTimeout(timer); if (controller === requestController) controller = null; }
    }
    function exclusive(action) {
      if (inFlight) return inFlight;
      inFlight = action().finally(() => { inFlight = null; });
      return inFlight;
    }
    function start(cart, details) {
      if (!base) return Promise.reject(new Error('Pagamento online indisponível.'));
      if (!session) {
        let payload;
        try { payload = validatePayload(cart, details); } catch (error) { return Promise.reject(error); }
        const bytes = cryptoImpl.getRandomValues(new Uint8Array(32));
        const token = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        session = { token, key: cryptoImpl.randomUUID(), details: { ...details, ...payload }, order: null, payload };
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
  const api = { baseUrl, createClient, validateOrder, validatePayload };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JGPix = api;
})(typeof window !== 'undefined' ? window : globalThis);
