import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

const SUGGESTIONS = [
  'Show me everyone in Active Diligence',
  'Add a founder: Sarah Chen, CEO of Lattice AI, B2B SaaS, Chicago',
  "What's our pipeline look like right now?",
  'Move Gil Test to Contacted',
  'Who has the highest fit score?',
  'How many founders are in each stage?',
];

export default function AskStu() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEnd = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  async function handleSend(text) {
    const msg = text || input.trim();
    if (!msg || streaming) return;

    const userMsg = { role: 'user', content: msg };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    const assistantMsg = { role: 'assistant', content: '', toolCalls: [], toolResults: [] };
    setMessages([...newMessages, assistantMsg]);

    try {
      // Send only user/assistant text messages to the API
      const apiMessages = newMessages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }));

      for await (const chunk of api.stuChat(apiMessages)) {
        if (chunk.type === 'text') {
          assistantMsg.content += chunk.text;
          setMessages([...newMessages, { ...assistantMsg }]);
        } else if (chunk.type === 'tool_call') {
          assistantMsg.toolCalls = [...(assistantMsg.toolCalls || []), { tool: chunk.tool, input: chunk.input }];
          setMessages([...newMessages, { ...assistantMsg }]);
        } else if (chunk.type === 'tool_result') {
          assistantMsg.toolResults = [...(assistantMsg.toolResults || []), { tool: chunk.tool, result: chunk.result }];
          setMessages([...newMessages, { ...assistantMsg }]);
        } else if (chunk.type === 'error') {
          assistantMsg.content += `\n\n[Error: ${chunk.error}]`;
          setMessages([...newMessages, { ...assistantMsg }]);
        }
      }
    } catch (err) {
      assistantMsg.content = `Error: ${err.message}`;
      setMessages([...newMessages, { ...assistantMsg }]);
    }

    setStreaming(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-2rem)] -my-4">
      {/* Header */}
      <div className="flex-shrink-0 pb-4">
        <h1 className="text-xl font-bold text-gray-900">Ask Stu</h1>
        <p className="text-sm text-gray-500 mt-0.5">Manage your pipeline, extract insights, and update records — all through conversation.</p>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <div className="w-14 h-14 rounded-2xl bg-gray-900 flex items-center justify-center mb-4">
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <p className="text-lg font-semibold text-gray-900 mb-1">What can I help with?</p>
            <p className="text-sm text-gray-500 mb-6 text-center max-w-md">
              I can search founders, add people to the pipeline, update statuses, pull insights, and more. Just tell me what you need.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-lg w-full">
              {SUGGESTIONS.map((s, i) => (
                <button
                  key={i}
                  onClick={() => handleSend(s)}
                  className="text-left px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6 pb-4">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} streaming={streaming && i === messages.length - 1} />
            ))}
            <div ref={messagesEnd} />
          </div>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 pt-4 border-t border-gray-100">
        <div className="flex gap-3">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Tell Stu what you need..."
            className="flex-1 bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10 resize-none"
            rows={1}
            disabled={streaming}
            style={{ minHeight: '48px', maxHeight: '120px' }}
            onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'; }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || streaming}
            className="px-4 py-3 bg-gray-900 text-white rounded-xl text-sm font-medium disabled:opacity-30 hover:bg-gray-800 transition-colors self-end"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ msg, streaming }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] bg-gray-900 text-white rounded-2xl rounded-br-md px-4 py-3 text-sm">
          <p className="whitespace-pre-wrap">{msg.content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] space-y-3">
        {/* Tool activity indicators */}
        {msg.toolCalls?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {msg.toolCalls.map((tc, i) => (
              <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-md text-xs font-medium">
                <ToolIcon tool={tc.tool} />
                {toolLabel(tc.tool)}
              </span>
            ))}
          </div>
        )}

        {/* Tool results — rendered as rich cards */}
        {msg.toolResults?.map((tr, i) => (
          <ToolResultCard key={i} tool={tr.tool} result={tr.result} />
        ))}

        {/* Text response */}
        {(msg.content || streaming) && (
          <div className="bg-gray-50 rounded-2xl rounded-bl-md px-4 py-3 text-sm text-gray-700">
            <p className="whitespace-pre-wrap">{msg.content || '...'}</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ToolIcon({ tool }) {
  const icons = {
    search_founders: 'M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z',
    get_founder_detail: 'M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0',
    create_founder: 'M19 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0z',
    update_founder: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z',
    delete_founder: 'M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79',
    add_note: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z',
    get_pipeline_stats: 'M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z',
    get_assessments: 'M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15',
    query_insights: 'M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5',
  };
  const d = icons[tool] || icons.search_founders;
  return <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d={d} /></svg>;
}

function toolLabel(tool) {
  const labels = {
    search_founders: 'Searching pipeline',
    get_founder_detail: 'Looking up founder',
    create_founder: 'Adding founder',
    update_founder: 'Updating record',
    delete_founder: 'Removing founder',
    add_note: 'Adding note',
    get_pipeline_stats: 'Pulling stats',
    get_assessments: 'Checking assessments',
    get_deals: 'Loading deals',
    run_fit_score: 'Scoring fit',
    log_call: 'Logging call',
    query_insights: 'Analyzing data',
  };
  return labels[tool] || tool;
}

function ToolResultCard({ tool, result }) {
  if (!result?.success) return null;

  // Founder search results
  if (tool === 'search_founders' && result.founders?.length > 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
          {result.count} founder{result.count !== 1 ? 's' : ''} found
        </div>
        <div className="divide-y divide-gray-100">
          {result.founders.slice(0, 8).map(f => (
            <Link key={f.id} to={`/founders/${f.id}`} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50 transition-colors">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0">
                  {f.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{f.name}</p>
                  <p className="text-xs text-gray-500 truncate">{[f.company, f.domain].filter(Boolean).join(' · ')}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {f.fit_score && <span className={`text-xs font-bold ${f.fit_score >= 8 ? 'text-emerald-600' : f.fit_score >= 6 ? 'text-amber-600' : 'text-gray-400'}`}>{f.fit_score}/10</span>}
                <span className={`badge text-[10px] ${statusBadge(f.status)}`}>{f.status}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // Founder detail
  if (tool === 'get_founder_detail' && result.founder) {
    const f = result.founder;
    return (
      <Link to={`/founders/${f.id}`} className="block bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition-colors">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
            {f.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-900">{f.name}</p>
            <p className="text-xs text-gray-500">{[f.role, f.company].filter(Boolean).join(' at ')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className={`badge ${statusBadge(f.status)}`}>{f.status}</span>
          {f.domain && <span className="badge badge-blue">{f.domain}</span>}
          {f.stage && <span className="badge badge-gray">{f.stage}</span>}
          {f.fit_score && <span className={`badge ${f.fit_score >= 7 ? 'badge-green' : 'badge-amber'}`}>Fit: {f.fit_score}/10</span>}
        </div>
        {result.notes?.length > 0 && <p className="text-xs text-gray-400 mt-2">{result.notes.length} note{result.notes.length !== 1 ? 's' : ''} · {result.assessments?.length || 0} assessment{result.assessments?.length !== 1 ? 's' : ''}</p>}
      </Link>
    );
  }

  // Pipeline stats
  if (tool === 'get_pipeline_stats') {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="grid grid-cols-4 gap-2 mb-3">
          <StatBox label="Total" value={result.total} />
          <StatBox label="Assessments" value={result.assessmentCount} />
          <StatBox label="Deals" value={result.dealCount} />
          <StatBox label="Avg Fit" value={result.avgFitScore?.avg ? `${result.avgFitScore.avg.toFixed(1)}/10` : 'N/A'} />
        </div>
        {result.byStatus?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {result.byStatus.map(s => (
              <span key={s.status} className={`badge text-[10px] ${statusBadge(s.status)}`}>
                {s.status}: {s.count}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Created/updated founder confirmation
  if ((tool === 'create_founder' || tool === 'update_founder') && result.founder) {
    const f = result.founder;
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-3">
        <div className="flex items-center gap-2 mb-1">
          <span className={`w-2 h-2 rounded-full ${tool === 'create_founder' ? 'bg-emerald-500' : 'bg-blue-500'}`} />
          <span className="text-xs font-medium text-gray-500">{tool === 'create_founder' ? 'Created' : 'Updated'}</span>
        </div>
        <Link to={`/founders/${f.id}`} className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors">
          {f.name}{f.company ? ` — ${f.company}` : ''}
        </Link>
        {result.changed && <p className="text-xs text-gray-400 mt-1">Changed: {result.changed.join(', ')}</p>}
      </div>
    );
  }

  // Assessment list
  if (tool === 'get_assessments' && result.assessments?.length > 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-500">
          {result.count} assessment{result.count !== 1 ? 's' : ''}
        </div>
        <div className="divide-y divide-gray-100">
          {result.assessments.map(a => (
            <Link key={a.id} to={`/assess/${a.id}`} className="flex items-center justify-between px-3 py-2 hover:bg-gray-50">
              <div>
                <p className="text-sm text-gray-900">{a.founder_name || 'Unknown'}</p>
                <p className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString()}</p>
              </div>
              <span className={`badge text-[10px] ${signalBadge(a.overall_signal)}`}>{a.overall_signal || a.status}</span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return null;
}

function StatBox({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function statusBadge(status) {
  const map = {
    'Identified': 'badge-gray', 'Contacted': 'badge-blue', 'Meeting Scheduled': 'badge-blue',
    'Active Diligence': 'badge-amber', 'IC Ready': 'badge-amber', 'Passed': 'badge-red', 'Invested': 'badge-green',
  };
  return map[status] || 'badge-gray';
}

function signalBadge(signal) {
  const map = { 'Invest': 'badge-green', 'Monitor': 'badge-amber', 'Pass': 'badge-red' };
  return map[signal] || 'badge-gray';
}
