import type { MainTab } from "../types/workOrder";
import { DatePicker } from "./DatePicker";
import { Icon } from "./Icon";

const primaryNavItems: Array<{ id: MainTab; label: string; icon: string }> = [
  { id: "stats", label: "统计", icon: "chart" },
  { id: "home", label: "首页", icon: "home" },
  { id: "more", label: "更多", icon: "more" },
];

export function FilterButton({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="filter-button" aria-label="筛选工单" title="筛选" onClick={onClick}>
      <Icon name="filter" size={19} />
    </button>
  );
}

export function PrimaryNav({ active, onChange }: { active: MainTab; onChange: (tab: MainTab) => void }) {
  return (
    <nav className="bottom-nav" aria-label="主导航">
      {primaryNavItems.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            type="button"
            key={item.id}
            className={isActive ? "active" : ""}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onChange(item.id)}
          >
            <Icon name={item.icon} size={20} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function SubHeader({ title, onBack, date, onDateChange }: { title: string; onBack?: () => void; date: string; onDateChange: (value: string) => void }) {
  return (
    <header className="subheader">
      {onBack ? (
        <button type="button" className="back-button" onClick={onBack} aria-label="返回">
          <Icon name="chevron" />
        </button>
      ) : (
        <span className="subheader-back-placeholder" aria-hidden="true" />
      )}
      <h1>{title}</h1>
      <div className="subheader-actions">
        <DatePicker value={date} onChange={onDateChange} />
      </div>
    </header>
  );
}
