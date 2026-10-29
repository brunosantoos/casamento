import { execSync } from "node:child_process";
import path from "node:path";
import { TEST_ENV } from "../vitest.config.js";

/** Aplica as migrações no banco de teste antes de rodar */
export default function setup() {
  if (!/_test\b/.test(TEST_ENV.DATABASE_URL)) throw new Error("Use um banco *_test para os testes");
  execSync("pnpm exec prisma migrate deploy", { cwd: path.resolve(import.meta.dirname, "../../db"), env: { ...process.env, DATABASE_URL: TEST_ENV.DATABASE_URL }, stdio: "pipe" });
}
