import { nativeInvoke, type AuthStatus } from "./tauri";

export type SessionInput = {
  tokenText: string;
  cookie?: string;
  sign?: string;
  target?: string;
};

export const fetchAuthStatus = () => nativeInvoke<AuthStatus>("cis_auth_status");

export const configureAuthSession = (input: SessionInput) =>
  nativeInvoke<AuthStatus>("cis_configure_session", { input });

export const logoutAuth = () => nativeInvoke<AuthStatus>("cis_clear_session");
