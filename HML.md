# Ambiente de homologação

Branch: `hml`. Atualizado em 30/09/2026.

## Estado mais recente — retomada local

Frontend republicado em `https://hml-jg-hamburgueria.web.app` usando `firebase.hml.json`, cuja configuração aponta exclusivamente para esse site. O predeploy executou 51 testes individuais e build, todos aprovados. Os 4 testes de fluxo integrado também passaram nesta retomada com rede simulada.

Após a publicação, o arquivo público `pedido.js` confirmou WhatsApp `5512981440776` na HML e `5512983157450` na produção. Pix online permanece desligado. Nenhum recurso de produção foi publicado ou alterado.

Os recursos Cloudflare HML existentes foram conferidos antes da publicação: Worker `jg-cardapio-api-hml`, banco D1 `jg-cardapio-hml`, tabelas `orders` e `rate_limits`, cron a cada cinco minutos e os três nomes de secrets esperados. As seções posteriores registram também o estado anterior da branch e o procedimento local.

A URL pública do Worker HML foi configurada em `pedido.js`, ainda com `enabled:false`, e publicada somente no frontend HML. O comando `npm run deploy` desta branch agora usa explicitamente `firebase.hml.json`, evitando atingir o site de produção.

Após autorização do login local, o banco D1 existente `jg-cardapio-hml` foi consultado: `orders` e `rate_limits` confirmadas. O secret `RATE_LIMIT_SECRET` já estava cadastrado e foi preservado.

O Worker `jg-cardapio-api-hml` foi validado com Wrangler 4.145.0 (`deploy --dry-run`) e publicado usando `server/wrangler.hml.jsonc`, arquivo local ignorado pelo Git. Cron a cada cinco minutos, banco HML e `PIX_ENABLED=false` confirmados pelo deploy. A API pública respondeu HTTP 503 com Pix indisponível, conforme esperado, mas agora permite CORS para `https://hml-jg-hamburgueria.web.app`; uma requisição com origem de produção não recebeu permissão CORS. Nenhum recurso de produção foi publicado ou alterado.

As credenciais de teste foram validadas sem criar cobrança: `GET /users/me` na API oficial confirmou a conta recebedora e o ID foi preenchido somente em `server/wrangler.hml.jsonc`, que continua ignorado pelo Git. `MP_ACCESS_TOKEN` e `MP_WEBHOOK_SECRET` foram cadastrados como secrets do Worker HML; a listagem remota confirmou também o `RATE_LIMIT_SECRET`, sem leitura dos valores. A Public Key não é usada pela arquitetura atual, pois navegador e site não chamam o Mercado Pago diretamente.

Na migração para Orders API, a URL de notificação permanece `https://jg-cardapio-api-hml.jg-hamburgueria-cardapio.workers.dev/api/webhooks/mercado-pago`, mas deixa de ser enviada no payload: deve ser cadastrada no painel com o evento **Order (Mercado Pago)**. A assinatura gerada para esse ambiente deve ficar em `MP_WEBHOOK_SECRET`. Os testes locais cobrem HMAC, janela temporal, consulta oficial após a assinatura e idempotência, mas a assinatura real do Mercado Pago só pode ser comprovada em um fluxo Pix de homologação após a ativação controlada.

Próxima etapa: confirmar no painel Mercado Pago que Pix está habilitado para a conta e que o segredo de assinatura fornecido corresponde a esta aplicação; depois ativar temporariamente a HML e executar o fluxo completo, incluindo QR, webhook assinado, pagamento atrasado e estorno. A publicação atual não comprova pagamento real nem limites de CPU sob carga. Não inserir códigos de login ou tokens neste registro.

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

## Preparação local e conferência antes das credenciais

O relato recuperado da conversa Cloud informa um Worker `jg-cardapio-api-hml` e D1 `jg-cardapio-hml` já criados, com cron, Pix desligado e secret de limitação de abuso. Esse relato é posterior aos registros anteriores desta branch; não equivale à conferência atual no painel. **Conferir os recursos existentes antes de criar qualquer recurso novo.** O exemplo `server/wrangler.hml.example.jsonc` usa esses nomes e a URL relatada; o UUID do D1, a origem estável do frontend e o ID da conta recebedora ainda precisam ser confirmados.

O modelo preserva `PIX_ENABLED=false`, cron de recuperação e observabilidade desligada. Usa Worker e banco diferentes do exemplo de produção. Copiar para `server/wrangler.hml.jsonc` somente quando for preencher os identificadores reais; esse arquivo local deve ficar ignorado pelo Git. Não colocar secrets em `vars`.

Verificações sem rede, login ou publicação, executadas na raiz do projeto:

```sh
# Valida a estrutura do modelo e enumera pendências esperadas.
node server/preflight.mjs --template

# Confere a configuração preenchida e secrets disponíveis no ambiente local.
node server/preflight.mjs --config server/wrangler.hml.jsonc

# Alternativa para secrets locais em arquivo ignorado pelo Git.
node server/preflight.mjs --config server/wrangler.hml.jsonc --secrets-file server/.dev.vars

# Testes objetivos da verificação local.
node --test --test-isolation=none tests/preflight.test.mjs
```

O preflight valida nomes HML, binding/UUID do D1, URL e origens HTTPS sem wildcard, ausência de origens de produção, ID recebedor numérico, cron, limite diário e presença/formato dos secrets. Não exibe seus valores. Por padrão compara com `server/wrangler.example.jsonc`; quando existir configuração real de produção, usar `--production-config CAMINHO` para comparar também IDs reais. Manter a configuração real fora do Git.

Sucesso do preflight significa apenas que os arquivos e variáveis locais atendem às verificações: não confirma conta, titularidade, recursos remotos ou validade das credenciais. Secrets podem já existir no Worker mesmo que não estejam disponíveis localmente. `--template` aceita os campos ainda não preenchidos e reporta essas pendências, sem afirmar que Pix está pronto.

Wrangler não estava instalado neste ambiente Windows; não foi instalado nem houve chamada à API Cloudflare por este procedimento. Os testes existentes do Worker usam SQLite real local; validação do runtime Wrangler/D1 remoto, CPU, cron e credenciais reais permanece para a etapa de conta configurada. Nenhum teste deste preflight gera cobrança, pagamento ou recurso externo.
