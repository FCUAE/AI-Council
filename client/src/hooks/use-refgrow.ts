declare global {
  interface Window {
    Refgrow?: (action: number, event: string, email: string) => void;
  }
}

export function getRefgrowReferral(): string | undefined {
  if (typeof window === "undefined") return undefined;

  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "refgrow_ref_code" && value) return decodeURIComponent(value);
  }

  return undefined;
}

export function trackRefgrowSignup(email: string) {
  if (typeof window === "undefined") return;
  if (window.Refgrow) {
    window.Refgrow(0, "signup", email);
  }
}
