import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

if ((process.env.NODE_ENV ?? "development") === "production") {
  throw new Error("Local seed data cannot be applied in production");
}

const connection = await connectWithRetry();
try {
  await waitForSchema(connection);
  const sql = await readFile(resolve(process.cwd(), "database/seeds/local.sql"), "utf8");
  await connection.query(sql);
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message: "local_seed_applied" })}\n`);
} finally {
  await connection.end();
}

function required(name) {
  if (!process.env[name]) throw new Error(`${name} is required`);
  return process.env[name];
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
        multipleStatements: true
      });
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw lastError;
}

async function waitForSchema(connection) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const [rows] = await connection.query("SHOW TABLES LIKE 'merchants'");
    if (rows.length) return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error("Timed out waiting for the merchants table");
}
