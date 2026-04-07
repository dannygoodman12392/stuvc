import { useState, useRef, useCallback } from 'react';
import { api } from '../utils/api';

const FIELD_OPTIONS = [
  { value: '', label: 'Skip' },
  { value: 'name', label: 'Name' },
  { value: 'company', label: 'Company' },
  { value: 'role', label: 'Role / Title' },
  { value: 'email', label: 'Email' },
  { value: 'linkedin_url', label: 'LinkedIn URL' },
  { value: 'twitter', label: 'Twitter / X' },
  { value: 'github_url', label: 'GitHub URL' },
  { value: 'website_url', label: 'Website' },
  { value: 'location_city', label: 'City / Location' },
  { value: 'location_state', label: 'State / Region' },
  { value: 'domain', label: 'Domain / Sector' },
  { value: 'stage', label: 'Funding Stage' },
  { value: 'tags', label: 'Tags' },
  { value: 'company_one_liner', label: 'Company Description' },
  { value: 'bio', label: 'Bio / Notes' },
  { value: 'source', label: 'Source / Referral' },
  { value: 'fit_score', label: 'Fit Score' },
  { value: 'previous_companies', label: 'Previous Companies' },
  { value: 'notable_background', label: 'Notable Background' },
];

export default function ImportFoundersModal({ onClose, onImportComplete }) {
  const [step, setStep] = useState('upload'); // upload | mapping | preview | importing | done
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  // Data state
  const [fileType, setFileType] = useState('');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState([]);
  const [mappings, setMappings] = useState({});
  const [rows, setRows] = useState([]);
  const [editingCell, setEditingCell] = useState(null);
  const [removedRows, setRemovedRows] = useState(new Set());
  const [result, setResult] = useState(null);
  const [enriching, setEnriching] = useState(false);

  // Upload handler
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!['csv', 'pdf'].includes(ext)) {
      setError('Only CSV and PDF files are supported');
      return;
    }
    setError('');
    setUploading(true);
    try {
      const data = await api.uploadFile(file);
      setFileType(data.type);
      setFileName(data.fileName);
      setHeaders(data.headers);
      setMappings(data.mappings);
      setRows(data.rows);
      setRemovedRows(new Set());

      // CSV → show mapping step. PDF → skip to preview (already mapped by Claude)
      setStep(data.type === 'csv' && data.headers.length > 0 ? 'mapping' : 'preview');
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }, []);

  // Drag & drop
  const onDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Mapping change
  const updateMapping = (header, field) => {
    setMappings(prev => ({ ...prev, [header]: field || null }));
  };

  // Apply mapping and go to preview
  const applyMapping = async () => {
    setError('');
    try {
      const data = await api.remapImport(rows, mappings);
      setRows(data.rows);
      setStep('preview');
    } catch (err) {
      setError(err.message);
    }
  };

  // Edit a cell in preview
  const handleCellEdit = (rowIdx, field, value) => {
    setRows(prev => prev.map((r, i) => i === rowIdx ? { ...r, [field]: value } : r));
    setEditingCell(null);
  };

  // Remove a row
  const toggleRemoveRow = (idx) => {
    setRemovedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  // Confirm import
  const handleImport = async () => {
    const founders = rows.filter((_, i) => !removedRows.has(i)).map(r => {
      const { _row, _raw, ...fields } = r;
      return fields;
    });

    if (founders.length === 0) {
      setError('No founders to import');
      return;
    }

    setImporting(true);
    setError('');
    try {
      const res = await api.confirmImport(founders, `${fileType}-import`);
      setResult(res);
      setStep('done');
    } catch (err) {
      setError(err.message);
    } finally {
      setImporting(false);
    }
  };

  // Trigger enrichment
  const handleEnrich = async () => {
    setEnriching(true);
    try {
      await api.enrichImported();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnriching(false);
    }
  };

  const activeRows = rows.filter((_, i) => !removedRows.has(i));

  // Preview columns — show only fields that have data
  const previewFields = (() => {
    const seen = new Set();
    for (const row of activeRows) {
      for (const [k, v] of Object.entries(row)) {
        if (!k.startsWith('_') && v) seen.add(k);
      }
    }
    return FIELD_OPTIONS.filter(f => f.value && seen.has(f.value));
  })();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Import Founders</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {step === 'upload' && 'Upload a CSV or PDF to import founder data'}
              {step === 'mapping' && `Map columns from ${fileName}`}
              {step === 'preview' && `Review ${activeRows.length} founders before importing`}
              {step === 'importing' && 'Importing...'}
              {step === 'done' && 'Import complete'}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-auto p-6">

          {/* STEP: Upload */}
          {step === 'upload' && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors cursor-pointer ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.pdf"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              {uploading ? (
                <div className="space-y-3">
                  <div className="w-8 h-8 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin mx-auto" />
                  <p className="text-sm text-gray-500">
                    {fileName?.endsWith('.pdf') ? 'Extracting founder data with AI...' : 'Parsing file...'}
                  </p>
                </div>
              ) : (
                <>
                  <svg className="w-12 h-12 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-sm font-medium text-gray-700 mb-1">Drop a file here or click to browse</p>
                  <p className="text-xs text-gray-400">CSV or PDF up to 10MB</p>
                  <div className="flex items-center justify-center gap-4 mt-6 text-xs text-gray-400">
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3.375 19.5h17.25m-17.25 0a1.125 1.125 0 01-1.125-1.125M3.375 19.5h7.5c.621 0 1.125-.504 1.125-1.125m-9.75 0V5.625m0 12.75v-1.5c0-.621.504-1.125 1.125-1.125m18.375 2.625V5.625m0 12.75c0 .621-.504 1.125-1.125 1.125m1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125m0 3.75h-7.5A1.125 1.125 0 0112 18.375m9.75-12.75c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125m19.5 0v1.5c0 .621-.504 1.125-1.125 1.125M2.25 5.625v1.5c0 .621.504 1.125 1.125 1.125m0 0h17.25m-17.25 0h7.5c.621 0 1.125.504 1.125 1.125M3.375 8.25c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125m17.25-3.75h-7.5c-.621 0-1.125.504-1.125 1.125m8.625-1.125c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M12 10.875v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 10.875c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125M13.125 12h7.5m-7.5 0c-.621 0-1.125.504-1.125 1.125M20.625 12c.621 0 1.125.504 1.125 1.125v1.5c0 .621-.504 1.125-1.125 1.125m-17.25 0h7.5M12 14.625v-1.5m0 1.5c0 .621-.504 1.125-1.125 1.125M12 14.625c0 .621.504 1.125 1.125 1.125m-2.25 0c.621 0 1.125.504 1.125 1.125m0 0v1.5c0 .621-.504 1.125-1.125 1.125" /></svg>
                      CSV — auto-maps columns
                    </span>
                    <span className="flex items-center gap-1.5">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                      PDF — AI extracts data
                    </span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* STEP: Column Mapping (CSV only) */}
          {step === 'mapping' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                {headers.map(header => (
                  <div key={header} className="flex items-center gap-3 bg-gray-50 rounded-lg px-3 py-2">
                    <span className="text-sm text-gray-600 font-mono truncate flex-1" title={header}>{header}</span>
                    <svg className="w-4 h-4 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                    </svg>
                    <select
                      value={mappings[header] || ''}
                      onChange={(e) => updateMapping(header, e.target.value)}
                      className="text-sm border border-gray-200 rounded-md px-2 py-1 bg-white min-w-[140px]"
                    >
                      {FIELD_OPTIONS.map(f => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <button onClick={() => setStep('upload')} className="btn-ghost text-sm">
                  Back
                </button>
                <button onClick={applyMapping} className="btn-primary text-sm">
                  Preview {rows.length} Rows
                </button>
              </div>
            </div>
          )}

          {/* STEP: Preview */}
          {step === 'preview' && (
            <div className="space-y-4">
              {/* Stats bar */}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>{activeRows.length} founders to import</span>
                {removedRows.size > 0 && (
                  <span className="text-amber-600">{removedRows.size} removed</span>
                )}
                <span className="text-gray-300">Click any cell to edit</span>
              </div>

              {/* Table */}
              <div className="border border-gray-200 rounded-lg overflow-auto max-h-[50vh]">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 w-8">#</th>
                      {previewFields.map(f => (
                        <th key={f.value} className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                          {f.label}
                        </th>
                      ))}
                      <th className="px-2 py-2 w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {rows.map((row, idx) => {
                      const removed = removedRows.has(idx);
                      return (
                        <tr key={idx} className={`${removed ? 'opacity-30 bg-red-50' : 'hover:bg-gray-50'} transition-opacity`}>
                          <td className="px-2 py-1.5 text-xs text-gray-400">{idx + 1}</td>
                          {previewFields.map(f => {
                            const isEditing = editingCell?.row === idx && editingCell?.field === f.value;
                            return (
                              <td key={f.value} className="px-3 py-1.5 max-w-[200px]">
                                {isEditing ? (
                                  <input
                                    autoFocus
                                    defaultValue={row[f.value] || ''}
                                    className="w-full text-sm border border-blue-400 rounded px-1.5 py-0.5 outline-none"
                                    onBlur={(e) => handleCellEdit(idx, f.value, e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') handleCellEdit(idx, f.value, e.target.value);
                                      if (e.key === 'Escape') setEditingCell(null);
                                    }}
                                  />
                                ) : (
                                  <span
                                    onClick={() => !removed && setEditingCell({ row: idx, field: f.value })}
                                    className={`block truncate cursor-text ${row[f.value] ? 'text-gray-900' : 'text-gray-300 italic'}`}
                                    title={row[f.value] || ''}
                                  >
                                    {row[f.value] || '-'}
                                  </span>
                                )}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5">
                            <button
                              onClick={() => toggleRemoveRow(idx)}
                              className={`p-1 rounded transition-colors ${removed ? 'text-green-500 hover:text-green-700' : 'text-gray-300 hover:text-red-500'}`}
                              title={removed ? 'Restore' : 'Remove'}
                            >
                              {removed ? (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                                </svg>
                              ) : (
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              )}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                <button onClick={() => setStep(fileType === 'csv' ? 'mapping' : 'upload')} className="btn-ghost text-sm">
                  Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={importing || activeRows.length === 0}
                  className="btn-accent text-sm disabled:opacity-50"
                >
                  {importing ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Importing...
                    </span>
                  ) : (
                    `Import ${activeRows.length} Founder${activeRows.length !== 1 ? 's' : ''}`
                  )}
                </button>
              </div>
            </div>
          )}

          {/* STEP: Done */}
          {step === 'done' && result && (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
                <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>

              <div>
                <p className="text-lg font-bold text-gray-900">{result.imported} founder{result.imported !== 1 ? 's' : ''} imported</p>
                {result.skipped > 0 && (
                  <p className="text-sm text-gray-500 mt-1">
                    {result.skipped} skipped
                    {result.duplicates?.length > 0 && ` (${result.duplicates.length} duplicate${result.duplicates.length !== 1 ? 's' : ''})`}
                  </p>
                )}
              </div>

              {result.duplicates?.length > 0 && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-left max-w-md mx-auto">
                  <p className="text-xs font-medium text-amber-700 mb-1">Duplicates skipped:</p>
                  <p className="text-xs text-amber-600">{result.duplicates.join(', ')}</p>
                </div>
              )}

              <div className="flex items-center justify-center gap-3 pt-4">
                <button
                  onClick={handleEnrich}
                  disabled={enriching}
                  className="btn-primary text-sm"
                >
                  {enriching ? 'Enriching...' : 'Enrich with LinkedIn Data'}
                </button>
                <button
                  onClick={() => { onImportComplete?.(); onClose(); }}
                  className="btn-ghost text-sm"
                >
                  Done
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Enrichment fills in bios, work history, and location from LinkedIn profiles.
                <br />Requires an EnrichLayer API key in Settings.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
