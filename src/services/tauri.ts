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
  return getTauriInternals().invoke<T>(command, args);
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
