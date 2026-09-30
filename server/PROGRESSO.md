# Checkpoint do servidor Pix

Branch: `codex/servidor-pix-cloudflare`. Pasta de trabalho: `.worktrees/servidor-pix-cloudflare`. Nenhum deploy, login, credencial real ou commit realizado.

## Pronto

- `server/worker.js`: POST de pedido/Pix, GET autenticado, webhook assinado com consulta oficial, recuperação agendada, retenção e limitação de abuso persistentes em D1.
- `server/schema.sql`: pedidos e contadores, chave de idempotência única, pagamento único, claims atômicos de criação/consulta.
- `server/catalog.js`: catálogo de preços do HTML e taxa de entrega de 300 centavos.
- `server/wrangler.example.jsonc`: configuração inativa, origens Firebase e D1 a preencher.
- `server/package.json`: módulos ES apenas para servidor.
- `server/README.md`: contrato, ativação, limites de segurança/escopo e próximos testes.
- `tests/worker.test.mjs`: 10 testes com SQL real em SQLite local e provedor simulado.

## Testes efetivamente executados

`node --test tests/worker.test.mjs`: 10 passaram, 0 falharam. Verifica catálogo/preços, idempotência concorrente e após timeout, acesso, webhook e estorno sem regressão, divergência de conta/valor, recuperação GET, limites e retenção. `git diff --check`: sem erros (arquivos novos ainda sem staging).

Para executar os testes foi copiado `server/mercado-pago.js` do worktree `.worktrees/integracao-mercado-pago`. Essa cópia pertence à outra frente, não foi alterada e não deve sobrescrever a versão final dela ao integrar as branches. O root deve copiar apenas os arquivos desta frente listados acima e este checkpoint, e obter o provider diretamente da frente Mercado Pago.

## Contrato coordenado com a integração

POST `/api/orders`: JSON com `items:[{id,quantity,notes}]`, `payment:pix`, `fulfillment:delivery|pickup`, `customer`, `address`, `neighborhood`, `reference`, `notes`, `payerEmail`. Headers: `Authorization: Bearer TOKEN` (32 bytes aleatórios base64url, 43 caracteres) e `Idempotency-Key: UUIDv4`. Repetir ambos e o mesmo corpo em qualquer retry incerto. GET `/api/orders/:id` usa o mesmo Bearer.

Resposta: `id`, `status`, `amountCents`, `subtotalCents`, `deliveryCents`, `items`, `fulfillment`, `expiresAt`, e QR apenas em `pending`. `creating` retorna HTTP 202. Estados posteriores: pending, approved, rejected, cancelled, expired, refunded, charged_back. Provider deve incluir collectorId, currencyId e paymentMethodId; verificação de assinatura é assíncrona.

## Falta para produção

1. Root integrar Worker + provider + frontend opt-in e rodar as suites pertinentes juntas.
2. Login do titular, Worker/D1 reais, domínio API, origens finais, ID recebedor e secrets oficiais (nunca no Git ou chat).
3. Configurar webhook e cron, executar schema no D1 e validar runtime Cloudflare real, incluindo CPU e cotas do plano gratuito.
4. Testar na conta Mercado Pago geração/leitura/QR/assinaturas e cenários de timeout, expiração, pagamento atrasado e estorno. Só depois ativar PIX_ENABLED e URL no site.

Nenhum bloqueio humano impede o desenvolvimento agora. Custos reais e confirmação de pagamentos reais não foram testados. WhatsApp segue envio pelo cliente; texto editável não comprova pagamento ao dono, que deve conferir o painel Mercado Pago. Sem painel administrativo nesta implementação.
