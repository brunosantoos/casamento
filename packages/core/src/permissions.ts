/**
 * Permissões efetivas no formato "modulo:acao". Perfis são apenas conjuntos iniciais;
 * cada membro pode receber `grants` e `revokes` individuais. Toda checagem acontece no backend.
 */
export const MODULES = {
  dashboard: "Dashboard",
  finance: "Financeiro",
  planning: "Planejamento e checklist",
  calendar: "Calendário",
  ceremony: "Igreja e cerimônia",
  venue: "Recepção e festa",
  vendors: "Fornecedores",
  documents: "Contratos e documentos",
  guests: "Convidados",
  rsvp: "Convites e confirmações",
  whatsapp: "WhatsApp",
  gallery: "Galeria",
  ai: "Inteligência artificial",
  reports: "Relatórios",
  audit: "Auditoria",
  users: "Usuários e permissões",
  settings: "Configurações",
  integrations: "Integrações (segredos)",
} as const;
export type Module = keyof typeof MODULES;

export const ACTIONS = {
  view: "Visualizar",
  create: "Criar",
  edit: "Editar",
  delete: "Excluir",
  export: "Exportar",
  approve: "Aprovar",
} as const;
export type Action = keyof typeof ACTIONS;

export type Permission = `${Module}:${Action}`;

/** Ações que fazem sentido em cada módulo (o editor de perfis só mostra estas) */
export const MODULE_ACTIONS: Record<Module, Action[]> = {
  dashboard: ["view"],
  finance: ["view", "create", "edit", "delete", "export", "approve"],
  planning: ["view", "create", "edit", "delete", "export"],
  calendar: ["view", "create", "edit", "delete"],
  ceremony: ["view", "create", "edit", "delete"],
  venue: ["view", "create", "edit", "delete"],
  vendors: ["view", "create", "edit", "delete", "export"],
  documents: ["view", "create", "edit", "delete", "export"],
  guests: ["view", "create", "edit", "delete", "export"],
  rsvp: ["view", "create", "edit"],
  whatsapp: ["view", "create", "approve"],
  gallery: ["view", "create", "edit", "delete"],
  ai: ["view", "create", "approve"],
  reports: ["view", "export"],
  audit: ["view"],
  users: ["view", "create", "edit", "delete"],
  settings: ["view", "edit"],
  integrations: ["view", "edit"],
};

export const ALL_PERMISSIONS: Permission[] = (Object.keys(MODULE_ACTIONS) as Module[]).flatMap((m) =>
  MODULE_ACTIONS[m].map((a) => `${m}:${a}` as Permission),
);

const all = (m: Module): Permission[] => MODULE_ACTIONS[m].map((a) => `${m}:${a}` as Permission);
const only = (m: Module, ...actions: Action[]): Permission[] => actions.map((a) => `${m}:${a}` as Permission);

export const DEFAULT_ROLES: { key: string; name: string; description: string; permissions: Permission[] }[] = [
  {
    key: "ADMIN",
    name: "Administrador",
    description: "Acesso integral: configurações, integrações, usuários, financeiro e auditoria.",
    permissions: ALL_PERMISSIONS,
  },
  {
    key: "COUPLE",
    name: "Casal",
    description: "Planejamento, convidados, financeiro, fornecedores, contratos e IA.",
    permissions: [
      ...all("dashboard"), ...all("finance"), ...all("planning"), ...all("calendar"), ...all("ceremony"), ...all("venue"),
      ...all("vendors"), ...all("documents"), ...all("guests"), ...all("rsvp"), ...all("whatsapp"), ...all("gallery"),
      ...all("ai"), ...all("reports"), ...only("users", "view"), ...only("settings", "view", "edit"),
    ],
  },
  {
    key: "PLANNER",
    name: "Cerimonialista",
    description: "Cronogramas, tarefas, fornecedores e contatos. Sem financeiro nem segredos.",
    permissions: [
      ...all("dashboard"), ...all("planning"), ...all("calendar"), ...all("ceremony"), ...all("venue"),
      ...only("vendors", "view", "create", "edit"), ...only("documents", "view"), ...only("guests", "view", "export"),
      ...only("rsvp", "view"), ...only("gallery", "view", "create"), ...only("reports", "view"),
    ],
  },
  {
    key: "COLLABORATOR",
    name: "Colaborador",
    description: "Apenas tarefas e dados explicitamente autorizados.",
    permissions: [...only("dashboard", "view"), ...only("planning", "view", "edit"), ...only("calendar", "view")],
  },
];

export function effectivePermissions(role: { permissions: string[] }, member: { grants: string[]; revokes: string[] }) {
  const set = new Set<string>([...role.permissions, ...member.grants]);
  for (const r of member.revokes) set.delete(r);
  return set;
}

export const isPermission = (p: string): p is Permission => (ALL_PERMISSIONS as string[]).includes(p);
