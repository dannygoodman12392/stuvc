import { useEffect, useState, createContext, useContext, useCallback } from 'react';

const ToastCtx = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  const toast = useCallback(({ message, actionLabel, onAction, duration = 5000, tone = 'default' }) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(t => [...t, { id, message, actionLabel, onAction, tone }]);
    if (duration > 0) {
      setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  return (
    <ToastCtx.Provider value={{ toast, dismiss }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-center gap-3 px-4 py-2.5 rounded-lg shadow-lg border text-sm min-w-[320px] ${
              t.tone === 'error'
                ? 'bg-red-600 text-white border-red-700'
                : 'bg-gray-900 text-white border-gray-800'
            }`}
          >
            <span className="flex-1">{t.message}</span>
            {t.actionLabel && (
              <button
                onClick={() => { t.onAction?.(); dismiss(t.id); }}
                className="text-white/90 hover:text-white font-semibold text-xs uppercase tracking-wide"
              >
                {t.actionLabel}
              </button>
            )}
            <button onClick={() => dismiss(t.id)} className="text-white/50 hover:text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) return { toast: () => {}, dismiss: () => {} };
  return ctx;
}
