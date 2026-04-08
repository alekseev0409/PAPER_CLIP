import { randomBytes, randomUUID } from "node:crypto";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { and, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { hashPassword } from "better-auth/crypto";
import {
  authAccounts,
  authSessions,
  authUsers,
  authVerifications,
  createDb,
} from "@paperclipai/db";
import { loadPaperclipEnvFile } from "../config/env.js";
import { readConfig, resolveConfigPath } from "../config/store.js";

type ManualUserCommandOptions = {
  config?: string;
  dbUrl?: string;
  email: string;
  name?: string;
  password?: string;
  json?: boolean;
};

function generatePassword() {
  const raw = randomBytes(12).toString("base64url");
  return `Pc_${raw}9!`;
}

function resolveDbUrl(configPath?: string, explicitDbUrl?: string) {
  if (explicitDbUrl) return explicitDbUrl;
  const config = readConfig(configPath);
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (config?.database.mode === "postgres" && config.database.connectionString) {
    return config.database.connectionString;
  }
  if (config?.database.mode === "embedded-postgres") {
    const port = config.database.embeddedPostgresPort ?? 54329;
    return `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  }
  return null;
}

function resolveBaseUrl(configPath?: string) {
  const fromEnv =
    process.env.PAPERCLIP_PUBLIC_URL ??
    process.env.PAPERCLIP_AUTH_PUBLIC_BASE_URL ??
    process.env.BETTER_AUTH_URL ??
    process.env.BETTER_AUTH_BASE_URL;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/+$/, "");
  const config = readConfig(configPath);
  if (config?.auth.baseUrlMode === "explicit" && config.auth.publicBaseUrl) {
    return config.auth.publicBaseUrl.replace(/\/+$/, "");
  }
  const host = config?.server.host ?? "localhost";
  const port = config?.server.port ?? 3100;
  const publicHost = host === "0.0.0.0" ? "localhost" : host;
  return `http://${publicHost}:${port}`;
}

function resolveAuthSecret() {
  return process.env.BETTER_AUTH_SECRET?.trim() ?? process.env.PAPERCLIP_AGENT_JWT_SECRET?.trim() ?? null;
}

function createCliAuth(db: ReturnType<typeof createDb>, configPath?: string) {
  const baseUrl = resolveBaseUrl(configPath);
  const secret = resolveAuthSecret();
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRET (or PAPERCLIP_AGENT_JWT_SECRET) must be set");
  }

  return betterAuth({
    baseURL: baseUrl,
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authUsers,
        session: authSessions,
        account: authAccounts,
        verification: authVerifications,
      },
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      disableSignUp: false,
    },
    ...(baseUrl.startsWith("http://") ? { advanced: { useSecureCookies: false } } : {}),
  });
}

export async function createManualUser(opts: ManualUserCommandOptions) {
  const configPath = resolveConfigPath(opts.config);
  loadPaperclipEnvFile(configPath);
  const dbUrl = resolveDbUrl(configPath, opts.dbUrl);
  if (!dbUrl) {
    p.log.error("Could not resolve database connection.");
    p.log.info("If using embedded-postgres, start the Paperclip server and run this command again.");
    return;
  }

  const email = opts.email.trim().toLowerCase();
  const name = (opts.name?.trim() || email.split("@")[0] || "user").trim();
  const password = opts.password?.trim() || generatePassword();
  const generatedPassword = !opts.password?.trim();
  const db = createDb(dbUrl);
  const closableDb = db as typeof db & {
    $client?: { end?: (options?: { timeout?: number }) => Promise<void> };
  };

  try {
    const existing = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .then((rows) => rows[0] ?? null);
    if (existing) {
      throw new Error(`User already exists: ${email}`);
    }

    const auth = createCliAuth(db, configPath);
    const result = await (auth as unknown as {
      api: {
        signUpEmail: (input: {
          body: { name: string; email: string; password: string };
          headers: Headers;
        }) => Promise<{ user: { id: string; email: string; name: string } }>;
      };
    }).api.signUpEmail({
      body: { name, email, password },
      headers: new Headers(),
    });

    if (opts.json) {
      console.log(JSON.stringify({ user: result.user, password }, null, 2));
      return;
    }

    p.log.success(`Created user ${pc.cyan(email)}`);
    p.log.message(`Name: ${pc.dim(name)}`);
    p.log.message(`User ID: ${pc.dim(result.user.id)}`);
    p.log.message(`Password: ${pc.cyan(password)}`);
    if (generatedPassword) {
      p.log.info("Password was generated automatically. Send it to the user via a secure channel.");
    }
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
  } finally {
    await closableDb.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}

export async function setManualUserPassword(opts: Omit<ManualUserCommandOptions, "name">) {
  const configPath = resolveConfigPath(opts.config);
  loadPaperclipEnvFile(configPath);
  const dbUrl = resolveDbUrl(configPath, opts.dbUrl);
  if (!dbUrl) {
    p.log.error("Could not resolve database connection.");
    p.log.info("If using embedded-postgres, start the Paperclip server and run this command again.");
    return;
  }

  const email = opts.email.trim().toLowerCase();
  const password = opts.password?.trim() || generatePassword();
  const generatedPassword = !opts.password?.trim();
  const db = createDb(dbUrl);
  const closableDb = db as typeof db & {
    $client?: { end?: (options?: { timeout?: number }) => Promise<void> };
  };

  try {
    const user = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .then((rows) => rows[0] ?? null);
    if (!user) {
      throw new Error(`User not found: ${email}`);
    }

    const passwordHash = await hashPassword(password);
    const existingCredential = await db
      .select({ id: authAccounts.id })
      .from(authAccounts)
      .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, "credential")))
      .then((rows) => rows[0] ?? null);

    if (existingCredential) {
      await db
        .update(authAccounts)
        .set({ password: passwordHash, updatedAt: new Date() })
        .where(eq(authAccounts.id, existingCredential.id));
    } else {
      const now = new Date();
      await db.insert(authAccounts).values({
        id: randomUUID(),
        accountId: user.id,
        providerId: "credential",
        userId: user.id,
        password: passwordHash,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (opts.json) {
      console.log(JSON.stringify({ email, password }, null, 2));
      return;
    }

    p.log.success(`Updated password for ${pc.cyan(email)}`);
    p.log.message(`Password: ${pc.cyan(password)}`);
    if (generatedPassword) {
      p.log.info("Password was generated automatically. Send it to the user via a secure channel.");
    }
  } catch (err) {
    p.log.error(err instanceof Error ? err.message : String(err));
  } finally {
    await closableDb.$client?.end?.({ timeout: 5 }).catch(() => undefined);
  }
}
