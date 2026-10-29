# Integrações

## Evolution API (WhatsApp)

Cliente: `packages/core/src/whatsapp/evolution.ts` (validado contra **v2.3.x**: `/instance/create`, `/instance/connect/:name`,
`/instance/connectionState/:name`, `/instance/logout/:name`, `/webhook/set/:name`, `/message/sendText/:name`).
Outras versões: confira os endpoints antes de usar.

**Configuração** (Configurações → Integrações): URL base, URL pública para o webhook (deve ser alcançável pela Evolution) e a
chave da API (gravada cifrada). Depois, em WhatsApp → Conexão: "Conectar" cria a instância e mostra o QR.

**Envio**: campanhas são rascunho → prévia (não cria nada nem envia) → confirmação explícita (`whatsapp:approve`).
Cada destinatário vira uma `OutboundMessage` com chave de idempotência `(campanha, família, telefone)` e um `Job` na fila.
O worker respeita horário permitido, intervalo mínimo e limite diário (configuráveis) e faz até N tentativas com backoff.
Erros 4xx são permanentes. Se o worker cair no meio de um envio, a mensagem vira FALHA com "estado incerto" (não reenvia sozinho).

**Status reais**: `ACCEPTED` = Evolution aceitou (SERVER_ACK); `DELIVERED`/`READ` só por webhook (`messages.update`);
`REPLIED` quando chega mensagem do número. Status nunca regride.

**Webhook** `POST /webhooks/evolution/:token`: token aleatório na URL (só o hash fica no banco), instância conferida, evento bruto
gravado com chave única (duplicados ignorados), limite por IP. Eventos inválidos geram `SecurityEvent`.
Confirmação automática por resposta "sim/não" existe mas vem **desligada** (`whatsapp.autoRsvpFromReplies`).

## Inteligência artificial

Camada independente de fornecedor (`core/src/ai/llm.ts`, Vercel AI SDK): Anthropic, OpenAI, Google ou compatível com OpenAI.
Provedor, modelo e chave em Configurações → Integrações.

- **Consultas** (`ai/chat.ts`, `ai/tools.ts`): ferramentas tipadas e somente leitura, filtradas pelas permissões de quem
  pergunta; sem SQL livre nem acesso a segredos. Cada resposta guarda as fontes consultadas.
- **Alterações**: a IA só cria `AIActionProposal`; a execução exige `ai:approve` + a permissão do módulo (`ai/actions.ts`).
  Não existem executores para pagamentos, mensagens ou exclusões.
- **Documentos** (`ai/analysis.ts`): PDF com texto (unpdf, por página), imagens via OCR do modelo multimodal, texto puro.
  Conteúdo envolvido em `<documento>` como dado não confiável; achados separam trecho literal × interpretação, com risco e motivo.
  PDF escaneado sem camada de texto: o sistema pede o envio das páginas como imagem (limitação documentada).
- **Custos**: `AIUsage` por chamada e limite mensal de tokens (`ai.monthlyTokenLimit`).
- **Privacidade**: `ai.shareGuestData` controla se nomes de convidados podem ir ao provedor.
