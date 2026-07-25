export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function requestJSON<T = unknown>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const data: unknown = await response.json().catch(() => null);
  const error = data && typeof data === 'object' && 'error' in data
    ? String((data as { error: unknown }).error)
    : '';
  if (!response.ok) throw new ApiError(error || `${path} ${response.status}`, response.status);
  if (data === null) throw new ApiError(`${path} returned invalid JSON`, response.status);
  return data as T;
}
