# Checkpoint do servidor Pix

Branch: `codex/servidor-pix-cloudflare`. Atualizado em 30/09/2026. Pix permanece desativado no exemplo; nenhum deploy ou pagamento real foi realizado. Trabalho executado no ambiente de nuvem.

## Implementação e revisão concluídas

- `server/worker.js`: criação idempotente, acesso por Bearer, webhook assinado com consulta oficial, limites persistentes e retenção no D1. A revisão corrigiu concorrência entre GET e cron com claim compartilhado, recuperação de pedidos expirados pelo GET, expiração sem expor QR, retorno HTTP 202 para criação ainda em andamento e normalização da caixa do UUID de idempotência. Consultas oficiais pendentes que omitem QR preservam o QR já salvo; aprovação e expiração continuam ocultando-o.
- Estados oficiais desconhecidos são rejeitados, sem transformá-los em `pending`. Expirados não voltam a pendentes; confirmação oficial tardia pode avançar `expired`, `cancelled` e `rejected` para `approved`. Estorno e chargeback permanecem registrados sem regressão.
- `server/schema.sql`: schema existente, sem mudança ou migração nesta revisão. Chave e pagamento únicos, claims atômicos e índice para recuperação.
- `server/catalog.js`: catálogo existente, sem mudança. Teste confere os 12 preços contra `cardapio.html`; entrega custa 300 centavos.
- `package.json` e `package-lock.json`: Node >=24 declarado e `npm test` inclui Worker, pedido e produção com `--test-isolation=none`.
- `server/README.md`: contrato HTTP, configuração, operação, limites e instruções verificáveis para testar. Atualizado com recuperação tardia e concorrência de consultas.
- `tests/worker.test.mjs`: agora 17 testes, com SQL real no SQLite local e provider simulado; sete regressões novas cobrem as correções acima.

`server/mercado-pago.js` não foi alterado nesta frente. A versão final do provider e seus testes devem vir da branch `codex/integracao-mercado-pago`. Não copiar uma versão antiga deste arquivo por cima da outra frente ao integrar.

## Testes realmente executados

- `node tests/worker.test.mjs`: **17 passaram, 0 falharam**, com todos os nomes de subtestes exibidos. Cobre catálogo, preço, token, ausência de PII na resposta, idempotência/timeout, webhook, conferência de conta/valor/moeda/método, recuperação, expiração, aprovação tardia, concorrência GET/cron, limites e retenção.
- `node pedido.test.js`: **5 passaram, 0 falharam**.
- `node tests/production.test.cjs`: **6 passaram, 0 falharam**; inclui build estático.
- `git diff --check`: sem erros.

`npm test`: **28 passaram, 0 falharam**, incluindo os 17 subtestes Worker. O script agora usa `--test-isolation=none` para garantir execução efetiva neste ambiente.

Atenção ao runner deste ambiente: `node --test --test-reporter=tap tests/worker.test.mjs` reportou apenas **1 teste de arquivo**, sem os 17 subtestes. A execução direta do arquivo com `node` enumerou e executou os testes reais. Não usar o resultado agregado de arquivo como evidência de cobertura. `npm test` resolve essa limitação com isolamento desativado.

## Contrato para a outra branch

POST `/api/orders`: `items:[{id,quantity,notes}]`, `payment:pix`, `fulfillment:delivery|pickup`, `customer`, `address`, `neighborhood`, `reference`, `notes`, `payerEmail`. Headers: Bearer de 32 bytes aleatórios base64url (43 caracteres) e `Idempotency-Key: UUIDv4`. Repetir token, chave e corpo após falha incerta. GET `/api/orders/:id` exige o mesmo Bearer.

Resposta: `id`, `status`, `amountCents`, `subtotalCents`, `deliveryCents`, `items`, `fulfillment`, `expiresAt`; QR somente em `pending`. POST e GET retornam 202 em `creating`, 200 nos demais estados. Limites: 20 por produto, 50 itens no pedido, R$1.500, JSON de 16KiB. A outra frente está alinhando a validação do cliente a esses limites e removendo quebras de linha/tab dos campos antes de enviar.

## Próximos passos reais

Validação conjunta das versões finais concluída em checkout separado: **47 testes individuais + 4 testes do fluxo combinado passaram**, além do build. O fluxo usa cliente + Worker + módulo Mercado Pago real com rede simulada e SQLite; não gera pagamentos reais. A tela passou em Chromium 390 × 844 com API simulada. Nesta branch isolada, `npm test` executa os 28 testes próprios.

As branches continuam separadas. Ao consolidar para publicação, resolver o conflito em `package.json` mantendo as suites das duas frentes, `test:integration` e Node >=24. O comando completo está em `MERCADO_PAGO.md` da outra branch. Nenhuma alteração foi incorporada à `main`.

1. Consolidar as branches revisadas no fluxo de entrega escolhido. A integração em checkout de revisão já foi testada; não refazer os módulos existentes.
2. Configurar conta do titular, Worker/D1, domínio público, origens finais, ID recebedor, secrets e webhook. Credenciais nunca vão no Git ou no chat.
3. Aplicar o schema ao D1 e validar runtime Cloudflare real: claims/concorrência no D1, cron, CPU e cotas do plano. A documentação atual de Workers não pôde ser baixada nesta sessão porque o proxy local não respondeu; nenhuma configuração de runtime foi modificada com base em APIs novas.
4. Validar geração/leitura do QR, assinaturas reais, timeout, expiração, pagamento atrasado e estorno na conta Mercado Pago. Conferir janela de idempotência oficial antes de ativar.
5. Só após essa validação preencher a URL do frontend e habilitar Pix. WhatsApp continua sendo enviado pelo cliente; mensagem editável não comprova recebimento. O dono deve conferir o painel Mercado Pago.

Não há painel administrativo, gestão de estoque, envio automático de WhatsApp ou reembolso automático. Custos e pagamentos reais continuam sem validação.

## Persistência desta sessão

Alterações publicadas na branch remota `codex/servidor-pix-cloudflare` em 30/09/2026. O envio foi feito pela integração GitHub após a renovação das permissões, e a árvore publicada foi comparada com o checkout local. A `main` permaneceu inalterada.
