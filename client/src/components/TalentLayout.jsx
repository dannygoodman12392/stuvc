import { NavLink, Outlet } from 'react-router-dom';

const TABS = [
  { to: '/talent', label: 'Home', end: true },
  { to: '/talent/portfolio', label: 'Companies' },
  { to: '/talent/roles', label: 'Roles' },
  { to: '/talent/candidates', label: 'Candidates' },
  { to: '/talent/matches', label: 'Matches' },
  { to: '/talent/criteria', label: 'Criteria' },
  { to: '/talent/trash', label: 'Trash' },
];

export default function TalentLayout() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 tracking-tight">Talent</h1>
        <p className="text-sm text-gray-500 mt-1">Cofounder & early-hire matching for portfolio founders</p>
      </div>
      <div className="flex items-center gap-1 border-b border-gray-200 -mx-5 md:-mx-8 px-5 md:px-8 mb-6 overflow-x-auto">
        {TABS.map(t => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
            className={({ isActive }) =>
              `px-3 py-2 text-[13px] font-medium border-b-2 transition-colors whitespace-nowrap ${
                isActive
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-500 hover:text-gray-900'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </div>
  );
}
