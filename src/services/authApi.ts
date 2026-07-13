import { nativeInvoke, type AuthStatus } from "./tauri";

export type SessionInput = {
  tokenText: string;
  cookie?: string;
  sign?: string;
  target?: string;
};

export type AuthHistoryItem = {
  id: string;
  employeeNumber: string | null;
  lastUsedAt: number;
  tokenHint: string;
  username: string | null;
};

export const fetchAuthStatus = () => nativeInvoke<AuthStatus>("cis_auth_status");

export const configureAuthSession = (input: SessionInput) =>
  nativeInvoke<AuthStatus>("cis_configure_session", { input });

export const logoutAuth = () => nativeInvoke<AuthStatus>("cis_clear_session");

export const fetchAuthHistory = () => nativeInvoke<AuthHistoryItem[]>("cis_auth_history");

export const restoreAuthHistory = (id: string) =>
  nativeInvoke<AuthStatus>("cis_restore_auth_history", { id });

export const refreshAuthSession = () => nativeInvoke<AuthStatus>("cis_refresh_auth_session");

export const setAuthRefreshToken = (refreshToken: string) =>
  nativeInvoke<AuthStatus>("cis_set_refresh_token", { input: { refreshToken } });

export const exportAuthSession = (input: { verification: "biometric" | "password"; password?: string }) =>
  nativeInvoke<string>("cis_export_auth_session", { input });
