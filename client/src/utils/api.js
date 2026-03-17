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
  me: () => request('/auth/me'),
  changePassword: (currentPassword, newPassword) => request('/auth/password', { method: 'PUT', body: JSON.stringify({ currentPassword, newPassword }) }),
  invite: (email, name, role) => request('/auth/invite', { method: 'POST', body: JSON.stringify({ email, name, role }) }),
  team: () => request('/auth/team'),

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
  getSourcingStats: () => request('/sourcing/stats'),
  getSourcingRuns: () => request('/sourcing/runs'),
  approveSourced: (id) => request(`/sourcing/approve/${id}`, { method: 'POST' }),
  dismissSourced: (id) => request(`/sourcing/dismiss/${id}`, { method: 'POST' }),
  triggerSourcing: () => request('/sourcing/run', { method: 'POST' }),

  // Calls
  getCalls: (founderId) => request(`/calls/${founderId}`),
  logCall: (founderId, transcript) => request(`/calls/${founderId}`, { method: 'POST', body: JSON.stringify({ transcript }) }),

  // Assessments
  getAssessments: () => request('/assessments'),
  getAssessment: (id) => request(`/assessments/${id}`),
  createAssessment: (data) => request('/assessments', { method: 'POST', body: JSON.stringify(data) }),

  // Deal Room
  getDeals: () => request('/deal-room'),
  getDeal: (id) => request(`/deal-room/${id}`),
  createDeal: (data) => request('/deal-room', { method: 'POST', body: JSON.stringify(data) }),
  updateDeal: (id, data) => request(`/deal-room/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // AI
  fitScore: (founderId) => request('/ai/fit-score', { method: 'POST', body: JSON.stringify({ founderId }) }),

  // Stu tool-use chat
  stuChat: async function* (messages) {
    const token = getToken();
    const res = await fetch(`${API_BASE}/stu/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ messages })
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
  },

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
