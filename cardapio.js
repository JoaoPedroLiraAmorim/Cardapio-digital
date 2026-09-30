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
      tab.classList.toggle("active", tab.getAttribute("href") === targetId);
    });
    centralizarAbaHorizontal(targetId);

    window.scrollTo({
      top: targetPosition,
      behavior: "smooth"
    });

    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      isProgrammaticScroll = false;
    }, 700);
  };

  // Centraliza a aba ativa APENAS dentro da barra horizontal (sem interferir no scroll vertical)
  const centralizarAbaHorizontal = (targetId) => {
    if (!categoryBarWrap) return;
    const activeTab = categoryBarWrap.querySelector(`.cat-tab[href="${targetId}"]`);
    if (!activeTab) return;

    const tabLeft = activeTab.offsetLeft;
    const tabWidth = activeTab.offsetWidth;
    const containerWidth = categoryBarWrap.offsetWidth;

    categoryBarWrap.scrollTo({
      left: tabLeft - (containerWidth / 2) + (tabWidth / 2),
      behavior: "smooth"
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
    if (isProgrammaticScroll) return;

    if (!ticking) {
      window.requestAnimationFrame(() => {
        atualizarAbaAtivaPorPosicao();
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  const atualizarAbaAtivaPorPosicao = () => {
    const navBarHeight = (document.querySelector(".category-bar")?.offsetHeight || 54) + 60;
    let secaoAtualId = "";

    sections.forEach((section) => {
      const rect = section.getBoundingClientRect();
      if (rect.top <= navBarHeight && rect.bottom >= navBarHeight) {
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
      });
    }
  };
});
