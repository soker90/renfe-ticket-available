// ---------------------------------------------------------------------------
// Cliente HTTP con gestión de cookies persistentes
// ---------------------------------------------------------------------------

const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "*/*",
};

export class CookieClient {
  private cookies: Map<string, string> = new Map();

  /** Establece una cookie manualmente */
  setCookie(name: string, value: string): void {
    this.cookies.set(name, value);
  }

  /** Construye la string de cookies para el header */
  getCookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  /** Extrae cookies de los headers Set-Cookie de la respuesta */
  extractCookies(response: Response): void {
    const setCookies = (response.headers as unknown as { getSetCookie(): string[] }).getSetCookie?.() ?? [];
    for (const cookie of setCookies) {
      const parts = cookie.split(";")[0];
      const eqIdx = parts.indexOf("=");
      if (eqIdx > 0) {
        const name = parts.substring(0, eqIdx).trim();
        const value = parts.substring(eqIdx + 1).trim();
        this.cookies.set(name, value);
      }
    }
  }

  /**
   * Realiza una petición HTTP con cookies persistentes.
   * Maneja redirects manualmente para capturar cookies en cada paso.
   */
  async request(url: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      ...DEFAULT_HEADERS,
      ...(options.headers as Record<string, string>),
    };

    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    const response = await fetch(url, {
      ...options,
      headers,
      redirect: "manual",
    });

    this.extractCookies(response);

    // Seguir redirects manualmente
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (location) {
        const redirectUrl = new URL(location, url).toString();
        await response.text().catch(() => {});
        return this.request(redirectUrl, {
          method: "GET",
          headers: {},
        });
      }
    }

    return response;
  }
}
