import type {
  AccentId,
  AccentMode,
  AppearanceSettings,
  ThemeId,
  ThemeMode,
} from "../types/workOrder";

export const APPEARANCE_STORAGE_KEY = "kidindin.appearance-settings.v3";
const LEGACY_THEME_STORAGE_KEY = "kidindin.theme-settings.v2";

export const themeOptions: Array<{
  description: string;
  id: ThemeId;
  label: string;
}> = [
  { id: "light", label: "浅色", description: "明亮界面" },
  { id: "dark", label: "深色", description: "中性黑色" },
];

export const accentOptions: Array<{
  description: string;
  id: AccentId;
  label: string;
}> = [
  { id: "sky", label: "天空蓝", description: "清爽专注" },
  { id: "pink", label: "樱花粉", description: "柔和明快" },
  { id: "green", label: "青翠绿", description: "自然沉静" },
  { id: "purple", label: "罗兰紫", description: "优雅醒目" },
  { id: "orange", label: "暖橙", description: "温暖活力" },
];

export const themeModeOptions: Array<{
  description: string;
  id: ThemeMode;
  label: string;
}> = [
  { id: "system", label: "跟随系统", description: "设备深浅色变化时自动同步" },
  { id: "manual", label: "手动", description: "固定使用浅色或深色主题" },
];

export const accentModeOptions: Array<{
  description: string;
  id: AccentMode;
  label: string;
}> = [
  { id: "schedule", label: "随时间", description: "一天中自动轮换不同色调" },
  { id: "manual", label: "手动", description: "固定使用所选主色调" },
];

export const defaultAppearanceSettings: AppearanceSettings = {
  themeMode: "system",
  manualTheme: "light",
  accentMode: "schedule",
  manualAccent: "sky",
};

const themeIds = new Set<ThemeId>(themeOptions.map((option) => option.id));
const themeModes = new Set<ThemeMode>(
  themeModeOptions.map((option) => option.id),
);
const accentIds = new Set<AccentId>(accentOptions.map((option) => option.id));
const accentModes = new Set<AccentMode>(
  accentModeOptions.map((option) => option.id),
);

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeIds.has(value as ThemeId);
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && themeModes.has(value as ThemeMode);
}

function isAccentId(value: unknown): value is AccentId {
  return typeof value === "string" && accentIds.has(value as AccentId);
}

function isAccentMode(value: unknown): value is AccentMode {
  return typeof value === "string" && accentModes.has(value as AccentMode);
}

function migrateLegacySettings(): AppearanceSettings | null {
  try {
    const raw = localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
    if (!raw) return null;
    const legacy = JSON.parse(raw) as {
      manualTheme?: unknown;
      mode?: unknown;
    };
    const legacyTheme = legacy.manualTheme;
    const legacyAccentWasExplicit =
      legacy.mode === "manual" &&
      (legacyTheme === "warm" || legacyTheme === "forest");
    return {
      themeMode: legacy.mode === "manual" ? "manual" : "system",
      manualTheme: legacyTheme === "dark" ? "dark" : "light",
      accentMode: legacyAccentWasExplicit ? "manual" : "schedule",
      manualAccent:
        legacyTheme === "warm"
          ? "orange"
          : legacyTheme === "forest"
            ? "green"
            : "sky",
    };
  } catch {
    return null;
  }
}

export function loadAppearanceSettings(): AppearanceSettings {
  try {
    const raw = localStorage.getItem(APPEARANCE_STORAGE_KEY);
    if (!raw) return migrateLegacySettings() ?? defaultAppearanceSettings;
    const value = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      themeMode: isThemeMode(value.themeMode)
        ? value.themeMode
        : defaultAppearanceSettings.themeMode,
      manualTheme: isThemeId(value.manualTheme)
        ? value.manualTheme
        : defaultAppearanceSettings.manualTheme,
      accentMode: isAccentMode(value.accentMode)
        ? value.accentMode
        : defaultAppearanceSettings.accentMode,
      manualAccent: isAccentId(value.manualAccent)
        ? value.manualAccent
        : defaultAppearanceSettings.manualAccent,
    };
  } catch {
    return defaultAppearanceSettings;
  }
}

export function resolveTheme(
  settings: AppearanceSettings,
  systemDark: boolean,
): ThemeId {
  return settings.themeMode === "system"
    ? systemDark
      ? "dark"
      : "light"
    : settings.manualTheme;
}

export function resolveAccent(
  settings: AppearanceSettings,
  now = new Date(),
): AccentId {
  if (settings.accentMode === "manual") return settings.manualAccent;
  const hour = now.getHours();
  if (hour >= 5 && hour < 9) return "orange";
  if (hour >= 9 && hour < 13) return "sky";
  if (hour >= 13 && hour < 17) return "green";
  if (hour >= 17 && hour < 21) return "purple";
  return "pink";
}

export function getThemeLabel(theme: ThemeId) {
  return themeOptions.find((option) => option.id === theme)?.label ?? theme;
}

export function getAccentLabel(accent: AccentId) {
  return accentOptions.find((option) => option.id === accent)?.label ?? accent;
}

export function getThemeMetaColor(theme: ThemeId) {
  return theme === "dark" ? "#000000" : "#f7f9fc";
}
