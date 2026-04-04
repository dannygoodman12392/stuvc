import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../utils/api';

export default function DealRoom() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDeals();
  }, []);

  async function loadDeals() {
    try {
      const d = await api.getDeals();
      setDeals(d);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }

  const DECISION_COLORS = {
    invested: 'badge-green',
    passed: 'badge-red',
    pending: 'badge-amber',
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Deal Room</h1>
          <p className="text-sm text-gray-500 mt-0.5">IC prep, decision logging, and deal tracking</p>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500 text-sm">Loading deals...</div>
      ) : deals.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-16 h-16 rounded-2xl bg-gray-50 border border-gray-200 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 0h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
            </svg>
          </div>
          <p className="text-gray-500 text-sm mb-1">No active deals yet</p>
          <p className="text-xs text-gray-400">Deals are created when founders reach IC Ready status with a completed assessment.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deals.map(d => (
            <div key={d.id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">{d.founder_name}</p>
                  {d.founder_company && <p className="text-xs text-gray-500">{d.founder_company}</p>}
                </div>
                <span className={`badge ${DECISION_COLORS[d.decision] || 'badge-gray'}`}>{d.decision}</span>
              </div>

              {d.overall_signal && (
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs text-gray-500">Assessment:</span>
                  <span className={`text-xs font-medium ${d.overall_signal === 'Invest' ? 'text-emerald-600' : d.overall_signal === 'Monitor' ? 'text-amber-600' : 'text-red-600'}`}>
                    {d.overall_signal}
                  </span>
                </div>
              )}

              {d.round_terms && (() => {
                try {
                  const terms = JSON.parse(d.round_terms);
                  return (
                    <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                      {terms.instrument && <div><span className="text-gray-500">Instrument:</span> <span className="text-gray-700">{terms.instrument}</span></div>}
                      {terms.post_money && <div><span className="text-gray-500">Post-money:</span> <span className="text-gray-700">{terms.post_money}</span></div>}
                      {terms.check_size && <div><span className="text-gray-500">Check:</span> <span className="text-gray-700">{terms.check_size}</span></div>}
                    </div>
                  );
                } catch { return null; }
              })()}

              <div className="flex gap-2 pt-3 border-t border-gray-100">
                {d.assessment_id && (
                  <Link to={`/assess/${d.assessment_id}`} className="text-xs text-blue-600 hover:underline">View Assessment</Link>
                )}
                <Link to={`/founders/${d.founder_id}`} className="text-xs text-blue-600 hover:underline">Founder Profile</Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
