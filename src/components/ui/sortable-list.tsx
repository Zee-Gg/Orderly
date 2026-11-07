"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";

export type DragHandleProps = {
  /** Spread onto the element people grab. */
  handle: Record<string, unknown>;
  isDragging: boolean;
};

function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: (props: DragHandleProps) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };
  return (
    <li ref={setNodeRef} style={style} className={cn(isDragging && "opacity-80 shadow-raised")}>
      {children({ handle: { ref: setActivatorNodeRef, ...attributes, ...listeners }, isDragging })}
    </li>
  );
}

/**
 * Vertical drag-and-drop list. Only the drag handle starts a drag, so
 * scrolling on phones still works. Keyboard: focus the handle, Space, arrows.
 */
export function SortableList<T extends { id: string }>({
  id,
  items,
  onReorder,
  disabled,
  className,
  children,
}: {
  /** Stable id (avoids hydration mismatches in dnd-kit's aria ids). */
  id: string;
  items: T[];
  onReorder: (items: T[]) => void;
  disabled?: boolean;
  className?: string;
  children: (item: T, props: DragHandleProps) => ReactNode;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(items, from, to));
  }

  return (
    <DndContext id={id} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy} disabled={disabled}>
        <ul className={className}>
          {items.map((item) => (
            <SortableRow key={item.id} id={item.id} disabled={disabled}>
              {(props) => children(item, props)}
            </SortableRow>
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

/** The grip button people drag. */
export function DragHandle({
  handle,
  label,
  className,
}: {
  handle: Record<string, unknown>;
  label: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      {...handle}
      aria-label={label}
      className={cn(
        "flex size-touch shrink-0 cursor-grab touch-none items-center justify-center rounded-control text-muted hover:bg-subtle active:cursor-grabbing",
        className,
      )}
    >
      <GripVertical aria-hidden className="size-5" />
    </button>
  );
}
