/* Regras do pedido: valores em centavos; nenhum pagamento é processado aqui. */
(function (root) {
  const deliveryNeighborhoods = {
    800: ["Centro", "Jardim Bela Vista", "Vila Maria", "Vila Nova Guarani", "Banhado", "Jardim Paulista", "Conjunto Residencial Monte Castelo", "Jardim Jussara", "Vila São Pedro", "Jardim Augusta", "Jardim Oswaldo Cruz", "Vila Adyana", "Jardim São Dimas", "Vila Rubi", "Vila Betânia", "Jardim Renata", "Jardim Maringá", "Jardim Esplanada", "Residencial Esplanada do Sol", "Jardim Apolo", "Vila Ema"],
    500: ["Eugênio de Melo", "Jardim Ipê", "Jardim Itapuã", "Residencial Armando Moreira Righi", "Residencial Galo Branco", "Conjunto Habitacional Jardim São José", "Jardim Americano", "Jardim Motorama", "Jardim Nova Detroit", "Jardim Nova Flórida", "Jardim Pararangaba", "Jardim Rodolfo", "Jardim São Vicente", "Residencial Ana Maria", "Residencial Campo Belo", "Residencial Frei Galvão", "Jardim Castanheira", "Jardim Cerejeiras", "Jardim Nova Michigan", "Jardim Paineiras I", "Jardim Paineiras II", "Jardim San Rafael", "Parque Nova Esperança", "Parque Novo Horizonte", "Residencial Dom Bosco", "Campos de São José"],
    400: ["Jardim Coqueiro"],
    300: ["Jardim Santa Inês I", "Jardim Santa Inês II", "Jardim Santa Inês III", "Jardim São José"],
    600: ["Jardim Helena", "Jardim Mariana", "Jardim Mariana II", "Pousada do Vale", "Vila Monterrey"],
    1500: ["Buquirinha", "Alto da Ponte", "Altos da Vila Paiva", "Caetê", "Conjunto Residencial Vila Leila", "Jardim Altos de Santana", "Jardim Boa Vista", "Jardim Guimarães", "Jardim Minas Gerais", "Jardim Santa Matilde", "Jardim Telespark", "Recanto Caetê", "Residencial Caminho das Montanhas", "Residencial Independência", "Residencial Mantiqueira", "Vila Cândida", "Vila Dirce", "Vila Leonídia", "Vila Maritéia", "Vila Monte Alegre", "Vila Nossa Senhora das Graças", "Vila Paiva", "Vila Santarém", "Vila São Geraldo", "Vila Sinhá", "Vila Unidos", "Vila Veneziani", "Bosque dos Ipês", "Campo dos Alemães", "Cidade Morumbi", "Conjunto Habitacional Dom Pedro I", "Conjunto Habitacional Dom Pedro II", "Conjunto Habitacional Elmano F. Veloso", "Conjunto Residencial 31 de Março", "Conjunto Residencial Morada do Sol", "Conjunto Residencial Morumbi", "Conjunto Residencial Primavera", "Conjunto Residencial Recanto Eucaliptos", "Conjunto Residencial Recanto Pinheiros", "Conjunto Habitacional Papa João Paulo II", "Jardim Colonial", "Jardim Cruzeiro do Sul", "Jardim dos Bandeirantes", "Jardim Imperial", "Jardim Juliana", "Jardim Nova República", "Jardim Petrópolis", "Jardim República", "Jardim Santa Edwiges", "Jardim Sul", "Jardim Terras do Sul", "Jardim Vale do Sol", "Jardim Veneza", "Parque dos Ypês", "Parque Independência", "Parque Residencial União", "Residencial Altos do Bosque", "Residencial de Ville", "Residencial Gazzo", "Vila das Flores", "Jardim Mesquita", "Parque Interlagos"]
  };
  const cleanNeighborhood = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
  const deliveryFees = Object.freeze(Object.fromEntries(Object.entries(deliveryNeighborhoods).flatMap(([fee, names]) => names.map(name => [cleanNeighborhood(name), Number(fee)]))));
  const config = { whatsapp: "5512981440776", deliveryFees, pix: { enabled: true, apiBaseUrl: "https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev" }, print: { enabled: true, apiBaseUrl: "https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev" } };
  const payments = { cash: "Dinheiro", debit: "Cartão de débito", credit: "Cartão de crédito", pix: "Pix" };
  const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const clean = value => String(value || "").replace(/[\r\n]+/g, " ").trim();
  function restore(value, products) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => item && products[item.id] && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99 && !seen.has(item.id) && seen.add(item.id))
      .map(item => ({ id: item.id, quantity: item.quantity, notes: products[item.id].allowsNotes && typeof item.notes === "string" ? item.notes.slice(0, 240) : "" }));
  }
  function deliveryFeeFor(neighborhood) { return deliveryFees[cleanNeighborhood(neighborhood)] || 0; }
  function totals(cart, products, fulfillment, neighborhood) {
    const subtotal = cart.reduce((sum, item) => sum + products[item.id].price * item.quantity, 0);
    const delivery = cart.length && fulfillment === "delivery" ? deliveryFeeFor(neighborhood) : 0;
    return { subtotal, delivery, total: subtotal + delivery };
  }
  function message(cart, products, details) {
    const amounts = details.confirmedPayment || totals(cart, products, details.fulfillment, details.neighborhood);
    const delivery = details.fulfillment === "delivery";
    const pixConfirmed = details.payment === "pix" && details.confirmedPayment;
    const lines = [
      "Ol\u00e1, JG Hamburgueria! \u{1F44B}",
      "",
      pixConfirmed ? "Gostaria de confirmar este pedido:" : "Gostaria de fazer este pedido:",
      "",
      `\u{1F464} Cliente: ${clean(details.customer)}`,
      `${delivery ? "\u{1F6F5}" : "\u{1F3EA}"} Tipo: ${delivery ? "Entrega" : "Retirada"}`,
    ];
    if (delivery) {
      const address = [clean(details.address), clean(details.neighborhood) && `Bairro: ${clean(details.neighborhood)}`, clean(details.reference) && `Complemento/referência: ${clean(details.reference)}`].filter(Boolean).join(", ");
      lines.push(`\u{1F4CD} Endereço: ${address}`);
    }
    lines.push("", "\u{1F6D2} Itens");
    cart.forEach(item => {
      const product = products[item.id];
      lines.push(`${item.quantity} × ${product.name} — ${money(product.price * item.quantity)}`);
      if (product.allowsNotes && clean(item.notes)) lines.push(`  Observação: ${clean(item.notes)}`);
    });
    if (clean(details.notes)) lines.push(`Observação do pedido: ${clean(details.notes)}`);
    lines.push("", "\u{1F9FE} Resumo", `Subtotal: ${money(amounts.subtotal)}`, `Entrega: ${money(amounts.delivery)}`, `Total: ${money(amounts.total)}`, "");
    lines.push(pixConfirmed ? "\u2705 Pagamento: Pix confirmado." : `\u{1F4B3} Pagamento: ${payments[details.payment]}, na ${delivery ? "entrega" : "retirada"}.`);
    if (details.payment === "cash" && details.needsChange) lines.push(`Troco para: ${money(details.changeFor)}`);
    lines.push("", "\u{1F354} Fico no aguardo da confirmação e do preparo. Obrigado!");
    return lines.join("\n");
  }
  function printBaseUrl(value) {
    if (!value?.enabled) return null;
    try { const url = new URL(value.apiBaseUrl); return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && url.pathname === "/" ? url.origin : null; } catch { return null; }
  }
  function printPayload(cart, details) {
    if (!Array.isArray(cart) || !cart.length || !["delivery", "pickup"].includes(details.fulfillment) || !Object.hasOwn(payments, details.payment)) throw new Error("Revise o pedido antes de confirmar.");
    return { items: cart.map(item => ({ id:item.id, quantity:item.quantity, notes:clean(item.notes) })), payment:details.payment, fulfillment:details.fulfillment,
      customer:clean(details.customer), address:clean(details.address), neighborhood:clean(details.neighborhood), reference:clean(details.reference), notes:clean(details.notes),
      needsChange:details.payment === "cash" && details.needsChange === true, changeForCents:details.payment === "cash" && details.needsChange ? details.changeFor : 0 };
  }
  function createPrintClient(value, { fetchImpl = root.fetch?.bind(root), cryptoImpl = root.crypto, storageImpl } = {}) {
    const base = printBaseUrl(value); let pending = null;
    const storageKey = "jg-print-confirmation-v1";
    const maxPendingAge = 30 * 60 * 1000;
    let storage = storageImpl || null;
    try { if (storageImpl === undefined) storage = root.localStorage || null; } catch { /* Armazenamento pode estar bloqueado. */ }
    async function payloadHash(serialized) {
      if (!cryptoImpl?.subtle) return null;
      const bytes = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(serialized));
      return [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, "0")).join("");
    }
    function readPending(hash) {
      if (!storage || !hash) return null;
      try {
        const saved = JSON.parse(storage.getItem(storageKey));
        const fresh = Number.isFinite(saved?.createdAt) && Date.now() - saved.createdAt >= 0 && Date.now() - saved.createdAt <= maxPendingAge;
        const token = /^[A-Za-z0-9_-]{43}$/.test(saved?.token || "");
        const key = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(saved?.key || "");
        return fresh && token && key && saved.payloadHash === hash ? saved : null;
      } catch { return null; }
    }
    function savePending(value) {
      if (!storage || !value.payloadHash) return;
      try { storage.setItem(storageKey, JSON.stringify({ payloadHash:value.payloadHash, token:value.token, key:value.key, createdAt:value.createdAt })); } catch { /* A confirmação continua idempotente nesta aba. */ }
    }
    function randomToken() { const bytes = cryptoImpl.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
    async function confirm(cart, details) {
      if (!base || !fetchImpl || !cryptoImpl?.randomUUID || !cryptoImpl?.getRandomValues) throw new Error("Confirmação de pedido indisponível.");
      const payload = printPayload(cart, details); const serialized = JSON.stringify(payload);
      const hash = await payloadHash(serialized);
      if (!pending || pending.serialized !== serialized) {
        const saved = readPending(hash);
        pending = saved ? { ...saved, serialized } : { serialized, payloadHash:hash, token:randomToken(), key:cryptoImpl.randomUUID(), createdAt:Date.now() };
        savePending(pending);
      }
      const response = await fetchImpl(`${base}/api/print/orders`, { method:"POST", mode:"cors", credentials:"omit", cache:"no-store", redirect:"error",
        headers:{ "Content-Type":"application/json", Authorization:`Bearer ${pending.token}`, "Idempotency-Key":pending.key }, body:serialized });
      if (!response.ok) throw new Error("Não conseguimos confirmar a comanda agora. Tente novamente antes de abrir o WhatsApp.");
      const result = await response.json(); if (!result?.queued || typeof result.id !== "string") throw new Error("Resposta de confirmação inválida.");
      return result;
    }
    async function confirmApproved(order) {
      if (!base || !order?.id || !pending) throw new Error("Confirmação de pedido indisponível.");
      const response = await fetchImpl(`${base}/api/print/orders/${encodeURIComponent(order.id)}`, { method:"POST", mode:"cors", credentials:"omit", cache:"no-store", redirect:"error", headers:{ Authorization:`Bearer ${pending.token}` } });
      if (!response.ok) throw new Error("Não conseguimos confirmar a comanda agora. Tente novamente antes de abrir o WhatsApp.");
      const result = await response.json(); if (!result?.queued || result.id !== order.id) throw new Error("Resposta de confirmação inválida."); return result;
    }
    return { enabled:!!base, confirm, confirmApproved, beginPix: (token, key) => { pending = { serialized:"", token, key }; } };
  }
  const api = { config, money, restore, totals, message, createPrintClient, printPayload, deliveryFeeFor, deliveryNeighborhoods };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JGOrder = api;
})(typeof window !== "undefined" ? window : this);
