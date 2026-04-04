import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

export default function SearchPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const debounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setResults(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setResults(null);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await api.search(query);
        setResults(data);
      } catch (err) {
        console.error('Search error:', err);
      }
      setLoading(false);
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  function go(path) {
    navigate(path);
    onClose();
  }

  if (!open) return null;

  const hasResults = results && (results.founders?.length || results.notes?.length || results.calls?.length || results.assessments?.length || results.memos?.length);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]" onClick={onClose}>
      <div className="fixed inset-0 bg-black/40" />
      <div className="relative w-full max-w-lg bg-white rounded-xl shadow-2xl border border-gray-200 overflow-hidden" onClick={e => e.stopPropagation()}>
        {/* Search input */}
        <div className="flex items-center px-4 py-3 border-b border-gray-100">
          <svg className="w-4 h-4 text-gray-400 mr-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search founders, notes, calls, memos..."
            className="flex-1 text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none"
          />
          <kbd className="hidden sm:inline-block text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded font-mono">ESC</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">Searching...</div>
          )}

          {!loading && query.length >= 2 && !hasResults && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">No results for "{query}"</div>
          )}

          {!loading && hasResults && (
            <div className="py-2">
              {/* Founders */}
              {results.founders?.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Founders</div>
                  {results.founders.map(f => (
                    <button key={`f-${f.id}`} onClick={() => go(`/founders/${f.id}`)} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center gap-3 transition-colors">
                      <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
                        {f.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">{f.name}</div>
                        <div className="text-xs text-gray-500 truncate">{f.company_one_liner || f.company || f.domain || ''}</div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {f.deal_status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">{f.deal_status}</span>}
                        {f.status && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">{f.status}</span>}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Notes */}
              {results.notes?.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Notes</div>
                  {results.notes.map(n => (
                    <button key={`n-${n.id}`} onClick={() => go(`/founders/${n.founder_id}`)} className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors">
                      <div className="text-xs text-gray-500 mb-0.5">{n.founder_name} {n.founder_company ? `(${n.founder_company})` : ''}</div>
                      <div className="text-sm text-gray-700 truncate">{n.content}</div>
                    </button>
                  ))}
                </div>
              )}

              {/* Calls */}
              {results.calls?.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Calls</div>
                  {results.calls.map(c => {
                    let summary = '';
                    try {
                      const parsed = JSON.parse(c.structured_summary);
                      summary = parsed.one_liner || '';
                    } catch { summary = 'Call transcript'; }
                    return (
                      <button key={`c-${c.id}`} onClick={() => go(`/founders/${c.founder_id}`)} className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors">
                        <div className="text-xs text-gray-500 mb-0.5">{c.founder_name} {c.founder_company ? `(${c.founder_company})` : ''} · {new Date(c.created_at).toLocaleDateString()}</div>
                        <div className="text-sm text-gray-700 truncate">{summary}</div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Assessments */}
              {results.assessments?.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">Assessments</div>
                  {results.assessments.map(a => (
                    <button key={`a-${a.id}`} onClick={() => go(`/assess/${a.id}`)} className="w-full text-left px-4 py-2 hover:bg-gray-50 flex items-center justify-between transition-colors">
                      <div>
                        <div className="text-sm text-gray-700">{a.founder_name || 'Assessment'} {a.founder_company ? `(${a.founder_company})` : ''}</div>
                        <div className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString()}</div>
                      </div>
                      {a.overall_signal && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                          a.overall_signal === 'Invest' ? 'bg-emerald-50 text-emerald-600' :
                          a.overall_signal === 'Monitor' ? 'bg-amber-50 text-amber-600' :
                          'bg-red-50 text-red-600'
                        }`}>{a.overall_signal}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Memos */}
              {results.memos?.length > 0 && (
                <div>
                  <div className="px-4 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider mt-1">IC Memos</div>
                  {results.memos.map(m => (
                    <button key={`m-${m.id}`} onClick={() => go(`/founders/${m.founder_id}`)} className="w-full text-left px-4 py-2 hover:bg-gray-50 transition-colors">
                      <div className="text-sm text-gray-700">{m.founder_name} {m.founder_company ? `(${m.founder_company})` : ''} — v{m.version}</div>
                      <div className="text-xs text-gray-400">{new Date(m.created_at).toLocaleDateString()}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!loading && !query && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-gray-500">Search across your entire pipeline</p>
              <p className="text-xs text-gray-400 mt-1">Founders, notes, calls, assessments, memos</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-gray-100 flex items-center gap-3 text-[10px] text-gray-400">
          <span><kbd className="bg-gray-100 px-1 py-0.5 rounded font-mono">Enter</kbd> to select</span>
          <span><kbd className="bg-gray-100 px-1 py-0.5 rounded font-mono">Esc</kbd> to close</span>
        </div>
      </div>
    </div>
  );
}
