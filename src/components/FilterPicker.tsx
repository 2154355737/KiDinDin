import { ChevronDown } from "lucide-react";

export type FilterPickerOption = string | { label: string; value: string };

export function FilterPicker({
  label,
  value,
  allValue = "all",
  allLabel,
  options,
  open,
  onToggle,
  onSelect,
}: {
  label: string;
  value: string;
  allValue?: string;
  allLabel: string;
  options: FilterPickerOption[];
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
}) {
  const normalized = options.map((option) => typeof option === "string"
    ? { label: option, value: option }
    : option);
  const currentLabel = value === allValue
    ? allLabel
    : normalized.find((option) => option.value === value)?.label ?? value;

  return (
    <div className="filter-picker">
      <span>{label}</span>
      <button
        type="button"
        className="filter-picker-trigger"
        onClick={onToggle}
        aria-expanded={open}
      >
        {currentLabel}
        <ChevronDown className="filter-picker-icon" size={16} strokeWidth={2.2} />
      </button>
      {open && (
        <div className="filter-picker-menu">
          <button
            type="button"
            className={value === allValue ? "active" : ""}
            onClick={() => onSelect(allValue)}
          >
            {allLabel}
          </button>
          {normalized.map((option) => (
            <button
              type="button"
              key={option.value}
              className={value === option.value ? "active" : ""}
              onClick={() => onSelect(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
