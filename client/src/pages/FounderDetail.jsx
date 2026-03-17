import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../utils/api';

const STATUSES = ['Identified', 'Contacted', 'Meeting Scheduled', 'Met', 'Passed'];
const DEAL_STATUSES = ['Under Consideration', 'Active Diligence', 'IC Review', 'Committed', 'Passed'];
const RESIDENT_STATUSES = ['Prospect', 'Tour Scheduled', 'Admitted', 'Active', 'Alumni'];

const STATUS_COLORS = {
  'Identified': 'badge-gray', 'Contacted': 'badge-blue', 'Meeting Scheduled': 'badge-blue',
  'Met': 'badge-green', 'Passed': 'badge-red',
};

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

  useEffect(() => { loadFounder(); }, [id]);

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

  async function toggleTrack(track) {
    const tracks = (founder.pipeline_tracks || '').split(',').filter(Boolean);
    let newTracks;
    if (tracks.includes(track)) {
      newTracks = tracks.filter(t => t !== track);
    } else {
      newTracks = [...tracks, track];
    }
    const updates = { pipeline_tracks: newTracks.join(',') };
    // Set initial statuses when adding a track
    if (track === 'investment' && !tracks.includes('investment')) {
      updates.deal_status = 'Under Consideration';
    }
    if (track === 'resident' && !tracks.includes('resident')) {
      updates.resident_status = 'Prospect';
    }
    await handleUpdate(updates);
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
  const isResident = tracks.includes('resident');
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
              {/* Track badges */}
              {isResident && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider">Resident</span>
              )}
              {isInvestment && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider">Investment</span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {founder.role && <span>{founder.role}</span>}
              {founder.role && founder.company && <span> at </span>}
              {founder.company && <span className="text-gray-700">{founder.company}</span>}
            </p>
            {founder.company_one_liner && (
              <p className="text-xs text-gray-400 mt-0.5">{founder.company_one_liner}</p>
            )}
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
          <select
            value={founder.status}
            onChange={e => handleUpdate({ status: e.target.value })}
            className="select text-sm"
          >
            {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Track toggles */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => toggleTrack('resident')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isResident ? 'bg-purple-50 border-purple-200 text-purple-700' : 'bg-white border-gray-200 text-gray-500 hover:border-purple-200'
          }`}
        >
          {isResident ? '✓ Resident Track' : '+ Resident Track'}
        </button>
        <button
          onClick={() => toggleTrack('investment')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            isInvestment ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-white border-gray-200 text-gray-500 hover:border-emerald-200'
          }`}
        >
          {isInvestment ? '✓ Investment Track' : '+ Investment Track'}
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

          {/* Resident Track Panel */}
          {isResident && (
            <div className="card p-4 border-l-2 border-l-purple-400">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-purple-700">Resident Track</h3>
                <select
                  value={founder.resident_status || ''}
                  onChange={e => handleUpdate({ resident_status: e.target.value })}
                  className="select text-xs"
                >
                  {RESIDENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                {founder.desks_needed && <Detail label="Desks Needed" value={founder.desks_needed} />}
                {founder.admitted_at && <Detail label="Admitted" value={new Date(founder.admitted_at).toLocaleDateString()} />}
                <Detail label="Status" value={founder.resident_status || 'Not set'} />
              </div>
            </div>
          )}

          {/* Investment Track Panel */}
          {isInvestment && (
            <div className="card p-4 border-l-2 border-l-emerald-400">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-emerald-700">Investment Track</h3>
                <div className="flex items-center gap-2">
                  <select
                    value={founder.deal_status || ''}
                    onChange={e => handleUpdate({ deal_status: e.target.value })}
                    className="select text-xs"
                  >
                    {DEAL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <button onClick={() => setEditingDeal(!editingDeal)} className="btn-ghost text-xs px-2 py-1">
                    {editingDeal ? 'Cancel' : 'Edit'}
                  </button>
                </div>
              </div>

              {editingDeal ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="label">Deal Lead</label>
                      <input value={dealForm.deal_lead} onChange={e => setDealForm(f => ({ ...f, deal_lead: e.target.value }))} className="input w-full text-sm" placeholder="Danny Goodman" />
                    </div>
                    <div>
                      <label className="label">Security Type</label>
                      <select value={dealForm.security_type} onChange={e => setDealForm(f => ({ ...f, security_type: e.target.value }))} className="select w-full text-sm">
                        <option value="">Select...</option>
                        <option>SAFE</option>
                        <option>Convertible Note</option>
                        <option>Priced Round</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Post-Money Valuation</label>
                      <input type="number" value={dealForm.valuation} onChange={e => setDealForm(f => ({ ...f, valuation: e.target.value }))} className="input w-full text-sm" placeholder="10000000" />
                    </div>
                    <div>
                      <label className="label">Round Size</label>
                      <input type="number" value={dealForm.round_size} onChange={e => setDealForm(f => ({ ...f, round_size: e.target.value }))} className="input w-full text-sm" placeholder="2000000" />
                    </div>
                    <div>
                      <label className="label">Our Investment</label>
                      <input type="number" value={dealForm.investment_amount} onChange={e => setDealForm(f => ({ ...f, investment_amount: e.target.value }))} className="input w-full text-sm" placeholder="150000" />
                    </div>
                    <div>
                      <label className="label">ARR</label>
                      <input type="number" value={dealForm.arr} onChange={e => setDealForm(f => ({ ...f, arr: e.target.value }))} className="input w-full text-sm" placeholder="0" />
                    </div>
                    <div>
                      <label className="label">Monthly Burn</label>
                      <input type="number" value={dealForm.monthly_burn} onChange={e => setDealForm(f => ({ ...f, monthly_burn: e.target.value }))} className="input w-full text-sm" />
                    </div>
                    <div>
                      <label className="label">Runway (months)</label>
                      <input type="number" value={dealForm.runway_months} onChange={e => setDealForm(f => ({ ...f, runway_months: e.target.value }))} className="input w-full text-sm" />
                    </div>
                    <div>
                      <label className="label">Diligence</label>
                      <select value={dealForm.diligence_status} onChange={e => setDealForm(f => ({ ...f, diligence_status: e.target.value }))} className="select w-full text-sm">
                        <option value="">Not Started</option>
                        <option>In Progress</option>
                        <option>Complete</option>
                      </select>
                    </div>
                    <div>
                      <label className="label">Memo</label>
                      <select value={dealForm.memo_status} onChange={e => setDealForm(f => ({ ...f, memo_status: e.target.value }))} className="select w-full text-sm">
                        <option value="">Not Started</option>
                        <option>In Progress</option>
                        <option>Complete</option>
                      </select>
                    </div>
                  </div>
                  {founder.deal_status === 'Passed' && (
                    <div>
                      <label className="label">Reason for Pass</label>
                      <input value={dealForm.pass_reason} onChange={e => setDealForm(f => ({ ...f, pass_reason: e.target.value }))} className="input w-full text-sm" placeholder="Thesis mismatch, timing, etc." />
                    </div>
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

          {/* Assessments */}
          {founder.assessments?.length > 0 && (
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Assessments</h3>
              {founder.assessments.map(a => (
                <Link key={a.id} to={`/assess/${a.id}`} className="block p-3 bg-gray-50 rounded-lg mb-2 hover:bg-gray-100 transition-colors">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-700">Assessment #{a.id}</span>
                    <div className="flex items-center gap-2">
                      <span className={`badge ${a.overall_signal === 'Strong Pass' ? 'badge-green' : a.overall_signal === 'Pass' ? 'badge-blue' : a.overall_signal === 'Watch' ? 'badge-amber' : 'badge-red'}`}>
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

        {/* Right: Notes + Calls */}
        <div className="space-y-4">
          <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
            <button onClick={() => setSideTab('notes')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium ${sideTab === 'notes' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Notes ({founder.notes?.length || 0})
            </button>
            <button onClick={() => setSideTab('calls')} className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium ${sideTab === 'calls' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
              Calls ({founder.calls?.length || 0})
            </button>
          </div>

          {sideTab === 'notes' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <textarea
                  value={noteText}
                  onChange={e => setNoteText(e.target.value)}
                  placeholder="Add a note..."
                  className="input text-sm flex-1 min-h-[60px] resize-none"
                  rows={2}
                />
              </div>
              {noteText.trim() && (
                <button onClick={handleAddNote} className="btn-primary text-xs">Save Note</button>
              )}
              {founder.notes?.map(n => (
                <div key={n.id} className="card p-3">
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{n.content}</p>
                  <p className="text-[10px] text-gray-400 mt-2">{n.author} · {new Date(n.created_at).toLocaleDateString()}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <textarea
                  value={transcript}
                  onChange={e => setTranscript(e.target.value)}
                  placeholder="Paste Granola transcript here..."
                  className="input text-sm w-full min-h-[100px] resize-none"
                  rows={4}
                />
                {transcript.trim() && (
                  <button onClick={handleLogCall} disabled={callingAI} className="btn-primary text-xs mt-2">
                    {callingAI ? 'Processing...' : 'Log Call'}
                  </button>
                )}
              </div>
              {founder.calls?.map(c => {
                const summary = c.structured_summary ? JSON.parse(c.structured_summary) : null;
                return (
                  <div key={c.id} className="card p-3 space-y-2">
                    {summary ? (
                      <>
                        {summary.one_liner && <p className="text-sm font-medium text-gray-800">{summary.one_liner}</p>}
                        <div className={`badge ${summary.signal === 'strong_positive' || summary.signal === 'positive' ? 'badge-green' : summary.signal === 'neutral' ? 'badge-amber' : 'badge-red'}`}>
                          {summary.signal?.replace('_', ' ')}
                        </div>
                        {summary.key_points && (
                          <ul className="text-xs text-gray-500 space-y-1">
                            {summary.key_points.map((p, i) => <li key={i}>· {p}</li>)}
                          </ul>
                        )}
                        {summary.next_steps?.length > 0 && (
                          <div>
                            <p className="text-[10px] text-gray-400 uppercase tracking-wider mt-2">Next Steps</p>
                            <ul className="text-xs text-gray-500 space-y-0.5">
                              {summary.next_steps.map((s, i) => <li key={i}>→ {s}</li>)}
                            </ul>
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
