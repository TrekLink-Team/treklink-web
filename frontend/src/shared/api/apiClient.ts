export interface StandardApiResponse<T> {
  result: T | null;
  isSuccess: boolean;
  statusCode: number;
  message: string;
}

const BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const token = localStorage.getItem('treklink_access_token');

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(`${BASE_URL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`, {
    ...options,
    headers,
  });

  const data: StandardApiResponse<T> = await response.json();

  if (!response.ok || !data.isSuccess) {
    throw new ApiError(data.statusCode || response.status, data.message || 'API request failed');
  }

  return data.result as T;
}
