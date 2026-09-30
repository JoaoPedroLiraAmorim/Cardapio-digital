# Retomada — Pix Mercado Pago + Cloudflare

Registro de continuidade criado em 30/09/2026. Não contém credenciais.
Este documento é um checkpoint, não uma afirmação de implementação concluída.

## Objetivo autorizado

Adicionar Pix no próprio cardápio: QR Code e copia e cola gerados por pedido pelo Mercado Pago; cliente paga pelo banco dele e hamburgueria recebe no Mercado Pago. Servidor Cloudflare Worker + D1 cria pedidos, calcula preços e confirma pagamento com API oficial. Site continua Firebase Hosting. Depois de confirmado, cliente abre WhatsApp com mensagem formatada e envia; não há envio automático pela API WhatsApp.

Manter UI/UX atual e dinheiro, débito e crédito. Taxa inicial de entrega R$ 3. WhatsApp comercial já configurado em pedido.js. Bebidas não permitem observação. Pix novo desativado por padrão até configuração e validação completa. Não alterar produção durante desenvolvimento.

## Ambientes separados

Checkout principal: `C:/Users/JOAO PEDRO/Documents/cardapio-digital`, branch `main`, base `a195aea`.

1. Servidor: branch `codex/servidor-pix-cloudflare`, pasta `.worktrees/servidor-pix-cloudflare`. Agente `servidor_cloudflare`.
2. Provedor e tela Pix: branch `codex/integracao-mercado-pago`, pasta `.worktrees/integracao-mercado-pago`. Agente `integracao_pix_mp`.

As duas branches foram criadas como Git worktrees a partir da mesma base. Não houve merge, commit novo nem deploy nesta etapa. As alterações estão nos respectivos worktrees. A pasta `.worktrees/` aparece como não rastreada no checkout principal: não adicioná-la ao Git recursivamente.

## Estado confirmado no momento do checkpoint

- Servidor: escritos `server/worker.js`, `schema.sql`, `catalog.js`, `wrangler.example.jsonc`, `package.json` e `tests/worker.test.mjs`. Testes locais com SQLite real e provedor simulado em andamento. Resultados finais ainda não revisados pelo agente principal.
- Provedor: escrito `server/mercado-pago.js`; agente informou oito testes de provedor aprovados. Tela Pix em desenvolvimento. Arquivos já presentes/modificados incluem `pix.js`, `cardapio.html`, `cardapio.css`, `pedido.js`, build e testes de produção. Inspecionar estado atual, pois o desenvolvimento continua após este registro.
- Nenhum bloqueio humano informado pelos agentes. Credenciais, login, IDs e configuração de produção ficam para ativação posterior.
- Checkpoints específicos solicitados: `.worktrees/servidor-pix-cloudflare/server/PROGRESSO.md` e `.worktrees/integracao-mercado-pago/server/PROGRESSO_MP.md`. Podem ainda não existir no instante da criação deste documento; ler quando disponíveis.

## Contrato e segurança

Servidor: `POST /api/orders`, `GET /api/orders/:id`, `POST /api/webhooks/mercado-pago`. POST usa `Idempotency-Key` UUID estável e `Authorization: Bearer` com token aleatório de 32 bytes criado pelo cliente; repetição conserva os dois. GET exige o mesmo token. Nunca usar token na URL. Confirmar nomes exatos de campos no código e checkpoints dos agentes, pois estão sendo alinhados.

Provedor ES module: `createPix`, `getPayment`, `verifyWebhook`. Verificação de assinatura usa HMAC e WebCrypto (assíncrona); normalização de valores em centavos; timeouts e erros sem credenciais/PII. API de pagamentos Mercado Pago gera QR/copia e cola por pedido, não QR fixo.

Servidor calcula valores do catálogo, valida itens/dados/limites, protege acesso ao pedido, usa idempotência persistente D1, restringe CORS e abuso. Notificação não basta: consultar pagamento no Mercado Pago e conferir valor, referência, identidade do recebedor e estado antes de aprovar. Não confiar em botão “já paguei”, comprovante ou valores do navegador. Não registrar PII/segredos desnecessários.

Tela deve ser acessível/responsiva, permitir copiar Pix, mostrar aguardando/aprovado/expirado/erro, limitar consultas e evitar criação duplicada ao reabrir ou tentar novamente. Preservar método antigo quando Pix novo estiver desativado. Credenciais ficam em secrets da Cloudflare, jamais no frontend ou neste documento.

## Como continuar

1. Ler este documento e os checkpoints dos dois agentes. Conferir `git status` em cada worktree e inspecionar arquivos; não refazer código existente nem descartar alterações.
2. Se os agentes estiverem ativos, consultar o estado; se tiverem parado, continuar as pendências no worktree correto. Ausência de resposta por limite não significa tarefa concluída.
3. Finalizar servidor, provedor e tela; alinhar contrato de ponta a ponta. Unir para revisão em ambiente de desenvolvimento, mantendo branches separadas conforme pedido do usuário. Não realizar merge na main sem necessidade ou sobrescrever mudanças concorrentes.
4. Rodar testes objetivos de preços, autenticação, idempotência, webhook, transições e tela; build e verificações existentes. Testes simulados não comprovam pagamento real. Verificar limite de CPU do Workers gratuito com implementação real.
5. Revisar segurança/funcionamento e validar UI localmente. Registrar resultados concretos e limitações.
6. Entregar ao usuário relatório ESCRITO com o que foi feito, se realmente terminou, testes e pendências. Não alegar que está publicado ou pronto para pagamento real sem evidência.
7. Para ativação posterior: titular configura aplicação e conta Pix no Mercado Pago; autenticar Cloudflare oficialmente, criar D1, configurar secrets/URLs/webhook, publicar e validar fluxo completo. Nunca pedir senha/token no chat. Desenvolvimento atual não autoriza publicação de pagamento real automaticamente.

## Preferências e permissões

Usuário autorizou duas branches, dois agentes em paralelo, tela Pix e comandos necessários ao desenvolvimento. Pediu código focado, sem redundância, e testes objetivos. Não pediu pausa; continuar enquanto houver capacidade. Se o limite acabar, preservar arquivos e checkpoint para retomada quando voltar. Este documento não agenda retomada automática e não envia notificação ao celular.
