import type { ReactNode } from "react";
import { m } from "framer-motion";
import type { MainTab } from "../types/workOrder";
import { DatePicker } from "./DatePicker";
import { Icon } from "./Icon";

export function FilterButton({ onClick }: { onClick: () => void }) {
  return <button type="button" className="filter-button" aria-label="筛选工单" title="筛选" onClick={onClick}><Icon name="filter" size={19} /></button>;
}

export function PrimaryNav({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  const items: Array<{ id: MainTab; label: string; icon: string }> = [{ id: "stats", label: "统计", icon: "chart" }, { id: "home", label: "首页", icon: "home" }, { id: "more", label: "更多", icon: "more" }];
  return <nav className="bottom-nav" aria-label="主导航">{items.map((item) => {
    const isActive = active === item.id;
    return <m.button
      type="button"
      key={item.id}
      className={isActive ? "active" : ""}
      aria-current={isActive ? "page" : undefined}
      whileTap={{ scale: 0.92 }}
      onClick={() => onChange(item.id)}
    >
      {isActive ? <m.span
        className="bottom-nav-active-indicator"
        layoutId="primary-nav-active-indicator"
        transition={{ type: "spring", stiffness: 420, damping: 34 }}
        aria-hidden="true"
      /> : null}
      <Icon name={item.icon} size={20} />
      <span>{item.label}</span>
    </m.button>;
  })}</nav>;
}

export function SubHeader({ title, onBack, right, date, onDateChange, onFilter = () => undefined }: { title: string; onBack: () => void; right?: ReactNode; date: string; onDateChange: (value: string) => void; onFilter?: () => void }) {
  return <header className="subheader"><button className="back-button" onClick={onBack} aria-label="返回"><Icon name="chevron" /></button><h1>{title}</h1><div className="subheader-actions">{right}<FilterButton onClick={onFilter} /><DatePicker value={date} onChange={onDateChange} /></div></header>;
}
