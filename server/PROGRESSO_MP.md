# Checkpoint da integração Pix — Mercado Pago

Branch: `codex/integracao-mercado-pago`. Worktree: `.worktrees/integracao-mercado-pago`.

Sem deploy, sem commit, sem credenciais reais ou transações reais. Pix online está desligado por padrão em `JGOrder.config.pix`, preservando o checkout WhatsApp atual.

## Pronto

- `server/mercado-pago.js`: ES module; createPix/getPayment; HTTPS, timeout de 10s, sem retry automático; normalização centavos/BRL/Pix/collector; assinatura HMAC WebCrypto async com janela5min.
- `server/package.json`: type module restrito ao backend.
- `tests/mercado-pago.test.mjs`: 8 testes passaram em Node24; idempotência, dinheiro inválido, mismatch, erros saneados, timeout e HMAC adulterada.
- `pix.js`: cliente independente, chave UUID/token32bytes só memória, retries do mesmo POST, consulta autenticada, valida resumo/QR/status. Ainda precisa de testes e revisão.
- `cardapio.html/js/css`, `pedido.js`: tela Pix opt-in, email apenas Pix online, bloqueio de edição durante pagamento, polling finito/backoff, abort ao fechar, copia cola, WhatsApp só aprovado com resumo servidor. Ainda precisa de testes e revisão.
- `scripts/build.cjs` e teste produção: nova allowlist inclui somente `pix.js` como asset adicional.

## Contrato com servidor Cloudflare

POST `/api/orders` com Bearer base64url43chars (32bytes), Idempotency-Key UUIDv4; JSON items[{id,quantity,notes}],payment:'pix',fulfillment,customer,address,neighborhood,reference,notes,payerEmail. GET `/api/orders/:id` mesmoBearer. Resposta id,status,amountCents,subtotalCents,deliveryCents,items[{id,name,quantity,notes,priceCents}],fulfillment,expiresAt,qrCode,qrCodeBase64. `creating`202, estados restantes200. QR apenas pending. Backend compara MP_COLLECTOR_ID e reconsulta PSP, mínimo10s.

## Pendências / retomada

1. Testar cliente: POST incerto/retry chave igual, alterações externas não alteram snapshot, auth fora URL/storage, approved vspending, validaquantias/QR/ID, abort/concorrência.
2. Rodar npm test + testes provider/cliente; build e validar sintaxe; revisão funcional/visual do opt-in.
3. Criar MERCADO_PAGO.md com setup credenciais, configuração pública, homologação e limitações/reloads/expiração24h.
4. Root une diffs com Worker em ambiente de revisão; sem deploy automático.

Limitações: sem recuperar sessão após recarregar/fechar página (segredos/dados de pedido em memória); expiração default API24h para corpo idempotente estável; requer contas, webhooksecret/accessToken/collectorId, teste real antes de ativar.
