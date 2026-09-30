# Pix no site: integração Mercado Pago + Cloudflare

O checkout atual continua funcionando. O pagamento online está **desligado por padrão**. Esta branch prepara o provedor e a tela; a branch do servidor prepara Worker/D1. Não houve deploy nem cobrança real.

## Fluxo

O cliente escolhe Pix, informa e-mail e gera uma cobrança única. O servidor calcula preços a partir de seu catálogo, cria o pagamento com chave idempotente, e retorna total, QR Code PNG e copia e cola. O cliente paga no aplicativo de qualquer banco. O servidor consulta o Mercado Pago, confere valor, referência, moeda, modalidade e recebedor antes de confirmar. Somente após confirmação, a tela oferece enviar o pedido no WhatsApp. O cliente ainda precisa tocar em Enviar no WhatsApp; a hamburgueria confirma o atendimento.

Não há QR fixo nem botão “já paguei”. A confirmação não vem de comprovantes ou de um status enviado pelo navegador. A mensagem WhatsApp pode ser editada pelo cliente: o dono precisa conferir o identificador do pedido no registro do servidor antes de preparar pedidos pagos.

## Configuração pelo titular

1. Criar aplicação em [Suas integrações](https://www.mercadopago.com.br/developers/panel/app), habilitar a conta para receber Pix e confirmar a chave Pix exigida pelo Mercado Pago.
2. Obter [credenciais](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/credentials), identificador da conta recebedora e segredo de assinatura dos Webhooks. Confirmar tarifa da conta; custo de API/infraestrutura não elimina tarifa por pagamento.
3. Configurar secrets privados do Worker: Access Token e segredo Webhook; configurar o collector ID obrigatório. Nenhum desses valores vai em HTML, JavaScript público, Git, mensagens ou URL do cliente.
4. Configurar Webhooks de pagamentos na aplicação para o endpoint HTTPS do Worker e origens CORS explícitas do site. D1 e catálogo autoritativo precisam estar configurados. Consulte a documentação da branch servidor para nomes exatos/configuração Cloudflare.
5. Testar criação, aprovação, expiração, cancelamento/estorno, assinatura, tentativas repetidas e conciliação. Não ativar recebimentos reais antes desse teste completo e da conferência pelo titular.
6. Somente após homologação, editar `JGOrder.config.pix` em `pedido.js`: `enabled: true`, `apiBaseUrl` com a origem HTTPS do Worker, sem caminho, query ou credenciais. Essa configuração é pública e não contém segredos. Rebuild e publicação do site são etapas posteriores.

## Contrato e segurança

POST `/api/orders`: Bearer aleatório32bytes base64url e Idempotency-Key UUIDv4; payload com items, fulfillment, customer, address, neighborhood, reference, notes, payerEmail, payment:'pix'. GET `/api/orders/:id`: mesmo Bearer. Nenhum token vai na URL. Resposta: id,status,amountCents,subtotalCents,deliveryCents,items,fulfillment,expiresAt,qrCode,qrCodeBase64. Dados pessoais e autorização ficam só na memória da página; localStorage continua contendo apenas carrinho e observações de itens.

`server/mercado-pago.js` só roda no backend. Requisições têm timeout10s, limite de resposta1MB e nenhum retry automático. Depois de timeout de criação, repetir sempre o mesmo corpo e chave. A resposta normaliza dinheiro com decimal sem arredondar frações de centavo, rejeita moeda/modo diferente e inclui collectorId para o Worker comparar. O segredo Webhook valida HMAC com Web Crypto, janela5min; autenticar uma notificação nunca equivale a aprovar o pagamento. Duplicatas e conciliação são responsabilidade transacional do Worker/D1. Timestamps em segundos e milissegundos são aceitos.

O Pix usa prazo padrão da API, atualmente24h; não inserimos data relativa a cada retry, pois alteraria o corpo de uma mesma operação idempotente. O cliente exibe prazo retornado, consulta com backoff10–30s, no máximo60 consultas automáticas por abertura, e oferece atualização manual. Fechar o carrinho aborta consultas e reabrir retoma o mesmo pedido. O carrinho fica bloqueado durante uma tentativa incerta ou Pix pendente, evitando gerar pagamentos diferentes para o mesmo pedido. Após enviar ao WhatsApp, o cliente pode iniciar explicitamente outro pedido.

## Limitações antes de produção

- Recarregar ou fechar a página perde a sessão em memória. Há aviso para manter a página aberta. Recuperação segura por outro dispositivo/reload requer um fluxo adicional; não fingir que isso já está implementado.
- Ainda precisa de credenciais, conta habilitada, Worker/D1 publicados e homologação real. Os testes locais simulam a rede; não comprovam aprovação na conta do dono.
- A API de Pix pode exigir informações adicionais do pagador dependendo das regras atuais/conta. O exemplo mínimo usa e-mail; confirmar em homologação antes de aumentar coleta de dados.
- Após pagamento, WhatsApp continua dependendo da ação do cliente e da confirmação do estabelecimento. Polling finito não é monitoramento permanente; conciliação no servidor precisa cobrir perda/atraso de Webhooks.
- Custos e limites gratuitos Cloudflare precisam ser acompanhados. Configurar proteção contra abuso, retenção de pedidos e acesso restrito aos dados no servidor.

## Verificação local

`npm test` testa regressões do cardápio; `node --test tests/mercado-pago.test.mjs tests/pix-client.test.cjs` testa provedor e cliente Pix; `npm run build` prepara somente assets públicos da allowlist. Não publica o servidor nem credenciais.

Fontes oficiais: [Pix via Payments API](https://www.mercadopago.com.br/developers/pt/docs/checkout-api-payments/integration-configuration/integrate-pix), [Webhooks](https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks), [referência de pagamentos](https://www.mercadopago.com.br/developers/pt/reference/payments/_payments/post).
