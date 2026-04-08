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

// Resident track (legacy)
addColumn('founders', 'resident_status', 'TEXT');
addColumn('founders', 'desks_needed', 'INTEGER');
addColumn('founders', 'admitted_at', 'DATETIME');

// Admissions pipeline (new unified track)
addColumn('founders', 'admissions_status', 'TEXT');

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

// Sourced founders enhancements
addColumn('sourced_founders', 'headline', 'TEXT');
addColumn('sourced_founders', 'location_city', 'TEXT');
addColumn('sourced_founders', 'location_type', 'TEXT');
addColumn('sourced_founders', 'chicago_connection', 'TEXT');
addColumn('sourced_founders', 'tags', 'TEXT');
addColumn('sourced_founders', 'enriched_data', 'TEXT');
addColumn('sourced_founders', 'search_query', 'TEXT');
addColumn('sourced_founders', 'company_one_liner', 'TEXT');
addColumn('sourced_founders', 'pedigree_signals', 'TEXT');
addColumn('sourced_founders', 'builder_signals', 'TEXT');
addColumn('sourced_founders', 'github_url', 'TEXT');
addColumn('sourced_founders', 'website_url', 'TEXT');

// Airtable record IDs (for one-way Stu → Airtable sync)
addColumn('founders', 'airtable_founder_record_id', 'TEXT');
addColumn('founders', 'airtable_deal_record_id', 'TEXT');

// Airtable sync audit log
db.exec(`
  CREATE TABLE IF NOT EXISTS airtable_sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER,
    table_name TEXT,
    field_name TEXT,
    old_value TEXT,
    new_value TEXT,
    airtable_record_id TEXT,
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Assessment inputs (multi-file, multi-link, multi-transcript) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS assessment_inputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assessment_id INTEGER NOT NULL REFERENCES opportunity_assessments(id),
    input_type TEXT NOT NULL,
    label TEXT,
    content TEXT,
    source_url TEXT,
    file_name TEXT,
    mime_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Assessment version tracking ──
db.exec(`
  CREATE TABLE IF NOT EXISTS assessment_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    assessment_id INTEGER NOT NULL REFERENCES opportunity_assessments(id),
    version_number INTEGER NOT NULL,
    change_summary TEXT,
    previous_assessment_id INTEGER REFERENCES opportunity_assessments(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── IC Memos ──
db.exec(`
  CREATE TABLE IF NOT EXISTS founder_memos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER NOT NULL REFERENCES founders(id),
    memo_type TEXT DEFAULT 'ic_memo',
    content TEXT NOT NULL DEFAULT '',
    version INTEGER DEFAULT 1,
    data_snapshot TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── Founder files/documents ──
db.exec(`
  CREATE TABLE IF NOT EXISTS founder_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    founder_id INTEGER NOT NULL REFERENCES founders(id),
    file_name TEXT NOT NULL,
    file_type TEXT,
    content_text TEXT,
    url TEXT,
    created_by INTEGER REFERENCES users(id),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Assessment columns for versioning, cancellation, soft delete
addColumn('opportunity_assessments', 'group_id', 'TEXT');
addColumn('opportunity_assessments', 'version_number', 'INTEGER DEFAULT 1');
addColumn('opportunity_assessments', 'cancelled_at', 'DATETIME');
addColumn('opportunity_assessments', 'is_deleted', 'INTEGER DEFAULT 0');

// ── Migrate old "resident" track → "admissions" track ──
// Move resident_status → admissions_status where not already set
const residentMigration = db.prepare("SELECT COUNT(*) as c FROM founders WHERE pipeline_tracks LIKE '%resident%' AND (admissions_status IS NULL OR admissions_status = '')").get();
if (residentMigration.c > 0) {
  // Map resident_status values to admissions_status
  db.prepare("UPDATE founders SET admissions_status = 'Active Resident' WHERE pipeline_tracks LIKE '%resident%' AND resident_status = 'Active' AND (admissions_status IS NULL OR admissions_status = '')").run();
  db.prepare("UPDATE founders SET admissions_status = 'Admitted' WHERE pipeline_tracks LIKE '%resident%' AND resident_status = 'Admitted' AND (admissions_status IS NULL OR admissions_status = '')").run();
  db.prepare("UPDATE founders SET admissions_status = 'Alumni' WHERE pipeline_tracks LIKE '%resident%' AND resident_status = 'Alumni' AND (admissions_status IS NULL OR admissions_status = '')").run();
  db.prepare("UPDATE founders SET admissions_status = 'Sourced' WHERE pipeline_tracks LIKE '%resident%' AND resident_status = 'Prospect' AND (admissions_status IS NULL OR admissions_status = '')").run();
  db.prepare("UPDATE founders SET admissions_status = 'First Call Scheduled' WHERE pipeline_tracks LIKE '%resident%' AND resident_status = 'Tour Scheduled' AND (admissions_status IS NULL OR admissions_status = '')").run();
  // Update pipeline_tracks: resident → admissions
  db.prepare("UPDATE founders SET pipeline_tracks = REPLACE(pipeline_tracks, 'resident', 'admissions') WHERE pipeline_tracks LIKE '%resident%'").run();
  console.log(`[DB] Migrated ${residentMigration.c} founders from resident → admissions track`);
}

// ── Migrate old statuses into the new track model ──
const migrationNeeded = db.prepare("SELECT COUNT(*) as c FROM founders WHERE status IN ('Active Diligence', 'IC Ready', 'Invested') AND (deal_status IS NULL OR deal_status = '')").get();
if (migrationNeeded.c > 0) {
  db.prepare("UPDATE founders SET deal_status = 'Active Diligence', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'Active Diligence' AND (deal_status IS NULL OR deal_status = '')").run();
  db.prepare("UPDATE founders SET deal_status = 'IC Review', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'IC Ready' AND (deal_status IS NULL OR deal_status = '')").run();
  db.prepare("UPDATE founders SET deal_status = 'Committed', pipeline_tracks = 'investment', status = 'Met' WHERE status = 'Invested' AND (deal_status IS NULL OR deal_status = '')").run();
  console.log(`[DB] Migrated ${migrationNeeded.c} founders to new track model`);
}

// ── User settings (key-value per user) ──
db.exec(`
  CREATE TABLE IF NOT EXISTS user_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, setting_key)
  );
`);

// ── Multi-tenancy: add user_id columns and backfill ──
addColumn('sourced_founders', 'user_id', 'INTEGER REFERENCES users(id)');
addColumn('sourcing_runs', 'user_id', 'INTEGER REFERENCES users(id)');
addColumn('users', 'onboarding_complete', 'INTEGER DEFAULT 0');
addColumn('users', 'has_paid', 'INTEGER DEFAULT 0');
addColumn('users', 'stripe_customer_id', 'TEXT');
addColumn('users', 'payment_date', 'DATETIME');

// One-time migration: assign all existing data to user_id=1 (Danny)
const mtFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'multi_tenant_v1'").get();
if (!mtFlag) {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS migration_flags (key TEXT PRIMARY KEY, ran_at DATETIME DEFAULT CURRENT_TIMESTAMP)");
  } catch {}

  db.prepare("UPDATE founders SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE sourced_founders SET user_id = 1 WHERE user_id IS NULL").run();
  db.prepare("UPDATE sourcing_runs SET user_id = 1 WHERE user_id IS NULL").run();
  db.prepare("UPDATE founder_notes SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE call_logs SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE opportunity_assessments SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE deal_room SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE founder_memos SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE founder_files SET created_by = 1 WHERE created_by IS NULL").run();
  db.prepare("UPDATE users SET onboarding_complete = 1, has_paid = 1 WHERE id = 1").run();

  db.prepare("INSERT INTO migration_flags (key) VALUES ('multi_tenant_v1')").run();
  console.log('[DB] Multi-tenant migration complete — all existing data assigned to user_id=1');
}

// ── Payment columns + admin bypass ──
const payFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'payment_v1'").get();
if (!payFlag) {
  // Ensure Danny (user_id=1) bypasses payment gate
  db.prepare("UPDATE users SET has_paid = 1 WHERE id = 1").run();
  // Grant all existing users free access (pre-payment era)
  db.prepare("UPDATE users SET has_paid = 1 WHERE has_paid = 0 OR has_paid IS NULL").run();
  db.prepare("INSERT INTO migration_flags (key) VALUES ('payment_v1')").run();
  console.log('[DB] Payment migration complete — existing users granted free access');
}

// ── One-time: restore Danny's sourcing criteria (user_id=1 only) ──
const criteriaFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'danny_criteria_v1'").get();
if (!criteriaFlag) {
  const upsert = db.prepare(`
    INSERT INTO user_settings (user_id, setting_key, setting_value, updated_at)
    VALUES (1, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, setting_key)
    DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `);

  const criteria = {
    sourcing_locations: JSON.stringify([
      'chicago','evanston','naperville','oak park','skokie','schaumburg',
      'urbana','champaign','bloomington','rockford','aurora','joliet',
      'palatine','deerfield','highland park','lake forest','winnetka',
      'wilmette','hinsdale','river north','wicker park','lincoln park',
      'west loop','loop','hyde park','pilsen'
    ]),
    sourcing_schools: JSON.stringify([
      'northwestern university','university of chicago','university of illinois',
      'illinois institute of technology','loyola university chicago','depaul university',
      'university of illinois chicago','northwestern kellogg','booth school of business',
      'illinois urbana-champaign','uiuc','northwestern mccormick'
    ]),
    sourcing_companies: JSON.stringify([
      'google','meta','apple','amazon','microsoft','stripe','openai','anthropic',
      'palantir','spacex','coinbase','datadog','snowflake','databricks','figma',
      'notion','linear','vercel','scale ai','anduril','shield ai',
      'brex','ramp','plaid','robinhood','square','block',
      'tesla','nvidia','uber','lyft','airbnb','doordash','instacart',
      'grubhub','groupon','avant','sprout social','tempus','relativity',
      'enova','reverb','braintree','uptake','sertifi',
      'mckinsey','bain','bcg','a16z','sequoia','benchmark'
    ]),
    sourcing_builder_signals: JSON.stringify([
      'YC Alum','Y Combinator','South Park Commons','SPC','Founders Inc',
      'Z Fellows','Thiel Fellow','On Deck','Entrepreneur First','TechStars',
      'Previous Exit','Serial Founder','Second-time Founder','Exited Founder',
      'PhD','Stanford PhD','MIT PhD',
      'Former CTO','Former VP Engineering','Former VP Product',
      'Staff Engineer','Principal Engineer','Founding Engineer',
      'Head of Product','Head of Growth','Head of Engineering',
      'Stealth Mode','Building something new','Just left',
      'Open Source','Patent Holder','Forbes 30 Under 30'
    ]),
    sourcing_domains: JSON.stringify([
      'AI/ML','Vertical AI','AI Infrastructure','Applied AI',
      'Fintech','Defense Tech','Climate Tech','Health Tech',
      'Developer Tools','DevOps','Cybersecurity',
      'Vertical SaaS','Enterprise SaaS','B2B SaaS',
      'Biotech','Proptech','Edtech','Legaltech',
      'Robotics','Hardware','Deep Tech'
    ]),
    sourcing_stage_filter: 'Pre-seed',
    sourcing_custom_queries: JSON.stringify([]),
  };

  db.transaction(() => {
    for (const [key, value] of Object.entries(criteria)) {
      upsert.run(key, value);
    }
  })();

  db.prepare("INSERT INTO migration_flags (key) VALUES ('danny_criteria_v1')").run();
  console.log('[DB] Danny sourcing criteria restored (user_id=1 only)');
}

// ── Update Danny's schools to include elite builder institutions ──
const schoolsFlag = db.prepare("SELECT * FROM migration_flags WHERE key = 'danny_schools_v2'").get();
if (!schoolsFlag) {
  const schools = JSON.stringify([
    'northwestern university','university of chicago','university of illinois',
    'illinois institute of technology','loyola university chicago','depaul university',
    'university of illinois chicago','northwestern kellogg','booth school of business',
    'illinois urbana-champaign','uiuc','northwestern mccormick',
    'stanford university','stanford','mit','massachusetts institute of technology',
    'harvard university','harvard','harvard business school',
    'uc berkeley','berkeley','carnegie mellon','cmu',
    'caltech','georgia tech','princeton university','princeton',
    'yale university','yale','columbia university','columbia',
    'cornell university','cornell','upenn','wharton',
    'duke university','duke','brown university',
    'university of michigan','umich','university of texas','ut austin',
    'university of waterloo','waterloo',
    'nyu','new york university','usc','ucla'
  ]);
  db.prepare(`
    INSERT INTO user_settings (user_id, setting_key, setting_value, updated_at)
    VALUES (1, 'sourcing_schools', ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, setting_key)
    DO UPDATE SET setting_value = excluded.setting_value, updated_at = CURRENT_TIMESTAMP
  `).run(schools);
  db.prepare("INSERT INTO migration_flags (key) VALUES ('danny_schools_v2')").run();
  console.log('[DB] Danny schools updated with elite institutions (user_id=1 only)');
}

module.exports = db;
