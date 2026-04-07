const Papa = require('papaparse');

// Synonym dictionary — maps common CSV header names to founder table columns
const COLUMN_SYNONYMS = {
  name:             ['name', 'full name', 'founder', 'founder name', 'contact', 'contact name', 'person'],
  company:          ['company', 'company name', 'startup', 'organization', 'org', 'venture', 'business'],
  role:             ['role', 'title', 'position', 'job title', 'current role'],
  email:            ['email', 'email address', 'e-mail', 'contact email', 'mail'],
  linkedin_url:     ['linkedin', 'linkedin url', 'linkedin profile', 'li url', 'li profile', 'linkedin link'],
  twitter:          ['twitter', 'x', 'twitter handle', 'x handle', 'twitter url'],
  github_url:       ['github', 'github url', 'github profile', 'gh'],
  website_url:      ['website', 'url', 'site', 'web', 'website url', 'homepage'],
  location_city:    ['city', 'location', 'location city', 'metro', 'hq', 'based in', 'headquarters'],
  location_state:   ['state', 'location state', 'region', 'province'],
  domain:           ['domain', 'sector', 'industry', 'vertical', 'space', 'category', 'focus'],
  stage:            ['stage', 'funding stage', 'round', 'funding round', 'investment stage'],
  tags:             ['tags', 'categories', 'labels', 'keywords'],
  company_one_liner:['one liner', 'description', 'one-liner', 'tagline', 'summary', 'about', 'what they do', 'company description'],
  bio:              ['bio', 'biography', 'background', 'about founder', 'notes', 'note'],
  source:           ['source', 'referral', 'how found', 'lead source', 'referred by', 'intro source'],
  fit_score:        ['score', 'fit score', 'fit', 'rating', 'priority'],
  previous_companies: ['previous companies', 'past companies', 'experience', 'work history', 'prior'],
  notable_background: ['notable background', 'highlights', 'achievements', 'notable', 'credentials'],
};

// Normalize a string for matching
function normalize(str) {
  return (str || '').toLowerCase().trim().replace(/[_\-\.]/g, ' ').replace(/\s+/g, ' ');
}

// Auto-map CSV headers to founder fields
function autoMapColumns(headers) {
  const mappings = {};

  for (const header of headers) {
    const norm = normalize(header);
    let bestMatch = null;
    let bestScore = 0;

    for (const [field, synonyms] of Object.entries(COLUMN_SYNONYMS)) {
      for (const syn of synonyms) {
        // Exact match
        if (norm === syn) {
          bestMatch = field;
          bestScore = 100;
          break;
        }
        // Contains match
        if (norm.includes(syn) || syn.includes(norm)) {
          const score = 50 + (syn.length / norm.length) * 30;
          if (score > bestScore) {
            bestMatch = field;
            bestScore = score;
          }
        }
      }
      if (bestScore === 100) break;
    }

    // Handle first name / last name special case
    if (!bestMatch && (norm === 'first name' || norm === 'firstname')) {
      bestMatch = '__first_name';
      bestScore = 100;
    }
    if (!bestMatch && (norm === 'last name' || norm === 'lastname' || norm === 'surname')) {
      bestMatch = '__last_name';
      bestScore = 100;
    }

    mappings[header] = bestScore >= 40 ? bestMatch : null;
  }

  return mappings;
}

// Parse CSV buffer/string and return { headers, mappings, rows, rowCount }
function parseCSV(content) {
  const text = typeof content === 'string' ? content : content.toString('utf-8');
  // Strip BOM if present
  const clean = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  const result = Papa.parse(clean, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0 && result.data.length === 0) {
    throw new Error(`CSV parsing failed: ${result.errors[0].message}`);
  }

  const headers = result.meta.fields || [];
  const mappings = autoMapColumns(headers);

  // Apply mappings to transform rows into founder objects
  const rows = result.data.slice(0, 500).map((row, idx) => {
    const founder = { _row: idx + 1 };
    let firstName = '';
    let lastName = '';

    for (const [header, field] of Object.entries(mappings)) {
      if (!field || !row[header]) continue;
      const val = (row[header] || '').trim();
      if (!val) continue;

      if (field === '__first_name') {
        firstName = val;
      } else if (field === '__last_name') {
        lastName = val;
      } else {
        founder[field] = val;
      }
    }

    // Combine first + last name
    if (firstName || lastName) {
      founder.name = [firstName, lastName].filter(Boolean).join(' ');
    }

    // Include unmapped raw values for reference
    founder._raw = row;

    return founder;
  });

  // Filter out completely empty rows
  const validRows = rows.filter(r => {
    const keys = Object.keys(r).filter(k => !k.startsWith('_'));
    return keys.length > 0;
  });

  return {
    headers,
    mappings,
    rows: validRows,
    rowCount: validRows.length,
    totalParsed: result.data.length,
  };
}

// Available founder fields for the mapping dropdown
const MAPPABLE_FIELDS = [
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'role', label: 'Role / Title' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'github_url', label: 'GitHub URL' },
  { value: 'website_url', label: 'Website' },
  { value: 'location_city', label: 'City / Location' },
  { value: 'location_state', label: 'State / Region' },
  { value: 'domain', label: 'Domain / Sector' },
  { value: 'stage', label: 'Funding Stage' },
  { value: 'tags', label: 'Tags' },
  { value: 'company_one_liner', label: 'Company Description' },
  { value: 'bio', label: 'Bio / Notes' },
  { value: 'source', label: 'Source / Referral' },
  { value: 'fit_score', label: 'Fit Score' },
  { value: 'previous_companies', label: 'Previous Companies' },
  { value: 'notable_background', label: 'Notable Background' },
];

module.exports = { parseCSV, autoMapColumns, MAPPABLE_FIELDS };
