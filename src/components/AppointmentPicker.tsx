import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

type AppointmentPickerProps = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
const FIVE_MINUTES = 5 * 60 * 1000;
const TIME_WHEEL_ITEM_HEIGHT = 44;

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function formatValue(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseValue(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match) {
    const [, yearText, monthText, dayText, hourText, minuteText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    const date = new Date(year, month - 1, day, hour, minute, 0, 0);

    if (
      date.getFullYear() !== year
      || date.getMonth() !== month - 1
      || date.getDate() !== day
      || date.getHours() !== hour
      || date.getMinutes() !== minute
    ) return null;
    return date;
  }

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    const [, yearText, monthText, dayText] = dateOnly;
    const date = new Date(Number(yearText), Number(monthText) - 1, Number(dayText), 0, 0, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function defaultAppointment() {
  const timestamp = Date.now() + 30 * 60 * 1000;
  return new Date(Math.ceil(timestamp / FIVE_MINUTES) * FIVE_MINUTES);
}

function normalizeToFiveMinutes(date: Date) {
  const normalized = new Date(date);
  normalized.setSeconds(0, 0);
  normalized.setMinutes(Math.round(normalized.getMinutes() / 5) * 5);
  return normalized;
}

function resolvedValue(value: string) {
  const parsed = parseValue(value);
  return parsed ? normalizeToFiveMinutes(parsed) : defaultAppointment();
}

function sameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
}

function displayValue(value: string) {
  const parsed = parseValue(value);
  if (!parsed) return "设置预约时间";
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日 ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function TimeWheel({ label, values, value, onChange }: {
  label: string;
  values: number[];
  value: number;
  onChange: (value: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const settleTimerRef = useRef<number | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const nearestIndex = () => {
    const scrollTop = listRef.current?.scrollTop ?? 0;
    return Math.max(0, Math.min(values.length - 1, Math.round(scrollTop / TIME_WHEEL_ITEM_HEIGHT)));
  };

  const scrollToIndex = (index: number, behavior: ScrollBehavior) => {
    const list = listRef.current;
    if (!list) return;
    const top = index * TIME_WHEEL_ITEM_HEIGHT;
    if (behavior === "auto") list.scrollTop = top;
    else list.scrollTo({ top, behavior });
  };

  const selectIndex = (index: number, behavior: ScrollBehavior = "auto") => {
    const safeIndex = Math.max(0, Math.min(values.length - 1, index));
    const nextValue = values[safeIndex];
    if (nextValue !== valueRef.current) {
      valueRef.current = nextValue;
      onChange(nextValue);
    }
    scrollToIndex(safeIndex, behavior);
  };

  useLayoutEffect(() => {
    const selectedIndex = Math.max(0, values.indexOf(valueRef.current));
    scrollToIndex(selectedIndex, "auto");
  }, []);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
  }, []);

  const handleScroll = () => {
    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(() => {
        animationFrameRef.current = null;
        const nextValue = values[nearestIndex()];
        if (nextValue !== valueRef.current) {
          valueRef.current = nextValue;
          onChange(nextValue);
        }
      });
    }
    if (settleTimerRef.current !== null) window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => {
      settleTimerRef.current = null;
      selectIndex(nearestIndex());
    }, 120);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const selectedIndex = Math.max(0, values.indexOf(valueRef.current));
    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectIndex(selectedIndex - 1);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      selectIndex(selectedIndex + 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      selectIndex(values.length - 1);
    }
  };

  return <div className="appointment-picker-time-group">
    <span>{label}</span>
    <div className="appointment-picker-time-wheel-frame">
      <span className="appointment-picker-time-wheel-selection" aria-hidden="true" />
      <div
        ref={listRef}
        className="appointment-picker-time-wheel"
        role="listbox"
        aria-label={label}
        aria-orientation="vertical"
        tabIndex={0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
      >
        {values.map((option, index) => <button
          type="button"
          key={option}
          className={value === option ? "is-selected" : ""}
          role="option"
          aria-label={`${label} ${pad(option)}`}
          aria-selected={value === option}
          tabIndex={-1}
          onClick={() => selectIndex(index)}
        >{pad(option)}</button>)}
      </div>
    </div>
  </div>;
}

export function AppointmentPicker({ value, onChange, disabled = false }: AppointmentPickerProps) {
  const initial = resolvedValue(value);
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState(initial);
  const [viewDate, setViewDate] = useState(() => new Date(initial.getFullYear(), initial.getMonth(), 1));

  const calendarDays = useMemo(() => {
    const firstWeekday = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
    return Array.from(
      { length: 42 },
      (_, index) => new Date(viewDate.getFullYear(), viewDate.getMonth(), index - firstWeekday + 1),
    );
  }, [viewDate]);

  const openPicker = () => {
    if (disabled) return;
    const nextDraft = resolvedValue(value);
    setDraft(nextDraft);
    setViewDate(new Date(nextDraft.getFullYear(), nextDraft.getMonth(), 1));
    setOpen(true);
  };

  useEffect(() => {
    if (!isOpen) return;

    const closeOnAndroidBack = (event: Event) => {
      event.preventDefault();
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("kidindin:back", closeOnAndroidBack);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("kidindin:back", closeOnAndroidBack);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const chooseDate = (date: Date) => {
    setDraft((current) => new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      current.getHours(),
      current.getMinutes(),
      0,
      0,
    ));
    if (date.getMonth() !== viewDate.getMonth() || date.getFullYear() !== viewDate.getFullYear()) {
      setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
    }
  };

  const chooseHour = (hour: number) => {
    setDraft((current) => new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate(),
      hour,
      current.getMinutes(),
      0,
      0,
    ));
  };

  const chooseMinute = (minute: number) => {
    setDraft((current) => new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate(),
      current.getHours(),
      minute,
      0,
      0,
    ));
  };

  const chooseToday = () => {
    const today = new Date();
    const next = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      draft.getHours(),
      draft.getMinutes(),
      0,
      0,
    );
    setDraft(next);
    setViewDate(new Date(today.getFullYear(), today.getMonth(), 1));
  };

  return <>
    <button
      type="button"
      className="appointment-picker-trigger"
      aria-label={value ? `预约时间：${displayValue(value)}` : "设置预约时间"}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      disabled={disabled}
      onClick={openPicker}
    >
      <Icon name="appointment" size={16} />
      <span>{displayValue(value)}</span>
    </button>

    {isOpen && createPortal(<div className="appointment-picker-backdrop" onClick={() => setOpen(false)}>
      <section
        className="appointment-picker-sheet"
        role="dialog"
        aria-modal="true"
        aria-label="选择预约日期和时间"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="appointment-picker-handle" aria-hidden="true" />
        <header className="appointment-picker-header">
          <button
            type="button"
            aria-label="上个月"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}
          >‹</button>
          <div>
            <b>{viewDate.getFullYear()}年{viewDate.getMonth() + 1}月</b>
            <span>{draft.getFullYear()}年{draft.getMonth() + 1}月{draft.getDate()}日　{pad(draft.getHours())}:{pad(draft.getMinutes())}</span>
          </div>
          <button
            type="button"
            aria-label="下个月"
            onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}
          >›</button>
        </header>

        <div className="appointment-picker-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
        </div>
        <div className="appointment-picker-calendar" aria-label="日期">
          {calendarDays.map((date) => {
            const dateValue = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
            const outside = date.getMonth() !== viewDate.getMonth();
            const selected = sameDay(date, draft);
            const today = sameDay(date, new Date());
            return <button
              type="button"
              key={dateValue}
              className={`${outside ? "is-outside" : ""} ${selected ? "is-selected" : ""} ${today ? "is-today" : ""}`.trim()}
              aria-label={`${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`}
              aria-pressed={selected}
              onClick={() => chooseDate(date)}
            >{date.getDate()}</button>;
          })}
        </div>

        <section className="appointment-picker-time" aria-label="时间，上下滑动选择">
          <TimeWheel label="小时" values={HOURS} value={draft.getHours()} onChange={chooseHour} />
          <span className="appointment-picker-time-separator" aria-hidden="true">:</span>
          <TimeWheel label="分钟（每 5 分钟）" values={MINUTES} value={draft.getMinutes()} onChange={chooseMinute} />
        </section>

        <footer className="appointment-picker-actions">
          <button type="button" className="appointment-picker-today" onClick={chooseToday}>今天</button>
          <button type="button" onClick={() => setOpen(false)}>取消</button>
          <button
            type="button"
            className="appointment-picker-confirm"
            onClick={() => {
              onChange(formatValue(draft));
              setOpen(false);
            }}
          >确定</button>
        </footer>
      </section>
    </div>, document.body)}
  </>;
}
