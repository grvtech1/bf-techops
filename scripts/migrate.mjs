import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

const directory = resolve(process.cwd(), "database/migrations");
const connection = await connectWithRetry();

try {
  const [[lock]] = await connection.query("SELECT GET_LOCK('merchant-platform-migrations', 60) AS acquired");
  if (lock.acquired !== 1) throw new Error("Could not acquire the database migration lock");

  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum CHAR(64) NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);

  const files = (await readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  for (const file of files) {
    const sql = await readFile(resolve(directory, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const [existing] = await connection.execute("SELECT checksum FROM schema_migrations WHERE name = ?", [file]);
    if (existing.length) {
      if (existing[0].checksum !== checksum) {
        throw new Error(`Checksum drift detected for applied migration ${file}`);
      }
      log("migration_verified", { file, checksum });
      continue;
    }

    log("migration_applying", { file, checksum });
    await connection.query(sql);
    await connection.execute("INSERT INTO schema_migrations (name, checksum) VALUES (?, ?)", [file, checksum]);
    log("migration_applied", { file, checksum });
  }
  await provisionApplicationUser(connection);
} finally {
  await connection.query("SELECT RELEASE_LOCK('merchant-platform-migrations')").catch(() => undefined);
  await connection.end();
}

function required(name) {
  if (!process.env[name]) throw new Error(`${name} is required`);
  return process.env[name];
}

function log(message, fields) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message, ...fields })}\n`);
}

async function connectWithRetry() {
  let lastError;
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    try {
      return await mysql.createConnection({
        host: required("MYSQL_HOST"),
        port: Number(process.env.MYSQL_PORT ?? 3306),
        database: required("MYSQL_DATABASE"),
        user: required("MYSQL_USER"),
        password: required("MYSQL_PASSWORD"),
        ssl: await mysqlSslOptions(),
        multipleStatements: true
      });
    } catch (error) {
      lastError = error;
      log("migration_database_wait", { attempt });
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function mysqlSslOptions() {
  if (process.env.MYSQL_SSL !== "true") return undefined;
  const path = required("MYSQL_SSL_CA_PATH");
  return { ca: await readFile(path, "utf8"), rejectUnauthorized: true };
}

async function provisionApplicationUser(connection) {
  const user = process.env.MYSQL_APP_USER;
  const password = process.env.MYSQL_APP_PASSWORD;
  if (!user && !password) return;
  if (!user || !password || !/^[A-Za-z0-9_]{1,32}$/.test(user)) {
    throw new Error("MYSQL_APP_USER and MYSQL_APP_PASSWORD must be supplied together with a safe username");
  }
  const database = required("MYSQL_DATABASE");
  if (!/^[A-Za-z0-9_]{1,64}$/.test(database)) throw new Error("Unsafe MYSQL_DATABASE value");

  const escapedUser = connection.escape(user);
  const escapedPassword = connection.escape(password);
  await connection.query(`CREATE USER IF NOT EXISTS ${escapedUser}@'%' IDENTIFIED BY ${escapedPassword}`);
  await connection.query(`ALTER USER ${escapedUser}@'%' IDENTIFIED BY ${escapedPassword}`);
  await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.* TO ${escapedUser}@'%'`);
  log("application_database_user_provisioned", { user, database });
}
