/**
 * JG Hamburgueria - Cardápio Digital (Consulta Local)
 * Navegação suave e precisa sem travamentos ou puxões no scroll
 */

document.addEventListener("DOMContentLoaded", () => {
  const catTabs = document.querySelectorAll(".cat-tab");
  const sections = document.querySelectorAll(".menu-section");
  const categoryBarWrap = document.querySelector(".category-bar-wrap");

  let isProgrammaticScroll = false;
  let scrollTimeout = null;

  // Função para rolar até a seção desejada compensando a barra fixa
  const scrollToTarget = (targetId) => {
    const targetElement = document.querySelector(targetId);
    if (!targetElement) return;

    const navBar = document.querySelector(".category-bar");
    const navBarHeight = navBar ? navBar.offsetHeight : 54;
    
    // Calcula posição exata
    const targetPosition = targetElement.getBoundingClientRect().top + window.pageYOffset - navBarHeight - 10;

    isProgrammaticScroll = true;

    // Atualiza imediatamente a aba ativa
    catTabs.forEach((tab) => {
      const isCurrent = tab.getAttribute("href") === targetId;
      tab.classList.toggle("active", isCurrent);
      if (isCurrent) tab.setAttribute("aria-current", "location");
      else tab.removeAttribute("aria-current");
    });
    centralizarAbaHorizontal(targetId);

    window.scrollTo({
      top: targetPosition,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(finishProgrammaticScroll, 200);
  };

  // Centraliza a aba ativa APENAS dentro da barra horizontal (sem interferir no scroll vertical)
  const centralizarAbaHorizontal = (targetId) => {
    if (!categoryBarWrap || categoryBarWrap.scrollWidth <= categoryBarWrap.clientWidth) return;
    const activeTab = categoryBarWrap.querySelector(`.cat-tab[href="${targetId}"]`);
    if (!activeTab) return;

    const tabLeft = activeTab.offsetLeft;
    const tabWidth = activeTab.offsetWidth;
    const containerWidth = categoryBarWrap.offsetWidth;

    categoryBarWrap.scrollTo({
      left: tabLeft - (containerWidth / 2) + (tabWidth / 2),
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  };

  // Cliques nas abas da barra fixa de categorias
  catTabs.forEach((tab) => {
    tab.addEventListener("click", (e) => {
      e.preventDefault();
      const targetId = tab.getAttribute("href");
      if (targetId && targetId !== "#") {
        scrollToTarget(targetId);
      }
    });
  });

  // Acompanhamento do scroll manual leve e fluido
  let ticking = false;

  window.addEventListener("scroll", () => {
    if (isProgrammaticScroll) {
      clearTimeout(scrollTimeout);
      scrollTimeout = setTimeout(finishProgrammaticScroll, 200);
      return;
    }

    if (!ticking) {
      window.requestAnimationFrame(() => {
        if (!isProgrammaticScroll) atualizarAbaAtivaPorPosicao();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  function finishProgrammaticScroll() {
    clearTimeout(scrollTimeout);
    isProgrammaticScroll = false;
    atualizarAbaAtivaPorPosicao();
  }
  window.addEventListener("scrollend", finishProgrammaticScroll);
  window.addEventListener("wheel", finishProgrammaticScroll, { passive: true });
  window.addEventListener("touchstart", finishProgrammaticScroll, { passive: true });
  window.addEventListener("keydown", event => {
    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) finishProgrammaticScroll();
  });

  const atualizarAbaAtivaPorPosicao = () => {
    const navBarHeight = (document.querySelector(".category-bar")?.offsetHeight || 54) + 60;
    let secaoAtualId = sections[0]?.getAttribute("id") || "";

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= navBarHeight) {
        secaoAtualId = section.getAttribute("id");
      }
    });

    // Se estiver no topo da página
    if (window.pageYOffset < 150) {
      secaoAtualId = sections[0]?.getAttribute("id") || "";
    }

    if (secaoAtualId) {
      catTabs.forEach((tab) => {
        const isCurrent = tab.getAttribute("href") === `#${secaoAtualId}`;
        if (tab.classList.contains("active") !== isCurrent) {
          tab.classList.toggle("active", isCurrent);
          if (isCurrent) {
            centralizarAbaHorizontal(`#${secaoAtualId}`);
          }
        }
        if (isCurrent) tab.setAttribute("aria-current", "location");
        else tab.removeAttribute("aria-current");
      });
    }
  };
  atualizarAbaAtivaPorPosicao();
  window.addEventListener("pageshow", finishProgrammaticScroll);
  window.addEventListener("resize", finishProgrammaticScroll);
});

document.addEventListener("DOMContentLoaded", () => {
  const order = window.JGOrder;
  const products = Object.create(null);
  const storageKey = "jg-cart-v1";
  const dialog = document.querySelector("#cart-dialog");
  const form = document.querySelector("#checkout-form");
  const items = document.querySelector("#cart-items");
  const dock = document.querySelector(".cart-dock");
  const status = document.querySelector("#cart-status");
  const pix = window.JGPix.createClient(order.config.pix);
  const printer = order.createPrintClient(order.config.print);
  const pixPanel = document.querySelector("#pix-panel");
  const pixState = document.querySelector("#pix-state");
  const pixRefresh = document.querySelector("#pix-refresh");
  let pixTimer;
  let pixAttempts = 0;
  let pixBusy = false;
  let toastTimeout;
  let cart = [];

  document.querySelectorAll("[data-product-id]").forEach(card => {
    const id = card.dataset.productId;
    products[id] = { name: card.querySelector("h3").textContent, price: Number(card.dataset.price), allowsNotes: !card.classList.contains("drink-item") };
    card.querySelector(".item-price, .drink-price").textContent = order.money(products[id].price);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "add-button";
    button.textContent = "+ Adicionar";
    button.setAttribute("aria-label", `Adicionar ${products[id].name} ao carrinho`);
    button.addEventListener("click", () => {
      if (pix.getSession()) return announce("Conclua o pedido Pix em andamento antes de alterar o carrinho.");
      const existing = cart.find(item => item.id === id);
      if (existing?.quantity === 99) return announce("Limite de 99 unidades por produto.");
      if (existing) existing.quantity++;
      else cart.push({ id, quantity: 1, notes: "" });
      save();
      render();
      announce(`${products[id].name} adicionado ao carrinho`);
    });
    card.append(button);
  });

  try { cart = order.restore(JSON.parse(localStorage.getItem(storageKey)), products); } catch { /* O carrinho continua funcionando sem armazenamento. */ }
  function save() {
    try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch { /* Navegação privada ou armazenamento cheio. */ }
  }
  function announce(text) {
    clearTimeout(toastTimeout);
    status.textContent = text;
    status.classList.add("visible");
    toastTimeout = setTimeout(() => status.classList.remove("visible"), 2600);
  }
  function updateTotals() {
    const amounts = order.totals(cart, products, form.elements.fulfillment.value);
    document.querySelector("#cart-count").textContent = `· ${cart.reduce((sum, item) => sum + item.quantity, 0)} itens`;
    document.querySelector("#cart-dock-total").textContent = order.money(amounts.subtotal);
    document.querySelector("#subtotal").textContent = order.money(amounts.subtotal);
    document.querySelector("#delivery-fee").textContent = amounts.delivery ? order.money(amounts.delivery) : "Grátis";
    document.querySelector("#delivery-label").textContent = form.elements.fulfillment.value === "pickup" ? "Retirada" : "Entrega";
    document.querySelector("#order-total").textContent = order.money(amounts.total);
    form.elements.changeFor.min = (amounts.total / 100).toFixed(2);
    form.elements.changeFor.setCustomValidity("");
  }
  function render() {
    dock.hidden = !cart.length;
    form.hidden = !cart.length;
    document.querySelector("#empty-cart").hidden = !!cart.length;
    document.body.classList.toggle("has-cart", !!cart.length);
    items.replaceChildren();
    cart.forEach(item => {
      const row = document.createElement("article");
      row.className = "cart-item";
      const heading = document.createElement("div");
      heading.className = "cart-item-heading";
      const title = document.createElement("h3");
      title.textContent = products[item.id].name;
      const price = document.createElement("strong");
      price.textContent = order.money(products[item.id].price * item.quantity);
      heading.append(title, price);
      const controls = document.createElement("div");
      controls.className = "quantity-controls";
      const minus = document.createElement("button");
      const plus = document.createElement("button");
      const count = document.createElement("span");
      const remove = document.createElement("button");
      [minus, plus, remove].forEach(button => { button.type = "button"; });
      minus.textContent = "−";
      plus.textContent = "+";
      count.textContent = item.quantity;
      remove.textContent = "Remover";
      remove.className = "remove-button";
      minus.setAttribute("aria-label", `Diminuir quantidade de ${products[item.id].name}`);
      plus.setAttribute("aria-label", `Aumentar quantidade de ${products[item.id].name}`);
      remove.setAttribute("aria-label", `Remover ${products[item.id].name}`);
      plus.disabled = item.quantity >= 99;
      const change = delta => {
        if (pix.getSession()) return announce("Conclua o pedido Pix em andamento antes de alterar o carrinho.");
        item.quantity += delta;
        if (item.quantity <= 0) cart = cart.filter(entry => entry !== item);
        save(); render();
        const updated = items.querySelector(`[data-product="${item.id}"]`);
        (updated?.querySelector(delta > 0 ? ".quantity-controls button:nth-of-type(2)" : ".quantity-controls button") || items.querySelector("button") || document.querySelector("#close-cart")).focus();
      };
      row.dataset.product = item.id;
      minus.addEventListener("click", () => change(-1));
      plus.addEventListener("click", () => change(1));
      remove.addEventListener("click", () => change(-item.quantity));
      controls.append(minus, count, plus, remove);
      row.append(heading, controls);
      if (products[item.id].allowsNotes) {
        const label = document.createElement("label");
        label.className = "field item-note";
        label.textContent = "Observação deste item (opcional)";
        const notes = document.createElement("input");
        notes.maxLength = 240;
        notes.placeholder = "Ex.: um sem cebola, outro sem picles";
        notes.value = item.notes;
        notes.addEventListener("input", () => { if (pix.getSession()) return; item.notes = notes.value; save(); });
        label.append(notes);
        row.append(label);
      }
      items.append(row);
    });
    updateTotals();
    syncPixLock();
  }
  function updateFields() {
    const delivery = form.elements.fulfillment.value === "delivery";
    document.querySelector("#address-fields").hidden = !delivery;
    ["address", "neighborhood", "reference"].forEach(name => {
      form.elements[name].disabled = !delivery;
      form.elements[name].required = delivery && name !== "reference";
    });
    const cash = form.elements.payment.value === "cash";
    const change = cash && form.elements.needsChange.checked;
    document.querySelector("#cash-fields").hidden = !cash;
    document.querySelector("#change-field").hidden = !change;
    form.elements.changeFor.disabled = !change;
    form.elements.changeFor.required = change;
    const onlinePix = pix.enabled && form.elements.payment.value === "pix";
    document.querySelector("#pix-email-field").hidden = !onlinePix;
    form.elements.payerEmail.disabled = !onlinePix;
    form.elements.payerEmail.required = onlinePix;
    document.querySelector("#checkout-submit").textContent = onlinePix ? "Gerar Pix para pagar" : "Confirmar pedido e abrir WhatsApp ↗";
    document.querySelector("#payment-hint").textContent = onlinePix ? "Você paga pelo aplicativo do seu banco. Após aprovação, confirme para enviar a comanda e abrir o WhatsApp." : "Confirme para enviar a comanda à hamburgueria e depois abra o WhatsApp.";
    updateTotals();
  }
  function syncPixLock() {
    const locked = !!pix.getSession();
    document.querySelectorAll(".add-button, #cart-items button, #cart-items input").forEach(control => {
      control.disabled = locked || (control.textContent === "+" && Number(control.previousElementSibling?.textContent) >= 99);
    });
    form.hidden = locked || !cart.length;
    pixPanel.hidden = !locked;
  }
  function stopPixPolling() { clearTimeout(pixTimer); pixTimer = null; }
  function showPix() {
    syncPixLock();
    const session = pix.getSession();
    if (!session) return;
    const payment = session.order;
    const state = payment?.status || "creating";
    const labels = { creating: "Estamos gerando seu Pix…", pending: "Aguardando pagamento. A confirmação é automática.", approved: "Pagamento confirmado! Envie agora seu pedido para a hamburgueria.", rejected: "Pagamento recusado. Você pode voltar ao pedido.", cancelled: "Pagamento cancelado. Você pode voltar ao pedido.", expired: "O Pix expirou. Volte ao pedido para tentar novamente.", refunded: "Este pagamento foi devolvido. Fale com a hamburgueria antes de pedir novamente.", charged_back: "Este pagamento foi contestado. Fale com a hamburgueria." };
    pixState.textContent = labels[state];
    document.querySelector("#pix-total").textContent = payment ? order.money(payment.amountCents) : "Conferindo…";
    const summary = document.querySelector("#pix-summary");
    summary.replaceChildren();
    payment?.items.forEach(item => { const row = document.createElement("li"); row.textContent = `${item.quantity} × ${item.name} — ${order.money(item.quantity * item.priceCents)}`; summary.append(row); });
    document.querySelector("#pix-code-panel").hidden = state !== "pending";
    const qr = document.querySelector("#pix-qr");
    if (state === "pending") {
      qr.src = `data:image/png;base64,${payment.qrCodeBase64}`;
      document.querySelector("#pix-code").value = payment.qrCode;
      document.querySelector("#pix-expiration").textContent = payment.expiresAt ? `Pague até ${new Date(payment.expiresAt).toLocaleString("pt-BR")}.` : "";
    } else { qr.removeAttribute("src"); document.querySelector("#pix-code").value = ""; }
    document.querySelector("#pix-whatsapp").hidden = state !== "approved";
    document.querySelector("#pix-whatsapp").disabled = pixBusy;
    document.querySelector("#pix-edit").hidden = !pix.isTerminal(state) || state === "approved";
    if (state !== "approved") document.querySelector("#pix-new-order").hidden = true;
    pixRefresh.hidden = pix.isTerminal(state);
    pixRefresh.disabled = pixBusy;
    pixRefresh.textContent = payment ? "Atualizar pagamento" : "Tentar gerar Pix novamente";
    if (pix.isTerminal(state)) stopPixPolling();
  }
  function schedulePixPolling() {
    stopPixPolling();
    const state = pix.getSession()?.order?.status;
    if (!dialog.open || !["pending", "creating"].includes(state)) return;
    if (pixAttempts >= 60) { pixState.textContent = "Ainda aguardando. Toque em atualizar pagamento quando concluir no banco."; return; }
    const delay = pixAttempts < 6 ? 10000 : pixAttempts < 20 ? 15000 : 30000;
    pixTimer = setTimeout(() => { pixAttempts++; runPix(true); }, delay);
  }
  async function runPix(poll = false, details = null) {
    if (pixBusy) return;
    pixBusy = true;
    stopPixPolling();
    try {
      const promise = details ? pix.start(cart, details) : pix.refresh();
      // A consulta automática acontece em segundo plano. Não redesenhe o
      // botão como desabilitado durante a espera, pois isso causa um piscar a
      // cada ciclo e parece um clique que o cliente não fez.
      if (!poll) showPix();
      if (details) document.querySelector("#pix-title").focus();
      await promise;
      showPix();
      schedulePixPolling();
    } catch (error) {
      if (dialog.open) {
        if (!pix.getSession()) { announce(error.message); return; }
        showPix();
        pixState.textContent = "Não conseguimos confirmar agora. Atualize o pagamento; sua tentativa será retomada sem gerar outro pedido.";
        if (poll) schedulePixPolling();
      }
    } finally { pixBusy = false; pixRefresh.disabled = false; document.querySelector("#pix-whatsapp").disabled = false; }
  }
  pixRefresh.addEventListener("click", () => { pixAttempts = 0; runPix(); });
  document.querySelector("#pix-edit").addEventListener("click", () => { stopPixPolling(); pix.reset(); syncPixLock(); updateFields(); document.querySelector("#checkout-submit").focus(); });
  document.querySelector("#pix-new-order").addEventListener("click", () => {
    if (pix.getSession()?.order?.status !== "approved") return;
    pix.finish();
    if (pix.getSession()) return;
    cart = []; save(); render(); dialog.close();
    document.querySelector("#pix-new-order").hidden = true;
  });
  document.querySelector("#pix-copy").addEventListener("click", async () => {
    const code = document.querySelector("#pix-code");
    if (pix.getSession()?.order?.status !== "pending") return;
    try { await navigator.clipboard.writeText(code.value); announce("Código Pix copiado. Cole no aplicativo do seu banco."); }
    catch { code.focus(); code.select(); announce("Selecione o código e use a opção Copiar do seu aparelho."); }
  });
  function openWhatsapp(message) {
    const link = document.createElement("a");
    link.href = `https://api.whatsapp.com/send?phone=${order.config.whatsapp}&text=${encodeURIComponent(message)}`;
    link.target = "_blank"; link.rel = "noopener noreferrer";
    document.body.append(link); link.click(); link.remove();
    announce("Envie a mensagem no WhatsApp para solicitar seu pedido.");
  }
  document.querySelector("#pix-whatsapp").addEventListener("click", () => {
    const session = pix.getSession();
    if (pixBusy || session?.order?.status !== "approved") return;
    const payment = session.order;
    const paidProducts = Object.fromEntries(payment.items.map(item => [item.id, { name: item.name, price: item.priceCents, allowsNotes: products[item.id]?.allowsNotes }]));
    const paidCart = payment.items.map(item => ({ id: item.id, quantity: item.quantity, notes: item.notes }));
    const message = order.message(paidCart, paidProducts, { ...session.details, payment: "pix", confirmedPayment: { id: payment.id, subtotal: payment.subtotalCents, delivery: payment.deliveryCents, total: payment.amountCents } });
    openWhatsapp(message);
    document.querySelector("#pix-new-order").hidden = false;
  });
  document.querySelector("#open-cart").addEventListener("click", () => { dialog.showModal(); document.body.classList.add("cart-open"); if (pix.getSession()) { showPix(); pixAttempts = 0; runPix(); } });
  document.querySelector("#close-cart").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { document.body.classList.remove("cart-open"); stopPixPolling(); pix.pause(); });
  form.addEventListener("change", updateFields);
  form.elements.changeFor.addEventListener("input", () => form.elements.changeFor.setCustomValidity(""));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!cart.length) return;
    for (const name of ["customer", "address", "neighborhood"]) {
      const input = form.elements[name];
      input.setCustomValidity(input.required && !input.value.trim() ? "Preencha este campo." : "");
    }
    const details = Object.fromEntries(new FormData(form));
    details.needsChange = details.payment === "cash" && form.elements.needsChange.checked;
    details.changeFor = Math.round(Number(details.changeFor) * 100);
    if (details.needsChange && details.changeFor < order.totals(cart, products, details.fulfillment).total) {
      form.elements.changeFor.setCustomValidity("Informe um valor igual ou maior que o total do pedido.");
    }
    if (!form.reportValidity()) return;
    if (pix.getSession()) return;
    if (pix.enabled && details.payment === "pix") {
      if (order.totals(cart, products, details.fulfillment).total > 150000) return announce("O Pix aceita pedidos de até R$ 1.500,00. Ajuste o carrinho.");
      pixAttempts = 0; runPix(false, details); return;
    }
    const submit = document.querySelector("#checkout-submit"); submit.disabled = true;
    try { await printer.confirm(cart, details); openWhatsapp(order.message(cart, products, details)); }
    catch (error) { announce(error.message); }
    finally { submit.disabled = false; }
  });
  form.addEventListener("input", event => {
    if (["customer", "address", "neighborhood"].includes(event.target.name)) event.target.setCustomValidity("");
  });
  render(); updateFields();
});
