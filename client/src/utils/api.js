const API_BASE = '/api';

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
  const raw = localStorage.getItem('stu_user');
  return raw ? JSON.parse(raw) : null;
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
    throw new Error(err.error || 'Request failed');
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
  starSourced: (id) => request(`/sourcing/star/${id}`, { method: 'POST' }),
  unstarSourced: (id) => request(`/sourcing/unstar/${id}`, { method: 'POST' }),
  triggerSourcing: () => request('/sourcing/run', { method: 'POST' }),

  // Calls
  getCalls: (founderId) => request(`/calls/${founderId}`),
  logCall: (founderId, transcript) => request(`/calls/${founderId}`, { method: 'POST', body: JSON.stringify({ transcript }) }),

  // Assessments
  getAssessments: () => request('/assessments'),
  getAssessment: (id) => request(`/assessments/${id}`),
  getAssessmentInputs: (id) => request(`/assessments/${id}/inputs`),
  getAssessmentGroup: (groupId) => request(`/assessments/group/${groupId}`),
  createAssessment: (data) => request('/assessments', { method: 'POST', body: JSON.stringify(data) }),
  updateAssessment: (id, data) => request(`/assessments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAssessment: (id) => request(`/assessments/${id}`, { method: 'DELETE' }),
  cancelAssessment: (id) => request(`/assessments/${id}/cancel`, { method: 'POST' }),
  rerunAssessment: (id, data) => request(`/assessments/${id}/rerun`, { method: 'POST', body: JSON.stringify(data) }),
  getStewardOperator: (id) => request(`/assessments/${id}/steward-operator`),
  runStewardOperator: (id) => request(`/assessments/${id}/steward-operator`, { method: 'POST' }),

  // Deal Room
  getDeals: () => request('/deal-room'),
  getDeal: (id) => request(`/deal-room/${id}`),
  createDeal: (data) => request('/deal-room', { method: 'POST', body: JSON.stringify(data) }),
  updateDeal: (id, data) => request(`/deal-room/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

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
  getPipelineConfig: () => request('/settings/pipeline-config'),
  getSourcingCriteria: () => request('/settings/sourcing-criteria'),
  completeOnboarding: () => request('/settings/complete-onboarding', { method: 'POST' }),

  // Stu tool-use chat
  stuChat: async function* (messages) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/stu/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages })
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
  getTalentMatchStats: () => request('/talent/matches/stats'),
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

  // Streaming chat (sidebar)
  chat: async function* (messages, context) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages, context })
    });

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
