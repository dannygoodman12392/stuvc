import { useState, useMemo } from 'react';
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, useSensor, useSensors,
  closestCorners, useDroppable, useDraggable,
} from '@dnd-kit/core';
import { useNavigate } from 'react-router-dom';

// ══════════════════════════════════════════════════════════════════════════
// The board. Move companies you already know through your deal stages.
//
// Rewritten onto the design system. What it replaced had colored columns (blue,
// yellow), avatar circles, colored badges, and cards so tall only three fit on a
// screen — and it led with the PERSON's name on a board of COMPANIES.
//
// Three rules it now obeys:
//   · Color means state, never decoration. The columns are hairlines and ground.
//     A stage is a POSITION, and position is already the signal; painting it too
//     says the same thing twice in a louder voice.
//   · One primary ink per card — the company. The founder recedes.
//   · A stage badge on a card sitting in that stage's column is one bit of
//     information printed twice. Gone.
//
// ── THE (NO STAGE) COLUMN IS NOT A STYLE CHOICE ──
// 31 of 105 companies on the investment track have deal_status = NULL. The old
// board did `f[stageField] || stages[0]` and silently dumped every one of them
// into "Under Consideration" — which is why that column read 71 when only 40
// companies actually carry that status. That is the same failure as a going-cold
// clock computed off an import date: an absence rendered as a definite state.
// They get their own column, and it says what they are.
// ══════════════════════════════════════════════════════════════════════════

const NO_STAGE = '(no stage)';

export default function KanbanBoard({ founders, stages, track, onStageChange }) {
  const [activeId, setActiveId] = useState(null);
  const nav = useNavigate();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } })
  );

  const stageField = track === 'investment' ? 'deal_status' : 'admissions_status';

  const { columns, order } = useMemo(() => {
    const grouped = { [NO_STAGE]: [] };
    for (const s of stages) grouped[s] = [];
    for (const f of founders) {
      const s = f[stageField];
      if (!s) grouped[NO_STAGE].push(f);
      else if (grouped[s]) grouped[s].push(f);
      else grouped[s] = [f]; // a stage not in the canonical list still shows itself
    }
    const keys = Object.keys(grouped).filter((k) => k !== NO_STAGE);
    // Unstaged leads only when it has something in it — it's a prompt, not a lane.
    return { columns: grouped, order: grouped[NO_STAGE].length ? [NO_STAGE, ...keys] : keys };
  }, [founders, stages, stageField]);

  const active = activeId ? founders.find((f) => String(f.id) === String(activeId)) : null;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragEnd={(e) => {
        setActiveId(null);
        const { active: a, over } = e;
        if (!over) return;
        const to = String(over.id);
        const f = founders.find((x) => String(x.id) === String(a.id));
        // Dropping into (no stage) would mean "un-decide", which isn't a thing you
        // do on purpose. And a no-op drag must never fire a write.
        if (!f || to === NO_STAGE || f[stageField] === to) return;
        onStageChange(f.id, to);
      }}
    >
      <div className="flex gap-2 items-start h-full">
        {order.map((stage) => (
          <Column
            key={stage}
            id={stage}
            rows={columns[stage]}
            unstaged={stage === NO_STAGE}
            onOpen={(id) => nav(`/founders/${id}`)}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>{active ? <Card row={active} dragging /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ id, rows, unstaged, onOpen }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={`w-[220px] flex-none flex flex-col rounded-md border transition ${
        isOver && !unstaged ? 'border-accent bg-accent-soft' : 'border-line-2 bg-ground-2'
      }`}
    >
      <div className="flex items-center gap-2 h-6 px-2 border-b border-line flex-shrink-0">
        {/* The stage name is the label. No dot, no hue — the column IS the state. */}
        <span className={`text-micro font-semibold uppercase truncate ${unstaged ? 'text-ink-4' : 'text-ink-2'}`}>
          {id}
        </span>
        <div className="flex-1" />
        <span className="num text-micro text-ink-4">{rows.length}</span>
      </div>

      <div className="p-1 space-y-1 overflow-y-auto max-h-[calc(100vh-160px)]">
        {unstaged && rows.length > 0 && (
          // Says what it is rather than pretending. These aren't under
          // consideration — nobody has said anything about them yet.
          <p className="text-mini text-ink-4 px-1 pb-1 leading-snug">
            No deal stage set. Drag one onto a column to start tracking it.
          </p>
        )}
        {rows.map((r) => (
          <Card key={r.id} row={r} onOpen={onOpen} />
        ))}
        {!rows.length && !unstaged && (
          <div className="h-8 flex items-center justify-center text-mini text-ink-4">—</div>
        )}
      </div>
    </div>
  );
}

const BAND_LABEL = { anchor: 'Anchor', memo: 'Memo', monitor: 'Monitor', pass: 'Pass', indeterminate: 'Held' };

function Card({ row, onOpen, dragging }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: String(row.id) });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => !dragging && onOpen && onOpen(row.id)}
      className={`bg-ground border rounded-sm px-2 py-1.5 cursor-pointer select-none transition ${
        dragging ? 'border-line-3 rotate-1' : 'border-line hover:border-line-3'
      } ${isDragging && !dragging ? 'opacity-30' : ''}`}
    >
      {/* ONE primary ink: the company. This is a board of companies, so the founder
          recedes — the old card had it exactly the other way round. */}
      <div className="flex items-baseline gap-1">
        <span className="text-small font-medium text-ink truncate flex-1">
          {row.company || row.person || row.name}
        </span>
        {row.investment_amount > 0 && (
          <span className="text-micro text-ink-4 flex-none" title="Portfolio company">●</span>
        )}
      </div>

      {row.person && <div className="text-mini text-ink-3 truncate">{row.person}</div>}

      {(row.stu_band || row.my_band || row.they_owe > 0) && (
        <div className="flex items-center gap-2 mt-1">
          {/* Bands are typographic. A colored verdict tells him what to think before
              he has read the evidence. His call outranks Stu's read. */}
          {row.my_band ? (
            <span className={`band band-${row.my_band}`}>{BAND_LABEL[row.my_band]}</span>
          ) : row.stu_band ? (
            <span className={`band band-${row.stu_band} opacity-60`} title="Stu's read — your call is still open">
              {BAND_LABEL[row.stu_band]}
            </span>
          ) : null}
          <div className="flex-1" />
          {/* Urgency is a promotion up the ink ramp, not a new hue. */}
          {row.they_owe > 0 && (
            <span className="num text-micro text-ink font-medium" title={`${row.they_owe} owed to you`}>
              {row.they_owe} owed
            </span>
          )}
        </div>
      )}
    </div>
  );
}
