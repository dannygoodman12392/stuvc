const Database = require('better-sqlite3');
const path = require('path');

// In production, use /data volume for persistence; locally use server dir
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, 'superior-os.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Team members ──
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME
  );
`);

// ── Founders (core pipeline) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS founders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    role TEXT,
    email TEXT,
    linkedin_url TEXT,
    twitter TEXT,
    github_url TEXT,
    website_url TEXT,
    location_city TEXT,
    location_state TEXT,
    stage TEXT DEFAULT 'Pre-seed',
    domain TEXT,
    tags TEXT,
    status TEXT DEFAULT 'Identified',
    source TEXT,
    fit_score INTEGER,
    fit_score_rationale TEXT,
    ai_summary TEXT,
    chicago_connection TEXT,
    bio TEXT,
    previous_companies TEXT,
    notable_background TEXT,
    is_deleted INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Founder notes ──
db.exec(`
  CREATE TABLE IF NOT EXISTS founder_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER NOT NULL REFERENCES founders(id),
    content TEXT NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Auto-sourced founders queue ──
db.exec(`
  CREATE TABLE IF NOT EXISTS sourced_founders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT,
    role TEXT,
    linkedin_url TEXT,
    email TEXT,
    source TEXT NOT NULL,
    confidence_score INTEGER,
    confidence_rationale TEXT,
    raw_data TEXT,
    status TEXT DEFAULT 'pending',
    promoted_to_founder_id INTEGER REFERENCES founders(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Opportunity assessments ──
db.exec(`
  CREATE TABLE IF NOT EXISTS opportunity_assessments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER REFERENCES founders(id),
    inputs TEXT,
    founder_agent_output TEXT,
    market_agent_output TEXT,
    economics_agent_output TEXT,
    pattern_agent_output TEXT,
    bear_agent_output TEXT,
    synthesis_output TEXT,
    overall_signal TEXT,
    status TEXT DEFAULT 'pending',
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Deal room ──
db.exec(`
  CREATE TABLE IF NOT EXISTS deal_room (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER REFERENCES founders(id),
    assessment_id INTEGER REFERENCES opportunity_assessments(id),
    ic_memo TEXT,
    round_terms TEXT,
    returns_model TEXT,
    decision TEXT DEFAULT 'pending',
    decision_rationale TEXT,
    decision_date DATETIME,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Danny AI conversations ──
db.exec(`
  CREATE TABLE IF NOT EXISTS ai_conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    context_type TEXT,
    context_id INTEGER,
    messages TEXT,
    pinned_insights TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Sourcing run log ──
db.exec(`
  CREATE TABLE IF NOT EXISTS sourcing_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sources_hit TEXT,
    founders_found INTEGER DEFAULT 0,
    founders_added INTEGER DEFAULT 0,
    founders_deduplicated INTEGER DEFAULT 0,
    errors TEXT
  );
`);

// ── Call logs (Granola transcripts) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER REFERENCES founders(id),
    raw_transcript TEXT,
    structured_summary TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Pipeline tracks & deal fields (added for unified pipeline model) ──
function addColumn(table, col, type) {
  try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`); } catch {}
}

// Track flags
addColumn('founders', 'pipeline_tracks', "TEXT DEFAULT ''");

// Resident track
addColumn('founders', 'resident_status', 'TEXT');
addColumn('founders', 'desks_needed', 'INTEGER');
addColumn('founders', 'admitted_at', 'DATETIME');

// Investment/deal track
addColumn('founders', 'deal_status', 'TEXT');
addColumn('founders', 'deal_lead', 'TEXT');
addColumn('founders', 'valuation', 'REAL');
addColumn('founders', 'round_size', 'REAL');
addColumn('founders', 'investment_amount', 'REAL');
addColumn('founders', 'arr', 'REAL');
addColumn('founders', 'monthly_burn', 'REAL');
addColumn('founders', 'runway_months', 'INTEGER');
addColumn('founders', 'security_type', 'TEXT');
addColumn('founders', 'memo_status', 'TEXT');
addColumn('founders', 'diligence_status', 'TEXT');
addColumn('founders', 'pass_reason', 'TEXT');
addColumn('founders', 'deal_entered_at', 'DATETIME');

// Extra useful fields
addColumn('founders', 'company_one_liner', 'TEXT');
addColumn('founders', 'next_action', 'TEXT');

// ── Migrate old statuses into the new track model ──
// Active Diligence, IC Ready, Invested → set investment track + deal_status, normalize status to Met
const migrationNeeded = db.prepare("SELECT COUNT(*) as c FROM founders WHERE status IN ('Active Diligence', 'IC Ready', 'Invested') AND (deal_status IS NULL OR deal_status = '')").get();
if (migrationNeeded.c > 0) {
  db.prepare("UPDATE founders SET deal_status = 'Active Diligence', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'Active Diligence' AND (deal_status IS NULL OR deal_status = '')").run();
  db.prepare("UPDATE founders SET deal_status = 'IC Review', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'IC Ready' AND (deal_status IS NULL OR deal_status = '')").run();
  db.prepare("UPDATE founders SET deal_status = 'Committed', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'Invested' AND (deal_status IS NULL OR deal_status = '')").run();
  console.log(`[DB] Migrated ${migrationNeeded.c} founders to new track model`);
}

module.exports = db;
