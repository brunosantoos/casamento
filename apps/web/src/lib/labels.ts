import type { Tone } from "@/components/app/common";

type L = Record<string, { label: string; tone: Tone }>;

export const OBLIGATION_STATUS: L = { DRAFT: { label: "Rascunho", tone: "neutral" }, ACTIVE: { label: "Contratado", tone: "emerald" }, CANCELLED: { label: "Cancelado", tone: "rose" } };
export const ITEM_KIND: L = { EXPENSE: { label: "Despesa", tone: "wine" }, DEPOSIT: { label: "Caução", tone: "gold" }, ADVANCE: { label: "Adiantamento", tone: "sky" }, FEE: { label: "Taxa", tone: "violet" }, OTHER: { label: "Outro", tone: "neutral" } };
export const ITEM_STATUS: L = { PLANNED: { label: "Previsto", tone: "neutral" }, CONTRACTED: { label: "Contratado", tone: "emerald" }, CANCELLED: { label: "Cancelado", tone: "rose" } };
export const CHARGE_TYPE: Record<string, string> = { ONE_TIME: "Valor único", PER_GUEST: "Por convidado", PER_HOUR: "Por hora", PER_UNIT: "Por unidade" };
export const INSTALLMENT_STATUS: L = {
  PLANNED: { label: "Previsto", tone: "neutral" }, UPCOMING: { label: "A vencer", tone: "sky" }, OVERDUE: { label: "Vencido", tone: "rose" },
  PARTIAL: { label: "Parcialmente pago", tone: "amber" }, PAID: { label: "Pago", tone: "emerald" }, CANCELLED: { label: "Cancelado", tone: "neutral" },
};
export const PAYMENT_METHOD: Record<string, string> = { PIX: "Pix", CASH: "Dinheiro", CREDIT_CARD: "Cartão de crédito", DEBIT_CARD: "Cartão de débito", BANK_TRANSFER: "Transferência", BOLETO: "Boleto", CHECK: "Cheque", OTHER: "Outro" };
export const INCOME_KIND: Record<string, string> = { GIFT_CASH: "Presente em dinheiro", FAMILY: "Contribuição familiar", THIRD_PARTY: "Valor de terceiros", DEPOSIT_REFUND: "Devolução de caução", REFUND: "Reembolso", CHARGEBACK: "Estorno", OTHER: "Outra entrada" };
export const INCOME_STATUS: L = { PROMISED: { label: "Prometido", tone: "violet" }, EXPECTED: { label: "Previsto", tone: "sky" }, RECEIVED: { label: "Recebido", tone: "emerald" }, CANCELLED: { label: "Cancelado", tone: "rose" } };

export const VENDOR_STATUS: L = {
  RESEARCHED: { label: "Pesquisado", tone: "neutral" }, CONTACTED: { label: "Contatado", tone: "sky" }, QUOTE_RECEIVED: { label: "Orçamento recebido", tone: "violet" },
  NEGOTIATING: { label: "Em negociação", tone: "amber" }, HIRED: { label: "Contratado", tone: "emerald" }, COMPLETED: { label: "Concluído", tone: "gold" }, DISCARDED: { label: "Descartado", tone: "rose" },
};
export const QUOTE_STATUS: L = { REQUESTED: { label: "Solicitado", tone: "neutral" }, RECEIVED: { label: "Recebido", tone: "sky" }, ACCEPTED: { label: "Aceito", tone: "emerald" }, REJECTED: { label: "Recusado", tone: "rose" }, EXPIRED: { label: "Expirado", tone: "neutral" } };
export const CONTRACT_STATUS: L = { DRAFT: { label: "Rascunho", tone: "neutral" }, UNDER_REVIEW: { label: "Em análise", tone: "amber" }, SIGNED: { label: "Assinado", tone: "emerald" }, COMPLETED: { label: "Concluído", tone: "gold" }, CANCELLED: { label: "Cancelado", tone: "rose" } };
export const INTERACTION_TYPE: Record<string, string> = { call: "Ligação", meeting: "Reunião", whatsapp: "WhatsApp", email: "E-mail", visit: "Visita", note: "Anotação" };

export const TASK_STATUS: L = {
  NOT_STARTED: { label: "Não iniciada", tone: "neutral" }, IN_PROGRESS: { label: "Em andamento", tone: "sky" }, WAITING_THIRD_PARTY: { label: "Aguardando terceiros", tone: "amber" },
  WAITING_APPROVAL: { label: "Aguardando aprovação", tone: "violet" }, DONE: { label: "Concluída", tone: "emerald" }, CANCELLED: { label: "Cancelada", tone: "rose" },
};
export const PRIORITY: L = { LOW: { label: "Baixa", tone: "neutral" }, MEDIUM: { label: "Média", tone: "sky" }, HIGH: { label: "Alta", tone: "amber" }, URGENT: { label: "Urgente", tone: "rose" } };
export const AREA: Record<string, string> = { CHURCH: "Igreja", CELEBRANT: "Celebrante", PLANNER: "Cerimonialista", CEREMONY: "Cerimônia", RECEPTION: "Recepção" };
export const EVENT_TYPE: Record<string, string> = { MEETING: "Reunião", FITTING: "Prova de roupa", REHEARSAL: "Ensaio", DELIVERY: "Entrega", VISIT: "Visita", TASTING: "Degustação", IMPORTANT_DATE: "Data importante", OTHER: "Outro", TASK: "Tarefa", PAYMENT: "Vencimento", CONTRACT: "Contrato" };
export const PARTICIPANT_ROLE: Record<string, string> = { GODPARENT: "Padrinho/Madrinha", WITNESS: "Testemunha", READER: "Leitor(a)", MUSICIAN: "Músico", RING_BEARER: "Daminha/Pajem", BRIDESMAID: "Madrinha", GROOMSMAN: "Padrinho", OTHER: "Outro" };
export const SCHEDULE_AREA: Record<string, string> = { PREP: "Preparação", CEREMONY: "Cerimônia", RECEPTION: "Recepção", OTHER: "Outro" };

export const RSVP_STATUS: L = { PENDING: { label: "Sem resposta", tone: "amber" }, ACCEPTED: { label: "Confirmado", tone: "emerald" }, DECLINED: { label: "Não vai", tone: "rose" } };
export const INVITE_STATUS: L = { NOT_SENT: { label: "Não enviado", tone: "neutral" }, SENT: { label: "Enviado", tone: "sky" }, DELIVERED: { label: "Entregue", tone: "violet" }, OPENED: { label: "Aberto", tone: "emerald" } };
export const SIDE: Record<string, string> = { P1: "Noivo(a) 1", P2: "Noivo(a) 2", BOTH: "Ambos" };

export const MESSAGE_STATUS: L = {
  PENDING: { label: "Na fila", tone: "neutral" }, SENDING: { label: "Enviando", tone: "sky" }, ACCEPTED: { label: "Aceita pelo provedor", tone: "sky" }, DELIVERED: { label: "Entregue", tone: "violet" },
  READ: { label: "Lida", tone: "emerald" }, REPLIED: { label: "Respondida", tone: "gold" }, FAILED: { label: "Falha", tone: "rose" }, CANCELLED: { label: "Cancelada", tone: "neutral" },
};
export const CAMPAIGN_STATUS: L = { DRAFT: { label: "Rascunho", tone: "neutral" }, QUEUED: { label: "Na fila", tone: "sky" }, RUNNING: { label: "Enviando", tone: "amber" }, COMPLETED: { label: "Concluída", tone: "emerald" }, CANCELLED: { label: "Cancelada", tone: "rose" } };
export const FILE_CATEGORY: Record<string, string> = { CONTRACT: "Contrato", RECEIPT: "Comprovante", QUOTE: "Orçamento", DOCUMENT: "Documento", PHOTO: "Foto", INSPIRATION: "Inspiração", OTHER: "Outro" };
export const RISK: L = { LOW: { label: "Risco baixo", tone: "emerald" }, MEDIUM: { label: "Atenção", tone: "amber" }, HIGH: { label: "Risco alto", tone: "rose" } };
export const PROPOSAL_STATUS: L = { PENDING: { label: "Aguardando aprovação", tone: "amber" }, APPROVED: { label: "Aprovada", tone: "sky" }, REJECTED: { label: "Recusada", tone: "neutral" }, EXECUTED: { label: "Executada", tone: "emerald" }, FAILED: { label: "Falhou", tone: "rose" } };

export const opt = (m: L | Record<string, string>) => Object.entries(m).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));
