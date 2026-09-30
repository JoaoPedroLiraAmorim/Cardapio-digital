# Revisão de produção — JG Hamburgueria

Data: 30/09/2026. Site verificado: https://jg-hamburgueria.web.app/.

## Correções após a revisão

Os cinco achados abaixo foram corrigidos em 30/09/2026:

- HTML e raiz passaram a exigir revalidação de cache, assim como CSS e JavaScript.
- Navegação sincroniza a categoria ao finalizar a rolagem, ao interrompê-la, ao restaurar a página e ao redimensionar a tela; também informa a categoria atual às tecnologias assistivas.
- Títulos sobre o verde usam `#30070B`, com contraste de aproximadamente 3,05:1, mantendo o vinho da marca.
- Logo otimizada em WebP de 525 × 525 px e 227.982 bytes, cerca de 86% menor. O original foi preservado. O endereço antigo redireciona para a nova imagem.
- O build bloqueia arquivos extras, diretórios e links na pasta pública antes de copiar o conteúdo; nenhum arquivo inesperado é removido automaticamente.

Os 11 testes automatizados passaram. O navegador confirmou navegação, entrega de R$ 3, retirada grátis, observações somente para comida, header sem rolagem horizontal em 320 px e ausência de erros nas etapas verificadas. Os avisos das dependências de desenvolvimento seguem como informação da auditoria; não foi aplicado downgrade automático.

Publicação confirmada no Firebase Hosting: `/` e `/index.html` responderam com `public, max-age=0, must-revalidate`. Os bytes do HTML, JavaScript e WebP públicos coincidiram com os arquivos gerados localmente. `/logo-JG.png` redirecionou corretamente para `/logo-JG.webp`. O navegador carregou a nova logo e não registrou erros nas etapas verificadas.

O restante deste documento registra as evidências da revisão original, antes das correções.

## Resultado

Foram identificados cinco achados: três de prioridade P2 e dois de prioridade P3. Nenhuma vulnerabilidade crítica foi identificada no código e no conteúdo público examinados. Isso não equivale a uma garantia de ausência de vulnerabilidades. A revisão gerou este relatório; não houve correção de código nem publicação de uma nova versão.

## Achados

### 1. [P2] HTML com preços pode permanecer em cache por uma hora

- Local: `firebase.json`, linhas 7–11; `cardapio.js`, linhas 128–131.
- Evidência: a resposta HTTP de `/` trouxe `Cache-Control: max-age=3600`. Apenas CSS e JavaScript recebem a regra de revalidação imediata.
- Impacto: nomes, descrições e preços vêm do HTML. Após atualizar um preço, um cliente com o HTML ainda fresco no cache pode continuar montando pedidos com o valor anterior por até uma hora. Recarregar JavaScript não atualiza esses valores, pois ele lê os atributos do HTML antigo.
- Correção proposta: acrescentar regras de revalidação para `/`, `/index.html` e os demais documentos HTML. Manter a revalidação atual de CSS e JS. Não altera layout ou fluxo.
- Limite: um carrinho já aberto continuará com os dados carregados até atualizar a página; uma mudança de preço precisa ser confirmada pela hamburgueria ao aceitar o pedido.

### 2. [P2] Categoria ativa pode ficar diferente da seção visível

- Local: `cardapio.js`, linhas 39–41 e 73–82.
- Causa: depois de clicar em uma categoria, os eventos de rolagem são ignorados por 700 ms. Ao terminar, o código apenas libera a flag; não recalcula a categoria ativa.
- Reprodução determinística: executar a primeira rotina de inicialização com eventos simulados; clicar em Bebidas, voltar ao topo e emitir `scroll` dentro do intervalo; executar o callback do temporizador. A aba ativa continua em Bebidas, embora a posição atual seja o topo. A rotina só corrige isso quando recebe outro evento de rolagem após o bloqueio.
- Impacto: indicação errada da categoria ao interromper a animação ou terminar um movimento durante o intervalo; a revisão anterior já mostrou visualmente esse estado.
- Correção proposta: recalcular a categoria ao liberar o bloqueio e na inicialização/restauração da página. Preferir finalizar pelo término da rolagem, com fallback, e tratar interrupções do usuário. Preservar a animação e o header compacto.

### 3. [P2] Títulos das categorias têm contraste insuficiente

- Local: `cardapio.css`, linhas 214–217, sobre o fundo definido em `--bg-main`.
- Evidência: vinho `#521016` sobre verde `#416B6A` resulta em contraste de aproximadamente **2,45:1**. Os títulos das categorias são texto informativo grande, não parte do logotipo.
- Impacto: leitura prejudicada para clientes com baixa visão ou sob iluminação forte. O [critério WCAG 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) pede pelo menos 3:1 para texto grande.
- Correção proposta: ajustar exclusivamente o tom dos títulos sobre o verde até atingir o mínimo, mantendo cores, fontes, cartões e composição da marca. Não exige redesenhar a página.

### 4. [P3] Logo excessivamente pesada para o tamanho exibido

- Local: `cardapio.html`, linha 42; arquivo `logo-JG.png`.
- Evidência: PNG de **1.652.487 bytes**, com **1254 × 1254 px**, exibido a 150 px no celular e 175 px em telas maiores.
- Impacto: transferência desnecessária em conexões móveis e consumo da cota de hospedagem. A 1 Mb/s, só os bytes dessa imagem representam aproximadamente 13,2 segundos de transferência teórica, sem contar latência. O texto pode aparecer antes; isso não significa que toda a página fique bloqueada durante esse tempo.
- Correção proposta: gerar uma versão transparente otimizada para o tamanho de exibição, com resolução suficiente para telas de alta densidade; comparar visualmente antes de substituir. Manter a logo original como fonte. A economia exata precisa ser medida após gerar o arquivo.

### 5. [P3] Build preserva arquivos extras na pasta pública

- Local: `scripts/build.cjs`, linhas 5–10.
- Evidência: criei `public/review-sentinel.txt`, executei o build e confirmei que o arquivo continuou na pasta. Removi o arquivo ao concluir o teste.
- Impacto: o script copia cinco arquivos conhecidos, mas não garante que sejam os únicos na pasta. O Firebase publica todos os arquivos não ignorados de `public/`; um artefato antigo ou arquivo interno colocado ali por engano poderia ser enviado em uma atualização.
- Correção proposta: gerar a pasta do zero com verificações do caminho, ou validar a lista exata de arquivos antes do deploy e abortar se existir conteúdo inesperado. A validação da lista evita uma limpeza destrutiva.
- Estado atual: a pasta tem somente os cinco arquivos esperados. Nenhum vazamento foi identificado no site examinado.

## Segurança e dependências

- Observações e dados dos produtos são inseridos com `textContent`/`value`, sem uso de `innerHTML` para conteúdo de cliente. Não identifiquei caminho de execução de HTML/JavaScript a partir desses campos.
- A URL do WhatsApp tem destino fixo e usa `encodeURIComponent` para a mensagem. O link usa `noopener noreferrer`.
- Preços usados para restaurar o carrinho vêm do catálogo da página; preços adulterados no armazenamento não são aproveitados. Produtos inexistentes, quantidades negativas/fracionadas/acima de 99 e duplicatas são filtrados.
- Falha no armazenamento local é capturada; o carrinho continua funcionando em memória.
- Nome e endereço não são gravados pelo código no armazenamento local. As observações dos itens são persistidas junto com o carrinho.
- As rotas `/package.json`, `/firebase.json`, `/.firebaserc` e `/pedido.test.js` retornaram **404**. Página, scripts e logo retornaram **200** com tipos de conteúdo esperados.
- `npm audit` apontou cinco entradas de severidade moderada na árvore de desenvolvimento de `firebase-tools`, originadas em dois avisos: [OpenTelemetry](https://github.com/open-telemetry/opentelemetry-js/security/advisories/GHSA-8988-4f7v-96qf) e [uuid](https://github.com/uuidjs/uuid/security/advisories/GHSA-w5hq-g745-h8pq). Não são cinco falhas independentes. Essas dependências são da ferramenta de publicação e não estão entre os arquivos enviados ao cliente. Não foi demonstrado um caminho explorável no fluxo de publicação usado aqui. A recomendação automática de downgrade major não deve ser aplicada sem avaliar compatibilidade.
- A resposta pública não trouxe CSP nem bloqueio de incorporação em iframe. Adicionar uma política compatível com Google Fonts e os scripts locais é uma melhoria de defesa; sua ausência, isoladamente, não comprova exploração de XSS ou clickjacking.
- Qualquer pessoa pode editar uma mensagem antes de enviá-la no WhatsApp. O pedido é uma solicitação: o valor deve ser conferido pela hamburgueria, e selecionar Pix ou cartão não comprova pagamento. Isso é um limite do fluxo escolhido, não um erro de cobrança do site.

## Verificações realizadas

- Os cinco testes existentes passaram: catálogo/preços, totais em centavos, entrega de R$ 3/retirada grátis, restauração de carrinho, formatação da mensagem, observações de bebidas e quatro formas de pagamento.
- No site público, confirmei o bloqueio de nome composto somente por espaços.
- No site público, confirmei o bloqueio de troco de R$ 10 para pedido de R$ 26,99 e a retirada sem taxa.
- Não foram enviados pedidos reais durante a revisão.
- O console do navegador não registrou erros nas etapas verificadas.
- Conferi os arquivos públicos, seus tipos e as regras de cache por HTTP.
- Calculei o contraste usando luminância relativa das cores do CSS.
- Medi tamanho e dimensões da logo pelo arquivo original.
- Reproduzi a preservação de arquivo extra no build e removi o artefato de teste.

## Limites e ordem sugerida

Priorizar hoje a revalidação do HTML e a sincronização da categoria ativa. Em seguida, ajustar contraste e otimizar a logo, com comparação visual, e acrescentar a validação da pasta pública. A produção não foi alterada durante esta revisão.

A revisão cobre os arquivos deste repositório, o navegador disponibilizado e o site público. Não verificou permissões administrativas da conta Google, nem testes em aparelhos físicos com Safari/iOS, Android e WhatsApp instalado. A abertura e o envio final pelo aplicativo WhatsApp precisam ser conferidos em um telefone real antes de considerar o fluxo integralmente validado.
