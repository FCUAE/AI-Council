type TokenGetter = () => Promise<string | null>;

let _getToken: TokenGetter | null = null;

export function setClerkTokenGetter(fn: TokenGetter) {
  _getToken = fn;
}

export async function getClerkToken(): Promise<string | null> {
  if (!_getToken) return null;
  try {
    return await _getToken();
  } catch {
    return null;
  }
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getClerkToken();
  const headers = new Headers(options.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(url, { ...options, headers, credentials: "include" });
}
