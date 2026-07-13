import {
  BarChart3,
  Calendar,
  Check,
  ChevronRight,
  Clock3,
  Home,
  LogOut,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  X,
  type LucideIcon,
} from "lucide-react";

const icons: Record<string, LucideIcon> = {
  calendar: Calendar,
  chart: BarChart3,
  check: Check,
  chevron: ChevronRight,
  clock: Clock3,
  close: X,
  filter: SlidersHorizontal,
  home: Home,
  logout: LogOut,
  pause: Pause,
  play: Play,
  plus: Plus,
  search: Search,
  send: Send,
  settings: Settings,
};

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const Glyph = icons[name] ?? Check;
  return <Glyph className="icon" size={size} strokeWidth={1.9} aria-hidden="true" />;
}
