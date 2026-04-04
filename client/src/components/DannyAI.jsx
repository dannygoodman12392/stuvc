import { useState, useRef, useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import { api } from '../utils/api';

export default function DannyAI({ onClose, founderData }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const messagesEnd = useRef(null);
  const location = useLocation();

  useEffect(() => {
    messagesEnd.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Reset chat when founder changes
  useEffect(() => {
    setMessages([]);
  }, [founderData?.id]);

  function buildContext() {
    const path = location.pathname;

    // Rich founder context when available
    if (founderData) {
      let ctx = `CURRENT FOUNDER CONTEXT:\n`;
      ctx += `Name: ${founderData.name}\n`;
      ctx += `Company: ${founderData.company || 'N/A'}\n`;
      ctx += `Role: ${founderData.role || 'Founder'}\n`;
      ctx += `Location: ${founderData.location_city || ''} ${founderData.location_state || ''}\n`;
      ctx += `Stage: ${founderData.stage || 'Pre-seed'}\n`;
      ctx += `Domain: ${founderData.domain || 'N/A'}\n`;
      ctx += `Status: ${founderData.status || 'N/A'}\n`;
      ctx += `One-liner: ${founderData.company_one_liner || 'N/A'}\n`;
      ctx += `Bio: ${founderData.bio || 'N/A'}\n`;
      ctx += `Previous Companies: ${founderData.previous_companies || 'N/A'}\n`;
      ctx += `Notable Background: ${founderData.notable_background || 'N/A'}\n`;
      ctx += `Fit Score: ${founderData.fit_score || 'Not scored'}/10\n`;
      if (founderData.fit_score_rationale) ctx += `Fit Rationale: ${founderData.fit_score_rationale}\n`;

      // Pipeline info
      if (founderData.pipeline_tracks) ctx += `Tracks: ${founderData.pipeline_tracks}\n`;
      if (founderData.admissions_status) ctx += `Admissions Status: ${founderData.admissions_status}\n`;
      if (founderData.deal_status) ctx += `Deal Status: ${founderData.deal_status}\n`;

      // Deal data
      if (founderData.valuation || founderData.round_size) {
        ctx += `\nDEAL DATA:\n`;
        if (founderData.deal_lead) ctx += `Deal Lead: ${founderData.deal_lead}\n`;
        if (founderData.valuation) ctx += `Valuation: $${Number(founderData.valuation).toLocaleString()}\n`;
        if (founderData.round_size) ctx += `Round Size: $${Number(founderData.round_size).toLocaleString()}\n`;
        if (founderData.investment_amount) ctx += `Our Investment: $${Number(founderData.investment_amount).toLocaleString()}\n`;
        if (founderData.arr) ctx += `ARR: $${Number(founderData.arr).toLocaleString()}\n`;
        if (founderData.monthly_burn) ctx += `Monthly Burn: $${Number(founderData.monthly_burn).toLocaleString()}\n`;
        if (founderData.runway_months) ctx += `Runway: ${founderData.runway_months} months\n`;
      }

      // Notes
      if (founderData.notes?.length > 0) {
        ctx += `\nRECENT NOTES (${founderData.notes.length} total):\n`;
        founderData.notes.slice(0, 5).forEach(n => {
          ctx += `[${new Date(n.created_at).toLocaleDateString()}] ${n.content}\n`;
        });
      }

      // Calls
      if (founderData.calls?.length > 0) {
        ctx += `\nCALL HISTORY (${founderData.calls.length} calls):\n`;
        founderData.calls.slice(0, 3).forEach(c => {
          try {
            const s = JSON.parse(c.structured_summary);
            ctx += `[${new Date(c.created_at).toLocaleDateString()}] ${s.one_liner || 'Call'} | Signal: ${s.signal || 'N/A'}\n`;
            if (s.key_points) ctx += `  Key points: ${s.key_points.join('; ')}\n`;
          } catch {
            ctx += `[${new Date(c.created_at).toLocaleDateString()}] Transcript logged\n`;
          }
        });
      }

      // Assessments
      if (founderData.assessments?.length > 0) {
        ctx += `\nASSESSMENTS:\n`;
        founderData.assessments.forEach(a => {
          ctx += `Assessment #${a.id}: ${a.overall_signal || a.status} (${new Date(a.created_at).toLocaleDateString()})\n`;
        });
      }

      return ctx;
    }

    // Fallback: simple route context
    if (path === '/') return 'User is viewing the Pipeline.';
    if (path.startsWith('/founders/')) return `User is viewing a founder detail page.`;
    if (path.startsWith('/assess')) return 'User is in the Opportunity Assessment module.';
    return 'User is navigating Stu.';
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || streaming) return;

    const userMsg = { role: 'user', content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setStreaming(true);

    const assistantMsg = { role: 'assistant', content: '' };
    setMessages([...newMessages, assistantMsg]);

    try {
      for await (const chunk of api.chat(newMessages, buildContext())) {
        if (chunk.type === 'text') {
          assistantMsg.content += chunk.text;
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

  return (
    <div className="w-80 flex-shrink-0 bg-white border-l border-gray-200 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-blue-50 flex items-center justify-center">
            <svg className="w-3.5 h-3.5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </div>
          <div>
            <span className="text-sm font-semibold text-gray-900">Stu AI</span>
            {founderData && (
              <span className="text-[10px] text-blue-500 block -mt-0.5">{founderData.name}</span>
            )}
          </div>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Context indicator */}
      {founderData && (
        <div className="px-4 py-1.5 bg-blue-50/50 border-b border-blue-100/50 flex items-center gap-1.5">
          <div className="w-4 h-4 rounded-full bg-blue-100 flex items-center justify-center text-[8px] font-bold text-blue-600">
            {founderData.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <span className="text-[11px] text-blue-600">Context: {founderData.name}{founderData.company ? ` @ ${founderData.company}` : ''}</span>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center mx-auto mb-3">
              <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-700 mb-1">Stu AI</p>
            {founderData ? (
              <div className="space-y-1">
                <p className="text-xs text-gray-500">I have full context on {founderData.name}. Ask me anything.</p>
                <div className="flex flex-wrap gap-1 justify-center mt-2">
                  {['Key risks?', 'Draft follow-up email', 'Compare to thesis', 'Summarize calls'].map(s => (
                    <button key={s} onClick={() => { document.querySelector('[data-stu-input]').value = s; setInput(s); }}
                      className="text-[10px] px-2 py-1 bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Ask about any deal, founder, or framework.</p>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}>
              <p className="whitespace-pre-wrap">{msg.content || (streaming && i === messages.length - 1 ? '...' : '')}</p>
            </div>
          </div>
        ))}
        <div ref={messagesEnd} />
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="px-4 py-3 border-t border-gray-100">
        <div className="flex gap-2">
          <input
            data-stu-input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={founderData ? `Ask about ${founderData.name}...` : 'Ask Stu anything...'}
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-500/10"
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="px-3 py-2 bg-gray-900 text-white rounded-lg text-sm font-medium disabled:opacity-40 hover:bg-gray-800 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
          </button>
        </div>
      </form>
    </div>
  );
}
