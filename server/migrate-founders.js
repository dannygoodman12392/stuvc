/**
 * One-time migration script to organize founders into the new pipeline structure.
 * Run with: node server/migrate-founders.js
 *
 * This script:
 * 1. Searches for each founder by name
 * 2. Creates them if they don't exist
 * 3. Sets correct pipeline_tracks, admissions_status, deal_status, status
 * 4. Avoids duplicates
 */

const db = require('./db');

// Helper: find founder by name (strict match)
function findFounder(name) {
  // Try exact match first
  let founder = db.prepare("SELECT * FROM founders WHERE is_deleted = 0 AND LOWER(TRIM(name)) = LOWER(TRIM(?))").get(name);
  if (founder) return founder;

  // Try first name + last name match (must match beginning of first name and exact last name)
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) {
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];
    // Require: starts with first name, ends with last name
    founder = db.prepare("SELECT * FROM founders WHERE is_deleted = 0 AND LOWER(name) LIKE LOWER(?) ORDER BY updated_at DESC LIMIT 1")
      .get(`${firstName}%${lastName}`);
    if (founder) return founder;
  }

  return null;
}

// Helper: create or update founder
function upsertFounder(name, data) {
  const existing = findFounder(name);

  if (existing) {
    // Update existing founder
    const sets = [];
    const vals = [];
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        sets.push(`${k} = ?`);
        vals.push(v);
      }
    }
    if (sets.length > 0) {
      sets.push('updated_at = CURRENT_TIMESTAMP');
      vals.push(existing.id);
      db.prepare(`UPDATE founders SET ${sets.join(', ')} WHERE id = ?`).run(...vals);
    }
    return { action: 'updated', id: existing.id, name: existing.name };
  } else {
    // Create new founder
    const cols = ['name'];
    const vals = [name];
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== null) {
        cols.push(k);
        vals.push(v);
      }
    }
    const placeholders = cols.map(() => '?').join(', ');
    const result = db.prepare(`INSERT INTO founders (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
    return { action: 'created', id: result.lastInsertRowid, name };
  }
}

console.log('Starting founder organization migration...\n');

let created = 0, updated = 0, errors = 0;

function organize(name, data, notes) {
  try {
    const result = upsertFounder(name, data);
    if (result.action === 'created') created++;
    else updated++;
    console.log(`  ${result.action === 'created' ? '+' : '~'} ${result.name} (ID: ${result.id}) → ${data.admissions_status || data.deal_status || data.status || 'set'}`);

    // Add note if provided
    if (notes) {
      db.prepare('INSERT INTO founder_notes (founder_id, content, created_by) VALUES (?, ?, 1)').run(result.id, notes);
    }
  } catch (err) {
    errors++;
    console.error(`  ! ERROR: ${name}: ${err.message}`);
  }
}

// ═══════════════════════════════════════════
// SOURCED (25 founders)
// ═══════════════════════════════════════════
console.log('\n--- SOURCED ---');

organize('Nikhil Srinivasan', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Meera Ramesh', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Bryce Townsend', {
  status: 'Sourced', pipeline_tracks: 'investment', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Dominic Lattanzio', {
  status: 'Sourced', pipeline_tracks: 'admissions,investment', admissions_status: 'Sourced', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Jacob Dossett', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Benjamin Miller', {
  status: 'Sourced', pipeline_tracks: 'investment', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Simrit Chhabra', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Arnav Shah', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Nabhan Ahmad', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Ari Rosenberg', {
  status: 'Sourced', pipeline_tracks: 'admissions,investment', admissions_status: 'Sourced', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Brandon Boynton', {
  status: 'Sourced', pipeline_tracks: 'investment', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Claire Wiley', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Eli Sasson', {
  status: 'Sourced', pipeline_tracks: 'admissions,investment', admissions_status: 'Sourced', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Pranav Kondapalli', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Brandon Maushund', {
  status: 'Sourced', pipeline_tracks: 'investment', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Corey Rowe', {
  status: 'Sourced', pipeline_tracks: 'investment', deal_status: 'Under Consideration',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Spencer Herrick', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Tyler Berghoff', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Luke Davia', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Cameron Schofield', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('AJ Steigman', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Tisha Ahluwalia', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Kali Koerber', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Stephen Shooner', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Adam Morris', {
  status: 'Sourced', pipeline_tracks: 'admissions', admissions_status: 'Sourced',
  location_city: 'Chicago', location_state: 'IL'
});

// ═══════════════════════════════════════════
// CURRENTLY INTERVIEWING (8 founders)
// ═══════════════════════════════════════════
console.log('\n--- CURRENTLY INTERVIEWING ---');

organize('Mason Heiser', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Complete',
  next_action: 'Schedule second call'
}, 'First call complete. Scheduling second call.');

organize('Anthony Diaz', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Complete',
}, 'First call complete.');

organize('Peter Christensen', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Scheduled',
  next_action: 'First call scheduled 3/17'
}, 'First call scheduled for March 17, 2026.');

organize('Cooper Levin', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Scheduled',
  next_action: 'First call scheduled 3/18'
}, 'First call scheduled for March 18, 2026.');

organize('Leo Chen', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Scheduled',
  next_action: 'First call scheduled 3/19'
}, 'First call scheduled for March 19, 2026.');

organize('Brandon Gell', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'First Call Scheduled',
  next_action: 'First call scheduled 3/20'
}, 'First call scheduled for March 20, 2026.');

organize('Trisha Li', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'Second Call Scheduled',
  next_action: 'Second call scheduled'
}, 'Second call scheduled.');

organize('Elorm Batchassi', {
  status: 'Interviewing', pipeline_tracks: 'admissions', admissions_status: 'Second Call Scheduled',
  next_action: 'Second call scheduled'
}, 'Second call scheduled.');

// ═══════════════════════════════════════════
// CURRENT RESIDENTS (9 founders)
// ═══════════════════════════════════════════
console.log('\n--- CURRENT RESIDENTS ---');

organize('Josh Payne', {
  status: 'Active', pipeline_tracks: 'admissions,investment', admissions_status: 'Active Resident',
  deal_status: 'Under Consideration', company: 'Beehive',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident. Also evaluating for investment.');

organize('Nick Matarese', {
  status: 'Active', pipeline_tracks: 'admissions,investment', admissions_status: 'Active Resident',
  deal_status: 'Under Consideration', company: 'Veritas',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident. Also evaluating for investment.');

organize('Arman Mohammadi', {
  status: 'Active', pipeline_tracks: 'admissions,investment', admissions_status: 'Active Resident',
  deal_status: 'Under Consideration', company: 'Komodo',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident. Also evaluating for investment.');

organize('Katie McCourt', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Active Resident',
  company: 'Pantherfly',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident.');

organize('Gian-Carlo DiGiuseppe', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Active Resident',
  company: 'Haus Labs',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident.');

organize('David Terrell', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Active Resident',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident.');

organize('Salar Faezi', {
  status: 'Active', pipeline_tracks: 'admissions,investment', admissions_status: 'Active Resident',
  deal_status: 'Under Consideration', company: 'Founderoo',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident. Also evaluating for investment.');

organize('Raunak Daga', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Active Resident',
  company: 'Banter',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident.');

organize('Omid Toufani', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Active Resident',
  company: 'Stash',
  location_city: 'Chicago', location_state: 'IL'
}, 'Current resident.');

// ═══════════════════════════════════════════
// DENSITY RESIDENTS (25 founders)
// ═══════════════════════════════════════════
console.log('\n--- DENSITY RESIDENTS ---');

organize('Grace Chen', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  company: 'Nobe', location_city: 'Chicago', location_state: 'IL'
});
organize('Colleen Deignan', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Torin Schall', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Nikita Gupta', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Daryl Thomas', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Prahlad Krishnan', {
  status: 'Inactive', pipeline_tracks: 'admissions', admissions_status: 'Alumni',
  location_city: 'Chicago', location_state: 'IL'
}, 'Moved out of Density.');
organize('Neeraja Rao', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Adam Smith', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  company: 'Deskpilot', location_city: 'Chicago', location_state: 'IL'
});
organize('Jas Minhas', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Sumit Sukhwani', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Justin Steinfeld', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Jake Huber', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Bret Bernhoft', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Tara Pham', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Nikhil Chauhan', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Shelly Yesmin', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Casey Callan', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Sajan Bhangu', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Alex Keller', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Chris Pishoy', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Paige Costello', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Damon D\'Amore', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Ian MacLeod', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Rishi Bhatnagar', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});
organize('Liel Binsky', {
  status: 'Active', pipeline_tracks: 'admissions', admissions_status: 'Density Resident',
  location_city: 'Chicago', location_state: 'IL'
});

// ═══════════════════════════════════════════
// HOLD / NURTURE (23 founders)
// ═══════════════════════════════════════════
console.log('\n--- HOLD / NURTURE ---');

organize('Dhananjay Pavgi', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
}, 'Great founder, timing didn\'t work.');

organize('Austin Smith', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
}, 'Possible resident opportunity.');

organize('Max Rodriguez', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
}, 'Possible resident opportunity.');

organize('Claire Swickard', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Will Bainton', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Jackson Peters', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Spencer DeBruin', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Sam Dolgin', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Ryan Kellet', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Nic Steele', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Alex Beal', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Nikhil Handa', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Will Fehlhaber', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Gio Vargas', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Zeeshan Ali', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Marcus Pousette', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Raheem Idowu', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Jud Brewer', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Mike Davis', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Mike Romano', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Elias Gomez', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});
organize('Nikhil Reddy', {
  status: 'Hold', pipeline_tracks: 'admissions,investment', admissions_status: 'Hold/Nurture', deal_status: 'Passed',
}, 'Passed on investment. Possible resident opportunity.');

organize('Jaylon Brinkley', {
  status: 'Hold', pipeline_tracks: 'admissions', admissions_status: 'Hold/Nurture',
});

// ═══════════════════════════════════════════
// NOT ADMITTED (20+ founders)
// ═══════════════════════════════════════════
console.log('\n--- NOT ADMITTED ---');

organize('Graham Hamilton-Bischoff', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Alexander Koo', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Mati Presto', {
  status: 'Not Admitted', pipeline_tracks: 'admissions,investment', admissions_status: 'Not Admitted', deal_status: 'Passed',
}, 'Also passed on investment.');
organize('Jacob Sternberg', {
  status: 'Not Admitted', pipeline_tracks: 'admissions,investment', admissions_status: 'Not Admitted', deal_status: 'Passed',
}, 'Also passed on investment.');
organize('Anthony Giannetti', {
  status: 'Not Admitted', pipeline_tracks: 'admissions,investment', admissions_status: 'Not Admitted', deal_status: 'Passed',
}, 'Also passed on investment.');
organize('Mark DiMichele', {
  status: 'Not Admitted', pipeline_tracks: 'admissions,investment', admissions_status: 'Not Admitted', deal_status: 'Passed',
}, 'Also passed on investment.');
organize('Nick Allen', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Max Davis', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Kevin Doyle', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Ian Paterson', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Mridul Bagrodia', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('David Korostoff', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Maaz Khan', {
  status: 'Not Admitted', pipeline_tracks: 'admissions,investment', admissions_status: 'Not Admitted', deal_status: 'Passed',
}, 'Also passed on investment.');
organize('Ethan Shay', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Tina Tsou', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Scott Barnett', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Keith Howard', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Avi Patel', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Sebi Trandafir', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});
organize('Joe Lane', {
  status: 'Not Admitted', pipeline_tracks: 'admissions', admissions_status: 'Not Admitted',
});

console.log(`\n✅ Migration complete: ${created} created, ${updated} updated, ${errors} errors`);
