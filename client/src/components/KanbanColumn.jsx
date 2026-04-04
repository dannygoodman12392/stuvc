import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import KanbanCard from './KanbanCard';

const COLUMN_COLORS = {
  // Admissions
  'Sourced': { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' },
  'Outreach': { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  'First Call Scheduled': { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  'First Call Complete': { bg: 'bg-indigo-50', border: 'border-indigo-200', dot: 'bg-indigo-400' },
  'Second Call Scheduled': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400' },
  'Second Call Complete': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400' },
  'Admitted': { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-400' },
  'Active Resident': { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500' },
  'Density Resident': { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500' },
  'Alumni': { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' },
  'Hold/Nurture': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  'Not Admitted': { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-400' },
  // Investment
  'Under Consideration': { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  'First Meeting': { bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-400' },
  'Partner Call': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400' },
  'Memo Draft': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-400' },
  'IC Review': { bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-500' },
  'Committed': { bg: 'bg-green-50', border: 'border-green-200', dot: 'bg-green-500' },
  'Passed': { bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-400' },
};

export default function KanbanColumn({ stage, founders, track, onAddToInvestment }) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const colors = COLUMN_COLORS[stage] || { bg: 'bg-gray-50', border: 'border-gray-200', dot: 'bg-gray-400' };
  const founderIds = founders.map(f => f.id);

  return (
    <div
      className={`flex flex-col min-w-[260px] max-w-[280px] flex-shrink-0 rounded-xl ${colors.bg} border ${colors.border} ${
        isOver ? 'ring-2 ring-blue-400 ring-offset-1' : ''
      } transition-all`}
    >
      {/* Column header */}
      <div className="px-3 py-2.5 border-b border-white/50">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${colors.dot}`} />
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider truncate">
              {stage}
            </h3>
          </div>
          <span className="text-xs font-bold text-gray-500 bg-white/80 px-1.5 py-0.5 rounded">
            {founders.length}
          </span>
        </div>
      </div>

      {/* Cards */}
      <div ref={setNodeRef} className="flex-1 p-2 space-y-2 overflow-y-auto min-h-[80px] max-h-[calc(100vh-280px)]">
        <SortableContext items={founderIds} strategy={verticalListSortingStrategy}>
          {founders.map(f => (
            <KanbanCard
              key={f.id}
              founder={f}
              track={track}
              onAddToInvestment={onAddToInvestment}
            />
          ))}
        </SortableContext>
        {founders.length === 0 && (
          <div className="text-center py-6 text-xs text-gray-400">
            Drop here
          </div>
        )}
      </div>
    </div>
  );
}
