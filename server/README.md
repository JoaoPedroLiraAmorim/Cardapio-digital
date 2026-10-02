# Servidor Pix: Cloudflare Workers + D1

Este código prepara pagamentos Pix no Mercado Pago e confirma o resultado consultando a API oficial. O site continua no Firebase Hosting. Não há publicação, conta configurada ou pagamento real testado nesta entrega. A integração está desligada por padrão (`PIX_ENABLED=false`).

## Configuração antes de ativar

Para homologação, usar `wrangler.hml.example.jsonc` e o procedimento de `../HML.md`. O preflight `node server/preflight.mjs --template` verifica o modelo local sem consultar APIs. Já há relato posterior do ambiente Cloud de Worker/D1 HML criados: conferir os recursos existentes antes de provisionar novos. As etapas abaixo são requisitos gerais; não indicam que esses recursos ainda precisam ser criados.

1. O titular cria uma aplicação Mercado Pago, habilita Pix e obtém as credenciais e o segredo de assinatura do webhook no painel oficial. O ID da conta recebedora é configurado em `MP_COLLECTOR_ID`. Nunca colocar o token no HTML, Git, WhatsApp ou chat.
2. Criar Worker e D1 na conta Cloudflare. Copiar `wrangler.example.jsonc` para um arquivo de configuração local e preencher ID do banco e domínio público HTTPS, sem barra final. Aplicar `schema.sql` ao D1. A publicação e a criação desses recursos exigem autorização e login do titular.
3. Configurar os secrets `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `RATE_LIMIT_SECRET` pelo painel oficial ou comando de secrets do Wrangler. `RATE_LIMIT_SECRET` deve ser aleatório, com pelo menos 32 bytes. `MP_COLLECTOR_ID` é variável de configuração, não segredo.
4. Registrar o webhook **Order (Mercado Pago)** no painel, apontando para `https://SEU-WORKER/api/webhooks/mercado-pago`. A Orders API não recebe `notification_url` no payload. Cadastrar a assinatura gerada como `MP_WEBHOOK_SECRET` e validá-la no ambiente correspondente antes de ativar.
5. Restringir `ALLOWED_ORIGINS` aos dois domínios Firebase efetivamente utilizados. Localhost só deve entrar numa configuração separada de desenvolvimento. Configurar o frontend com a URL desse servidor. Só habilitar `PIX_ENABLED=true` depois dos testes da conta e do fluxo completo.

O Wrangler deve ser instalado em uma versão compatível e fixada no momento de configurar/publicar. Não foi adicionado como dependência do site: nenhum CLI ou login é necessário para executar os testes locais abaixo. Os arquivos `wrangler.example.jsonc` e `wrangler.hml.example.jsonc` são modelos, sem IDs reais de D1 ou credenciais. Preflight verifica apenas dados locais e não confirma secrets já armazenados no Worker.

## Contrato HTTP

Todas as respostas usam `Cache-Control: no-store`. CORS é uma restrição de navegador e não substitui autenticação ou limitação de abuso.

`POST /api/orders`, JSON:

```json
{
  "payment": "pix",
  "fulfillment": "delivery",
  "customer": "Nome",
  "address": "Rua, número",
  "neighborhood": "Bairro",
  "reference": "",
  "notes": "",
  "payerEmail": "cliente@example.com",
  "items": [{"id": "item-1", "quantity": 1, "notes": "Sem cebola"}]
}
```

Enviar `Authorization: Bearer TOKEN` e `Idempotency-Key: UUID-V4`. O frontend gera o token com 32 bytes criptograficamente aleatórios, codificados base64url (43 caracteres), antes do primeiro POST. Manter os dois valores durante a tentativa e repetir ambos com o mesmo corpo após timeout. Nunca mudar a chave para tentar resolver uma falha de comunicação: o pagamento anterior pode existir. Dados e token não devem ir em query strings. O token não é devolvido pelo servidor; apenas seu SHA-256 é armazenado.

`GET /api/orders/ID` exige o mesmo Bearer e a origem permitida. A resposta inclui `id`, `status`, `amountCents`, `subtotalCents`, `deliveryCents`, `items`, `fulfillment`, `expiresAt` e, apenas enquanto pendente, `qrCode` e `qrCodeBase64`. Nome, endereço, e-mail e credenciais não são devolvidos. O servidor usa exclusivamente o catálogo de `catalog.js` para preços e R$3 de entrega (retirada gratuita). Não aceita observações em bebidas. Catálogo e HTML devem ser atualizados juntos.

Estados: `creating` (HTTP 202, repetir mesma tentativa), `pending`, `approved`, `expired`, `rejected`, `cancelled`, `refunded`, `charged_back` (HTTP 200). Erros contêm apenas `{"error":"mensagem"}`. HTTP 503 não significa que não houve cobrança; manter a tentativa e tentar recuperá-la. HTTP 409 significa que token/corpo não corresponde à chave original. Quantidade máxima: 20 por produto, 50 no pedido, R$1.500 por pedido; corpo JSON limitado a 16KiB.

## Confirmação, recuperação e segurança

O webhook exige assinatura válida e, mesmo assim, consulta a order oficial em `GET /v1/orders/{id}`. Confere ID, referência do pedido, conta recebedora, moeda, método e valor em centavos. Notificações repetidas são idempotentes; uma notificação antiga não rebaixa um pagamento aprovado para pendente. Estorno e chargeback continuam sendo registrados. Não existe endpoint de "já paguei".

O D1 registra a tentativa antes da chamada ao Mercado Pago, com chave única e claim atômico. Retries reutilizam a chave original no provedor. Uma criação incerta é repetida por até 23 horas; depois desse prazo exige conferência do titular no Mercado Pago, sem gerar outra cobrança automaticamente. Essa janela conservadora deve ser conferida com a política de idempotência vigente do provedor antes de ativar.

O GET recupera notificações perdidas para pedidos pendentes ou expirados, consultando o provedor no máximo uma vez a cada 10 segundos por pedido. GET e agendamento compartilham um claim atômico de 30 segundos: duas consultas concorrentes não fazem duas chamadas. O GET oculta o QR após expiração mesmo se a consulta oficial falhar. Se uma consulta pendente omitir o QR, o QR já salvo é preservado. Aprovação e expiração continuam escondendo-o. Uma resposta pendente antiga não revive um pedido expirado; confirmação oficial tardia e estorno continuam sendo aceitos. O agendamento a cada cinco minutos revalida até 50 pedidos por execução, recuperando criações recentes e pagamentos pendentes/expirados por até 48 horas. Pagamento que chega após expiração ainda pode ser confirmado por webhook. Se o agendamento estiver desativado ou atingir cotas, a recuperação periódica não funciona; monitorar esses recursos em produção.

Limits persistentes em D1: 20 tentativas de criação por IP a cada 10 minutos, 120 consultas por IP/minuto e 500 criações novas/dia globalmente por padrão (`MAX_DAILY_ORDERS`). IP é combinado com segredo e hash, não armazenado em claro. Endereços compartilhados podem atingir limite; reavaliar conforme volume. Limites funcionam em janelas fixas e são proteção básica, não proteção completa contra ataque distribuído. Configurar regras Cloudflare e, se necessário, Turnstile antes de exposição de alto tráfego. Chamadas de webhook não dependem de CORS, mas exigem assinatura.

Não registramos corpos, tokens ou dados de clientes em logs; observabilidade está desligada no exemplo. Erros internos são genéricos. Pedidos contêm dados pessoais no D1 para criar/recuperar pagamentos: restringir acesso à conta Cloudflare, habilitar autenticação forte e manter mínimo de usuários autorizados. O agendamento exclui pedidos após sete dias e contadores expirados. Recursos de recuperação/backup do D1 podem manter cópias por período adicional conforme plano; a exclusão SQL não garante remoção imediata de backups.

O botão gratuito de WhatsApp exige que o cliente envie a mensagem. Uma mensagem editável dizendo "pago" não é comprovante para o dono: a hamburgueria deve confirmar o recebimento no painel Mercado Pago. Este servidor não inclui painel administrativo, envio automático pela WhatsApp Business API, gestão de estoque, reembolso automático, disponibilidade de cozinha ou confirmação automática de preparo.

As rotas públicas de confirmação de impressão aceitam dinheiro, débito e crédito; Pix é enfileirado somente pela rota do pedido cuja situação oficial seja `approved`. Além do limite por IP, `MAX_DAILY_PRINT_ORDERS` limita novas confirmações locais por dia. O pareamento de impressoras deve ficar normalmente fechado: habilite `PRINT_PAIRING_ENABLED=true` apenas durante `npm run hml:pair` e retorne a `false` assim que o dispositivo for criado. Um dispositivo só pode solicitar retry manual de jobs incertos que ele próprio recebeu.

## Verificação local e limites da entrega

```sh
npm test
# Após integrar os testes do provider da branch Mercado Pago:
node --test --test-isolation=none tests/mercado-pago.test.mjs
```

Requer Node >=24 com `node:sqlite`, também indicado em `package.json`. `npm test` executa os 28 testes desta branch (17 Worker, 5 pedido, 6 produção); não exige instalação do Firebase CLI. O script usa `--test-isolation=none` porque, neste ambiente de nuvem, a execução isolada padrão reportou apenas arquivos como aprovados sem enumerar subtestes. Confira sempre o número e os nomes dos testes no resultado.

Os testes do Worker executam o SQL real em SQLite local com adaptador D1 e provedor simulado: preços adulterados, bebida com observação, retry concorrente/timeout, token incorreto, assinatura inválida, confirmação/estorno, valor/recebedor divergente, recuperação sem webhook, expiração e aprovação tardia, concorrência GET/cron, estados de estorno, GET de criação incerta, normalização UUID, limites de abuso e retenção. Não substituem validação no runtime Cloudflare/D1 remoto nem sandbox e conta real Mercado Pago. Antes de ativar, testar QR no banco do cliente, notificações assinadas, timeout, cancelamento, valor divergente, pagamento atrasado e fluxo até WhatsApp.

## Fontes para ativação

- [Workers: limites e recursos gratuitos](https://developers.cloudflare.com/workers/platform/limits/)
- [D1: preços e cotas](https://developers.cloudflare.com/d1/platform/pricing/)
- [Workers: secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
- [Mercado Pago: integração Pix](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix)
- [Mercado Pago: notificações](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks)

Infraestrutura gratuita depende de respeitar cotas de execução, CPU, D1 e tráfego. A tarifa do Mercado Pago é separada e deve ser confirmada na conta. Nenhum teste local comprova custo zero ou segurança absoluta em produção.
