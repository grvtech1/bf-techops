import type { DataSourceOptions } from "typeorm";
import { readFileSync } from "node:fs";
import { persistenceEntities } from "./entities.js";

export interface DatabaseEnvironment {
  MYSQL_HOST?: string;
  MYSQL_PORT?: string;
  MYSQL_DATABASE?: string;
  MYSQL_USER?: string;
  MYSQL_PASSWORD?: string;
  MYSQL_SSL?: string;
  MYSQL_SSL_CA_PATH?: string;
}

export function databaseOptions(env: DatabaseEnvironment): DataSourceOptions {
  const required = ["MYSQL_HOST", "MYSQL_DATABASE", "MYSQL_USER", "MYSQL_PASSWORD"] as const;
  for (const key of required) {
    if (!env[key]) {
      throw new Error(`${key} is required`);
    }
  }

  return {
    type: "mysql",
    host: env.MYSQL_HOST,
    port: Number(env.MYSQL_PORT ?? 3306),
    database: env.MYSQL_DATABASE,
    username: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    entities: persistenceEntities,
    synchronize: false,
    migrationsRun: false,
    timezone: "Z",
    charset: "utf8mb4",
    ssl: mysqlSslOptions(env),
    extra: {
      connectionLimit: 10,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10_000
    }
  };
}

function mysqlSslOptions(env: DatabaseEnvironment): { ca: string; rejectUnauthorized: true } | undefined {
  if (env.MYSQL_SSL !== "true") return undefined;
  if (!env.MYSQL_SSL_CA_PATH) {
    throw new Error("MYSQL_SSL_CA_PATH is required when MYSQL_SSL=true");
  }
  return {
    ca: readFileSync(env.MYSQL_SSL_CA_PATH, "utf8"),
    rejectUnauthorized: true
  };
}
