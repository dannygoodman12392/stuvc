import { useState, useEffect } from 'react';
import { NavLink, useMatch } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import DannyAI from './DannyAI';
import SearchPalette from './SearchPalette';
import StuLogo from './StuLogo';
import { api } from '../utils/api';

const navItems = [
  { to: '/ask', label: 'Ask Stu', accent: true },
  { to: '/', label: 'Pipeline' },
  { to: '/assess', label: 'Assess' },
  { to: '/portfolio', label: 'Portfolio', placeholder: true },
  { to: '/fund', label: 'Fund', placeholder: true },
];

export default function Layout({ children }) {
  const { user, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [founderData, setFounderData] = useState(null);

  // Detect founder detail page and load context for AI sidebar
  const founderMatch = useMatch('/founders/:id');
  useEffect(() => {
    if (founderMatch?.params?.id) {
      api.getFounder(founderMatch.params.id)
        .then(f => setFounderData(f))
        .catch(() => setFounderData(null));
    } else {
      setFounderData(null);
    }
  }, [founderMatch?.params?.id]);

  // Cmd+K listener
  useEffect(() => {
    function handleKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(o => !o);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-black/10 md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-[220px] bg-white border-r border-gray-200 flex flex-col transform transition-transform duration-200 ease-in-out md:relative md:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="px-4 py-4">
          <NavLink to="/" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
            <StuLogo size={28} />
            <div>
              <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Stu</span>
            </div>
          </NavLink>
        </div>

        {/* Search trigger */}
        <div className="px-3 mb-2">
          <button
            onClick={() => setSearchOpen(true)}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-400 hover:border-gray-300 hover:text-gray-500 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <span className="flex-1 text-left">Search...</span>
            <kbd className="text-[10px] bg-gray-100 px-1 py-0.5 rounded font-mono">{typeof navigator !== 'undefined' && navigator.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}K</kbd>
          </button>
        </div>

        <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.placeholder ? '#' : item.to}
              end={item.to === '/'}
              onClick={(e) => { if (item.placeholder) e.preventDefault(); setMobileOpen(false); }}
              className={({ isActive }) =>
                `flex items-center justify-between px-3 py-[7px] rounded-lg text-[13px] font-medium transition-colors ${
                  item.accent
                    ? isActive
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                    : isActive && !item.placeholder
                    ? 'bg-gray-100 text-gray-900'
                    : item.placeholder
                    ? 'text-gray-400 cursor-default'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`
              }
            >
              <span className="flex items-center gap-2">
                {item.accent && (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                )}
                {item.label}
              </span>
              {item.placeholder && (
                <span className="text-[10px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">Soon</span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* User */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-gray-900 flex items-center justify-center text-white text-[10px] font-semibold">
              {user?.name?.split(' ').map(n => n[0]).join('') || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-gray-900 truncate">{user?.name}</p>
            </div>
            <button onClick={logout} className="text-gray-400 hover:text-gray-600 transition-colors" title="Sign out">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile header */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-gray-200 flex-shrink-0">
          <button onClick={() => setMobileOpen(true)} className="p-1 text-gray-600">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="flex items-center gap-1.5">
            <StuLogo size={20} />
            <span className="text-sm font-semibold text-gray-900">Stu</span>
          </div>
          <button onClick={() => setAiOpen(!aiOpen)} className={`p-1 transition-colors ${aiOpen ? 'text-blue-600' : 'text-gray-400'}`}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
            </svg>
          </button>
        </header>

        <div className="flex-1 flex overflow-hidden">
          <main className="flex-1 overflow-y-auto bg-gray-50">
            <div className="max-w-5xl mx-auto px-5 py-8 md:px-8">
              {children}
            </div>
          </main>

          {/* Stu AI toggle */}
          <button
            onClick={() => setAiOpen(!aiOpen)}
            className={`hidden md:flex items-center justify-center w-10 flex-shrink-0 border-l transition-colors ${
              aiOpen ? 'bg-blue-50 border-gray-200 text-blue-600' : 'bg-white border-gray-200 text-gray-400 hover:text-blue-600'
            }`}
            title={founderData ? `Stu AI (${founderData.name})` : 'Toggle Stu AI'}
          >
            <div className="flex flex-col items-center gap-1">
              <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              {founderData && (
                <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              )}
            </div>
          </button>

          {aiOpen && <DannyAI onClose={() => setAiOpen(false)} founderData={founderData} />}
        </div>
      </div>

      {/* Global search */}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
