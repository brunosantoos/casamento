# Funcionalidades e limitações

## Concluído e verificado
Todos os 17 módulos do painel e o portal público estão ligados ao banco real (sem dados simulados). Verificado no navegador:
cadastro do administrador, criação do casamento, geração de 70 tarefas do modelo, lançamento da igreja com 4 itens/caução/
parcelas/pagamento, dashboard, as 26 telas do painel sem erros de console, e confirmação de presença pelo portal.
62 testes automatizados passando; backup com restauração verificada.

## Dependências externas / não validado aqui
- **Evolution API**: implementada e testada com respostas simuladas; Docker não estava ativo nesta máquina, então o envio
  contra uma instância real ainda precisa ser feito (`pnpm infra:up`, configurar no painel, conectar o QR).
- **Provedor de IA**: testado com modelo simulado; requer chave real para uso.
- **S3/MinIO**: driver implementado; em dev foi usado o armazenamento local privado. **SMTP**: sem servidor, e-mails vão ao log.

## Limitações conhecidas
- OCR de PDF escaneado: não há OCR no servidor; envie as páginas como imagens (o modelo multimodal faz o OCR).
- Exportação PDF dos relatórios via impressão do navegador (layout de impressão dedicado), não arquivo PDF gerado no servidor.
- Antivírus de arquivos não incluído (há validação de tipo real/tamanho); integrar ClamAV se a infraestrutura permitir.
- Lembretes internos por e-mail (WhatsApp para a equipe não foi ativado para evitar mensagens não solicitadas).
- Rate limit do better-auth em memória (uma instância de API); para várias instâncias, mover para armazenamento compartilhado.
