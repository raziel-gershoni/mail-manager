// Parse a query param from a request URL that may be RELATIVE.
// On Vercel's Node runtime, `Request.url` is a path like "/api/x?k=v" (not absolute),
// and `new URL(relative)` throws. A dummy base makes it parse either form.
const BASE = "http://localhost";

export function searchParam(reqUrl: string, name: string): string | null {
  return new URL(reqUrl, BASE).searchParams.get(name);
}
