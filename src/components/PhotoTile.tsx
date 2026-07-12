import { Icon } from "./Icon";

export function PhotoTile({ label, active, onClick, tone = "blue" }: { label: string; active?: boolean; onClick?: () => void; tone?: string }) {
  return <button className={`photo-tile photo-${tone} ${active ? "is-active" : ""}`} onClick={onClick} type="button"><span className="photo-shine" /><span className="photo-label">{label}</span>{active && <span className="photo-check"><Icon name="check" size={14} /></span>}</button>;
}
