import { useState } from 'react';

export default function TagInput({ tags = [], onChange, placeholder, accent = 'gray' }) {
  const [value, setValue] = useState('');

  function commit() {
    const trimmed = value.trim();
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed]);
    }
    setValue('');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && !value && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  }

  function removeAt(i) {
    onChange(tags.filter((_, idx) => idx !== i));
  }

  const chipClass = accent === 'amber'
    ? 'bg-amber-50 text-amber-800'
    : 'bg-gray-100 text-gray-700';
  const focusClass = accent === 'amber'
    ? 'focus-within:border-amber-400 focus-within:ring-amber-500/10'
    : 'focus-within:border-blue-400 focus-within:ring-blue-500/10';

  return (
    <div className={`flex flex-wrap items-center gap-1.5 p-2 min-h-[42px] bg-white border border-gray-200 rounded-lg ${focusClass} focus-within:ring-2 transition-all`}>
      {tags.map((tag, i) => (
        <span key={i} className={`inline-flex items-center gap-1 px-2.5 py-1 text-sm rounded-md ${chipClass}`}>
          {tag}
          <button type="button" onClick={() => removeAt(i)} className="text-current/60 hover:text-current ml-0.5 opacity-60 hover:opacity-100">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </span>
      ))}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={tags.length === 0 ? placeholder : 'Add...'}
        className="flex-1 min-w-[120px] text-sm text-gray-900 placeholder-gray-400 outline-none bg-transparent py-1 px-1"
      />
    </div>
  );
}
