const PASSWORD_RECOVERY_PENDING_KEY = "passwordRecoveryPending";
const PASSWORD_RECOVERY_PENDING_TTL = 30 * 60 * 1000;

export const isPasswordRecoveryUrl = () => {
  if (typeof window === "undefined") {
    return false;
  }

  const url = new URL(window.location.href);
  if (url.searchParams.get("type") === "recovery") {
    return true;
  }

  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (new URLSearchParams(hash).get("type") === "recovery") {
    return true;
  }

  const pendingAt = Number(
    window.localStorage.getItem(PASSWORD_RECOVERY_PENDING_KEY),
  );
  return (
    Number.isFinite(pendingAt) &&
    Date.now() - pendingAt >= 0 &&
    Date.now() - pendingAt <= PASSWORD_RECOVERY_PENDING_TTL
  );
};

export const markPasswordRecoveryPending = () => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(
      PASSWORD_RECOVERY_PENDING_KEY,
      String(Date.now()),
    );
  }
};

export const clearPasswordRecoveryPending = () => {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(PASSWORD_RECOVERY_PENDING_KEY);
  }
};
