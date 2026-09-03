export const APP_SETTINGS_STORAGE_KEY = "kidindin.app-settings.v1";
export const APP_SETTINGS_VERSION = 1 as const;

export type InterfaceDensity = "comfortable" | "compact";
export type MotionPreference = "system" | "reduced";
export type VacantRoomFillInterval = 0 | 1 | 2 | 3 | 5 | 10;

export type AppSettings = {
  version: typeof APP_SETTINGS_VERSION;
  display: {
    density: InterfaceDensity;
    motion: MotionPreference;
    showToolDescriptions: boolean;
  };
  diagnostics: {
    showWatermarkGenerationDebug: boolean;
  };
  vacantRoom: {
    autoSelectOrders: boolean;
    autoSelectImages: boolean;
    fillAutoSelectOrders: boolean;
    fillIntervalSeconds: VacantRoomFillInterval;
  };
};

export const defaultAppSettings: AppSettings = {
  version: APP_SETTINGS_VERSION,
  display: {
    density: "comfortable",
    motion: "system",
    showToolDescriptions: true,
  },
  diagnostics: {
    showWatermarkGenerationDebug: false,
  },
  vacantRoom: {
    autoSelectOrders: true,
    autoSelectImages: true,
    fillAutoSelectOrders: true,
    fillIntervalSeconds: 2,
  },
};

const fillIntervals = new Set<VacantRoomFillInterval>([0, 1, 2, 3, 5, 10]);

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function objectOrEmpty(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function normalizeAppSettings(value: unknown): AppSettings {
  const candidate = objectOrEmpty(value);
  const display = objectOrEmpty(candidate.display);
  const diagnostics = objectOrEmpty(candidate.diagnostics);
  const vacantRoom = objectOrEmpty(candidate.vacantRoom);
  const density = display.density === "compact" ? "compact" : "comfortable";
  const motion = display.motion === "reduced" ? "reduced" : "system";
  const rawInterval = vacantRoom.fillIntervalSeconds;
  const fillIntervalSeconds =
    typeof rawInterval === "number" && fillIntervals.has(rawInterval as VacantRoomFillInterval)
      ? rawInterval as VacantRoomFillInterval
      : defaultAppSettings.vacantRoom.fillIntervalSeconds;

  return {
    version: APP_SETTINGS_VERSION,
    display: {
      density,
      motion,
      showToolDescriptions: booleanOr(
        display.showToolDescriptions,
        defaultAppSettings.display.showToolDescriptions,
      ),
    },
    diagnostics: {
      showWatermarkGenerationDebug: booleanOr(
        diagnostics.showWatermarkGenerationDebug,
        defaultAppSettings.diagnostics.showWatermarkGenerationDebug,
      ),
    },
    vacantRoom: {
      autoSelectOrders: booleanOr(
        vacantRoom.autoSelectOrders,
        defaultAppSettings.vacantRoom.autoSelectOrders,
      ),
      autoSelectImages: booleanOr(
        vacantRoom.autoSelectImages,
        defaultAppSettings.vacantRoom.autoSelectImages,
      ),
      fillAutoSelectOrders: booleanOr(
        vacantRoom.fillAutoSelectOrders,
        defaultAppSettings.vacantRoom.fillAutoSelectOrders,
      ),
      fillIntervalSeconds,
    },
  };
}

export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
    return raw ? normalizeAppSettings(JSON.parse(raw)) : defaultAppSettings;
  } catch {
    return defaultAppSettings;
  }
}
