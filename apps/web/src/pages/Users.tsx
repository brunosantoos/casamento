import { Copy, Lock, Mail, Pencil, Plus, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog, EmptyState, Field, LoadingButton, PageHeader, QueryState, Section, StatusBadge, TextField } from "@/components/app/common";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useMe } from "@/hooks/use-me";
import { dateTime, relative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { trpc, type RouterOutputs } from "@/trpc";

type Data = RouterOutputs["members"]["list"];
type Member = Data["members"][number];
type Role = Data["roles"][number];

const ACTION_LABEL: Record<string, string> = { view: "Ver", create: "Criar", edit: "Editar", delete: "Excluir", export: "Exportar", approve: "Aprovar" };
const ACTIONS = ["view", "create", "edit", "delete", "export", "approve"];

function useCatalog() {
  return trpc.wedding.permissionCatalog.useQuery(undefined, { staleTime: Infinity });
}

/**
 * Matriz módulos × ações. `state(p)` diz como desenhar a célula; `onToggle(p)` decide o que mudar.
 * Células desabilitadas = permissões que você não possui (não pode conceder).
 */
function PermissionMatrix({ state, onToggle, readOnly, canGrant }: {
  state: (p: string) => { on: boolean; mark?: "granted" | "revoked" | null };
  onToggle: (p: string) => void;
  readOnly?: boolean;
  canGrant: (p: string) => boolean;
}) {
  const cat = useCatalog();
  if (!cat.data) return null;
  const modules = Object.entries(cat.data.modules) as [string, string][];
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Módulo</th>
            {ACTIONS.map((a) => <th key={a} className="px-2 py-2 text-center text-xs font-medium">{ACTION_LABEL[a]}</th>)}
          </tr>
        </thead>
        <tbody className="divide-y">
          {modules.map(([m, label]) => (
            <tr key={m}>
              <td className="px-3 py-1.5 whitespace-nowrap">{label}</td>
              {ACTIONS.map((a) => {
                const allowed = (cat.data.moduleActions as Record<string, string[]>)[m]?.includes(a);
                if (!allowed) return <td key={a} />;
                const p = `${m}:${a}`;
                const s = state(p);
                const disabled = readOnly || (!s.on && !canGrant(p));
                return (
                  <td key={a} className="px-2 py-1.5 text-center">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => onToggle(p)}
                      title={s.mark === "granted" ? "Concedido individualmente" : s.mark === "revoked" ? "Revogado individualmente" : s.on ? "Herdado do perfil" : "Sem acesso"}
                      className={cn(
                        "mx-auto grid size-6 place-items-center rounded-md border text-xs transition disabled:cursor-not-allowed disabled:opacity-40",
                        s.on && "border-primary bg-primary text-primary-foreground",
                        s.mark === "granted" && "ring-2 ring-gold",
                        s.mark === "revoked" && "border-destructive bg-destructive/10 text-destructive",
                      )}
                    >
                      {s.on ? "✓" : s.mark === "revoked" ? "✕" : ""}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded border border-primary bg-primary text-[10px] text-primary-foreground">✓</span> herdado do perfil</span>
      <span className="flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded border border-primary bg-primary text-[10px] text-primary-foreground ring-2 ring-gold">✓</span> concedido</span>
      <span className="flex items-center gap-1.5"><span className="grid size-4 place-items-center rounded border border-destructive bg-destructive/10 text-[10px] text-destructive">✕</span> revogado</span>
    </div>
  );
}

function InviteDialog({ roles, open, onOpenChange }: { roles: Role[]; open: boolean; onOpenChange: (o: boolean) => void }) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState({ email: "", name: "", roleId: "" });
  const [url, setUrl] = useState<string | null>(null);
  const invite = trpc.members.invite.useMutation({
    onSuccess: (r) => {
      setUrl(r.url);
      utils.members.list.invalidate();
      toast.success("Convite enviado por e-mail");
    },
    onError: (e) => toast.error(e.message),
  });
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setUrl(null);
      setForm({ email: "", name: "", roleId: "" });
    }
  };
  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Convidar para o painel</DialogTitle>
          <DialogDescription>A pessoa recebe um link válido por 7 dias para criar a conta (ou entrar) e acessar este casamento.</DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="space-y-3">
            <p className="text-sm">Convite criado. Você também pode enviar o link diretamente:</p>
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.target.select()} />
              <Button variant="outline" size="icon" aria-label="Copiar" onClick={() => navigator.clipboard.writeText(url).then(() => toast.success("Link copiado"))}><Copy /></Button>
            </div>
            <DialogFooter><Button onClick={() => close(false)}>Concluir</Button></DialogFooter>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (!form.roleId) return toast.error("Escolha um perfil");
              invite.mutate({ email: form.email, name: form.name || undefined, roleId: form.roleId });
            }}
          >
            <TextField label="E-mail" type="email" required value={form.email} onChange={(v) => setForm({ ...form, email: v })} />
            <TextField label="Nome (opcional)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
            <Field label="Perfil">
              <Select value={form.roleId} onValueChange={(v) => setForm({ ...form, roleId: v })}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Escolha…" /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <DialogFooter><LoadingButton type="submit" loading={invite.isPending}><Mail /> Enviar convite</LoadingButton></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({ member, roles, onClose }: { member: Member; roles: Role[]; onClose: () => void }) {
  const { can, wedding } = useMe();
  const mine = new Set(wedding?.permissions ?? []);
  const utils = trpc.useUtils();
  const [roleId, setRoleId] = useState(member.roleId);
  const [grants, setGrants] = useState<string[]>(member.grants);
  const [revokes, setRevokes] = useState<string[]>(member.revokes);
  const [active, setActive] = useState(member.active);
  const role = roles.find((r) => r.id === roleId)!;
  const save = trpc.members.updateMember.useMutation({
    onSuccess: () => {
      toast.success("Acesso atualizado");
      utils.members.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const inherited = (p: string) => role.permissions.includes(p);
  const state = (p: string) => {
    if (revokes.includes(p)) return { on: false, mark: "revoked" as const };
    if (grants.includes(p)) return { on: true, mark: inherited(p) ? null : ("granted" as const) };
    return { on: inherited(p), mark: null };
  };
  const toggle = (p: string) => {
    if (inherited(p)) setRevokes(revokes.includes(p) ? revokes.filter((x) => x !== p) : [...revokes, p]);
    else setGrants(grants.includes(p) ? grants.filter((x) => x !== p) : [...grants, p]);
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{member.user.name}</DialogTitle>
          <DialogDescription>{member.user.email}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Perfil">
              <Select value={roleId} onValueChange={(v) => { setRoleId(v); setGrants([]); setRevokes([]); }}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>{roles.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field label="Acesso ativo" hint="Desativado: a pessoa perde acesso a este casamento.">
              <div className="flex h-9 items-center"><Switch checked={active} onCheckedChange={setActive} /></div>
            </Field>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Permissões efetivas</div>
            <Legend />
            <PermissionMatrix state={state} onToggle={toggle} canGrant={(p) => mine.has(p)} readOnly={!can("users:edit")} />
            <p className="text-xs text-muted-foreground">Clique para conceder ou revogar individualmente. Você só pode conceder permissões que possui. Todas as regras são verificadas no servidor.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <LoadingButton loading={save.isPending} onClick={() => save.mutate({ memberId: member.id, roleId, grants, revokes, active })}>Salvar</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RoleDialog({ role, onClose }: { role: Role | "new"; onClose: () => void }) {
  const { wedding } = useMe();
  const mine = new Set(wedding?.permissions ?? []);
  const utils = trpc.useUtils();
  const isNew = role === "new";
  const readOnly = !isNew && role.key === "ADMIN";
  const [name, setName] = useState(isNew ? "" : role.name);
  const [description, setDescription] = useState(isNew ? "" : (role.description ?? ""));
  const [perms, setPerms] = useState<string[]>(isNew ? ["dashboard:view"] : role.permissions);
  const save = trpc.members.saveRole.useMutation({
    onSuccess: () => {
      toast.success("Perfil salvo");
      utils.members.list.invalidate();
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isNew ? "Novo perfil" : role.name}</DialogTitle>
          <DialogDescription>{readOnly ? "O perfil Administrador tem todas as permissões e não pode ser alterado." : "Defina o que quem tiver este perfil pode fazer em cada módulo."}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Nome" value={name} onChange={setName} disabled={readOnly} />
            <TextField label="Descrição" value={description} onChange={setDescription} disabled={readOnly} />
          </div>
          <PermissionMatrix
            readOnly={readOnly}
            canGrant={(p) => mine.has(p)}
            state={(p) => ({ on: perms.includes(p) })}
            onToggle={(p) => setPerms(perms.includes(p) ? perms.filter((x) => x !== p) : [...perms, p])}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{readOnly ? "Fechar" : "Cancelar"}</Button>
          {!readOnly && <LoadingButton loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate({ id: isNew ? undefined : role.id, name, description: description || undefined, permissions: perms })}>Salvar perfil</LoadingButton>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function UsersPage() {
  const { can, me } = useMe();
  const q = trpc.members.list.useQuery();
  const utils = trpc.useUtils();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editingRole, setEditingRole] = useState<Role | "new" | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);
  const revoke = trpc.members.revokeInvite.useMutation({ onSuccess: () => { toast.success("Convite revogado"); setRevoking(null); utils.members.list.invalidate(); }, onError: (e) => toast.error(e.message) });
  const delRole = trpc.members.deleteRole.useMutation({ onSuccess: () => { toast.success("Perfil excluído"); setDeletingRole(null); utils.members.list.invalidate(); }, onError: (e) => toast.error(e.message) });

  return (
    <>
      <PageHeader
        title="Usuários e permissões"
        description="Quem acessa o painel e o que cada pessoa pode ver, criar, editar, excluir, exportar e aprovar."
        actions={can("users:create") && <Button onClick={() => setInviting(true)}><UserPlus /> Convidar</Button>}
      />
      <Alert className="mb-5"><Lock /><AlertDescription>As permissões são verificadas no servidor em cada operação; esconder um botão aqui é só conveniência.</AlertDescription></Alert>
      <QueryState query={q}>
        {(d) => (
          <Tabs defaultValue="members">
            <TabsList className="mb-4">
              <TabsTrigger value="members">Membros ({d.members.length})</TabsTrigger>
              <TabsTrigger value="invites">Convites pendentes ({d.invitations.length})</TabsTrigger>
              <TabsTrigger value="roles">Perfis</TabsTrigger>
            </TabsList>

            <TabsContent value="members">
              <div className="overflow-x-auto rounded-xl border bg-card">
                <Table>
                  <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>E-mail</TableHead><TableHead>Perfil</TableHead><TableHead>Ajustes</TableHead><TableHead>Situação</TableHead><TableHead>Último acesso</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {d.members.map((m) => {
                      const self = m.userId === me?.user.id;
                      return (
                        <TableRow key={m.id}>
                          <TableCell className="font-medium whitespace-nowrap">{m.user.name}{self && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}</TableCell>
                          <TableCell className="text-muted-foreground">{m.user.email}</TableCell>
                          <TableCell>{m.role.name}</TableCell>
                          <TableCell className="text-xs">{m.grants.length || m.revokes.length ? `+${m.grants.length} / −${m.revokes.length}` : "—"}</TableCell>
                          <TableCell>{m.active && m.user.active ? <StatusBadge tone="emerald">Ativo</StatusBadge> : <StatusBadge tone="rose">{m.user.active ? "Desativado" : "Conta desativada"}</StatusBadge>}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs" title={dateTime(m.user.lastLoginAt)}>{m.user.lastLoginAt ? relative(m.user.lastLoginAt) : "nunca"}</TableCell>
                          <TableCell className="text-right">
                            {can("users:edit") && <Button size="sm" variant="ghost" disabled={self} title={self ? "Você não pode alterar o próprio acesso" : undefined} onClick={() => setEditing(m)}><Pencil /> Editar</Button>}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </TabsContent>

            <TabsContent value="invites">
              {d.invitations.length ? (
                <div className="overflow-x-auto rounded-xl border bg-card">
                  <Table>
                    <TableHeader><TableRow><TableHead>E-mail</TableHead><TableHead>Perfil</TableHead><TableHead>Enviado</TableHead><TableHead>Validade</TableHead><TableHead /></TableRow></TableHeader>
                    <TableBody>
                      {d.invitations.map((i) => (
                        <TableRow key={i.id}>
                          <TableCell>{i.email}{i.name ? <span className="text-muted-foreground"> · {i.name}</span> : null}</TableCell>
                          <TableCell>{i.role.name}</TableCell>
                          <TableCell className="text-xs">{dateTime(i.createdAt)}</TableCell>
                          <TableCell>{i.expired ? <StatusBadge tone="rose">Expirado</StatusBadge> : <span className="text-xs">{dateTime(i.expiresAt)}</span>}</TableCell>
                          <TableCell className="text-right">{can("users:delete") && <Button size="sm" variant="ghost" onClick={() => setRevoking(i.id)}>Revogar</Button>}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : <EmptyState icon={<Mail />} title="Nenhum convite pendente" description="Convide a cerimonialista, familiares ou colaboradores." />}
            </TabsContent>

            <TabsContent value="roles">
              <Section title="Perfis" description="Conjuntos iniciais de permissões. Ajustes individuais são feitos no membro." actions={can("users:edit") && <Button size="sm" onClick={() => setEditingRole("new")}><Plus /> Novo perfil</Button>}>
                <ul className="grid gap-3 md:grid-cols-2">
                  {d.roles.map((r) => (
                    <li key={r.id} className="rounded-xl border p-4">
                      <div className="flex items-start gap-2">
                        <ShieldCheck className="mt-0.5 size-4 text-primary" />
                        <div className="min-w-0 flex-1">
                          <div className="font-medium">{r.name} {r.system && <StatusBadge tone="neutral" className="ml-1">padrão</StatusBadge>}</div>
                          <p className="text-xs text-muted-foreground">{r.description}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{r.permissions.length} permissões · {r._count.members} membro(s)</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setEditingRole(r)}><Pencil /></Button>
                          {!r.system && can("users:delete") && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setDeletingRole(r)}><Trash2 /></Button>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </Section>
            </TabsContent>

            <InviteDialog roles={d.roles} open={inviting} onOpenChange={setInviting} />
            {editing && <MemberDialog member={editing} roles={d.roles} onClose={() => setEditing(null)} />}
            {editingRole && <RoleDialog role={editingRole} onClose={() => setEditingRole(null)} />}
            <ConfirmDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)} title="Revogar convite?" description="O link deixa de funcionar imediatamente." destructive confirmLabel="Revogar" loading={revoke.isPending} onConfirm={() => revoking && revoke.mutate({ id: revoking })} />
            <ConfirmDialog open={!!deletingRole} onOpenChange={(o) => !o && setDeletingRole(null)} title={`Excluir o perfil "${deletingRole?.name}"?`} description="Só é possível excluir perfis sem membros." destructive confirmLabel="Excluir" loading={delRole.isPending} onConfirm={() => deletingRole && delRole.mutate({ id: deletingRole.id })} />
          </Tabs>
        )}
      </QueryState>
    </>
  );
}
