const API_BASE = '/api';

// Public health/version check (no auth) — used to detect new deploys.
export function fetchAppVersion() {
  return fetch(`${API_BASE}/health`, { cache: 'no-store' })
    .then(r => r.json())
    .then(d => d.version)
    .catch(() => null);
}

function getToken() {
  return localStorage.getItem('stu_token');
}

export function setToken(token) {
  if (token) {
    localStorage.setItem('stu_token', token);
  } else {
    localStorage.removeItem('stu_token');
  }
}

export function getUser() {
  try {
    const raw = localStorage.getItem('stu_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem('stu_user'); // corrupt value → clear, don't crash the app
    return null;
  }
}

export function setUser(user) {
  if (user) {
    localStorage.setItem('stu_user', JSON.stringify(user));
  } else {
    localStorage.removeItem('stu_user');
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  if (res.status === 401) {
    setToken(null);
    setUser(null);
    window.location.href = '/login';
    throw new Error('Session expired');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    const e = new Error(err.error || 'Request failed');
    if (err.code) e.code = err.code; // preserve backend codes (no_key, spend_cap_exceeded, …)
    e.status = res.status;
    throw e;
  }

  return res.json();
}

export const api = {
  // Auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (name, email, password) => request('/auth/register', { method: 'POST', body: JSON.stringify({ name, email, password }) }),
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  invite: (email, name, role) => request('/auth/invite', { method: 'POST', body: JSON.stringify({ email, name, role }) }),
  team: () => request('/auth/team'),

  // Payments
  createCheckoutSession: () => request('/payments/create-checkout-session', { method: 'POST' }),
  getPaymentStatus: () => request('/payments/status'),

  // Admin
  adminDashboard: () => request('/admin/dashboard'),
  adminUsers: () => request('/admin/users'),
  adminUserDetail: (id) => request(`/admin/user/${id}`),
  adminDeleteUser: (id) => request(`/admin/user/${id}`, { method: 'DELETE' }),

  // Founders
  getFounders: (params) => request('/founders?' + new URLSearchParams(params || {})),
  getFounderStats: () => request('/founders/stats'),
  getFounder: (id) => request(`/founders/${id}`),
  createFounder: (data) => request('/founders', { method: 'POST', body: JSON.stringify(data) }),
  updateFounder: (id, data) => request(`/founders/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFounder: (id) => request(`/founders/${id}`, { method: 'DELETE' }),

  // Notes
  getNotes: (founderId) => request(`/notes/${founderId}`),
  createNote: (founderId, content) => request(`/notes/${founderId}`, { method: 'POST', body: JSON.stringify({ content }) }),
  updateNote: (noteId, content) => request(`/notes/${noteId}`, { method: 'PUT', body: JSON.stringify({ content }) }),
  deleteNote: (noteId) => request(`/notes/${noteId}`, { method: 'DELETE' }),

  // Sourcing
  getSourcingQueue: (params) => request('/sourcing/queue?' + new URLSearchParams(params || {})),
  getSourcingStarred: () => request('/sourcing/starred'),
  getSourcingStats: () => request('/sourcing/stats'),
  getSourcingRuns: () => request('/sourcing/runs'),
  approveSourced: (id) => request(`/sourcing/approve/${id}`, { method: 'POST' }),
  dismissSourced: (id) => request(`/sourcing/dismiss/${id}`, { method: 'POST' }),
  hideForeverSourced: (id) => request(`/sourcing/hide-forever/${id}`, { method: 'POST' }),
  starSourced: (id) => request(`/sourcing/star/${id}`, { method: 'POST' }),
  unstarSourced: (id) => request(`/sourcing/unstar/${id}`, { method: 'POST' }),
  triggerSourcing: () => request('/sourcing/run', { method: 'POST' }),
  getSourcingTasteProfile: () => request('/sourcing/taste-profile'),

  // Calls
  getCalls: (founderId) => request(`/calls/${founderId}`),
  logCall: (founderId, transcript) => request(`/calls/${founderId}`, { method: 'POST', body: JSON.stringify({ transcript }) }),

  // Assessments
  getAssessments: () => request('/assessments'),
  getAssessment: (id) => request(`/assessments/${id}`),
  getAssessmentInputs: (id) => request(`/assessments/${id}/inputs`),
  getAssessmentTasteDivergence: (id) => request(`/assessments/${id}/taste-divergence`),
  getAssessmentGroup: (groupId) => request(`/assessments/group/${groupId}`),
  createAssessment: (data) => request('/assessments', { method: 'POST', body: JSON.stringify(data) }),
  updateAssessment: (id, data) => request(`/assessments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAssessment: (id) => request(`/assessments/${id}`, { method: 'DELETE' }),
  cancelAssessment: (id) => request(`/assessments/${id}/cancel`, { method: 'POST' }),
  rerunAssessment: (id, data) => request(`/assessments/${id}/rerun`, { method: 'POST', body: JSON.stringify(data) }),
  getStewardOperator: (id) => request(`/assessments/${id}/steward-operator`),
  runStewardOperator: (id) => request(`/assessments/${id}/steward-operator`, { method: 'POST' }),
  pushAssessmentToNotion: (id) => request(`/assessments/${id}/push-to-notion`, { method: 'POST' }),

  // Memos
  getMemos: (founderId) => request(`/memos/${founderId}`),
  generateMemo: (founderId) => request(`/memos/${founderId}`, { method: 'POST' }),
  deleteMemo: (founderId, memoId) => request(`/memos/${founderId}/${memoId}`, { method: 'DELETE' }),

  // Files
  getFiles: (founderId) => request(`/files/${founderId}`),
  addFile: (founderId, data) => request(`/files/${founderId}`, { method: 'POST', body: JSON.stringify(data) }),
  deleteFile: (founderId, fileId) => request(`/files/${founderId}/${fileId}`, { method: 'DELETE' }),

  // Import
  uploadFile: async (file) => {
    const token = getToken();
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/import/upload`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: form,
    });
    if (res.status === 401) { setToken(null); setUser(null); window.location.href = '/login'; throw new Error('Session expired'); }
    if (!res.ok) { const err = await res.json().catch(() => ({ error: 'Upload failed' })); throw new Error(err.error || 'Upload failed'); }
    return res.json();
  },
  remapImport: (rows, mappings) => request('/import/remap', { method: 'POST', body: JSON.stringify({ rows, mappings }) }),
  confirmImport: (founders, source) => request('/import/confirm', { method: 'POST', body: JSON.stringify({ founders, source }) }),
  enrichImported: (founderIds) => request('/import/enrich', { method: 'POST', body: JSON.stringify({ founderIds }) }),
  getImportFields: () => request('/import/fields'),

  // Search
  search: (q) => request(`/search?q=${encodeURIComponent(q)}`),

  // AI
  fitScore: (founderId) => request('/ai/fit-score', { method: 'POST', body: JSON.stringify({ founderId }) }),

  // Settings
  getSettings: () => request('/settings'),
  updateSetting: (key, value) => request(`/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  testAnthropic: () => request('/settings/test-anthropic'),
  getPipelineConfig: () => request('/settings/pipeline-config'),
  getSourcingCriteria: () => request('/settings/sourcing-criteria'),
  completeOnboarding: () => request('/settings/complete-onboarding', { method: 'POST' }),

  // Home dashboard
  getHome: () => request('/home'),

  // ── Today — the surface ──
  // Pipeline — the front door. One connected read over the founders spine.
  getPipeline: (params) => request('/pipeline?' + new URLSearchParams(params || {})),
  getPipelineCompany: (id) => request(`/pipeline/${id}`),
  // The inbox — the seam between the sourcing engine and the tracker. Approving
  // promotes in one transaction and keeps the source chain intact.
  getPipelineInbox: (params) => request('/pipeline/inbox?' + new URLSearchParams(params || {})),

  // The attention engine — cross-stage integrity checks, computed from pipeline state.
  getAttention: () => request('/today/attention'),

  getToday: () => request('/today'),
  addTodayItem: (body) => request('/today/items', { method: 'POST', body: JSON.stringify(body) }),
  updateTodayItem: (id, body) => request(`/today/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTodayItem: (id) => request(`/today/items/${id}`, { method: 'DELETE' }),
  decide: (body) => request('/today/decisions', { method: 'POST', body: JSON.stringify(body) }),
  getCalibration: () => request('/today/decisions/calibration'),
  resolveDecision: (id, outcome) => request(`/today/decisions/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({ outcome }) }),
  getCommitments: (days) => request(`/today/commitments${days ? `?days=${days}` : ''}`),
  getFounderDelta: (founderId) => request(`/today/commitments/founder/${founderId}`),
  closeCommitment: (id, status) => request(`/today/commitments/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),

  // Healthcheck board
  getHealthFull: () => request('/health/full'),
  checkNotionDrift: (repair) => request('/health/drift' + (repair ? '?repair=1' : '')),

  // Newsletter / Daily Brief
  getNewsletterBrief: (days) => request('/newsletter/brief' + (days ? `?days=${days}` : '')),
  getNewsletterStatus: () => request('/newsletter/status'),
  syncNewsletter: () => request('/newsletter/sync', { method: 'POST' }),
  dismissNewsletterItem: (id) => request(`/newsletter/${id}`, { method: 'DELETE' }),
  getNewsletterSources: () => request('/newsletter/sources'),
  addNewsletterSource: (data) => request('/newsletter/sources', { method: 'POST', body: JSON.stringify(data) }),
  updateNewsletterSource: (id, data) => request(`/newsletter/sources/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNewsletterSource: (id) => request(`/newsletter/sources/${id}`, { method: 'DELETE' }),
  getBriefToday: () => request('/newsletter/today'),
  rebuildBrief: () => request('/newsletter/rebuild', { method: 'POST' }),
  seedBriefDefaults: () => request('/newsletter/seed-defaults', { method: 'POST' }),
  sendBriefNow: () => request('/newsletter/send-now', { method: 'POST' }),
  getBriefDigestPreview: () => request('/newsletter/digest-preview'),
  getBriefArchive: () => request('/newsletter/archive'),

  // Stu tool-use chat
  stuChat: async function* (messages, mode) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/stu/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(mode ? { messages, mode } : { messages })
    });

    if (res.status === 401) {
      setToken(null);
      setUser(null);
      window.location.href = '/login';
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Request failed' }));
      yield { type: 'error', error: err.error || `Server error (${res.status})` };
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch {}
        }
      }
    }
  },

  // Talent — Portfolio companies
  getTalentPortfolio: () => request('/talent/portfolio'),
  getTalentCompany: (id) => request(`/talent/portfolio/${id}`),
  createTalentCompany: (data) => request('/talent/portfolio', { method: 'POST', body: JSON.stringify(data) }),
  updateTalentCompany: (id, data) => request(`/talent/portfolio/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTalentCompany: (id) => request(`/talent/portfolio/${id}`, { method: 'DELETE' }),
  bulkDeleteTalentCompanies: (ids) => request('/talent/portfolio/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Talent — Roles
  getTalentRoles: (params) => request('/talent/roles?' + new URLSearchParams(params || {})),
  getTalentRole: (id) => request(`/talent/roles/${id}`),
  getRoleLastRun: (roleId) => request(`/talent/sourcing/last-run/${roleId}`),
  createTalentRole: (data) => request('/talent/roles', { method: 'POST', body: JSON.stringify(data) }),
  updateTalentRole: (id, data) => request(`/talent/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTalentRole: (id) => request(`/talent/roles/${id}`, { method: 'DELETE' }),
  bulkUpdateTalentRoles: (ids, patch) => request('/talent/roles/bulk/update', { method: 'POST', body: JSON.stringify({ ids, patch }) }),
  bulkDeleteTalentRoles: (ids) => request('/talent/roles/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Talent — Candidates
  getTalentCandidates: (params) => request('/talent/candidates?' + new URLSearchParams(params || {})),
  getTalentCandidate: (id) => request(`/talent/candidates/${id}`),
  getTalentCandidateStats: () => request('/talent/candidates/stats'),
  createTalentCandidate: (data) => request('/talent/candidates', { method: 'POST', body: JSON.stringify(data) }),
  updateTalentCandidate: (id, data) => request(`/talent/candidates/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTalentCandidate: (id) => request(`/talent/candidates/${id}`, { method: 'DELETE' }),
  starTalentCandidate: (id) => request(`/talent/candidates/${id}/star`, { method: 'POST' }),
  unstarTalentCandidate: (id) => request(`/talent/candidates/${id}/unstar`, { method: 'POST' }),
  dismissTalentCandidate: (id) => request(`/talent/candidates/${id}/dismiss`, { method: 'POST' }),
  shortlistTalentCandidate: (id) => request(`/talent/candidates/${id}/shortlist`, { method: 'POST' }),
  bulkUpdateTalentCandidates: (ids, patch) => request('/talent/candidates/bulk/update', { method: 'POST', body: JSON.stringify({ ids, patch }) }),
  bulkDeleteTalentCandidates: (ids) => request('/talent/candidates/bulk/delete', { method: 'POST', body: JSON.stringify({ ids }) }),

  // Talent — Matches
  getTalentMatches: (params) => request('/talent/matches?' + new URLSearchParams(params || {})),
  getTalentMatch: (id) => request(`/talent/matches/${id}`),
  getTalentMatchStats: (params) => request('/talent/matches/stats?' + new URLSearchParams(params || {})),
  updateTalentMatch: (id, data) => request(`/talent/matches/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTalentMatch: (id) => request(`/talent/matches/${id}`, { method: 'DELETE' }),
  bulkUpdateTalentMatches: (ids, patch) => request('/talent/matches/bulk/update', { method: 'POST', body: JSON.stringify({ ids, patch }) }),

  // Talent — Criteria
  getTalentCriteria: (scope = 'global') => request(`/talent/criteria?scope=${scope}`),
  updateTalentCriteria: (key, value, scope = 'global') => request(`/talent/criteria/${key}?scope=${scope}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  resetTalentCriteria: (key, scope = 'global') => request(`/talent/criteria/${key}?scope=${scope}`, { method: 'DELETE' }),

  // Talent — Sourcing
  getTalentSourcingStats: () => request('/talent/sourcing/stats'),
  getTalentSourcingRuns: () => request('/talent/sourcing/runs'),
  triggerTalentSourcing: (opts = {}) => {
    // Back-compat: old call was triggerTalentSourcing(true) for fullSweep
    const body = typeof opts === 'boolean' ? { fullSweep: opts } : opts;
    return request('/talent/sourcing/run', { method: 'POST', body: JSON.stringify(body) });
  },
  triggerTalentMatching: (params = {}) => request('/talent/sourcing/match', { method: 'POST', body: JSON.stringify(params) }),

  // Talent — Trash
  getTalentTrash: () => request('/talent/trash'),
  restoreTalentTrash: (type, ids) => request('/talent/trash/restore', { method: 'POST', body: JSON.stringify({ type, ids }) }),
  purgeTalentTrash: (type, ids) => request('/talent/trash/purge', { method: 'POST', body: JSON.stringify({ type, ids }) }),
  emptyTalentTrash: () => request('/talent/trash/empty', { method: 'POST' }),

  // MCP / API access
  getMcpInfo: () => request('/mcp/info'),
  getMcpTokens: () => request('/mcp/tokens'),
  createMcpToken: (label, scopes) => request('/mcp/tokens', { method: 'POST', body: JSON.stringify({ label, scopes }) }),
  revokeMcpToken: (id) => request(`/mcp/tokens/${id}`, { method: 'DELETE' }),

  // Active discovery + outreach
  discover: (data) => request('/discover', { method: 'POST', body: JSON.stringify(data) }),
  draftOutreach: (data) => request('/outreach/draft', { method: 'POST', body: JSON.stringify(data) }),

  // Signal monitors
  getMonitorTypes: () => request('/monitors/types'),
  getMonitors: () => request('/monitors'),
  createMonitor: (data) => request('/monitors', { method: 'POST', body: JSON.stringify(data) }),
  deleteMonitor: (id) => request(`/monitors/${id}`, { method: 'DELETE' }),
  setMonitorEnabled: (id, enabled) => request(`/monitors/${id}`, { method: 'PATCH', body: JSON.stringify({ enabled }) }),
  runMonitors: () => request('/monitors/run', { method: 'POST' }),
  getMonitorHits: (params) => request('/monitors/hits?' + new URLSearchParams(params || {})),
  dismissMonitorHit: (id) => request(`/monitors/hits/${id}/dismiss`, { method: 'POST' }),

  // Streaming chat (sidebar)
  chat: async function* (messages, context) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages, context })
    });

    if (res.status === 401) { setToken(null); setUser(null); window.location.href = '/login'; return; }
    if (!res.ok || !res.body) {
      const err = await res.json().catch(() => ({ error: 'Chat unavailable' }));
      throw new Error(err.error || 'Chat unavailable');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));
            yield data;
          } catch {}
        }
      }
    }
  }
};
