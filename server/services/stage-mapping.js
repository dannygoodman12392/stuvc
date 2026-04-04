/**
 * Reverse stage mapping: Stu pipeline stages → Airtable field values
 *
 * Airtable Admission Status options:
 *   Stage 0: Legacy (Density)
 *   Stage 1: Identified
 *   Stage 2: Interviewed
 *   Stage 3: Evaluating (Resident-Only)
 *   Stage 3: Evaluating (Investment-Only)
 *   Stage 4: Admitted (Resident)
 *   Stage 4: Admitted (Resident + Investment)
 *   Stage 5: Hold / Nurture
 *   Stage 5: Not Admitted
 *   Stage 5: Legacy Density Not Admitted SSFI
 *
 * Airtable Investment Pipeline Status options:
 *   Active, Not Started, Passed, Under Consideration
 */

// Stu admissions_status → Airtable "Admission Status" field value
function stuAdmissionsToAirtable(stuStatus, hasInvestmentTrack) {
  const map = {
    'Sourced':               'Stage 1: Identified',
    'Outreach':              'Stage 1: Identified',
    'First Call Scheduled':  'Stage 1: Identified',
    'First Call Complete':   'Stage 2: Interviewed',
    'Second Call Scheduled': hasInvestmentTrack
      ? 'Stage 3: Evaluating (Investment-Only)'
      : 'Stage 3: Evaluating (Resident-Only)',
    'Second Call Complete':  hasInvestmentTrack
      ? 'Stage 3: Evaluating (Investment-Only)'
      : 'Stage 3: Evaluating (Resident-Only)',
    'Admitted':              hasInvestmentTrack
      ? 'Stage 4: Admitted (Resident + Investment)'
      : 'Stage 4: Admitted (Resident)',
    'Active Resident':       hasInvestmentTrack
      ? 'Stage 4: Admitted (Resident + Investment)'
      : 'Stage 4: Admitted (Resident)',
    'Density Resident':      'Stage 0: Legacy (Density)',
    'Alumni':                hasInvestmentTrack
      ? 'Stage 4: Admitted (Resident + Investment)'
      : 'Stage 4: Admitted (Resident)',
    'Hold/Nurture':          'Stage 5: Hold / Nurture',
    'Not Admitted':          'Stage 5: Not Admitted',
  };
  return map[stuStatus] || null;
}

// Stu deal_status → Airtable Investment Pipeline "Status" field value
function stuDealToAirtable(stuDealStatus) {
  const map = {
    'Under Consideration': 'Under Consideration',
    'First Meeting':       'Active',
    'Partner Call':        'Active',
    'Memo Draft':          'Active',
    'IC Review':           'Active',
    'Committed':           'Active', // No "Committed" option in Airtable
    'Passed':              'Passed',
  };
  return map[stuDealStatus] || null;
}

module.exports = { stuAdmissionsToAirtable, stuDealToAirtable };
