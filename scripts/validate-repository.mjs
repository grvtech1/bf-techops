import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const requiredFiles = [
  "apps/api/src/invoices/invoice.service.ts",
  "apps/api/src/payments/payment.service.ts",
  "apps/worker/src/outbox-relay.ts",
  "apps/portal/src/app/page.tsx",
  "database/migrations/001_initial_schema.sql",
  "database/migrations/002_payment_operations.sql",
  "scripts/provision-tenant.mjs",
  "deploy/docker/Dockerfile",
  "deploy/k8s/overlays/local/kustomization.yaml",
  "deploy/k8s/overlays/production/kustomization.yaml",
  "deploy/monitoring/prometheus-rules.yaml",
  "deploy/monitoring/kube-prometheus-values-production.yaml",
  "infra/terraform/aws/main.tf",
  "infra/ansible/site.yml",
  "docs/THREAT_MODEL.md",
  "docs/DR.md",
  "docs/PRODUCTION_GO_LIVE.md",
  "docs/SCOPE_MATRIX.md"
];

for (const file of requiredFiles) {
  await access(join(root, file), constants.R_OK);
}

const files = await walk(root);
for (const file of files.filter((value) => extname(value) === ".json")) {
  JSON.parse(await readFile(file, "utf8"));
}

const textFiles = files.filter((file) => [".js", ".mjs", ".ts", ".tsx", ".sh", ".yaml", ".yml", ".tf", ".sql", ".md"].includes(extname(file)));
for (const file of textFiles) {
  const content = await readFile(file, "utf8");
  if (content.includes("\r\n")) throw new Error(`${relative(root, file)} uses CRLF; shell and manifest sources must use LF`);
  const trailingWhitespaceLine = content.split("\n").findIndex((line) => /[ \t]+$/.test(line));
  if (trailingWhitespaceLine >= 0) {
    throw new Error(`${relative(root, file)} has trailing whitespace on line ${trailingWhitespaceLine + 1}`);
  }
  if ([".yaml", ".yml"].includes(extname(file)) && /image:\s*\S+:latest\b/.test(content)) {
    throw new Error(`${relative(root, file)} uses a mutable latest image tag`);
  }
}

const deployment = await readFile(join(root, "deploy/k8s/base/deployments.yaml"), "utf8");
for (const required of [
  "readOnlyRootFilesystem: true",
  "allowPrivilegeEscalation: false",
  "runAsNonRoot: true",
  "seccompProfile:",
  "topologySpreadConstraints:",
  "startupProbe:",
  "readinessProbe:",
  "livenessProbe:"
]) {
  if (!deployment.includes(required)) throw new Error(`Workload security/availability contract is missing: ${required}`);
}

const production = await readFile(join(root, "deploy/k8s/overlays/production/kustomization.yaml"), "utf8");
for (const image of ["api", "worker", "portal", "migration"]) {
  const placeholder = `sha256:REPLACE_${image.toUpperCase()}_DIGEST`;
  const promoted = new RegExp(`merchant-platform-${image}[^\\n]*\\n\\s*digest: sha256:[a-f0-9]{64}`);
  if (!production.includes(placeholder) && !promoted.test(production)) {
    throw new Error(`Production ${image} image must be an explicit placeholder or a promoted SHA-256 digest`);
  }
}
if ((production.match(/topology\.kubernetes\.io\/zone/g) ?? []).length !== 3 ||
    (production.match(/whenUnsatisfiable: DoNotSchedule/g) ?? []).length < 3) {
  throw new Error("Every production application workload must enforce availability-zone spreading");
}

const ingress = await readFile(join(root, "deploy/k8s/overlays/production/ingress.yaml"), "utf8");
const [portalIngress, apiIngress] = ingress.split(/^---$/m);
if (!portalIngress?.includes("name: merchant-portal") || !portalIngress.includes("- path: /\n")) {
  throw new Error("Production portal ingress must route the root path to the portal service");
}
if (!apiIngress?.includes("name: merchant-api") || !apiIngress.includes("- path: /v1") || !apiIngress.includes("- path: /health")) {
  throw new Error("Production API ingress must expose only the versioned API and health paths");
}
if (/\n\s*- path: \/\n/.test(apiIngress)) throw new Error("Production API ingress must not expose /metrics through a root route");
const ingressPlaceholders = [...ingress.matchAll(/REPLACE_[A-Z0-9_]+/g)].map((match) => match[0]);
if (ingressPlaceholders.length > 0 && new Set(ingressPlaceholders).size !== 9) {
  throw new Error("Production ingress is partially configured; use make configure-production atomically");
}
for (const invariant of [
  "access_logs.s3.enabled=true",
  "alb.ingress.kubernetes.io/wafv2-acl-arn",
  "alb.ingress.kubernetes.io/auth-type: oidc"
]) {
  if (!ingress.includes(invariant)) throw new Error(`Production ingress invariant is missing: ${invariant}`);
}

const productionMonitoring = await readFile(join(root, "deploy/monitoring/kube-prometheus-values-production.yaml"), "utf8");
for (const invariant of ["storageClassName: gp3-retain", "retention: 30d", "replicas: 2"]) {
  if (!productionMonitoring.includes(invariant)) throw new Error(`Persistent monitoring invariant is missing: ${invariant}`);
}

const operations = await readFile(join(root, "infra/terraform/aws/operations.tf"), "utf8");
for (const invariant of [
  'addon_name                  = "amazon-cloudwatch-observability"',
  'addon_name                  = "aws-ebs-csi-driver"',
  'addon_name                  = "metrics-server"',
  "CloudWatchAgentServerPolicy",
  "AmazonEBSCSIDriverPolicy",
  "ScaleTaggedNodeGroups",
  "aws_s3_bucket.alb_access_logs",
  "aws_wafv2_web_acl_logging_configuration"
]) {
  if (!operations.includes(invariant)) throw new Error(`AWS operations invariant is missing: ${invariant}`);
}

const publish = await readFile(join(root, ".github/workflows/publish.yaml"), "utf8");
for (const invariant of [
  "Reject GitOps-only release loops",
  "workflow_run",
  "github.event.workflow_run.event == 'push'",
  "github.event.workflow_run.head_branch == 'main'",
  "cosign verify",
  "github.run_attempt"
]) {
  if (!publish.includes(invariant)) throw new Error(`Release workflow invariant is missing: ${invariant}`);
}
if (!publish.includes("release-context:\n") || !publish.includes("id-token: write")) {
  throw new Error("Release jobs must declare least-privilege GitHub permissions explicitly");
}

const ci = await readFile(join(root, ".github/workflows/ci.yaml"), "utf8");
if (!ci.includes("npm audit --omit=dev --audit-level=high")) {
  throw new Error("CI must reject high-severity runtime dependency advisories");
}

const smoke = await readFile(join(root, "scripts/smoke-test.sh"), "utf8");
for (const invariant of ["concurrent_overcapture=blocked", "REFUND_ID_REUSE_CODE", "tenant_denial=403"]) {
  if (!smoke.includes(invariant)) throw new Error(`Business smoke invariant is missing: ${invariant}`);
}

const dockerfile = await readFile(join(root, "deploy/docker/Dockerfile"), "utf8");
if (!dockerfile.includes("RUN npm ci") || !dockerfile.includes(".next/standalone") ||
    !dockerfile.includes("truststore.pki.rds.amazonaws.com/global/global-bundle.pem")) {
  throw new Error("Container builds must use the lockfile and the standalone portal runtime");
}

const persistenceConfig = await readFile(join(root, "packages/persistence/src/config.ts"), "utf8");
if (!persistenceConfig.includes("MYSQL_SSL_CA_PATH") || !persistenceConfig.includes("rejectUnauthorized: true")) {
  throw new Error("Verified database TLS must use an explicit CA bundle");
}

const migration = await readFile(join(root, "scripts/migrate.mjs"), "utf8");
for (const invariant of ["GET_LOCK", "checksum", "MYSQL_APP_USER", "GRANT SELECT, INSERT, UPDATE, DELETE"]) {
  if (!migration.includes(invariant)) throw new Error(`Migration safety invariant is missing: ${invariant}`);
}

const provisioner = await readFile(join(root, "scripts/provision-tenant.mjs"), "utf8");
for (const invariant of [
  "PROVISIONING_CHANGE_ID",
  "parent_merchant_id",
  "FOR UPDATE",
  "tenant.provisioned",
  "tenant_provisioning_noop",
  "refusing partial or destructive provisioning"
]) {
  if (!provisioner.includes(invariant)) throw new Error(`Tenant provisioning invariant is missing: ${invariant}`);
}
if (provisioner.includes("merchantSlug") || provisioner.includes("parent_id")) {
  throw new Error("Tenant provisioner references a merchant column that is absent from the migration schema");
}

const migrationJob = await readFile(join(root, "deploy/k8s/base/migration-job.yaml"), "utf8");
if (!migrationJob.includes("argocd.argoproj.io/hook: Sync") || !migrationJob.includes('argocd.argoproj.io/sync-wave: "-1"')) {
  throw new Error("Migration must be a Sync hook after credentials and before application deployments");
}
if (!deployment.includes('argocd.argoproj.io/sync-wave: "1"')) {
  throw new Error("Application deployments must follow the migration wave");
}

const shellFiles = files.filter((file) => extname(file) === ".sh");
const bashCommand = process.platform === "win32"
  ? join(process.env.ProgramFiles ?? "C:\\Program Files", "Git", "bin", "bash.exe")
  : "bash";
const bash = spawnSync(bashCommand, ["--version"], { encoding: "utf8" });
if (bash.status === 0) {
  for (const file of shellFiles) {
    const result = spawnSync(bashCommand, ["-n", file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`Shell syntax failed for ${relative(root, file)}: ${result.stderr}`);
  }
}

const lockPresent = files.some((file) => relative(root, file) === "package-lock.json");
if (!lockPresent) throw new Error("package-lock.json is required for reproducible builds");
process.stdout.write(`${JSON.stringify({
  status: "valid",
  checkedFiles: files.length,
  shellSyntaxChecked: bash.status === 0,
  packageLockPresent: lockPresent,
  nextRequiredAction: null
}, null, 2)}\n`);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const output = [];
  for (const entry of entries) {
    if ([".git", "node_modules", ".next", "dist", ".terraform"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else output.push(path);
  }
  return output;
}
