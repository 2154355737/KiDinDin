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

export type NativeUploadFile = {
  name: string;
  mime?: string;
  base64: string;
};

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

export async function fileToNativeUpload(file: File): Promise<NativeUploadFile> {
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });

  return { base64, mime: file.type || undefined, name: file.name };
}

export function nativeRequest(path: string, method: string, body?: unknown) {
  return nativeInvoke<unknown>("cis_request", { body: body ?? null, method, path });
}

export function fetchDeviceIdentityPreview() {
  return nativeInvoke<DeviceIdentityPreview>("device_identity_preview");
}

export function fetchIsMobileRuntime() {
  return nativeInvoke<boolean>("is_mobile_runtime");
}
