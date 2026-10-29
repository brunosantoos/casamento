# Segurança e LGPD

- Autenticação: better-auth (senha ≥ 10, scrypt), sessões 7 dias em cookie httpOnly/SameSite=Lax, limite de tentativas,
  recuperação de senha com token de 1h de uso único (revoga as outras sessões), contas desativáveis, cadastro só por convite após o 1º usuário.
- Autorização no servidor em toda procedure (`perm()`), isolamento por casamento, anti-IDOR, sem elevação de privilégio
  (ninguém concede o que não tem; não altera o próprio acesso). Bloqueios geram `SecurityEvent`.
- Entrada validada com Zod; Prisma parametrizado (sem SQL injection); React escapa saída; uploads com detecção do tipo real
  (HTML/SVG/scripts recusados), limite de tamanho, binários privados com URLs assinadas de 5 min e `CSP: sandbox` no download.
- Helmet + CSP, CORS restrito à origem do painel, rate limit por IP no portal e no webhook, honeypot e chaves de submissão no RSVP,
  tokens de convite com 192 bits, validade e revogação; tokens indexados por HMAC.
- Segredos cifrados (AES-256-GCM); front recebe só "definido •••• 1234". Auditoria append-only com redação de campos sensíveis.
- LGPD: exportação dos dados do titular (JSON, registrada), pedido e execução de exclusão por anonimização (mantém estatísticas),
  retenção configurável de arquivos excluídos, minimização (convidado não vê ninguém além da própria família), controle do que vai à IA.
