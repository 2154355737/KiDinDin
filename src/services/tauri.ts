import { reserveUniqueUploadFileName } from "./uploadFileNameStore";
import { randomizeJpegSha256 } from "./jpegSha256Randomization";

export type AuthStatus = {
  authenticated: boolean;
  employeeNumber: string | null;
  expiresAt: number | null;
  refreshAvailable: boolean;
  username: string | null;
};

export type DeviceIdentityPreview = {
  appId: string;
  appVersion: string;
  platform: string;
  requestAgent: string;
  userAgent: string;
  referer: string;
};

export type FloatingOverlayStatus = {
  supported: boolean;
  permissionGranted: boolean;
  enabled: boolean;
  visible: boolean;
  accessibilitySupported: boolean;
  accessibilityEnabled: boolean;
  recognition: WorkOrderRecognitionTarget;
};

export type WorkOrderRecognitionTarget = {
  pending: boolean;
  state: string;
  message: string;
  logs: string;
  recognizedAt: number;
  accountKey: string;
  woHeaderId: string;
  woNumber: string;
  resident: string;
  contactPhone: string;
  address: string;
  sourceDate: string;
  securityDate: string;
  prefilled: boolean;
  prefilledAt: number;
  rawJson: string;
};

export type WorkOrderIndexEntry = {
  woHeaderId: string;
  woNumber: string;
  resident: string;
  contactPhone: string;
  address: string;
  eligiblePrefill: boolean;
  rawJson: string;
};

export type WorkOrderIndexSyncResult = {
  indexed: number;
  inserted: number;
  updated: number;
  total: number;
};

export type NativeUploadFile = {
  name: string;
  mime?: string;
  base64: string;
};

export type NativeUploadTiming = {
  durationMs: number;
  label: string;
};

export type NativeDatabaseBackupResult = {
  backup?: unknown;
  databaseName?: string;
  prefillHistoryCount?: number;
  supported: boolean;
  workOrderCount?: number;
};

export type NativeDatabaseImportResult = {
  prefillHistoryImported?: number;
  prefillHistoryTotal?: number;
  supported: boolean;
  workOrderTotal?: number;
  workOrdersImported?: number;
};

export type NativeDatabaseValidationResult = {
  prefillHistoryCount?: number;
  supported: boolean;
  valid: boolean;
  workOrderCount?: number;
};

export type NativeBackupFileResult = {
  destination?: string;
  error?: string;
  fileName?: string;
  sha256?: string;
  size?: number;
  supported: boolean;
  uri?: string;
};

export type NativeLargeBackupBeginResult = {
  error?: string;
  fileName?: string;
  sessionId?: string;
  supported: boolean;
};

export type NativeLargeBackupAppendResult = {
  appendedSize?: number;
  error?: string;
  sessionId?: string;
  size?: number;
  supported: boolean;
};

export type NativeLargeBackupAbortResult = {
  aborted?: boolean;
  error?: string;
  sessionId?: string;
  supported: boolean;
};

export const LARGE_BACKUP_CHUNK_CHARACTER_LIMIT = 4 * 1024 * 1024;

type TauriInternals = {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
};

export const WORK_ORDER_AUTH_EXPIRED_EVENT =
  "kidindin:work-order-auth-expired";

export type WorkOrderAuthExpiredDetail = {
  command: string;
  message: string;
  path: string | null;
  requestStartedAt: number;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function isWorkOrderAuthExpiredError(error: unknown) {
  const message = errorMessage(error);
  return (
    message.includes("用户凭证已过期") ||
    message.includes("登录已失效") ||
    (/(?:^|\D)401(?:\D|$)/.test(message) &&
      /unauthorized|凭证|认证|登录/i.test(message))
  );
}

export function reportWorkOrderAuthExpired(
  error: unknown,
  detail: Omit<WorkOrderAuthExpiredDetail, "message">,
) {
  if (!isWorkOrderAuthExpiredError(error)) return;
  window.dispatchEvent(
    new CustomEvent<WorkOrderAuthExpiredDetail>(
      WORK_ORDER_AUTH_EXPIRED_EVENT,
      { detail: { ...detail, message: errorMessage(error) } },
    ),
  );
}

function getTauriInternals() {
  const internals = (globalThis as typeof globalThis & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__;
  if (!internals?.invoke) {
    throw new Error("当前页面未运行在 KiDinDin 安卓应用中。请安装并打开 APK，不要用浏览器访问 localhost:1420。");
  }
  return internals;
}

export function isNativeRuntime() {
  return Boolean((globalThis as typeof globalThis & { __TAURI_INTERNALS__?: TauriInternals })
    .__TAURI_INTERNALS__?.invoke);
}

export function nativeInvoke<T>(command: string, args?: Record<string, unknown>) {
  const requestStartedAt = Date.now();
  return getTauriInternals()
    .invoke<T>(command, args)
    .catch((error) => {
      reportWorkOrderAuthExpired(error, {
        command,
        path: typeof args?.path === "string" ? args.path : null,
        requestStartedAt,
      });
      throw error;
    });
}

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`图片 ${file.name} 无法解码`));
    };
    image.src = objectUrl;
  });
}

async function createPreviewDataUrl(blob: Blob, sourceName: string) {
  const file = new File([blob], sourceName, { type: "image/jpeg" });
  const image = await loadImage(file);
  const maxEdge = 360;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`图片 ${sourceName} 生成本地预览失败`);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}

async function normalizeJpeg(file: File) {
  const header = new Uint8Array(await file.slice(0, 3).arrayBuffer());
  const isJpeg = header.length === 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (isJpeg) return new Blob([file], { type: "image/jpeg" });

  const image = await loadImage(file);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(`图片 ${file.name} 转换 JPEG 失败`);
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error(`图片 ${file.name} 转换 JPEG 失败`)),
      "image/jpeg",
      0.92,
    );
  });
}

export async function fileToNativeUpload(
  file: File,
  onTiming?: (timing: NativeUploadTiming) => void,
): Promise<NativeUploadFile> {
  const measure = async <T,>(
    label: string,
    operation: () => Promise<T>,
  ) => {
    const startedAt = performance.now();
    try {
      return await operation();
    } finally {
      onTiming?.({
        durationMs: Math.round(performance.now() - startedAt),
        label,
      });
    }
  };
  const jpeg = await measure("格式检查与 JPEG 归一化", () => normalizeJpeg(file));
  const randomized = await measure("随机信息与 SHA-256", () =>
    randomizeJpegSha256(jpeg, file),
  );
  const previewDataUrl = await measure("生成本地缩略图预览", () =>
    createPreviewDataUrl(randomized.blob, file.name),
  );
  const name = await measure("IndexedDB 生成唯一文件名", () =>
    reserveUniqueUploadFileName(
      file,
      previewDataUrl,
      new Date(),
      randomized.contentSha256,
    ),
  );
  const base64 = await measure(
    "FileReader 转 Base64",
    () =>
      new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(randomized.blob);
      }),
  );

  return { base64, mime: "image/jpeg", name };
}

export function nativeRequest(path: string, method: string, body?: unknown) {
  return nativeInvoke<unknown>("cis_request", { body: body ?? null, method, path });
}

export function downloadCemAudio(listenRecordUrl: string) {
  return nativeInvoke<{ base64: string; mime: string }>("cis_download_audio", { listenRecordUrl });
}

export function fetchDeviceIdentityPreview() {
  return nativeInvoke<DeviceIdentityPreview>("device_identity_preview");
}

export function fetchIsMobileRuntime() {
  return nativeInvoke<boolean>("is_mobile_runtime");
}

export function fetchFloatingOverlayStatus() {
  return nativeInvoke<FloatingOverlayStatus>("floating_overlay_status");
}

export function requestFloatingOverlayPermission() {
  return nativeInvoke<FloatingOverlayStatus>(
    "floating_overlay_request_permission",
  );
}

export function showFloatingOverlay() {
  return nativeInvoke<FloatingOverlayStatus>("floating_overlay_show");
}

export function hideFloatingOverlay() {
  return nativeInvoke<FloatingOverlayStatus>("floating_overlay_hide");
}

export function openWorkOrderRecognitionAccessibilitySettings() {
  return nativeInvoke<FloatingOverlayStatus>(
    "floating_overlay_open_accessibility_settings",
  );
}

export function syncNativeWorkOrderIndex(
  accountKey: string,
  sourceDate: string,
  entries: WorkOrderIndexEntry[],
) {
  return nativeInvoke<WorkOrderIndexSyncResult>("work_order_index_sync", {
    accountKey,
    sourceDate,
    entries,
  });
}

export function exportNativeDatabaseBackup() {
  if (!isNativeRuntime()) {
    return Promise.resolve({ supported: false } satisfies NativeDatabaseBackupResult);
  }
  return nativeInvoke<NativeDatabaseBackupResult>("native_database_export");
}

export function importNativeDatabaseBackup(payload: string) {
  if (!isNativeRuntime()) {
    return Promise.resolve({ supported: false } satisfies NativeDatabaseImportResult);
  }
  return nativeInvoke<NativeDatabaseImportResult>("native_database_import", { payload });
}

export function validateNativeDatabaseBackup(payload: string) {
  if (!isNativeRuntime()) {
    return Promise.resolve({ supported: false, valid: false } satisfies NativeDatabaseValidationResult);
  }
  return nativeInvoke<NativeDatabaseValidationResult>("native_database_validate", { payload });
}

export function saveNativeBackupFile(fileName: string, payload: string) {
  return nativeInvoke<NativeBackupFileResult>("save_backup_file", {
    fileName,
    payload,
  });
}

export function beginLargeBackupFile(fileName: string) {
  if (!isNativeRuntime()) {
    return Promise.resolve({
      error: "当前平台不支持大型备份文件流式写入",
      supported: false,
    } satisfies NativeLargeBackupBeginResult);
  }
  return nativeInvoke<NativeLargeBackupBeginResult>("begin_large_backup", {
    fileName,
  });
}

export function appendLargeBackupFile(sessionId: string, chunk: string) {
  if (chunk.length > LARGE_BACKUP_CHUNK_CHARACTER_LIMIT) {
    return Promise.reject(new Error("大型备份单次追加不能超过 4MiB 字符"));
  }
  if (!isNativeRuntime()) {
    return Promise.resolve({
      error: "当前平台不支持大型备份文件流式写入",
      supported: false,
    } satisfies NativeLargeBackupAppendResult);
  }
  return nativeInvoke<NativeLargeBackupAppendResult>("append_large_backup", {
    chunk,
    sessionId,
  });
}

export function finishLargeBackupFile(
  sessionId: string,
  expectedSize: number,
  expectedSha256: string,
) {
  if (!Number.isSafeInteger(expectedSize) || expectedSize < 0) {
    return Promise.reject(new Error("大型备份预期大小必须是安全的非负整数"));
  }
  if (!/^[a-f0-9]{64}$/i.test(expectedSha256.trim())) {
    return Promise.reject(new Error("大型备份预期 SHA-256 无效"));
  }
  if (!isNativeRuntime()) {
    return Promise.resolve({
      error: "当前平台不支持大型备份文件流式写入",
      supported: false,
    } satisfies NativeBackupFileResult);
  }
  return nativeInvoke<NativeBackupFileResult>("finish_large_backup", {
    expectedSha256: expectedSha256.trim().toLowerCase(),
    expectedSize,
    sessionId,
  });
}

export function abortLargeBackupFile(sessionId: string) {
  if (!isNativeRuntime()) {
    return Promise.resolve({
      error: "当前平台不支持大型备份文件流式写入",
      supported: false,
    } satisfies NativeLargeBackupAbortResult);
  }
  return nativeInvoke<NativeLargeBackupAbortResult>("abort_large_backup", {
    sessionId,
  });
}

export function consumePendingPrefillTarget() {
  return nativeInvoke<WorkOrderRecognitionTarget | { pending: false }>(
    "consume_pending_prefill_target",
  );
}

export function reportNativeWorkOrderPrefill(
  woHeaderId: string,
  state: "prefill_running" | "prefill_success" | "prefill_error",
  message: string,
) {
  return nativeInvoke<WorkOrderRecognitionTarget>("report_work_order_prefill", {
    woHeaderId,
    state,
    message,
  });
}

export function reportNativeWorkOrderSecurityDate(
  woHeaderId: string,
  securityDate: string,
) {
  return nativeInvoke<WorkOrderRecognitionTarget>(
    "report_work_order_security_date",
    { woHeaderId, securityDate },
  );
}
