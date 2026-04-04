import { useState, useMemo } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  closestCenter,
} from '@dnd-kit/core';
import KanbanColumn from './KanbanColumn';
import KanbanCard from './KanbanCard';

export default function KanbanBoard({ founders, stages, track, onStageChange, onAddToInvestment }) {
  const [activeId, setActiveId] = useState(null);

  // Require 8px drag distance before activating — prevents accidental drags on click/scroll
  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 8 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 200, tolerance: 8 },
  });
  const sensors = useSensors(pointerSensor, touchSensor);

  // Group founders by stage
  const foundersByStage = useMemo(() => {
    const grouped = {};
    const stageField = track === 'investment' ? 'deal_status' : 'admissions_status';

    for (const stage of stages) {
      grouped[stage] = [];
    }

    for (const f of founders) {
      const fStage = f[stageField] || stages[0];
      if (grouped[fStage]) {
        grouped[fStage].push(f);
      } else {
        // Founder is in a stage not shown (shouldn't happen, but safe fallback)
        if (!grouped['_other']) grouped['_other'] = [];
        grouped['_other'].push(f);
      }
    }

    return grouped;
  }, [founders, stages, track]);

  const activeFounder = useMemo(() => {
    if (!activeId) return null;
    return founders.find(f => f.id === activeId) || null;
  }, [activeId, founders]);

  function handleDragStart(event) {
    setActiveId(event.active.id);
  }

  function handleDragEnd(event) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const founderId = active.id;
    const founder = founders.find(f => f.id === founderId);
    if (!founder) return;

    // Determine which stage the card was dropped into
    let targetStage = null;

    // Check if dropped onto a column (droppable ID = stage name)
    if (stages.includes(over.id)) {
      targetStage = over.id;
    } else {
      // Dropped onto another card — find which stage that card is in
      const overFounder = founders.find(f => f.id === over.id);
      if (overFounder) {
        const stageField = track === 'investment' ? 'deal_status' : 'admissions_status';
        targetStage = overFounder[stageField];
      }
    }

    if (!targetStage) return;

    // Check if stage actually changed
    const stageField = track === 'investment' ? 'deal_status' : 'admissions_status';
    if (founder[stageField] === targetStage) return;

    onStageChange(founderId, targetStage);
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex gap-3 overflow-x-auto pb-4 -mx-4 px-4 md:-mx-6 md:px-6 snap-x snap-mandatory scrollbar-hide"
           style={{ WebkitOverflowScrolling: 'touch' }}>
        {stages.map(stage => (
          <KanbanColumn
            key={stage}
            stage={stage}
            founders={foundersByStage[stage] || []}
            track={track}
            onAddToInvestment={onAddToInvestment}
          />
        ))}
      </div>

      {/* Drag overlay — floating card that follows the cursor */}
      <DragOverlay dropAnimation={null}>
        {activeFounder ? (
          <div className="rotate-2 scale-105">
            <KanbanCard
              founder={activeFounder}
              track={track}
              isDragging
            />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
