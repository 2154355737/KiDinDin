const STORAGE_KEY = "kidindin-resident-security-prefilled";

export function getResidentSecurityPrefilledIds(accountKey: string): string[] {
  try {
    const stored = localStorage.getItem(`${STORAGE_KEY}:${accountKey}`);
    if (!stored) return [];
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function addResidentSecurityPrefilledId(accountKey: string, woHeaderId: string): void {
  try {
    const current = getResidentSecurityPrefilledIds(accountKey);
    const updated = Array.from(new Set([...current, woHeaderId]));
    localStorage.setItem(`${STORAGE_KEY}:${accountKey}`, JSON.stringify(updated));
  } catch {
    // 忽略存储失败
  }
}

export function removeResidentSecurityPrefilledId(accountKey: string, woHeaderId: string): void {
  try {
    const current = getResidentSecurityPrefilledIds(accountKey);
    const updated = current.filter((id) => id !== woHeaderId);
    localStorage.setItem(`${STORAGE_KEY}:${accountKey}`, JSON.stringify(updated));
  } catch {
    // 忽略存储失败
  }
}

export function clearResidentSecurityPrefilledIds(accountKey: string): void {
  try {
    localStorage.removeItem(`${STORAGE_KEY}:${accountKey}`);
  } catch {
    // 忽略清除失败
  }
}
