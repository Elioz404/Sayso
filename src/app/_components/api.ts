// The one way client components call Sayso's own API: JSON in, JSON out, and the server's message as
// the error when it says no.

export async function callApi<T = Record<string, unknown>>(url: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE' = 'POST', body?: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(url, method === 'GET' ? { headers } : { method, headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Something went wrong (${res.status})`);
  return data;
}
