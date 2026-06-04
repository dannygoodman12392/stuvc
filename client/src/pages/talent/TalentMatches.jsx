import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../utils/api';
import { useToast } from '../../components/Toast';
import { PageHeader, FilterBar, FilterSelect, RankedList, Row, Score, Tag, DetailPanel, DetailSection, EmptyState } from '../../components/ui';

export default function TalentMatches() {
  // Role/company scope lives in the URL so the queue is shareable and reachable from a role page.
  const [searchParams, setSearchParams] = useSearchParams();
  const roleId = searchParams.get('role') || '';
  const companyId = searchParams.get('company') || '';

  const [matches, setMatches] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('suggested');
  const [minScore, setMinScore] = useState('');
  const [roles, setRoles] = useState([]);
  const [companies, setCompanies] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const [r, c] = await Promise.all([api.getTalentRoles(), api.getTalentPortfolio()]);
        setRoles(Array.isArray(r) ? r : []);
        setCompanies(Array.isArray(c) ? c : []);
      } catch { /* non-fatal */ }
    })();
  }, []);

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [status, minScore, roleId, companyId]);

  async function load() {
    setLoading(true);
    try {
      const params = {};
      if (status !== 'all') params.status = status;
      if (minScore) params.minScore = minScore;
      if (roleId) params.role_id = roleId;
      if (companyId) params.company_id = companyId;
      const scope = {};
      if (roleId) scope.role_id = roleId;
      if (companyId) scope.company_id = companyId;
      const [rows, s] = await Promise.all([api.getTalentMatches(params), api.getTalentMatchStats(scope)]);
      setMatches(rows);
      setStats(s);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setLoading(false);
    }
  }

  function setScope(key, value) {
    const next = new URLSearchParams(searchParams);
    if (value && value !== 'all') next.set(key, value); else next.delete(key);
    if (key === 'company') next.delete('role');
    setSearchParams(next, { replace: true });
    setSelectedId(null);
  }

  async function setMatchStatus(id, newStatus, closeIfSelected) {
    try {
      await api.updateTalentMatch(id, { status: newStatus });
      setMatches(ms => ms.filter(m => m.id !== id || status === 'all'));
      if (status === 'all') setMatches(ms => ms.map(m => m.id === id ? { ...m, status: newStatus } : m));
      if (closeIfSelected && id === selectedId) {
        const idx = matches.findIndex(m => m.id === id);
        const next = matches[idx + 1];
        setSelectedId(next ? next.id : null);
      }
      toast({ message: newStatus === 'shortlisted' ? 'Shortlisted' : newStatus === 'passed' ? 'Passed' : 'Updated', duration: 1500 });
    } catch (err) { toast({ message: err.message, tone: 'error' }); }
  }

  const scopedRole = roleId ? roles.find(r => String(r.id) === String(roleId)) : null;
  const roleOptions = companyId ? roles.filter(r => String(r.portfolio_company_id) === String(companyId)) : roles;

  const subtitle = scopedRole
    ? `${scopedRole.title}${scopedRole.company_name ? ` · ${scopedRole.company_name}` : ''} — ranked candidates to share with the founder.`
    : 'Pick a company and role to see ranked, best-fit candidates for it.';

  const idx = matches.findIndex(m => m.id === selectedId);
  const selected = idx >= 0 ? matches[idx] : null;
  const parseArr = (v) => Array.isArray(v) ? v : (() => { try { const x = JSON.parse(v || '[]'); return Array.isArray(x) ? x : []; } catch { return []; } })();

  return (
    <div>
      <PageHeader
        title="Talent"
        subtitle={subtitle}
        actions={
          <>
            {scopedRole && <Link to={`/talent/roles/${roleId}`} className="btn-secondary text-sm">Edit role / JD</Link>}
            <Link to="/talent" className="btn-secondary text-sm">Companies & roles</Link>
          </>
        }
      />

      <FilterBar resultCount={matches.length} dirty={!!(companyId || roleId || minScore || status !== 'suggested')} onClearAll={() => { setSearchParams(new URLSearchParams(), { replace: true }); setStatus('suggested'); setMinScore(''); }}>
        <FilterSelect label="Company" value={companyId || 'all'} onChange={(v) => setScope('company', v)}
          options={[{ value: 'all', label: 'All companies' }, ...companies.map(c => ({ value: String(c.id), label: c.name }))]} />
        <FilterSelect label="Role" value={roleId || 'all'} onChange={(v) => setScope('role', v)}
          options={[{ value: 'all', label: companyId ? 'All roles at company' : 'All roles' }, ...roleOptions.map(r => ({ value: String(r.id), label: `${r.title}${!companyId && r.company_name ? ` · ${r.company_name}` : ''}` }))]} />
        <FilterSelect label="Status" value={status} onChange={setStatus}
          options={[{ value: 'suggested', label: `New${stats.suggested != null ? ` (${stats.suggested})` : ''}` }, { value: 'shortlisted', label: `Shortlisted${stats.shortlisted != null ? ` (${stats.shortlisted})` : ''}` }, { value: 'in_process', label: 'In process' }, { value: 'passed', label: 'Passed' }, { value: 'all', label: 'All' }]} />
        <FilterSelect label="Match" value={minScore || 'all'} onChange={(v) => setMinScore(v === 'all' ? '' : v)}
          options={[{ value: 'all', label: 'Any match' }, { value: '80', label: '80+' }, { value: '65', label: '65+' }, { value: '50', label: '50+' }]} />
      </FilterBar>

      <RankedList
        items={matches}
        loading={loading}
        emptyState={<EmptyState title={scopedRole ? 'No candidates match this role yet' : 'Pick a company and role'} description={scopedRole ? 'Broaden the match filter, or re-source from the role page.' : 'Choose a company and role above to see its ranked shortlist.'} />}
        renderRow={(m) => (
          <Row
            key={m.id}
            title={m.candidate_name}
            subtitle={`${m.current_role || m.headline || ''}${m.current_company ? ` · ${m.current_company}` : ''}${m.location_city ? ` · ${m.location_city}` : ''}`}
            score={<Score value={m.match_score} max={100} label="Match" />}
            meta={<>{!roleId && m.role_title && <Tag>{m.role_title}</Tag>}{m.role_band && <Tag>Band {m.role_band}</Tag>}{m.status !== 'suggested' && <Tag>{m.status.replace('_', ' ')}</Tag>}</>}
            selected={m.id === selectedId}
            onClick={() => setSelectedId(m.id)}
            trailing={
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100">
                <button onClick={(e) => { e.stopPropagation(); setMatchStatus(m.id, 'shortlisted'); }} className="text-xs font-medium px-2 py-1 rounded-md bg-accent text-white hover:bg-accent-hover">Shortlist</button>
                <button onClick={(e) => { e.stopPropagation(); setMatchStatus(m.id, 'passed'); }} className="text-xs font-medium px-2 py-1 rounded-md text-danger hover:bg-danger-soft border border-gray-200">Pass</button>
              </div>
            }
          />
        )}
      />

      {selected && (
        <DetailPanel
          open={!!selected}
          onClose={() => setSelectedId(null)}
          title={selected.candidate_name}
          subtitle={`${selected.current_role || selected.headline || ''}${selected.current_company ? ` · ${selected.current_company}` : ''} · Match ${selected.match_score}/100`}
          onPrev={idx > 0 ? () => setSelectedId(matches[idx - 1].id) : null}
          onNext={idx < matches.length - 1 ? () => setSelectedId(matches[idx + 1].id) : null}
          primaryAction={{ label: 'Add to shortlist', onClick: () => setMatchStatus(selected.id, 'shortlisted', true), tone: 'accent' }}
          secondaryActions={[
            { label: 'Pass', onClick: () => setMatchStatus(selected.id, 'passed', true), tone: 'danger' },
          ]}
        >
          <div className="flex items-center gap-3 mb-5">
            {selected.linkedin_url && <a href={selected.linkedin_url} target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:text-accent-hover">LinkedIn ↗</a>}
            {selected.github_url && <a href={selected.github_url} target="_blank" rel="noopener" className="text-sm font-medium text-accent hover:text-accent-hover">GitHub ↗</a>}
            <Link to={`/talent/candidates/${selected.candidate_id}`} className="text-sm font-medium text-accent hover:text-accent-hover">Full profile →</Link>
          </div>

          {!roleId && selected.role_title && (
            <DetailSection label="For role">{selected.role_title}{selected.company_name ? ` · ${selected.company_name}` : ''}</DetailSection>
          )}
          {selected.match_rationale && <DetailSection label="Why this match">{selected.match_rationale}</DetailSection>}
          {parseArr(selected.strengths).length > 0 && (
            <DetailSection label="Strengths">
              <ul className="space-y-1">{parseArr(selected.strengths).map((s, i) => <li key={i} className="flex gap-2"><span className="text-gray-300">+</span><span>{s}</span></li>)}</ul>
            </DetailSection>
          )}
          {parseArr(selected.gaps).length > 0 && (
            <DetailSection label="Gaps">
              <ul className="space-y-1">{parseArr(selected.gaps).map((s, i) => <li key={i} className="flex gap-2"><span className="text-gray-300">–</span><span>{s}</span></li>)}</ul>
            </DetailSection>
          )}
          {parseArr(selected.candidate_pedigree).length > 0 && (
            <DetailSection label="Background">
              <div className="flex flex-wrap gap-1.5">{parseArr(selected.candidate_pedigree).map((s, i) => <Tag key={i}>{s}</Tag>)}</div>
            </DetailSection>
          )}
        </DetailPanel>
      )}
    </div>
  );
}
