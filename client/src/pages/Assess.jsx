import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function Assess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const preselectedFounder = searchParams.get('founder');

  const [assessments, setAssessments] = useState([]);
  const [founders, setFounders] = useState([]);
  const [showNew, setShowNew] = useState(!!preselectedFounder);
  const [loading, setLoading] = useState(true);

  // New assessment form
  const [founderId, setFounderId] = useState(preselectedFounder || '');
  const [inputs, setInputs] = useState({ deck_text: '', transcript: '', website_content: '', manual_notes: '' });
  const [pdfFile, setPdfFile] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [a, f] = await Promise.all([api.getAssessments(), api.getFounders()]);
      setAssessments(a);
      setFounders(f);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  async function handlePdfUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    setPdfFile(file);

    const reader = new FileReader();
    reader.onload = () => {
      setInputs(i => ({ ...i, deck_text: `[PDF uploaded: ${file.name}]\n\n(PDF text extraction will be processed server-side)` }));
    };
    reader.readAsText(file);
  }

  async function handleRunAssessment() {
    if (!inputs.deck_text && !inputs.transcript && !inputs.manual_notes && !inputs.website_content) {
      alert('Add at least one input (deck, transcript, notes, or URL content)');
      return;
    }

    setRunning(true);
    try {
      const result = await api.createAssessment({
        founder_id: founderId ? parseInt(founderId) : null,
        inputs
      });
      navigate(`/assess/${result.id}`);
    } catch (err) {
      console.error(err);
      alert('Failed to start assessment: ' + err.message);
    }
    setRunning(false);
  }

  const SIGNAL_COLORS = {
    'Strong Pass': 'badge-green',
    'Pass': 'badge-blue',
    'Watch': 'badge-amber',
    'Pass On': 'badge-red',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Opportunity Assessment</h1>
          <p className="text-sm text-gray-500 mt-0.5">Multi-agent evaluation system</p>
        </div>
        <button onClick={() => setShowNew(!showNew)} className="btn-primary text-sm">
          {showNew ? 'View History' : 'New Assessment'}
        </button>
      </div>

      {showNew ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input panel */}
          <div className="space-y-4">
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Link to Founder (optional)</h3>
              <select value={founderId} onChange={e => setFounderId(e.target.value)} className="select w-full text-sm">
                <option value="">Select founder...</option>
                {founders.map(f => (
                  <option key={f.id} value={f.id}>{f.name}{f.company ? ` (${f.company})` : ''}</option>
                ))}
              </select>
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Pitch Deck</h3>
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-blue-400 transition-colors">
                <input type="file" accept=".pdf,.txt" onChange={handlePdfUpload} className="hidden" id="pdf-upload" />
                <label htmlFor="pdf-upload" className="cursor-pointer">
                  <svg className="w-8 h-8 text-gray-400 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m6.75 12l-3-3m0 0l-3 3m3-3v6m-1.5-15H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                  <p className="text-sm text-gray-500">{pdfFile ? pdfFile.name : 'Drop pitch deck PDF or click to upload'}</p>
                </label>
              </div>
              {inputs.deck_text && !pdfFile && (
                <textarea
                  value={inputs.deck_text}
                  onChange={e => setInputs(i => ({ ...i, deck_text: e.target.value }))}
                  placeholder="Or paste deck text here..."
                  className="input w-full text-sm mt-3 min-h-[100px] resize-none"
                  rows={4}
                />
              )}
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Meeting Transcript</h3>
              <textarea
                value={inputs.transcript}
                onChange={e => setInputs(i => ({ ...i, transcript: e.target.value }))}
                placeholder="Paste Granola transcript..."
                className="input w-full text-sm min-h-[100px] resize-none"
                rows={4}
              />
            </div>

            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Additional Notes</h3>
              <textarea
                value={inputs.manual_notes}
                onChange={e => setInputs(i => ({ ...i, manual_notes: e.target.value }))}
                placeholder="Any additional context, observations, website content..."
                className="input w-full text-sm min-h-[80px] resize-none"
                rows={3}
              />
            </div>

            <button
              onClick={handleRunAssessment}
              disabled={running}
              className="btn-accent w-full justify-center text-sm"
            >
              {running ? (
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Running 5 agents...
                </span>
              ) : (
                'Run Assessment'
              )}
            </button>
          </div>

          {/* Input checklist */}
          <div className="card p-4 h-fit">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Input Status</h3>
            <div className="space-y-2">
              <InputStatus label="Founder linked" active={!!founderId} />
              <InputStatus label="Pitch deck" active={!!inputs.deck_text || !!pdfFile} />
              <InputStatus label="Meeting transcript" active={!!inputs.transcript} />
              <InputStatus label="Additional notes" active={!!inputs.manual_notes} />
            </div>
            <div className="mt-4 pt-4 border-t border-gray-100">
              <p className="text-xs text-gray-500">The assessment runs five specialized AI agents in parallel:</p>
              <ul className="text-xs text-gray-500 mt-2 space-y-1">
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />Founder Evaluator</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />Market Analyst</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />Unit Economics Inspector</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-blue-500" />Pattern Auditor</li>
                <li className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-red-500" />The Bear</li>
              </ul>
            </div>
          </div>
        </div>
      ) : (
        /* Assessment history */
        <>
          {loading ? (
            <div className="text-center py-12 text-gray-500 text-sm">Loading assessments...</div>
          ) : assessments.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 text-sm">No assessments yet</p>
              <button onClick={() => setShowNew(true)} className="text-blue-600 text-sm mt-2 hover:underline">Run your first assessment</button>
            </div>
          ) : (
            <div className="space-y-2">
              {assessments.map(a => (
                <Link key={a.id} to={`/assess/${a.id}`} className="card-hover block px-4 py-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {a.founder_name || 'Unnamed Opportunity'}
                        {a.founder_company && <span className="text-gray-500 ml-2">({a.founder_company})</span>}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{new Date(a.created_at).toLocaleDateString()}</p>
                    </div>
                    <span className={`badge ${SIGNAL_COLORS[a.overall_signal] || 'badge-gray'}`}>
                      {a.overall_signal || a.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function InputStatus({ label, active }) {
  return (
    <div className="flex items-center gap-2">
      <div className={`w-4 h-4 rounded-full flex items-center justify-center ${active ? 'bg-emerald-50' : 'bg-gray-100'}`}>
        {active && (
          <svg className="w-2.5 h-2.5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        )}
      </div>
      <span className={`text-sm ${active ? 'text-gray-700' : 'text-gray-400'}`}>{label}</span>
    </div>
  );
}
