import { useEffect, useState } from "react";
import { Icon } from "./Icon";

export function DatePicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [isOpen, setOpen] = useState(false);
  const [year, month, day] = value.split("-").map(Number);
  const [viewDate, setViewDate] = useState(() => new Date(year, month - 1, 1));
  const firstWeekday = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1).getDay();
  const cells = Array.from({ length: 42 }, (_, index) => new Date(viewDate.getFullYear(), viewDate.getMonth(), index - firstWeekday + 1));
  const formatDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const open = () => { setViewDate(new Date(year, month - 1, 1)); setOpen(true); };

  useEffect(() => {
    if (!isOpen) return;
    const closeOnAndroidBack = (event: Event) => { event.preventDefault(); setOpen(false); };
    window.addEventListener("kidindin:back", closeOnAndroidBack);
    return () => window.removeEventListener("kidindin:back", closeOnAndroidBack);
  }, [isOpen]);

  return <><button type="button" className="calendar-button" title={`查询日期：${value}`} aria-label="选择查询日期" onClick={open}><Icon name="calendar" size={17} /><span>{month}月{day}日</span></button>{isOpen && <div className="date-dialog-backdrop" onClick={() => setOpen(false)}><section className="date-dialog" role="dialog" aria-modal="true" aria-label="选择查询日期" onClick={(event) => event.stopPropagation()}><header><button type="button" aria-label="上个月" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))}>‹</button><b>{viewDate.getFullYear()}年{viewDate.getMonth() + 1}月</b><button type="button" aria-label="下个月" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))}>›</button></header><div className="weekday-row">{["日", "一", "二", "三", "四", "五", "六"].map((item) => <span key={item}>{item}</span>)}</div><div className="date-grid">{cells.map((date) => { const key = formatDate(date); return <button type="button" key={key} className={`${date.getMonth() !== viewDate.getMonth() ? "outside" : ""} ${key === value ? "selected" : ""}`} onClick={() => { onChange(key); setOpen(false); }}>{date.getDate()}</button>; })}</div><footer><button type="button" onClick={() => { onChange("2026-07-12"); setOpen(false); }}>今天</button><button type="button" onClick={() => setOpen(false)}>取消</button></footer></section></div>}</>;
}
