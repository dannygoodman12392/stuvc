import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const STATUSES = ['Sourced', 'Outreach', 'Interviewing', 'Active', 'Hold', 'Passed', 'Not Admitted', 'Inactive'];
const ADMISSIONS_STATUSES = ['Sourced', 'Outreach', 'First Call Scheduled', 'First Call Complete', 'Second Call Scheduled', 'Second Call Complete', 'Admitted', 'Active Resident', 'Density Resident', 'Alumni', 'Hold/Nurture', 'Not Admitted'];
const DEAL_STATUSES = ['Under Consideration', 'First Meeting', 'Partner Call', 'Memo Draft', 'IC Review', 'Committed', 'Passed'];

export default function FounderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [founder, setFounder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [noteText, setNoteText] = useState('');
  const [sideTab, setSideTab] = useState('notes');
  const [transcript, setTranscript] = useState('');
  const [callingAI, setCallingAI] = useState(false);
  const [editingDeal, setEditingDeal] = useState(false);
  const [dealForm, setDealForm] = useState({});

  // Memo state
  const [memos, setMemos] = useState([]);
  const [generatingMemo, setGeneratingMemo] = useState(false);
  const [expandedMemo, setExpandedMemo] = useState(null);
  const [memoPolling, setMemoPolling] = useState(null);

  // Files state
  const [files, setFiles] = useState([]);
  const [showFileForm, setShowFileForm] = useState(false);
  const [fileForm, setFileForm] = useState({ file_name: '', file_type: 'document', content_text: '', url: '' });

  useEffect(() => { loadFounder(); loadMemos(); loadFiles(); }, [id]);

  // Poll for memo completion
  useEffect(() => {
    if (!memoPolling) return;
    const interval = setInterval(async () => {
      try {
        const updated = await api.getMemos(id);
        setMemos(updated);
        const pending = updated.find(m => m.id === memoPolling);
        if (pending?.content) {
          setMemoPolling(null);
          setGeneratingMemo(false);
          setExpandedMemo(pending.id);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [memoPolling, id]);

  async function loadFounder() {
    setLoading(true);
    try {
      const f = await api.getFounder(id);
      setFounder(f);
      setDealForm({
        deal_lead: f.deal_lead || '', valuation: f.valuation || '', round_size: f.round_size || '',
        investment_amount: f.investment_amount || '', arr: f.arr || '', monthly_burn: f.monthly_burn || '',
        runway_months: f.runway_months || '', security_type: f.security_type || '',
        memo_status: f.memo_status || '', diligence_status: f.diligence_status || '',
        pass_reason: f.pass_reason || '',
      });
    } catch (err) { console.error(err); }
    setLoading(false);
  }

  async function loadMemos() {
    try { setMemos(await api.getMemos(id)); } catch {}
  }

  async function loadFiles() {
    try { setFiles(await api.getFiles(id)); } catch {}
  }

  async function handleUpdate(fields) {
    try {
      const updated = await api.updateFounder(id, fields);
      setFounder(f => ({ ...f, ...updated }));
    } catch (err) { console.error(err); }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    try {
      const note = await api.createNote(id, noteText.trim());
      setFounder(f => ({ ...f, notes: [note, ...f.notes] }));
      setNoteText('');
    } catch (err) { console.error(err); }
  }

  async function handleLogCall() {
    if (!transcript.trim()) return;
    setCallingAI(true);
    try {
      const call = await api.logCall(id, transcript.trim());
      setFounder(f => ({ ...f, calls: [call, ...f.calls] }));
      setTranscript('');
    } catch (err) { console.error(err); }
    setCallingAI(false);
  }

  async function handleFitScore() {
    setCallingAI(true);
    try {
      const result = await api.fitScore(id);
      setFounder(f => ({ ...f, fit_score: result.score, fit_score_rationale: result.rationale }));
    } catch (err) { console.error(err); }
    setCallingAI(false);
  }

  async function handleGenerateMemo() {
    setGeneratingMemo(true);
    try {
      const result = await api.generateMemo(id);
      setMemoPolling(result.id);
      setMemos(prev => [{ id: result.id, version: result.version, content: '', created_at: new Date().toISOString() }, ...prev]);
    } catch (err) {
      console.error(err);
      setGeneratingMemo(false);
    }
  }

  async function handleDeleteMemo(memoId) {
    if (!confirm('Delete this memo?')) return;
    try {
      await api.deleteMemo(id, memoId);
      setMemos(prev => prev.filter(m => m.id !== memoId));
      if (expandedMemo === memoId) setExpandedMemo(null);
    } catch (err) { console.error(err); }
  }

  async function handleAddFile() {
    if (!fileForm.file_name.trim()) return;
    try {
      const file = await api.addFile(id, fileForm);
      setFiles(prev => [file, ...prev]);
      setFileForm({ file_name: '', file_type: 'document', content_text: '', url: '' });
      setShowFileForm(false);
    } catch (err) { console.error(err); }
  }

  async function handleDeleteFile(fileId) {
    if (!confirm('Delete this file?')) return;
    try {
      await api.deleteFile(id, fileId);
      setFiles(prev => prev.filter(f => f.id !== fileId));
    } catch (err) { console.error(err); }
  }

  function toggleTrack(track) {
    const tracks = (founder.pipeline_tracks || '').split(',').filter(Boolean);
    let newTracks;
    if (tracks.includes(track)) {
      newTracks = tracks.filter(t => t !== track);
    } else {
      newTracks = [...tracks, track];
    }
    const updates = { pipeline_tracks: newTracks.join(',') };
    if (track === 'investment' && !tracks.includes('investment')) updates.deal_status = 'Under Consideration';
    if (track === 'admissions' && !tracks.includes('admissions')) updates.admissions_status = 'Sourced';
    handleUpdate(updates);
  }

  async function saveDealFields() {
    const updates = {};
    for (const [k, v] of Object.entries(dealForm)) {
      const numFields = ['valuation', 'round_size', 'investment_amount', 'arr', 'monthly_burn', 'runway_months'];
      updates[k] = numFields.includes(k) ? (v ? Number(v) : null) : (v || null);
    }
    await handleUpdate(updates);
    setEditingDeal(false);
  }

  if (loading) return <div className="text-center py-12 text-gray-500 text-sm">Loading...</div>;
  if (!founder) return <div className="text-center py-12 text-gray-500 text-sm">Founder not found</div>;

  const tracks = (founder.pipeline_tracks || '').split(',').filter(Boolean);
  const isAdmissions = tracks.includes('admissions') || tracks.includes('resident');
  const isInvestment = tracks.includes('investment');

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
        <Link to="/" className="hover:text-gray-600">Pipeline</Link>
        <span>/</span>
        <span className="text-gray-700">{founder.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-lg font-bold text-gray-600">
            {founder.name?.split(' ').map(n => n[0]).join('').slice(0, 2)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{founder.name}</h1>
              {isAdmissions && <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">Admissions</span>}
              {isInvestment && <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider">Investment</span>}
            </div>
            <p className="text-sm text-gray-500">
              {founder.role && <span>{founder.role}</span>}
              {founder.role && founder.company && <span> at </span>}
              {founder.company && <span className="text-gray-700">{founder.company}</span>}
            </p>
            {founder.company_one_liner && <p className="text-xs text-gray-400 mt-0.5">{founder.company_one_liner}</p>}
            {(founder.location_city || founder.location_state) && (
              <p className="text-xs text-gray-400 mt-0.5">{founder.location_city}{founder.location_city && founder.location_state && ', '}{founder.location_state}</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {founder.fit_score ? (
            <div className={`text-lg font-bold ${founder.fit_score >= 8 ? 'text-emerald-600' : founder.fit_score >= 6 ? 'text-amber-600' : 'text-gray-400'}`}>
              {founder.fit_score}/10
            </div>
          ) : (
            <button onClick={handleFitScore} disabled={callingAI} className="btn-secondary text-sm">
              {callingAI ? 'Scoring...' : 'AI Score'}
            </button>
          )}
          <select value={founder.status} onChange={e => handleUpdate({ status: e.target.value })} className="select text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Track toggles */}
      <div className="flex gap-2 mb-6">
        <button onClick={() => toggleTrack('admissions')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isAdmissions ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500 hover:border-purple-200'}`}>
          {isAdmissions ? '✓ Admissions Pipeline' : '+ Admissions Pipeline'}
        </button>
        <button onClick={() => toggleTrack('investment')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${isInvestment ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-200'}`}>
          {isInvestment ? '✓ Investment Pipeline' : '+ Investment Pipeline'}
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Details card */}
          <div className="card p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Details</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {founder.domain && <Detail label="Domain" value={founder.domain} />}
              {founder.stage && <Detail label="Stage" value={founder.stage} />}
              {founder.source && <Detail label="Source" value={founder.source} />}
              {founder.chicago_connection && <Detail label="Chicago Connection" value={founder.chicago_connection} />}
              {founder.previous_companies && <Detail label="Previous Companies" value={founder.previous_companies} />}
              {founder.notable_background && <Detail label="Notable Background" value={founder.notable_background} />}
            </div>
            {founder.bio && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Bio</p>
                <p className="text-sm text-gray-600">{founder.bio}</p>
              </div>
            )}
            {founder.fit_score_rationale && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">AI Fit Assessment</p>
                <p className="text-sm text-gray-600">{founder.fit_score_rationale}</p>
              </div>
            )}
            {founder.next_action && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">Next Action</p>
                <p className="text-sm text-gray-600">{founder.next_action}</p>
              </div>
            )}
            <div className="flex gap-2 mt-3 pt-3 border-t border-gray-100">
              {founder.linkedin_url && <a href={founder.linkedin_url} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">LinkedIn</a>}
              {founder.twitter && <a href={`https://twitter.com/${founder.twitter}`} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">Twitter</a>}
              {founder.github_url && <a href={founder.github_url} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">GitHub</a>}
              {founder.website_url && <a href={founder.website_url} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline">Website</a>}
            </div>
          </div>

          {/* Admissions Pipeline Panel */}
          {isAdmissions && (
            <div className="card p-4 border-l-2 border-l-purple-400">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-purple-700">Admissions Pipeline</h3>
                <select value={founder.admissions_status || founder.resident_status || ''} onChange={e => handleUpdate({ admissions_status: e.target.value })} className="select text-xs">
                  {ADMISSIONS_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {founder.desks_needed && <Detail label="Desks Needed" value={founder.desks_needed} />}
                {founder.admitted_at && <Detail label="Admitted" value={new Date(founder.admitted_at).toLocaleDateString()} />}
                <Detail label="Stage" value={founder.admissions_status || founder.resident_status || 'Not set'} />
              </div>
            </div>
          )}

          {/* Investment Pipeline Panel */}
          {isInvestment && (
            <div className="card p-4 border-l-2 border-l-emerald-400">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-emerald-700">Investment Pipeline</h3>
                <div className="flex items-center gap-2">
                  <select value={founder.deal_status || ''} onChange={e => handleUpdate({ deal_status: e.target.value })} className="select text-xs">
                    {DEAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => setEditingDeal(!editingDeal)} className="btn-ghost text-xs px-2 py-1">{editingDeal ? 'Cancel' : 'Edit'}</button>
                </div>
              </div>

              {editingDeal ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div><label className="label">Deal Lead</label><input value={dealForm.deal_lead} onChange={e => setDealForm(f => ({ ...f, deal_lead: e.target.value }))} className="input w-full text-sm" placeholder="Danny Goodman" /></div>
                    <div><label className="label">Security Type</label><select value={dealForm.security_type} onChange={e => setDealForm(f => ({ ...f, security_type: e.target.value }))} className="select w-full text-sm"><option value="">Select...</option><option>SAFE</option><option>Convertible Note</option><option>Priced Round</option></select></div>
                    <div><label className="label">Post-Money Valuation</label><input type="number" value={dealForm.valuation} onChange={e => setDealForm(f => ({ ...f, valuation: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">Round Size</label><input type="number" value={dealForm.round_size} onChange={e => setDealForm(f => ({ ...f, round_size: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">Our Investment</label><input type="number" value={dealForm.investment_amount} onChange={e => setDealForm(f => ({ ...f, investment_amount: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">ARR</label><input type="number" value={dealForm.arr} onChange={e => setDealForm(f => ({ ...f, arr: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">Monthly Burn</label><input type="number" value={dealForm.monthly_burn} onChange={e => setDealForm(f => ({ ...f, monthly_burn: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">Runway (months)</label><input type="number" value={dealForm.runway_months} onChange={e => setDealForm(f => ({ ...f, runway_months: e.target.value }))} className="input w-full text-sm" /></div>
                    <div><label className="label">Diligence</label><select value={dealForm.diligence_status} onChange={e => setDealForm(f => ({ ...f, diligence_status: e.target.value }))} className="select w-full text-sm"><option value="">Not Started</option><option>In Progress</option><option>Complete</option></select></div>
                    <div><label className="label">Memo</label><select value={dealForm.memo_status} onChange={e => setDealForm(f => ({ ...f, memo_status: e.target.value }))} className="select w-full text-sm"><option value="">Not Started</option><option>In Progress</option><option>Complete</option></select></div>
                  </div>
                  {founder.deal_status === 'Passed' && (
                    <div><label className="label">Reason for Pass</label><input value={dealForm.pass_reason} onChange={e => setDealForm(f => ({ ...f, pass_reason: e.target.value }))} className="input w-full text-sm" /></div>
                  )}
                  <button onClick={saveDealFields} className="btn-primary text-xs">Save Deal Info</button>
                </div>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
                  {founder.deal_lead && <Detail label="Deal Lead" value={founder.deal_lead} />}
                  {founder.security_type && <Detail label="Security" value={founder.security_type} />}
                  {founder.valuation && <Detail label="Valuation" value={`$${formatCurrency(founder.valuation)}`} />}
                  {founder.round_size && <Detail label="Round Size" value={`$${formatCurrency(founder.round_size)}`} />}
                  {founder.investment_amount && <Detail label="Our Investment" value={`$${formatCurrency(founder.investment_amount)}`} />}
                  {founder.arr != null && founder.arr > 0 && <Detail label="ARR" value={`$${formatCurrency(founder.arr)}`} />}
                  {founder.monthly_burn && <Detail label="Monthly Burn" value={`$${formatCurrency(founder.monthly_burn)}`} />}
                  {founder.runway_months && <Detail label="Runway" value={`${founder.runway_months} months`} />}
                  {founder.diligence_status && <Detail label="Diligence" value={founder.diligence_status} />}
                  {founder.memo_status && <Detail label="Memo" value={founder.memo_status} />}
                  {founder.deal_entered_at && <Detail label="Deal Entered" value={new Date(founder.deal_entered_at).toLocaleDateString()} />}
                  {founder.pass_reason && <Detail label="Pass Reason" value={founder.pass_reason} />}
                </div>
              )}
            </div>
          )}

          {/* IC Memo Section */}
          <div className="card p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-gray-700">IC Memo</h3>
                {memos.length > 0 && <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{memos.length} version{memos.length > 1 ? 's' : ''}</span>}
              </div>
              <button
                onClick={handleGenerateMemo}
                disabled={generatingMemo}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 disabled:opacity-50 transition-colors"
              >
                {generatingMemo ? (
                  <>
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                    Generating...
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>
                    {memos.length > 0 ? 'Regenerate' : 'Generate IC Memo'}
                  </>
                )}
              </button>
            </div>

            {memos.length === 0 && !generatingMemo && (
              <div className="text-center py-6">
                <p className="text-sm text-gray-400">No memos yet. Generate one from all available data.</p>
                <p className="text-xs text-gray-300 mt-1">Pulls notes, calls, assessments, deal info, and documents.</p>
              </div>
            )}

            {memos.map(memo => (
              <div key={memo.id} className={`border rounded-lg mb-2 ${expandedMemo === memo.id ? 'border-gray-300' : 'border-gray-100'}`}>
                <button
                  onClick={() => setExpandedMemo(expandedMemo === memo.id ? null : memo.id)}
                  className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-gray-50 transition-colors rounded-lg"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-gray-700">v{memo.version}</span>
                    <span className="text-xs text-gray-400">{new Date(memo.created_at).toLocaleDateString()}</span>
                    {!memo.content && <span className="text-[10px] text-amber-500 bg-amber-50 px-1.5 py-0.5 rounded animate-pulse">Generating...</span>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={(e) => { e.stopPropagation(); handleDeleteMemo(memo.id); }} className="text-gray-300 hover:text-red-400 transition-colors p-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                    <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expandedMemo === memo.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </div>
                </button>

                {expandedMemo === memo.id && memo.content && (
                  <div className="px-4 pb-4 border-t border-gray-100">
                    <div className="mt-3">
                      <MemoRenderer content={memo.content} />
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Assessments */}
          {founder.assessments?.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Assessments</h3>
              {founder.assessments.map(a => (
                <Link key={a.id} to={`/assess/${a.id}`} className="block p-3 bg-gray-50 rounded-lg mb-2 hover:bg-gray-100 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Assessment #{a.id}</span>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${a.overall_signal === 'Invest' ? 'badge-green' : a.overall_signal === 'Monitor' ? 'badge-amber' : 'badge-red'}`}>
                        {a.overall_signal || a.status}
                      </span>
                      <span className="text-xs text-gray-400">{new Date(a.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Link to={`/assess?founder=${id}`} className="btn-primary text-sm">Run Assessment</Link>
          </div>
        </div>

        {/* Right: Notes + Calls + Files */}
        <div className="space-y-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setSideTab('notes')} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium ${sideTab === 'notes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Notes ({founder.notes?.length || 0})
            </button>
            <button onClick={() => setSideTab('calls')} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium ${sideTab === 'calls' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Calls ({founder.calls?.length || 0})
            </button>
            <button onClick={() => setSideTab('files')} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium ${sideTab === 'files' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Files ({files.length})
            </button>
          </div>

          {sideTab === 'notes' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Add a note..." className="input text-sm flex-1 min-h-[60px] resize-none" rows={2} />
              </div>
              {noteText.trim() && <button onClick={handleAddNote} className="btn-primary text-xs">Save Note</button>}
              {founder.notes?.map(n => (
                <div key={n.id} className="card p-3">
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{n.content}</p>
                  <p className="text-[10px] text-gray-400 mt-2">{n.author} · {new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          ) : sideTab === 'calls' ? (
            <div className="space-y-3">
              <div>
                <textarea value={transcript} onChange={e => setTranscript(e.target.value)} placeholder="Paste Granola transcript here..." className="input text-sm w-full min-h-[100px] resize-none" rows={4} />
                {transcript.trim() && (
                  <button onClick={handleLogCall} disabled={callingAI} className="btn-primary text-xs mt-2">
                    {callingAI ? 'Processing...' : 'Log Call'}
                  </button>
                )}
              </div>
              {founder.calls?.map(c => {
                let summary = null;
                try { summary = JSON.parse(c.structured_summary); } catch {}
                return (
                  <div key={c.id} className="card p-3 space-y-2">
                    {summary ? (
                      <>
                        {summary.one_liner && <p className="text-sm font-medium text-gray-800">{summary.one_liner}</p>}
                        <div className={`badge ${summary.signal === 'strong_positive' || summary.signal === 'positive' ? 'badge-green' : summary.signal === 'neutral' ? 'badge-amber' : 'badge-red'}`}>
                          {summary.signal?.replace('_', ' ')}
                        </div>
                        {summary.key_points && <ul className="text-xs text-gray-500 space-y-1">{summary.key_points.map((p, i) => <li key={i}>· {p}</li>)}</ul>}
                        {summary.next_steps?.length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-2">Next Steps</p>
                            <ul className="text-xs text-gray-500 space-y-0.5">{summary.next_steps.map((s, i) => <li key={i}>→ {s}</li>)}</ul>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-xs text-gray-400">Transcript logged (no AI summary)</p>
                    )}
                    <p className="text-[10px] text-gray-400">{c.logged_by} · {new Date(c.created_at).toLocaleDateString()}</p>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Files tab */
            <div className="space-y-3">
              <button onClick={() => setShowFileForm(!showFileForm)} className="btn-secondary text-xs w-full">
                {showFileForm ? 'Cancel' : '+ Add Document'}
              </button>

              {showFileForm && (
                <div className="card p-3 space-y-2">
                  <input value={fileForm.file_name} onChange={e => setFileForm(f => ({ ...f, file_name: e.target.value }))} placeholder="Document name" className="input text-sm w-full" />
                  <select value={fileForm.file_type} onChange={e => setFileForm(f => ({ ...f, file_type: e.target.value }))} className="select text-sm w-full">
                    <option value="document">Document</option>
                    <option value="pitch_deck">Pitch Deck</option>
                    <option value="term_sheet">Term Sheet</option>
                    <option value="cap_table">Cap Table</option>
                    <option value="financials">Financials</option>
                    <option value="data_room">Data Room Link</option>
                    <option value="other">Other</option>
                  </select>
                  <input value={fileForm.url} onChange={e => setFileForm(f => ({ ...f, url: e.target.value }))} placeholder="URL (optional)" className="input text-sm w-full" />
                  <textarea value={fileForm.content_text} onChange={e => setFileForm(f => ({ ...f, content_text: e.target.value }))} placeholder="Paste content or notes..." className="input text-sm w-full min-h-[60px] resize-none" rows={3} />
                  <button onClick={handleAddFile} disabled={!fileForm.file_name.trim()} className="btn-primary text-xs">Save Document</button>
                </div>
              )}

              {files.length === 0 && !showFileForm && (
                <div className="text-center py-6 text-sm text-gray-400">No documents yet</div>
              )}

              {files.map(file => (
                <div key={file.id} className="card p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 text-sm">
                        {({ pitch_deck: '\uD83D\uDCCA', term_sheet: '\uD83D\uDCC4', cap_table: '\uD83D\uDCC8', financials: '\uD83D\uDCB0', data_room: '\uD83D\uDD17', document: '\uD83D\uDCCB', other: '\uD83D\uDCC1' })[file.file_type] || '\uD83D\uDCCB'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-700">{file.file_name}</p>
                        <p className="text-[10px] text-gray-400">{file.file_type?.replace('_', ' ')} · {new Date(file.created_at).toLocaleDateString()}</p>
                      </div>
                    </div>
                    <button onClick={() => handleDeleteFile(file.id)} className="text-gray-300 hover:text-red-400 transition-colors p-1">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                  {file.url && <a href={file.url} target="_blank" rel="noopener" className="text-xs text-blue-600 hover:underline mt-1 block truncate">{file.url}</a>}
                  {file.content_text && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{file.content_text}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <p className="text-xs text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-gray-700 mt-0.5">{value}</p>
    </div>
  );
}

function formatCurrency(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return n.toLocaleString();
}

function MemoRenderer({ content }) {
  if (!content) return null;
  const lines = content.split('\n');
  const elements = [];
  let key = 0;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      elements.push(<h2 key={key++} className="text-base font-bold text-gray-900 mt-5 mb-2">{line.slice(3)}</h2>);
    } else if (line.startsWith('### ')) {
      elements.push(<h3 key={key++} className="text-sm font-semibold text-gray-800 mt-4 mb-1">{line.slice(4)}</h3>);
    } else if (line.startsWith('# ')) {
      elements.push(<h1 key={key++} className="text-lg font-bold text-gray-900 mt-4 mb-2">{line.slice(2)}</h1>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      elements.push(<li key={key++} className="text-sm text-gray-600 ml-4 list-disc">{renderInline(line.slice(2))}</li>);
    } else if (line.match(/^\d+\. /)) {
      elements.push(<li key={key++} className="text-sm text-gray-600 ml-4 list-decimal">{renderInline(line.replace(/^\d+\. /, ''))}</li>);
    } else if (line.trim() === '') {
      elements.push(<div key={key++} className="h-2" />);
    } else {
      elements.push(<p key={key++} className="text-sm text-gray-600 leading-relaxed">{renderInline(line)}</p>);
    }
  }

  return <>{elements}</>;
}

function renderInline(text) {
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    const boldMatch = remaining.match(/\*\*(.+?)\*\*/);
    if (boldMatch) {
      const idx = remaining.indexOf(boldMatch[0]);
      if (idx > 0) parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
      parts.push(<strong key={key++} className="font-semibold text-gray-800">{boldMatch[1]}</strong>);
      remaining = remaining.slice(idx + boldMatch[0].length);
    } else {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }
  }

  return parts.length > 0 ? parts : text;
}
