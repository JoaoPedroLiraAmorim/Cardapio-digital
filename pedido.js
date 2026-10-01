/* Regras do pedido: valores em centavos; nenhum pagamento é processado aqui. */
(function (root) {
  const config = { whatsapp: "5512981440776", deliveryFee: 300, pix: { enabled: true, apiBaseUrl: "https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev" }, print: { enabled: true, apiBaseUrl: "https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev" } };
  const payments = { cash: "Dinheiro", debit: "Cartão de débito", credit: "Cartão de crédito", pix: "Pix" };
  const money = cents => (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const clean = value => String(value || "").replace(/[\r\n]+/g, " ").trim();
  function restore(value, products) {
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => item && products[item.id] && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 99 && !seen.has(item.id) && seen.add(item.id))
      .map(item => ({ id: item.id, quantity: item.quantity, notes: products[item.id].allowsNotes && typeof item.notes === "string" ? item.notes.slice(0, 240) : "" }));
  }
  function totals(cart, products, fulfillment) {
    const subtotal = cart.reduce((sum, item) => sum + products[item.id].price * item.quantity, 0);
    const delivery = cart.length && fulfillment === "delivery" ? config.deliveryFee : 0;
    return { subtotal, delivery, total: subtotal + delivery };
  }
  function message(cart, products, details) {
    const amounts = details.confirmedPayment || totals(cart, products, details.fulfillment);
    const delivery = details.fulfillment === "delivery";
    const pixConfirmed = details.payment === "pix" && details.confirmedPayment;
    const lines = [
      "Olá, JG Hamburgueria! 👋",
      "",
      pixConfirmed ? "Gostaria de confirmar este pedido:" : "Gostaria de fazer este pedido:",
      "",
      `👤 Cliente: ${clean(details.customer)}`,
      `${delivery ? "🛵" : "🏪"} Tipo: ${delivery ? "Entrega" : "Retirada"}`,
    ];
    if (delivery) {
      const address = [clean(details.address), clean(details.neighborhood) && `Bairro: ${clean(details.neighborhood)}`, clean(details.reference) && `Complemento/referência: ${clean(details.reference)}`].filter(Boolean).join(", ");
      lines.push(`📍 Endereço: ${address}`);
    }
    lines.push("", "🛒 Itens");
    cart.forEach(item => {
      const product = products[item.id];
      lines.push(`${item.quantity} × ${product.name} — ${money(product.price * item.quantity)}`);
      if (product.allowsNotes && clean(item.notes)) lines.push(`  Observação: ${clean(item.notes)}`);
    });
    if (clean(details.notes)) lines.push(`Observação do pedido: ${clean(details.notes)}`);
    lines.push("", "🧾 Resumo", `Subtotal: ${money(amounts.subtotal)}`, `Entrega: ${money(amounts.delivery)}`, `Total: ${money(amounts.total)}`, "");
    lines.push(pixConfirmed ? "✅ Pagamento: Pix confirmado." : `💳 Pagamento: ${payments[details.payment]}, na ${delivery ? "entrega" : "retirada"}.`);
    if (details.payment === "cash" && details.needsChange) lines.push(`Troco para: ${money(details.changeFor)}`);
    lines.push("", "🍔 Fico no aguardo da confirmação e do preparo. Obrigado!");
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
  function createPrintClient(value, { fetchImpl = root.fetch?.bind(root), cryptoImpl = root.crypto } = {}) {
    const base = printBaseUrl(value); let pending = null;
    function randomToken() { const bytes = cryptoImpl.getRandomValues(new Uint8Array(32)); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
    async function confirm(cart, details) {
      if (!base || !fetchImpl || !cryptoImpl?.randomUUID) throw new Error("Confirmação de pedido indisponível.");
      const payload = printPayload(cart, details); const serialized = JSON.stringify(payload);
      if (!pending || pending.serialized !== serialized) pending = { serialized, token:randomToken(), key:cryptoImpl.randomUUID() };
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
  const api = { config, money, restore, totals, message, createPrintClient, printPayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.JGOrder = api;
})(typeof window !== "undefined" ? window : this);
