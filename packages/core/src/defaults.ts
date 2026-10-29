/** Dados iniciais editáveis criados junto com cada casamento */

export const DEFAULT_CATEGORIES = [
  "Igreja e cerimônia", "Celebrante", "Cerimonialista", "Local da recepção", "Buffet", "Bebidas", "Decoração", "Fotografia", "Filmagem",
  "Música e DJ", "Trajes", "Beleza dos noivos", "Alianças", "Convites", "Bolo e doces", "Lembranças", "Transporte", "Hospedagem", "Lua de mel",
  "Cartório e documentação", "Casa e mobiliário", "Taxas administrativas", "Imprevistos", "Outras despesas",
];

export const DEFAULT_ALBUMS = ["Inspirações gerais", "Decoração", "Flores", "Vestidos e trajes", "Convites", "Cerimônia", "Recepção", "Casa", "Lua de mel"];

type T = { title: string; area?: string; priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT"; offsetDays?: number };

/** offsetDays: sugestão relativa à data do casamento — sempre editável na geração */
export const CHECKLIST_PHASES: { phase: number; name: string; items: T[] }[] = [
  { phase: 1, name: "Planejamento", items: [
    { title: "Definir data e orçamento", priority: "HIGH", offsetDays: -365 }, { title: "Definir número de convidados", offsetDays: -350 },
    { title: "Definir prioridades", offsetDays: -350 }, { title: "Organizar responsabilidades", offsetDays: -340 },
    { title: "Pesquisar igreja e local", priority: "HIGH", offsetDays: -330 }, { title: "Estabelecer calendário inicial", offsetDays: -330 },
  ] },
  { phase: 2, name: "Igreja e cerimônia", items: [
    { title: "Reservar igreja", area: "CHURCH", priority: "HIGH", offsetDays: -300 }, { title: "Confirmar taxas", area: "CHURCH", offsetDays: -290 },
    { title: "Conferir documentos religiosos", area: "CHURCH", offsetDays: -180 }, { title: "Agendar preparação dos noivos", area: "CHURCH", offsetDays: -150 },
    { title: "Definir celebrante", area: "CELEBRANT", offsetDays: -240 }, { title: "Contratar cerimonialista", area: "PLANNER", priority: "HIGH", offsetDays: -270 },
    { title: "Definir padrinhos e testemunhas", area: "CEREMONY", offsetDays: -200 }, { title: "Organizar músicas e leituras", area: "CEREMONY", offsetDays: -90 },
    { title: "Confirmar decoração e regras", area: "CHURCH", offsetDays: -90 }, { title: "Agendar ensaio", area: "CEREMONY", offsetDays: -30 },
  ] },
  { phase: 3, name: "Festa", items: [
    { title: "Reservar espaço", area: "RECEPTION", priority: "HIGH", offsetDays: -300 }, { title: "Contratar buffet", priority: "HIGH", offsetDays: -270 },
    { title: "Definir cardápio e bebidas", offsetDays: -120 }, { title: "Contratar decoração", offsetDays: -240 }, { title: "Contratar fotografia e vídeo", priority: "HIGH", offsetDays: -270 },
    { title: "Contratar música", offsetDays: -240 }, { title: "Definir bolo e doces", offsetDays: -120 }, { title: "Planejar transporte", offsetDays: -60 },
    { title: "Conferir acessibilidade e plano B", area: "RECEPTION", offsetDays: -60 },
  ] },
  { phase: 4, name: "Fornecedores e trajes", items: [
    { title: "Pesquisar e comparar propostas", offsetDays: -300 }, { title: "Negociar valores", offsetDays: -280 }, { title: "Revisar contratos", priority: "HIGH", offsetDays: -260 },
    { title: "Comprar ou alugar trajes", offsetDays: -180 }, { title: "Fazer ajustes", offsetDays: -30 }, { title: "Definir maquiagem e cabelo", offsetDays: -120 },
    { title: "Confirmar alianças", offsetDays: -60 }, { title: "Definir convites e lembranças", offsetDays: -150 },
  ] },
  { phase: 5, name: "Convidados", items: [
    { title: "Montar lista", priority: "HIGH", offsetDays: -240 }, { title: "Organizar famílias e acompanhantes", offsetDays: -200 }, { title: "Coletar contatos", offsetDays: -180 },
    { title: "Enviar convites", priority: "HIGH", offsetDays: -90 }, { title: "Acompanhar confirmações", offsetDays: -45 }, { title: "Cobrar respostas pendentes", offsetDays: -30 },
    { title: "Organizar necessidades alimentares", offsetDays: -25 }, { title: "Definir mesas, quando aplicável", offsetDays: -15 },
  ] },
  { phase: 6, name: "Documentação e vida prática", items: [
    { title: "Verificar documentação civil", priority: "HIGH", offsetDays: -120 }, { title: "Conferir prazos do cartório", priority: "HIGH", offsetDays: -100 },
    { title: "Resolver questões de regime de bens, quando aplicável", offsetDays: -100 }, { title: "Planejar moradia", offsetDays: -180 },
    { title: "Organizar itens da casa", offsetDays: -60 }, { title: "Planejar lua de mel, se houver", offsetDays: -150 },
  ] },
  { phase: 7, name: "Últimas semanas", items: [
    { title: "Confirmar fornecedores", priority: "URGENT", offsetDays: -14 }, { title: "Revisar cronograma", offsetDays: -10 }, { title: "Conferir todos os pagamentos", priority: "HIGH", offsetDays: -10 },
    { title: "Separar documentos e alianças", offsetDays: -3 }, { title: "Definir responsáveis pelo dia", offsetDays: -10 }, { title: "Preparar plano de contingência", offsetDays: -7 },
    { title: "Confirmar convidados finais", priority: "HIGH", offsetDays: -10 },
  ] },
  { phase: 8, name: "Dia do casamento", items: [
    { title: "Cronograma de preparação", offsetDays: 0 }, { title: "Horários de chegada", offsetDays: 0 }, { title: "Contatos de emergência", offsetDays: -2 },
    { title: "Conferência dos fornecedores", offsetDays: 0 }, { title: "Roteiro da cerimônia", area: "CEREMONY", offsetDays: -2 }, { title: "Roteiro da recepção", area: "RECEPTION", offsetDays: -2 },
    { title: "Registro de imprevistos", offsetDays: 0 },
  ] },
  { phase: 9, name: "Pós-casamento", items: [
    { title: "Devolver itens alugados", offsetDays: 3 }, { title: "Conferir entregas de fotos e vídeos", offsetDays: 60 }, { title: "Cobrar cauções", priority: "HIGH", offsetDays: 7 },
    { title: "Solicitar reembolsos", offsetDays: 10 }, { title: "Conferir pagamentos finais", offsetDays: 10 }, { title: "Resolver pendências com fornecedores", offsetDays: 15 },
    { title: "Organizar documentos", offsetDays: 30 }, { title: "Agradecer convidados e fornecedores", offsetDays: 20 }, { title: "Encerrar o planejamento", offsetDays: 60 },
  ] },
];

export const DEFAULT_MESSAGE_TEMPLATES = [
  {
    key: "invite", name: "Convite com link de confirmação", purpose: "INVITE",
    body: "Olá, {{nome}}! 💍\n\n{{noivos}} têm a alegria de convidar {{familia}} para o casamento, em {{data}}.\n\nConfirme sua presença por aqui: {{link}}\n\nCom carinho,\n{{noivos}}",
  },
  {
    key: "reminder", name: "Lembrete para quem não respondeu", purpose: "REMINDER",
    body: "Oi, {{nome}}! Tudo bem? Ainda não recebemos a confirmação de {{familia}} para o nosso casamento ({{data}}). Pode responder pelo link? {{link}}\n\nObrigado! {{noivos}}",
  },
  {
    key: "info", name: "Orientações para o dia", purpose: "INFO",
    body: "Olá, {{nome}}! Faltam poucos dias 🎉\n\nLocal: {{local}}\nData: {{data}}\n\nMais informações: {{link}}\n\n{{noivos}}",
  },
  { key: "vendor", name: "Contato com fornecedor", purpose: "VENDOR", body: "Olá, {{nome}}! Aqui é do casamento de {{noivos}} ({{data}}). " },
];
