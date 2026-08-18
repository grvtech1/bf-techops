import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import mysql from "mysql2/promise";

const input = {
  changeId: required("PROVISIONING_CHANGE_ID"),
  merchantId: uuid("ROOT_MERCHANT_ID"),
  merchantName: bounded("ROOT_MERCHANT_NAME", 2, 160),
  storeId: uuid("STORE_ID"),
  storeCode: match("STORE_CODE", /^[A-Z0-9][A-Z0-9_-]{1,39}$/),
  storeName: bounded("STORE_NAME", 2, 160),
  storeTimezone: timezone("STORE_TIMEZONE")
};
if (!/^[A-Za-z0-9._:-]{4,80}$/.test(input.changeId)) {
  throw new Error("PROVISIONING_CHANGE_ID must be a safe ticket or change identifier");
}

const mysqlPort = Number(process.env.MYSQL_PORT ?? 3306);
if (!Number.isInteger(mysqlPort) || mysqlPort < 1 || mysqlPort > 65535) {
  throw new Error("MYSQL_PORT must be an integer from 1 to 65535");
}

const connection = await mysql.createConnection({
  host: required("MYSQL_HOST"),
  port: mysqlPort,
  database: required("MYSQL_DATABASE"),
  user: required("MYSQL_USER"),
  password: required("MYSQL_PASSWORD"),
  ssl: await mysqlSslOptions()
});

try {
  await connection.beginTransaction();
  const [merchantRows] = await connection.execute(
    "SELECT id, parent_merchant_id, name, active FROM merchants WHERE id = ? FOR UPDATE",
    [input.merchantId]
  );
  const [storeRows] = await connection.execute(
    `SELECT id, merchant_id, code, name, timezone, active
       FROM stores
      WHERE id = ? OR (merchant_id = ? AND code = ?)
      FOR UPDATE`,
    [input.storeId, input.merchantId, input.storeCode]
  );

  if (merchantRows.length || storeRows.length) {
    if (!exactMerchant(merchantRows[0], input) || !exactStore(storeRows[0], input)) {
      throw new Error("Existing tenant/store differs from the requested identity; refusing partial or destructive provisioning");
    }
    await connection.rollback();
    log("tenant_provisioning_noop", { changeId: input.changeId, merchantId: input.merchantId, storeId: input.storeId });
  } else {
    await connection.execute(
      "INSERT INTO merchants (id, parent_merchant_id, name, active) VALUES (?, NULL, ?, TRUE)",
      [input.merchantId, input.merchantName]
    );
    await connection.execute(
      "INSERT INTO stores (id, merchant_id, code, name, timezone, active) VALUES (?, ?, ?, ?, ?, TRUE)",
      [input.storeId, input.merchantId, input.storeCode, input.storeName, input.storeTimezone]
    );
    await connection.execute(
      `INSERT INTO audit_events
        (id, merchant_id, actor_subject, action, resource_type, resource_id, request_id, details)
       VALUES (?, ?, ?, 'tenant.provisioned', 'merchant', ?, ?, ?)`,
      [
        randomUUID(),
        input.merchantId,
        `provisioner:${input.changeId}`,
        input.merchantId,
        input.changeId,
        JSON.stringify({ storeId: input.storeId, storeCode: input.storeCode })
      ]
    );
    await connection.commit();
    log("tenant_provisioned", { changeId: input.changeId, merchantId: input.merchantId, storeId: input.storeId });
  }
} catch (error) {
  await connection.rollback().catch(() => undefined);
  throw error;
} finally {
  await connection.end();
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function bounded(name, minimum, maximum) {
  const value = required(name).trim();
  if (value.length < minimum || value.length > maximum) throw new Error(`${name} length is invalid`);
  return value;
}

function match(name, pattern) {
  const value = required(name);
  if (!pattern.test(value)) throw new Error(`${name} format is invalid`);
  return value;
}

function uuid(name) {
  return match(name, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
}

async function mysqlSslOptions() {
  if (process.env.MYSQL_SSL !== "true") return undefined;
  const path = required("MYSQL_SSL_CA_PATH");
  return { ca: await readFile(path, "utf8"), rejectUnauthorized: true };
}

function timezone(name) {
  const value = bounded(name, 3, 64);
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    throw new Error(`${name} must be a valid IANA time zone`);
  }
  return value;
}

function exactMerchant(row, expected) {
  return row && row.id === expected.merchantId && row.parent_merchant_id === null &&
    row.name === expected.merchantName && Boolean(row.active);
}

function exactStore(row, expected) {
  return row && row.id === expected.storeId && row.merchant_id === expected.merchantId &&
    row.code === expected.storeCode && row.name === expected.storeName &&
    row.timezone === expected.storeTimezone && Boolean(row.active);
}

function log(message, fields) {
  process.stdout.write(`${JSON.stringify({ timestamp: new Date().toISOString(), level: "info", message, ...fields })}\n`);
}
