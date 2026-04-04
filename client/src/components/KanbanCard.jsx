import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Link } from 'react-router-dom';

const DEAL_COLORS = {
  'Under Consideration': 'bg-blue-50 text-blue-600',
  'First Meeting': 'bg-blue-50 text-blue-600',
  'Partner Call': 'bg-amber-50 text-amber-600',
  'Memo Draft': 'bg-amber-50 text-amber-600',
  'IC Review': 'bg-amber-50 text-amber-600',
  'Committed': 'bg-green-50 text-green-600',
  'Passed': 'bg-red-50 text-red-600',
};

export default function KanbanCard({ founder, track, onAddToInvestment, isDragging: externalDragging }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: founder.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const tracks = (founder.pipeline_tracks || '').split(',').filter(Boolean);
  const initials = founder.name?.split(' ').map(n => n[0]).join('').slice(0, 2) || '?';

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded-lg border border-gray-200 p-3 shadow-sm cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow ${
        isDragging ? 'shadow-lg ring-2 ring-blue-400' : ''
      }`}
      {...attributes}
      {...listeners}
    >
      {/* Header: avatar + name */}
      <div className="flex items-start gap-2.5">
        <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600 flex-shrink-0 mt-0.5">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate leading-tight">{founder.name}</p>
          {founder.company && (
            <p className="text-xs text-gray-500 truncate">{founder.company}</p>
          )}
        </div>
        {founder.fit_score && (
          <span className={`text-xs font-bold flex-shrink-0 ${
            founder.fit_score >= 8 ? 'text-emerald-600' : founder.fit_score >= 6 ? 'text-amber-600' : 'text-gray-400'
          }`}>
            {founder.fit_score}/10
          </span>
        )}
      </div>

      {/* One-liner */}
      {founder.company_one_liner && (
        <p className="text-[11px] text-gray-400 mt-1.5 line-clamp-2 leading-snug">{founder.company_one_liner}</p>
      )}

      {/* Footer: badges + actions */}
      <div className="flex items-center justify-between mt-2 gap-1">
        <div className="flex items-center gap-1 min-w-0">
          {/* Cross-track badge */}
          {track === 'admissions' && tracks.includes('investment') && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600 uppercase tracking-wider flex-shrink-0">
              +Invest
            </span>
          )}
          {track === 'investment' && tracks.includes('admissions') && founder.admissions_status && (
            <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 uppercase tracking-wider truncate">
              {founder.admissions_status}
            </span>
          )}
          {/* Deal info on investment cards */}
          {track === 'investment' && founder.deal_status && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider flex-shrink-0 ${
              DEAL_COLORS[founder.deal_status] || 'bg-gray-50 text-gray-500'
            }`}>
              {founder.deal_status}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Add to investment button */}
          {track === 'admissions' && !tracks.includes('investment') && onAddToInvestment && (
            <button
              onClick={(e) => { e.stopPropagation(); onAddToInvestment(founder.id); }}
              onPointerDown={(e) => e.stopPropagation()}
              className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-emerald-200 text-emerald-600 hover:bg-emerald-50 transition-colors"
              title="Add to Investment Pipeline"
            >
              +Deal
            </button>
          )}
          {/* View link */}
          <Link
            to={`/founders/${founder.id}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            className="text-[9px] font-medium px-1.5 py-0.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors"
          >
            View
          </Link>
        </div>
      </div>

      {/* Next action */}
      {founder.next_action && (
        <div className="mt-1.5 text-[10px] text-gray-400 truncate border-t border-gray-50 pt-1.5">
          Next: {founder.next_action}
        </div>
      )}
    </div>
  );
}
