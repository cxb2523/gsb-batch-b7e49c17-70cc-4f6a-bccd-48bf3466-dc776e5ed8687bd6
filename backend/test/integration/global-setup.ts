import pg from 'pg';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';

const DEFAULT_ADMIN_DB_URL = 'postgresql://postgres:postgrespassword@127.0.0.1:5432/postgres';

function stripSchemaParam(urlStr: string): string {
  const parsed = new URL(urlStr);
  parsed.searchParams.delete('schema');
  return parsed.toString();
}

function buildTestDatabaseUrl(baseUrlStr: string, dbName: string): string {
  const parsed = new URL(baseUrlStr);
  parsed.pathname = `/${dbName}`;
  return parsed.toString();
}

export async function setup(): Promise<() => Promise<void>> {
  const rawAdminUrl = process.env.TEST_DATABASE_URL || DEFAULT_ADMIN_DB_URL;
  const adminConnectionUrl = stripSchemaParam(rawAdminUrl);
  const dbName = `canvhq_test_${Date.now()}_${randomBytes(4).toString('hex')}`;

  const adminClient = new pg.Client({
    connectionString: adminConnectionUrl,
    connectionTimeoutMillis: 3000,
  });

  try {
    await adminClient.connect();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const message =
      `Integration test setup failed: cannot connect to Postgres at "${adminConnectionUrl}" (${reason}). ` +
      `Start the local Postgres container first with: docker compose up -d db`;
    process.once('exit', () => {
      console.error(`\n❌ ${message}`);
    });
    throw new Error(message, { cause: err });
  }

  try {
    await adminClient.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await adminClient.end().catch(() => {});
  }

  const testDbUrl = buildTestDatabaseUrl(rawAdminUrl, dbName);
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const backendRoot = path.resolve(currentDir, '../..');

  try {
    execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
      cwd: backendRoot,
      env: {
        ...process.env,
        DATABASE_URL: testDbUrl,
      },
      stdio: 'pipe',
    });
  } catch (err) {
    const cleanupClient = new pg.Client({
      connectionString: adminConnectionUrl,
      connectionTimeoutMillis: 3000,
    });
    await cleanupClient
      .connect()
      .then(() => cleanupClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`))
      .catch(() => {})
      .finally(() => cleanupClient.end().catch(() => {}));
    throw err;
  }

  process.env.DATABASE_URL = testDbUrl;

  return async () => {
    const teardownClient = new pg.Client({
      connectionString: adminConnectionUrl,
      connectionTimeoutMillis: 5000,
    });
    try {
      await teardownClient.connect();
      await teardownClient.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } finally {
      await teardownClient.end().catch(() => {});
    }
  };
}
