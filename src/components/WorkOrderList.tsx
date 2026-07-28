import { createPortal } from "react-dom";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import type { OrderStatus, WorkOrder } from "../types/workOrder";
import type { LocalWorkOrderMeta } from "../services/localWorkOrderStore";
import { Icon } from "./Icon";

const statusClass: Record<OrderStatus, string> = {
  待处理: "pending",
  处理中: "processing",
  已完成: "completed",
  已结束: "ended",
  待提交: "submitting",
  关闭失败: "failed",
  日志失败: "failed",
  未知: "unknown",
};
const MAX_ANIMATED_ORDERS = 60;
const LONG_PRESS_MS = 480;
const SWIPE_ACTION_DISTANCE = 54;
const SWIPE_DIRECTION_LOCK_DISTANCE = 12;
const SWIPE_HORIZONTAL_BIAS = 1.35;
const SWIPE_MAX_OFFSET = 82;
const SWIPE_COMMIT_DURATION_MS = 120;
const SWIPE_RESET_DURATION_MS = 180;
const SWIPE_RESET_CLEANUP_DELAY_MS = SWIPE_RESET_DURATION_MS + 32;
const PIN_POPOVER_ESTIMATED_WIDTH = 112;
const PIN_POPOVER_ESTIMATED_HEIGHT = 42;
const PIN_POPOVER_VIEWPORT_MARGIN = 8;

type GestureAxis = "pending" | "horizontal" | "vertical";
type SwipePhase = "idle" | "dragging" | "committing" | "settling";

type ActivePointer = {
  pointerId: number;
  orderKey: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  axis: GestureAxis;
  longPressed: boolean;
  timer: number | null;
  target: HTMLButtonElement;
};

type SwipeVisual = {
  direction: "note" | "favorite" | null;
  orderKey: string | null;
  offsetX: number;
  phase: SwipePhase;
};

type PinPopoverState = {
  order: WorkOrder;
  orderKey: string;
  arrowLeft: number;
  left: number;
  top: number;
  placement: "above" | "below";
};

type FloorGroupEntry = {
  order: WorkOrder;
  index: number;
};

type FloorGroup = {
  key: string;
  label: string;
  entries: FloorGroupEntry[];
};

function orderMotionKey(order: WorkOrder) {
  return order.woHeaderId || order.id;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function resolveGestureAxis(deltaX: number, deltaY: number): GestureAxis {
  const absoluteX = Math.abs(deltaX);
  const absoluteY = Math.abs(deltaY);
  if (
    Math.hypot(absoluteX, absoluteY) < SWIPE_DIRECTION_LOCK_DISTANCE
  )
    return "pending";
  if (absoluteY >= absoluteX) return "vertical";
  if (absoluteX >= absoluteY * SWIPE_HORIZONTAL_BIAS) return "horizontal";
  return "pending";
}

function normalizedGroupPart(value: string) {
  return value.trim();
}

function isMissingFloor(value: string) {
  const normalized = normalizedGroupPart(value);
  return !normalized || normalized === "未标注楼层";
}

function withLocationSuffix(value: string, suffix: string, fallback: string) {
  const normalized = normalizedGroupPart(value);
  if (!normalized || normalized.startsWith("未标注")) return fallback;
  return normalized.endsWith(suffix) ? normalized : `${normalized}${suffix}`;
}

function floorGroupLabel(order: WorkOrder) {
  const building = normalizedGroupPart(order.building);
  const unitNumber = normalizedGroupPart(order.unitNumber);
  const floorNumber = normalizedGroupPart(order.floorNumber);
  if (isMissingFloor(floorNumber)) return `楼层未标注 · ${order.id}`;
  return [
    building || "未标注楼栋",
    withLocationSuffix(unitNumber, "单元", "未标注单元"),
    withLocationSuffix(floorNumber, "层", "未标注楼层"),
  ].join(" · ");
}

function pinPopoverPosition(
  clientX: number,
  cardRect: DOMRect,
  frameRect?: DOMRect,
  bottomNavTop?: number,
) {
  const visualViewport = window.visualViewport;
  const viewportLeft = visualViewport?.offsetLeft ?? 0;
  const viewportTop = visualViewport?.offsetTop ?? 0;
  const viewportRight =
    viewportLeft + (visualViewport?.width ?? window.innerWidth);
  const viewportBottom =
    viewportTop + (visualViewport?.height ?? window.innerHeight);
  const usableLeft = Math.max(
    viewportLeft,
    frameRect?.left ?? viewportLeft,
  );
  const usableRight = Math.min(
    viewportRight,
    frameRect?.right ?? viewportRight,
  );
  const usableTop = Math.max(viewportTop, frameRect?.top ?? viewportTop);
  const usableBottom = Math.min(
    viewportBottom,
    frameRect?.bottom ?? viewportBottom,
    bottomNavTop ?? viewportBottom,
  );
  const left = clamp(
    clientX - PIN_POPOVER_ESTIMATED_WIDTH / 2,
    usableLeft + PIN_POPOVER_VIEWPORT_MARGIN,
    usableRight -
      PIN_POPOVER_ESTIMATED_WIDTH -
      PIN_POPOVER_VIEWPORT_MARGIN,
  );
  const belowTop = cardRect.bottom + 7;
  const fitsBelow =
    belowTop + PIN_POPOVER_ESTIMATED_HEIGHT <=
    usableBottom - PIN_POPOVER_VIEWPORT_MARGIN;
  const placement: PinPopoverState["placement"] = fitsBelow
    ? "below"
    : "above";
  const desiredTop = fitsBelow
    ? belowTop
    : cardRect.top - PIN_POPOVER_ESTIMATED_HEIGHT - 7;
  const top = clamp(
    desiredTop,
    usableTop + PIN_POPOVER_VIEWPORT_MARGIN,
    usableBottom -
      PIN_POPOVER_ESTIMATED_HEIGHT -
      PIN_POPOVER_VIEWPORT_MARGIN,
  );
  const arrowLeft = clamp(
    clientX - left - 5,
    14,
    PIN_POPOVER_ESTIMATED_WIDTH - 24,
  );
  return { arrowLeft, left, top, placement };
}

export function StatusBadge({ status }: { status: OrderStatus }) {
  return (
    <span className={`status status-${statusClass[status]}`}>{status}</span>
  );
}

export function WorkOrderList({
  orders,
  selected = [],
  localMetaById = {},
  groupByFloor = false,
  floorGroupingResetKey,
  collapsedFloorGroupKeys,
  loading = false,
  onToggle,
  onDetail,
  onCollapsedFloorGroupKeysChange,
  onToggleFavorite,
  onTogglePinned,
  onSaveNote,
}: {
  orders: WorkOrder[];
  selected?: string[];
  localMetaById?: Record<string, LocalWorkOrderMeta>;
  groupByFloor?: boolean;
  floorGroupingResetKey?: string;
  collapsedFloorGroupKeys?: readonly string[];
  loading?: boolean;
  onToggle?: (id: string) => void;
  onDetail: (order: WorkOrder) => void;
  onCollapsedFloorGroupKeysChange?: (keys: string[]) => void;
  onToggleFavorite?: (order: WorkOrder) => Promise<void> | void;
  onTogglePinned?: (order: WorkOrder) => Promise<void> | void;
  onSaveNote?: (order: WorkOrder, note: string) => Promise<void> | void;
}) {
  const selectable = Boolean(onToggle);
  const reduceMotion = useReducedMotion();
  const floorGroupIdPrefix = useId().replace(/:/g, "");
  const previousCountRef = useRef(orders.length);
  const selectedIds = useMemo(() => new Set(selected), [selected]);
  const orderSequence = useMemo(
    () => orders.map(orderMotionKey).join("|"),
    [orders],
  );
  const floorGroups = useMemo(() => {
    const groups = new Map<string, FloorGroup>();
    orders.forEach((order, index) => {
      const floorNumber = normalizedGroupPart(order.floorNumber);
      const key = !isMissingFloor(floorNumber)
        ? `floor:${JSON.stringify([
            normalizedGroupPart(order.building),
            normalizedGroupPart(order.unitNumber),
            floorNumber,
          ])}`
        : `order:${orderMotionKey(order)}`;
      const current = groups.get(key);
      const entry = { order, index };
      if (current) current.entries.push(entry);
      else
        groups.set(key, {
          key,
          label: floorGroupLabel(order),
          entries: [entry],
        });
    });
    return Array.from(groups.values());
  }, [orders]);
  const motionEnabled =
    !reduceMotion &&
    Math.max(previousCountRef.current, orders.length) <= MAX_ANIMATED_ORDERS;
  const gesturesEnabled =
    !selectable &&
    Boolean(onToggleFavorite && onTogglePinned && onSaveNote);
  const [internalCollapsedFloorGroups, setInternalCollapsedFloorGroups] =
    useState<Set<string>>(() => new Set());
  const controlledCollapsedFloorGroups = useMemo(
    () => new Set(collapsedFloorGroupKeys),
    [collapsedFloorGroupKeys],
  );
  const collapsedFloorGroups =
    collapsedFloorGroupKeys === undefined
      ? internalCollapsedFloorGroups
      : controlledCollapsedFloorGroups;
  const collapsedVisibleFloorGroupCount = floorGroups.reduce(
    (count, group) => count + Number(collapsedFloorGroups.has(group.key)),
    0,
  );
  const allVisibleFloorGroupsCollapsed =
    floorGroups.length > 0 &&
    collapsedVisibleFloorGroupCount === floorGroups.length;
  const [lastToggledFloorGroup, setLastToggledFloorGroup] = useState<
    string | null
  >(null);
  const [pinPopover, setPinPopover] = useState<PinPopoverState | null>(null);
  const [noteOrder, setNoteOrder] = useState<WorkOrder | null>(null);
  const [noteValue, setNoteValue] = useState("");
  const [noteError, setNoteError] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [swipeVisual, setSwipeVisual] = useState<SwipeVisual>({
    direction: null,
    orderKey: null,
    offsetX: 0,
    phase: "idle",
  });
  const pointerRef = useRef<ActivePointer | null>(null);
  const swipeVisualRef = useRef<SwipeVisual>({
    direction: null,
    orderKey: null,
    offsetX: 0,
    phase: "idle",
  });
  const swipeCommitTimerRef = useRef<number | null>(null);
  const swipeResetTimerRef = useRef<number | null>(null);
  const swipeFrameRef = useRef<number | null>(null);
  const pendingSwipeVisualRef = useRef<SwipeVisual | null>(null);
  const swipeSequenceRef = useRef(0);
  const suppressDetailRef = useRef<string | null>(null);
  const suppressDetailTimerRef = useRef<number | null>(null);

  useEffect(() => {
    previousCountRef.current = orders.length;
  }, [orders.length]);

  const cancelScheduledSwipeVisual = () => {
    if (swipeFrameRef.current != null)
      window.cancelAnimationFrame(swipeFrameRef.current);
    swipeFrameRef.current = null;
    pendingSwipeVisualRef.current = null;
  };

  const updateSwipeVisual = (next: SwipeVisual) => {
    cancelScheduledSwipeVisual();
    swipeVisualRef.current = next;
    setSwipeVisual(next);
  };

  const scheduleSwipeVisual = (next: SwipeVisual) => {
    swipeVisualRef.current = next;
    pendingSwipeVisualRef.current = next;
    if (swipeFrameRef.current != null) return;
    swipeFrameRef.current = window.requestAnimationFrame(() => {
      swipeFrameRef.current = null;
      const pending = pendingSwipeVisualRef.current;
      pendingSwipeVisualRef.current = null;
      if (pending && swipeVisualRef.current === pending)
        setSwipeVisual(pending);
    });
  };

  const clearPointerTimer = (pointer = pointerRef.current) => {
    if (pointer?.timer != null) window.clearTimeout(pointer.timer);
    if (pointer) pointer.timer = null;
  };

  const clearSwipeTimers = () => {
    cancelScheduledSwipeVisual();
    if (swipeCommitTimerRef.current != null)
      window.clearTimeout(swipeCommitTimerRef.current);
    if (swipeResetTimerRef.current != null)
      window.clearTimeout(swipeResetTimerRef.current);
    swipeCommitTimerRef.current = null;
    swipeResetTimerRef.current = null;
  };

  const clearSuppressDetail = () => {
    if (suppressDetailTimerRef.current != null)
      window.clearTimeout(suppressDetailTimerRef.current);
    suppressDetailTimerRef.current = null;
    suppressDetailRef.current = null;
  };

  const suppressDetailClick = (orderKey: string) => {
    if (suppressDetailTimerRef.current != null)
      window.clearTimeout(suppressDetailTimerRef.current);
    suppressDetailRef.current = orderKey;
    suppressDetailTimerRef.current = window.setTimeout(() => {
      if (suppressDetailRef.current === orderKey)
        suppressDetailRef.current = null;
      suppressDetailTimerRef.current = null;
    }, 700);
  };

  const consumeSuppressedDetail = (orderKey: string) => {
    if (suppressDetailRef.current !== orderKey) return false;
    clearSuppressDetail();
    return true;
  };

  const releasePointerCapture = (pointer: ActivePointer) => {
    if (
      pointer.target.isConnected &&
      pointer.target.hasPointerCapture(pointer.pointerId)
    )
      pointer.target.releasePointerCapture(pointer.pointerId);
  };

  const scheduleSwipeVisualReset = (orderKey: string) => {
    const reset = () => {
      swipeResetTimerRef.current = null;
      if (
        swipeVisualRef.current.orderKey === orderKey &&
        swipeVisualRef.current.phase === "settling"
      )
        updateSwipeVisual({
          direction: null,
          orderKey: null,
          offsetX: 0,
          phase: "idle",
        });
    };
    if (reduceMotion) reset();
    else
      swipeResetTimerRef.current = window.setTimeout(
        reset,
        SWIPE_RESET_CLEANUP_DELAY_MS,
      );
  };

  const resetSwipeVisual = (animate: boolean) => {
    clearSwipeTimers();
    swipeSequenceRef.current += 1;
    const current = swipeVisualRef.current;
    if (!current.orderKey) return;
    if (animate && !reduceMotion) {
      updateSwipeVisual({
        direction: current.direction,
        orderKey: current.orderKey,
        offsetX: 0,
        phase: "settling",
      });
      scheduleSwipeVisualReset(current.orderKey);
    } else
      updateSwipeVisual({
        direction: null,
        orderKey: null,
        offsetX: 0,
        phase: "idle",
      });
  };

  const openNoteDialog = (order: WorkOrder) => {
    setPinPopover(null);
    setNoteOrder(order);
    setNoteValue(localMetaById[order.woHeaderId]?.note ?? "");
    setNoteError("");
  };

  const handlePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    order: WorkOrder,
  ) => {
    if (
      !gesturesEnabled ||
      event.pointerType === "mouse" ||
      !event.isPrimary ||
      swipeVisualRef.current.phase !== "idle"
    )
      return;
    const orderKey = orderMotionKey(order);
    setPinPopover(null);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointer: ActivePointer = {
      pointerId: event.pointerId,
      orderKey,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      axis: "pending",
      longPressed: false,
      timer: null,
      target: event.currentTarget,
    };
    pointer.timer = window.setTimeout(() => {
      const activePointer = pointerRef.current;
      if (activePointer !== pointer || activePointer.axis !== "pending") return;
      pointer.longPressed = true;
      pointer.timer = null;
      suppressDetailClick(orderKey);
      const cardRect =
        pointer.target.closest<HTMLElement>(".order-card")?.getBoundingClientRect() ??
        pointer.target.getBoundingClientRect();
      const frame = pointer.target.closest<HTMLElement>(".phone-frame");
      const frameRect = frame?.getBoundingClientRect();
      const bottomNavTop =
        frame
          ?.querySelector<HTMLElement>(".bottom-nav")
          ?.getBoundingClientRect().top;
      setPinPopover({
        order,
        orderKey,
        ...pinPopoverPosition(
          pointer.currentX,
          cardRect,
          frameRect,
          bottomNavTop,
        ),
      });
    }, LONG_PRESS_MS);
    pointerRef.current = pointer;
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pointer.currentX = event.clientX;
    pointer.currentY = event.clientY;
    if (pointer.longPressed) return;
    const deltaX = pointer.currentX - pointer.startX;
    const deltaY = pointer.currentY - pointer.startY;
    if (pointer.axis === "pending") {
      const resolvedAxis = resolveGestureAxis(deltaX, deltaY);
      if (resolvedAxis === "pending") {
        if (
          Math.hypot(deltaX, deltaY) >= SWIPE_DIRECTION_LOCK_DISTANCE
        )
          clearPointerTimer(pointer);
        return;
      }
      clearPointerTimer(pointer);
      pointer.axis = resolvedAxis;
      suppressDetailClick(pointer.orderKey);
    }
    if (pointer.axis !== "horizontal") return;
    if (event.cancelable) event.preventDefault();
    scheduleSwipeVisual({
      direction: deltaX > 0 ? "note" : "favorite",
      orderKey: pointer.orderKey,
      offsetX: clamp(deltaX, -SWIPE_MAX_OFFSET, SWIPE_MAX_OFFSET),
      phase: "dragging",
    });
  };

  const handlePointerEnd = (
    event: PointerEvent<HTMLButtonElement>,
    order: WorkOrder,
  ) => {
    const pointer = pointerRef.current;
    if (
      !pointer ||
      pointer.pointerId !== event.pointerId ||
      pointer.orderKey !== orderMotionKey(order)
    )
      return;
    pointer.currentX = event.clientX;
    pointer.currentY = event.clientY;
    clearPointerTimer(pointer);
    releasePointerCapture(pointer);
    pointerRef.current = null;
    if (pointer.longPressed) {
      suppressDetailClick(pointer.orderKey);
      if (swipeVisualRef.current.orderKey === pointer.orderKey)
        resetSwipeVisual(true);
      return;
    }
    const deltaX = pointer.currentX - pointer.startX;
    const deltaY = pointer.currentY - pointer.startY;
    if (pointer.axis === "pending") {
      const resolvedAxis = resolveGestureAxis(deltaX, deltaY);
      if (resolvedAxis !== "pending") pointer.axis = resolvedAxis;
      else if (
        Math.hypot(deltaX, deltaY) >= SWIPE_DIRECTION_LOCK_DISTANCE
      )
        pointer.axis = "vertical";
    }
    if (
      Math.hypot(deltaX, deltaY) >= SWIPE_DIRECTION_LOCK_DISTANCE
    ) {
      suppressDetailClick(pointer.orderKey);
    }
    if (pointer.axis !== "horizontal") {
      if (swipeVisualRef.current.orderKey === pointer.orderKey)
        resetSwipeVisual(true);
      return;
    }
    suppressDetailClick(pointer.orderKey);
    if (Math.abs(deltaX) < SWIPE_ACTION_DISTANCE) {
      updateSwipeVisual({
        direction:
          swipeVisualRef.current.direction ??
          (deltaX > 0 ? "note" : "favorite"),
        orderKey: pointer.orderKey,
        offsetX: 0,
        phase: "settling",
      });
      scheduleSwipeVisualReset(pointer.orderKey);
      return;
    }
    clearSwipeTimers();
    const sequence = ++swipeSequenceRef.current;
    const committedOffset = deltaX < 0 ? -SWIPE_MAX_OFFSET : SWIPE_MAX_OFFSET;
    updateSwipeVisual({
      direction: deltaX < 0 ? "favorite" : "note",
      orderKey: pointer.orderKey,
      offsetX: committedOffset,
      phase: "committing",
    });
    const performAction = () => {
      swipeCommitTimerRef.current = null;
      if (swipeSequenceRef.current !== sequence) return;
      if (deltaX < 0)
        void Promise.resolve(onToggleFavorite?.(order)).catch(() => undefined);
      else openNoteDialog(order);
      updateSwipeVisual({
        direction: deltaX < 0 ? "favorite" : "note",
        orderKey: pointer.orderKey,
        offsetX: 0,
        phase: "settling",
      });
      scheduleSwipeVisualReset(pointer.orderKey);
    };
    if (reduceMotion) performAction();
    else
      swipeCommitTimerRef.current = window.setTimeout(
        performAction,
        SWIPE_COMMIT_DURATION_MS,
      );
  };

  const handlePointerCancel = (event: PointerEvent<HTMLButtonElement>) => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    clearPointerTimer(pointer);
    releasePointerCapture(pointer);
    pointerRef.current = null;
    if (swipeVisualRef.current.orderKey === pointer.orderKey)
      resetSwipeVisual(true);
  };

  const saveNote = async () => {
    if (!noteOrder || !onSaveNote) return;
    setSavingNote(true);
    setNoteError("");
    try {
      await onSaveNote(noteOrder, noteValue);
      setNoteOrder(null);
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : String(error));
    } finally {
      setSavingNote(false);
    }
  };

  const commitCollapsedFloorGroups = (next: Set<string>) => {
    if (collapsedFloorGroupKeys === undefined)
      setInternalCollapsedFloorGroups(next);
    onCollapsedFloorGroupKeysChange?.(Array.from(next));
  };

  const toggleFloorGroup = (groupKey: string) => {
    setPinPopover(null);
    resetSwipeVisual(false);
    setLastToggledFloorGroup(groupKey);
    const next = new Set(collapsedFloorGroups);
    if (next.has(groupKey)) next.delete(groupKey);
    else next.add(groupKey);
    commitCollapsedFloorGroups(next);
  };

  const expandAllFloorGroups = () => {
    setPinPopover(null);
    resetSwipeVisual(false);
    setLastToggledFloorGroup(null);
    const next = new Set(collapsedFloorGroups);
    floorGroups.forEach((group) => next.delete(group.key));
    commitCollapsedFloorGroups(next);
  };

  const collapseAllFloorGroups = () => {
    setPinPopover(null);
    resetSwipeVisual(false);
    setLastToggledFloorGroup(null);
    const next = new Set(collapsedFloorGroups);
    floorGroups.forEach((group) => next.add(group.key));
    commitCollapsedFloorGroups(next);
  };

  useEffect(() => {
    if (collapsedFloorGroupKeys === undefined)
      setInternalCollapsedFloorGroups(new Set());
    setLastToggledFloorGroup(null);
    setPinPopover(null);
    resetSwipeVisual(false);
  }, [floorGroupingResetKey, groupByFloor]);

  useEffect(() => {
    if (!pinPopover) return;
    const close = () => setPinPopover(null);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.visualViewport?.addEventListener("resize", close);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.visualViewport?.removeEventListener("resize", close);
    };
  }, [pinPopover?.orderKey]);

  useEffect(
    () => () => {
      const pointer = pointerRef.current;
      clearPointerTimer(pointer);
      if (pointer) releasePointerCapture(pointer);
      pointerRef.current = null;
      clearSwipeTimers();
      swipeSequenceRef.current += 1;
      if (suppressDetailTimerRef.current != null)
        window.clearTimeout(suppressDetailTimerRef.current);
      suppressDetailTimerRef.current = null;
      suppressDetailRef.current = null;
      swipeVisualRef.current = {
        direction: null,
        orderKey: null,
        offsetX: 0,
        phase: "idle",
      };
    },
    [],
  );

  const renderOrder = ({ order, index }: FloorGroupEntry) => {
    const orderKey = orderMotionKey(order);
    const localMeta = localMetaById[order.woHeaderId];
    const isSelected = selectedIds.has(order.id);
    const isSwipeRow = swipeVisual.orderKey === orderKey;
    const swipeOffset = isSwipeRow ? swipeVisual.offsetX : 0;
    const swipePhase = isSwipeRow ? swipeVisual.phase : "idle";
    const showSwipeAction =
      gesturesEnabled &&
      isSwipeRow &&
      swipeVisual.direction !== null &&
      (Math.abs(swipeOffset) > 0.5 || swipePhase !== "dragging");
    const rowMotionEnabled = motionEnabled && !groupByFloor;
    const enterDelay = Math.min(index, 6) * 0.018;
    const articleClassName = [
      "order-card",
      isSelected ? "selected" : "",
      localMeta?.pinned ? "locally-pinned" : "",
      pinPopover?.orderKey === orderKey ? "pin-menu-open" : "",
      swipePhase === "dragging" ? "is-swiping" : "",
      swipePhase === "committing" ? "is-swipe-committing" : "",
      swipePhase === "settling" ? "is-swipe-settling" : "",
      isSwipeRow && swipeVisual.direction === "note"
        ? "swipe-note-visible"
        : "",
      isSwipeRow && swipeVisual.direction === "favorite"
        ? "swipe-favorite-visible"
        : "",
    ]
      .filter(Boolean)
      .join(" ");
    const transitionDuration =
      swipePhase === "committing"
        ? SWIPE_COMMIT_DURATION_MS
        : SWIPE_RESET_DURATION_MS;

    return (
      <m.article
        className={articleClassName}
        key={orderKey}
        layout={rowMotionEnabled ? "position" : false}
        layoutDependency={rowMotionEnabled ? orderSequence : undefined}
        initial={rowMotionEnabled ? { opacity: 0, y: 6 } : false}
        animate={rowMotionEnabled ? { opacity: 1, y: 0 } : undefined}
        exit={
          rowMotionEnabled
            ? { opacity: 0, y: -4, transition: { duration: 0.12 } }
            : undefined
        }
        transition={
          rowMotionEnabled
            ? {
                layout: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                opacity: { duration: 0.16, delay: enterDelay },
                y: { duration: 0.18, delay: enterDelay },
              }
            : undefined
        }
      >
        <div
          className="order-swipe-shell"
          style={{
            position: "relative",
            display: "flex",
            flex: "1 1 auto",
            minWidth: 0,
            height: "100%",
            overflow: "hidden",
            background: "inherit",
          }}
        >
          {showSwipeAction && (
            <div
              className={`order-swipe-actions ${
                swipeVisual.direction === "note" ? "is-note" : "is-favorite"
              }`}
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "center",
                justifyContent:
                  swipeVisual.direction === "note"
                    ? "flex-start"
                    : "flex-end",
                padding: "0 12px",
                pointerEvents: "none",
              }}
            >
              {swipeVisual.direction === "note" ? (
                <span className="order-swipe-action order-swipe-action-note">
                  <Icon name="note" size={14} />
                  备注
                </span>
              ) : (
                <span className="order-swipe-action order-swipe-action-favorite">
                  <Icon name="star" size={14} />
                  {localMeta?.favorite ? "取消收藏" : "收藏"}
                </span>
              )}
            </div>
          )}
          <button
            type="button"
            className="order-main order-swipe-content"
            style={{
              position: "relative",
              zIndex: 1,
              transform: isSwipeRow
                ? `translate3d(${swipeOffset}px, 0, 0)`
                : "none",
              transition:
                isSwipeRow &&
                swipePhase !== "dragging" &&
                swipePhase !== "idle" &&
                !reduceMotion
                  ? `transform ${transitionDuration}ms cubic-bezier(.22, 1, .36, 1)`
                  : "none",
              willChange:
                isSwipeRow && swipePhase !== "idle"
                  ? "transform"
                  : undefined,
              background: "inherit",
            }}
            onClick={() => {
              if (consumeSuppressedDetail(orderKey)) return;
              onDetail(order);
            }}
            onPointerDown={(event) => handlePointerDown(event, order)}
            onPointerMove={handlePointerMove}
            onPointerUp={(event) => handlePointerEnd(event, order)}
            onPointerCancel={handlePointerCancel}
            onContextMenu={(event) => {
              if (gesturesEnabled) event.preventDefault();
            }}
          >
            <div className="order-line">
              <span className="order-id-line">
                <span className="order-id">{order.id}</span>
                {localMeta && (
                  <span className="local-order-flags">
                    {localMeta.pinned ? <Icon name="pin" size={10} /> : null}
                    {localMeta.favorite ? <Icon name="star" size={10} /> : null}
                    {localMeta.appointmentAt ? (
                      <Icon name="appointment" size={10} />
                    ) : null}
                    {localMeta.note ? <Icon name="note" size={10} /> : null}
                  </span>
                )}
              </span>
              <StatusBadge status={order.status} />
            </div>
            <div className="order-title">
              {order.resident}
              <span>{order.unit}</span>
            </div>
            <div className="order-meta">
              <span>{order.address}</span>
              {order.time === "待安排" ? (
                <span
                  className={`order-favorite-badge ${localMeta?.favorite ? "is-favorite" : ""}`}
                >
                  <Icon name="star" size={11} />
                  {localMeta?.favorite ? "已收藏" : "未收藏"}
                </span>
              ) : (
                <span>
                  <Icon name="clock" size={13} />
                  {order.time}
                </span>
              )}
            </div>
          </button>
        </div>
        {selectable && (
          <button
            type="button"
            className="select-control"
            onClick={() => onToggle?.(order.id)}
            aria-label={`选择${order.id}`}
          >
            <span>{isSelected && <Icon name="check" size={15} />}</span>
          </button>
        )}
      </m.article>
    );
  };

  const pinPopoverPortal =
    pinPopover && typeof document !== "undefined"
      ? createPortal(
          <div
            className="order-pin-popover-backdrop"
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 35,
              background: "transparent",
            }}
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) setPinPopover(null);
            }}
          >
            <div
              className={`order-pin-popover order-pin-popover-fixed is-${pinPopover.placement}`}
              role="menu"
              aria-label={`${pinPopover.order.id}置顶操作`}
              style={{
                position: "fixed",
                left: pinPopover.left,
                right: "auto",
                top: pinPopover.top,
                "--pin-arrow-left": `${pinPopover.arrowLeft}px`,
              } as CSSProperties}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  const order = pinPopover.order;
                  setPinPopover(null);
                  void Promise.resolve(onTogglePinned?.(order)).catch(
                    () => undefined,
                  );
                }}
              >
                <Icon name="pin" size={14} />
                {localMetaById[pinPopover.order.woHeaderId]?.pinned
                  ? "取消置顶"
                  : "置顶"}
              </button>
            </div>
          </div>,
          document.body,
        )
      : null;

  const noteDialogPortal =
    noteOrder && typeof document !== "undefined"
      ? createPortal(
          <div
            className="order-note-backdrop"
            onClick={() => !savingNote && setNoteOrder(null)}
          >
            <section
              className="order-note-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="填写工单备注"
              onClick={(event) => event.stopPropagation()}
            >
              <h3>工单备注</h3>
              <p>
                {noteOrder.resident} · {noteOrder.unit}
              </p>
              <textarea
                value={noteValue}
                onChange={(event) => setNoteValue(event.target.value)}
                placeholder="填写备注"
                maxLength={500}
                autoFocus
              />
              {noteError ? <small>{noteError}</small> : null}
              <div>
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => setNoteOrder(null)}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={savingNote}
                  onClick={() => void saveNote()}
                >
                  {savingNote ? "保存中…" : "保存"}
                </button>
              </div>
            </section>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <m.section
        className={`order-list ${groupByFloor ? "is-floor-grouped" : ""}`}
        aria-label="可上下滚动的工单列表"
        aria-busy={loading}
        layoutScroll={motionEnabled && !groupByFloor}
      >
        {groupByFloor && floorGroups.length > 0 ? (
          <div
            className="order-floor-group-controls"
            role="group"
            aria-label="楼层分组展开和收起"
          >
            <button
              type="button"
              className="order-floor-groups-toggle-all"
              aria-label={
                allVisibleFloorGroupsCollapsed
                  ? `展开全部 ${floorGroups.length} 个楼层`
                  : `收起全部 ${floorGroups.length} 个楼层`
              }
              onClick={
                allVisibleFloorGroupsCollapsed
                  ? expandAllFloorGroups
                  : collapseAllFloorGroups
              }
            >
              <Icon
                name={allVisibleFloorGroupsCollapsed ? "expand" : "collapse"}
                size={13}
              />
              {allVisibleFloorGroupsCollapsed ? "展开全部" : "收起全部"}
            </button>
          </div>
        ) : null}
        <AnimatePresence initial={false} mode="popLayout">
          {groupByFloor
            ? floorGroups.map((group, groupIndex) => {
                const expanded = !collapsedFloorGroups.has(group.key);
                const contentId = `${floorGroupIdPrefix}-floor-${groupIndex}`;
                return (
                  <div
                    className={`order-floor-group ${expanded ? "is-expanded" : "is-collapsed"}`}
                    key={`floor-group:${group.key}`}
                  >
                    <button
                      type="button"
                      className="order-floor-group-toggle"
                      aria-expanded={expanded}
                      aria-controls={contentId}
                      onClick={() => toggleFloorGroup(group.key)}
                    >
                      <span className="order-floor-group-title">
                        {group.label}
                      </span>
                      <span className="order-floor-group-summary">
                        <span className="order-floor-group-count">
                          {group.entries.length} 单
                        </span>
                        <Icon name="chevron" size={15} />
                      </span>
                    </button>
                    {expanded && (
                      <div
                        className={`order-floor-group-items ${
                          !reduceMotion && lastToggledFloorGroup === group.key
                            ? "is-entering"
                            : ""
                        }`}
                        id={contentId}
                      >
                        {group.entries.map(renderOrder)}
                      </div>
                    )}
                  </div>
                );
              })
            : orders.map((order, index) => renderOrder({ order, index }))}
          {!loading && !orders.length && (
            <m.p
              className="empty-hint"
              key="__empty__"
              initial={motionEnabled ? { opacity: 0, y: 4 } : false}
              animate={motionEnabled ? { opacity: 1, y: 0 } : undefined}
              exit={motionEnabled ? { opacity: 0 } : undefined}
            >
              没有匹配的工单
            </m.p>
          )}
        </AnimatePresence>
      </m.section>
      {pinPopoverPortal}
      {noteDialogPortal}
    </>
  );
}
