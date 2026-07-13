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
