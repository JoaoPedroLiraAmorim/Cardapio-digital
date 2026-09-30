# Progresso da integração Pix — Mercado Pago

Branch: `codex/integracao-mercado-pago`. Atualizado em 30/09/2026.

## Estado atual

Provedor Mercado Pago, cliente Pix e tela do cardápio implementados e revisados. Pix continua **desligado** em `JGOrder.config.pix`. Não houve deploy, cobrança real, inclusão de credenciais ou merge na `main`.

Esta branch contém `server/mercado-pago.js`; Worker/D1/catálogo ficam na branch `codex/servidor-pix-cloudflare`. Integrar as duas em um checkout de revisão antes de publicar. O teste combinado `tests/pix-flow.test.mjs` depende desses arquivos do servidor e não faz parte do `npm test` desta branch isolada.

## Correções desta retomada

- Validação antes de criar sessão: até 20 unidades por produto, 50 unidades por pedido, campos obrigatórios, e-mail e limites de texto. A tela também bloqueia totais acima de R$ 1.500,00. Dados inválidos permanecem editáveis; antes, uma rejeição HTTP 400 podia deixar o carrinho bloqueado indefinidamente.
- Notas com quebras de linha/tabulação são normalizadas para espaços, e textos são aparados antes do POST e do resumo enviado ao WhatsApp, respeitando o contrato do Worker.
- Respostas precisam manter os itens/quantidades/notas solicitados e o resumo financeiro da primeira resposta. Status não regride de aprovado para criação/pendente/recusado; estorno e contestação continuam permitidos, incluindo `refunded → charged_back` e aprovação tardia após expiração.
- Resposta recebida depois de abortar não altera o estado. Retentativas mantêm corpo, chave UUID e token originais.
- Carrinho e observações ficam bloqueados durante a sessão Pix. WhatsApp fica desabilitado enquanto a consulta está em andamento; voltar ao formulário devolve foco ao botão de checkout. Estorno/contestação esconde o botão de novo pedido de uma aprovação anterior.
- `npm test` agora inclui os testes do provedor e do cliente. O comando usa `--test-isolation=none` porque neste ambiente o isolamento padrão reportava apenas arquivos, sem mostrar/executar os subtestes esperados. Node 24 ou superior alinhado ao teste combinado SQLite.

## Verificação realizada

- `npm test`: **30 testes individuais passaram** (5 regras de pedido, 6 produção, 8 provedor, 11 cliente).
- `npm run build`: passou; somente assets públicos da allowlist, incluindo `pix.js`.
- `node --check pix.js`, `node --check cardapio.js`, `node --check server/mercado-pago.js` e `git diff --check`: passaram.
- Chromium real, viewport 390 × 844, API simulada: geração pendente, total/QR, bloqueio do carrinho, fechar/reabrir, aprovação, abertura WhatsApp, novo pedido e limite inválido sem POST nem bloqueio. Sem erros de JavaScript. Isso não valida recebimentos reais no Mercado Pago.
- Checkout separado com as versões finais das duas branches: **47 testes individuais + 4 testes do fluxo combinado passaram**, além do build. O conflito de `package.json` foi resolvido nesse checkout mantendo as suites das duas frentes; nenhuma branch de trabalho foi mesclada à outra ou à `main`.

## Próximos passos concretos

1. Consolidar as branches no fluxo de entrega escolhido. A revisão conjunta já executou `npm test` e `npm run test:integration`; este último cobre cliente → Worker → módulo Mercado Pago real com rede simulada e SQLite: preço autoritativo, assinatura/aprovação, respostas perdidas com idempotência e recebedor divergente. Instruções de resolução do `package.json` estão em `MERCADO_PAGO.md`.
2. Configurar conta habilitada, secrets, collector ID, D1, catálogo e origens CORS conforme documentação do servidor; fazer homologação real antes de ativar. Não inserir credenciais no repositório nem nos assets públicos.
3. Publicar Worker e frontend somente depois de homologar; configuração pública do frontend permanece opt-in. Não houve publicação nesta retomada.
4. Envio dos commits ao GitHub depende de acesso técnico de escrita; o push de verificação da sessão retornou 403. Alterações locais na nuvem não equivalem a alterações publicadas no GitHub.

## Limitações que permanecem

Sessão/autorização só em memória: recarregar/fechar a página perde a retomada. Polling automático é finito; conciliação no servidor continua necessária. WhatsApp exige envio pelo cliente e conferência do pedido pelo estabelecimento. `MERCADO_PAGO.md` contém fluxo, ativação e limites operacionais; não considerar Pix pronto para produção antes dos passos acima.
