/**
 * Backup com verificação de restauração.
 *   1. pg_dump (formato custom) → deploy/backups/<data>.dump + SHA-256
 *   2. restaura em um banco temporário e confere contagens das tabelas principais
 *   3. registra BackupExecution (status, tamanho, hash, verifiedAt)
 * Uso: pnpm --filter @casa/db backup        (DATABASE_URL do ambiente)
 * Restaurar de verdade: ver deploy/restore.sh e docs/backup-e-restauracao.md
 */
import { PrismaClient } from "@prisma/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL ausente");
const dir = path.resolve(import.meta.dirname, "../../../deploy/backups");
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(dir, `casamento-${stamp}.dump`);
const prisma = new PrismaClient();
const CHECK = ["Wedding", "FinancialObligation", "Installment", "Payment", "Guest", "AuditLog", "FileAsset"];

const exec = await prisma.backupExecution.create({ data: { status: "RUNNING", location: file } });
const count = (dbUrl: string, table: string) => Number(execFileSync("psql", [dbUrl, "-Atc", `SELECT count(*) FROM "${table}"`]).toString().trim());

try {
  execFileSync("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", `--file=${file}`, url], { stdio: "inherit" });
  const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
  const size = statSync(file).size;

  // Verificação: restaura em banco descartável e compara contagens
  const u = new URL(url);
  const tmpDb = `casamento_restore_check_${Date.now()}`;
  const admin = new URL(url);
  admin.pathname = "/postgres";
  execFileSync("psql", [admin.toString(), "-c", `CREATE DATABASE "${tmpDb}"`]);
  const tmpUrl = new URL(url);
  tmpUrl.pathname = `/${tmpDb}`;
  try {
    execFileSync("pg_restore", ["--no-owner", "--no-privileges", `--dbname=${tmpUrl.toString()}`, file], { stdio: "inherit" });
    const mismatches = CHECK.filter((t) => count(url, t) !== count(tmpUrl.toString(), t));
    if (mismatches.length) throw new Error(`Restauração divergente em: ${mismatches.join(", ")}`);
  } finally {
    execFileSync("psql", [admin.toString(), "-c", `DROP DATABASE IF EXISTS "${tmpDb}"`]);
  }
  await prisma.backupExecution.update({ where: { id: exec.id }, data: { status: "DONE", finishedAt: new Date(), sizeBytes: BigInt(size), sha256: sha, verifiedAt: new Date() } });
  console.log(`Backup OK e restauração verificada: ${file} (${(size / 1024).toFixed(0)} KB, sha256 ${sha.slice(0, 12)}…) [${u.pathname.slice(1)}]`);
} catch (e) {
  await prisma.backupExecution.update({ where: { id: exec.id }, data: { status: "FAILED", finishedAt: new Date(), error: (e as Error).message.slice(0, 500) } });
  console.error("Backup FALHOU:", (e as Error).message);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
