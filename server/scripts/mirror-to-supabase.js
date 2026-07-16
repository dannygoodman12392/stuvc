// Refreshes the Supabase "Stu Mirror" project from this machine's local Stu database,
// so tools like Permute always see current data when you ask them to reconnect/re-query.
//
// Usage:  node scripts/mirror-to-supabase.js
//
// Reads the connection string from ../../.env.supabase (gitignored, never commit it).
// Safe to re-run any time — it drops and recreates only the tables listed below.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.supabase') });

const Database = require('better-sqlite3');
const { Client } = require('pg');

const SQLITE_PATH = path.join(__dirname, '../superior-os.db');

// Explicit allowlist. Never add users, user_settings, mcp_tokens, or any other
// auth/credential table here — those must never leave this machine.
const TABLES = [
  'founders',
  'founder_notes',
  'founder_memos',
  'founder_files',
  'sourced_founders',
  'sourcing_runs',
  'opportunity_assessments',
  'assessment_inputs',
  'steward_operator_evaluations',
  'deal_room',
  'call_logs',
  'entity_filings',
  'monitors',
  'monitor_hits',
  'thesis_notes',
];

function declaredPgType(sqliteType, pk) {
  if (pk) return 'BIGINT PRIMARY KEY';
  const t = (sqliteType || '').toUpperCase();
  if (t.includes('INT')) return 'BIGINT';
  if (t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB')) return 'DOUBLE PRECISION';
  if (t.includes('DATE') || t.includes('TIME')) return 'TIMESTAMP';
  return 'TEXT';
}

function isValidForType(value, pgType) {
  if (value === null || value === undefined) return true;
  if (pgType === 'BIGINT') return Number.isInteger(value) || (typeof value === 'string' && /^-?\d+$/.test(value.trim()));
  if (pgType === 'DOUBLE PRECISION') return typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()));
  if (pgType === 'TIMESTAMP') return !isNaN(Date.parse(value));
  return true; // TEXT accepts anything
}

// Per column, find the declared type from SQLite's own type affinity, then downgrade
// to TEXT for any column where real data doesn't actually match (dirty legacy rows,
// bulk-import artifacts, etc.) rather than failing or flattening the whole table.
function resolveColumnTypes(cols, rows) {
  return cols.map(c => {
    if (c.pk === 1) return { name: c.name, pgType: 'BIGINT PRIMARY KEY' };
    const candidate = declaredPgType(c.type, false);
    if (candidate === 'TEXT') return { name: c.name, pgType: 'TEXT' };
    const allValid = rows.every(r => isValidForType(r[c.name], candidate));
    return { name: c.name, pgType: allValid ? candidate : 'TEXT' };
  });
}

function coerceValue(value, pgType) {
  if (value === null || value === undefined) return null;
  if (pgType === 'TEXT') return String(value);
  return value; // already numeric/date-parseable, pg driver handles it
}

function buildInsert(table, colNames, batch) {
  const values = [];
  const placeholders = batch.map((row, rIdx) => {
    const rowPlaceholders = colNames.map((_, cIdx) => `$${rIdx * colNames.length + cIdx + 1}`);
    colNames.forEach(name => values.push(row[name]));
    return `(${rowPlaceholders.join(',')})`;
  });
  const sql = `INSERT INTO "${table}" (${colNames.map(n => `"${n}"`).join(',')}) VALUES ${placeholders.join(',')}`;
  return { sql, values };
}

async function loadRows(pg, table, colNames, rows, batchSize = 500) {
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    if (batch.length === 0) continue;
    const { sql, values } = buildInsert(table, colNames, batch);
    await pg.query(sql, values);
  }
}

async function migrateTable(pg, sqlite, table) {
  const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  if (cols.length === 0) {
    console.warn(`Skipping ${table}: not found in SQLite (schema drift since this script was written).`);
    return null;
  }

  const rawRows = sqlite.prepare(`SELECT * FROM "${table}"`).all();
  const resolved = resolveColumnTypes(cols, rawRows);
  const downgraded = resolved.filter((r, i) => r.pgType === 'TEXT' && declaredPgType(cols[i].type, cols[i].pk === 1) !== 'TEXT');

  const colDefs = resolved.map(r => `"${r.name}" ${r.pgType}`).join(',\n  ');
  const colNames = resolved.map(r => r.name);
  const rows = rawRows.map(row => {
    const copy = {};
    resolved.forEach(r => { copy[r.name] = coerceValue(row[r.name], r.pgType); });
    return copy;
  });

  await pg.query(`DROP TABLE IF EXISTS "${table}";`);
  await pg.query(`CREATE TABLE "${table}" (\n  ${colDefs}\n);`);
  await loadRows(pg, table, colNames, rows);

  if (downgraded.length > 0) {
    console.log(`  ${table}: downgraded ${downgraded.map(d => d.name).join(', ')} to TEXT (dirty data didn't match declared type)`);
  }
  return { table, rows: rows.length, downgradedCols: downgraded.length };
}

async function main() {
  const dbUrl = process.env.SUPABASE_DB_URL;
  if (!dbUrl) {
    console.error('SUPABASE_DB_URL not found. Check that .env.supabase exists at the repo root.');
    process.exit(1);
  }

  const sqlite = new Database(SQLITE_PATH, { readonly: true });
  const pg = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await pg.connect();

  const summary = [];
  for (const table of TABLES) {
    const result = await migrateTable(pg, sqlite, table);
    if (result) {
      summary.push(result);
      console.log(`Mirrored ${table}: ${result.rows} rows`);
    }
  }

  await pg.end();
  sqlite.close();

  console.log('\nDone — Permute will see this data next time you query or refresh its connector.');
  console.table(summary);
}

main().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
