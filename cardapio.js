/**
 * Cardápio Oficial - JG Hamburgueria (JS Puro)
 */

document.addEventListener("DOMContentLoaded", () => {
  // 1. Rolagem suave para links internos
  const linksInternos = document.querySelectorAll('a[href^="#"]');
  const catPills = document.querySelectorAll(".cat-pill");

  linksInternos.forEach((link) => {
    link.addEventListener("click", (evento) => {
      const idDestino = link.getAttribute("href");
      if (idDestino && idDestino !== "#") {
        const elementoDestino = document.querySelector(idDestino);
        if (elementoDestino) {
          evento.preventDefault();
          elementoDestino.scrollIntoView({
            behavior: "smooth",
            block: "start"
          });

          // Atualiza estado ativo das pílulas de categoria se aplicável
          catPills.forEach((p) => p.classList.remove("active"));
          const pillCorrespondente = document.querySelector(`.cat-pill[href="${idDestino}"]`);
          if (pillCorrespondente) {
            pillCorrespondente.classList.add("active");
          }
        }
      }
    });
  });

  // 2. Acompanhamento automático da rolagem para destacar categoria ativa
  const secoes = document.querySelectorAll("section[id]");
  
  if ("IntersectionObserver" in window && secoes.length > 0) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.getAttribute("id");
          catPills.forEach((pill) => {
            const match = pill.getAttribute("href") === `#${id}`;
            pill.classList.toggle("active", match);
            if (match) {
              pill.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
            }
          });
        }
      });
    }, {
      rootMargin: "-20% 0px -60% 0px"
    });

    secoes.forEach((secao) => observer.observe(secao));
  }
});
