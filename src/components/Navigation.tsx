import type { ReactNode } from "react";
import type { MainTab } from "../types/workOrder";
import { DatePicker } from "./DatePicker";
import { Icon } from "./Icon";

export function FilterButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="filter-button" aria-label="筛选工单" title="筛选" onClick={onClick}><Icon name="filter" size={19} /></button>;
}

export function PrimaryNav({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  const items: Array<{ id: MainTab; label: string; icon: string }> = [{ id: "home", label: "首页", icon: "home" }, { id: "stats", label: "统计", icon: "chart" }, { id: "submit", label: "提交", icon: "send" }];
  return <nav className="bottom-nav" aria-label="主导航">{items.map((item) => <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => onChange(item.id)}><Icon name={item.icon} size={20} /><span>{item.label}</span></button>)}</nav>;
}

export function SubHeader({ title, onBack, right, date, onDateChange, onFilter = () => undefined }: { title: string; onBack: () => void; right?: ReactNode; date: string; onDateChange: (value: string) => void; onFilter?: () => void }) {
  return <header className="subheader"><button className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button><h1>{title}</h1><div className="subheader-actions">{right}<FilterButton onClick={onFilter} /><DatePicker value={date} onChange={onDateChange} /></div></header>;
}
