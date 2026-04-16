import { useState, useEffect } from 'react';
import { api } from '../../utils/api';
import TagInput from '../../components/TagInput';
import { useToast } from '../../components/Toast';

const SECTIONS = [
  { key: 'talent_bands', label: 'Talent Bands', hint: "Bands you source for. A = cofounder/founding eng, B = first-5 hire, C = domain expert." },
  { key: 'talent_locations', label: 'Target Locations', hint: 'Cities or regions candidates should be in (or open to). Use "Remote" for location-flexible.' },
  { key: 'talent_schools', label: 'Target Schools', hint: 'Schools that signal pedigree. Works as a soft signal, not a filter.' },
  { key: 'talent_companies', label: 'Target Companies', hint: 'Companies whose alumni you want to surface (ex-Stripe, ex-Citadel, ex-Tempus, etc).' },
  { key: 'talent_stacks', label: 'Tech Stacks', hint: 'Stacks/frameworks your portfolio needs (e.g., Python, Rust, React, PyTorch, CUDA).' },
  { key: 'talent_domains', label: 'Focus Domains', hint: 'Verticals / problem areas (AI/ML, Vertical AI, Fintech, Healthtech, DevTools, etc).' },
  { key: 'talent_leap_signals', label: 'Leap-Readiness Signals', hint: 'Signals a candidate is ready to leave their job (tenure 2–4y, OSS maintainer, side project momentum).' },
  { key: 'talent_custom_queries', label: 'Custom Exa Queries', hint: 'Freeform semantic queries fed directly into Exa (one per line).' },
];

export default function TalentCriteria() {
  const [data, setData] = useState(null);
  const [savingKey, setSavingKey] = useState(null);
  const { toast } = useToast();

  useEffect(() => { load(); }, []);

  async function load() {
    try {
      const d = await api.getTalentCriteria('global');
      setData(d);
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    }
  }

  async function save(key, value) {
    setSavingKey(key);
    try {
      await api.updateTalentCriteria(key, value, 'global');
      setData(prev => ({ ...prev, [key]: value }));
      toast({ message: 'Saved', duration: 2000 });
    } catch (err) {
      toast({ message: err.message, tone: 'error' });
    } finally {
      setSavingKey(null);
    }
  }

  if (!data) return <div className="text-sm text-gray-400">Loading...</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Sourcing criteria</h1>
        <p className="text-sm text-gray-500 mt-1">
          These parameters drive daily Exa + GitHub sourcing and candidate scoring. Changes take effect on the next run.
        </p>
      </div>

      {SECTIONS.map(section => {
        const value = Array.isArray(data[section.key]) ? data[section.key] : [];
        const isSaving = savingKey === section.key;
        return (
          <div key={section.key} className="card p-5">
            <div className="flex items-baseline justify-between mb-1">
              <label className="text-sm font-semibold text-gray-900">{section.label}</label>
              <span className="text-[10px] uppercase tracking-wide text-gray-400 tabular-nums">
                {isSaving ? 'saving…' : `${value.length} item${value.length === 1 ? '' : 's'}`}
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-3">{section.hint}</p>
            <TagInput
              tags={value}
              onChange={(next) => save(section.key, next)}
              placeholder={`Add ${section.label.toLowerCase()}...`}
              accent="amber"
            />
          </div>
        );
      })}

      <div className="text-xs text-gray-400 pt-2">
        Tip: Press Enter or comma to add a tag. Backspace on an empty input removes the last tag.
      </div>
    </div>
  );
}
