# Ambiente de homologação

Branch: `hml`. Atualizado em 30/09/2026.

Esta branch integra `codex/servidor-pix-cloudflare` e `codex/integracao-mercado-pago`. A `main` continua sendo a referência de produção e não recebeu esta integração.

## Estado validado

- `npm test`: 47 testes passaram.
- `npm run test:integration`: 4 testes do fluxo cliente, Worker e Mercado Pago passaram com rede simulada.
- `npm run build`: concluído.
- Nenhum Worker, banco D1, webhook ou pagamento real foi criado nesta etapa.
- O Pix permanece desativado por padrão com `PIX_ENABLED=false`.

## Recursos de HML a configurar

Criar recursos separados dos de produção:

1. um Worker de homologação;
2. um banco D1 de homologação e aplicar `server/schema.sql`;
3. uma URL Firebase estável para o frontend de homologação;
4. os secrets `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `RATE_LIMIT_SECRET` no ambiente do Worker;
5. as variáveis `MP_COLLECTOR_ID`, `PUBLIC_API_URL`, `ALLOWED_ORIGINS`, `MAX_DAILY_ORDERS` e `PIX_ENABLED`;
6. o agendamento `*/5 * * * *`;
7. o webhook Mercado Pago apontando para `https://URL-DO-WORKER/api/webhooks/mercado-pago`.

Manter `PIX_ENABLED=false` enquanto URL, CORS, schema, assinatura do webhook, QR, pagamento atrasado e estorno não tiverem sido validados. Credenciais e secrets devem ficar somente nos painéis oficiais ou no armazenamento de secrets do Worker; nunca no Git, arquivos versionados ou chat.

Depois da homologação, criar Worker, D1, secrets e webhook próprios de produção. Não reutilizar o banco ou as credenciais de HML.

Os detalhes do contrato e da operação estão em `server/README.md`. O histórico técnico de cada frente está em `server/PROGRESSO.md`, `server/PROGRESSO_MP.md` e `MERCADO_PAGO.md`.
