import { observeApiBuild } from './version';

export type User = { id: number; username: string; isAdmin: boolean };
export type Space = { id: number; name: string; role: 'owner' | 'editor' | 'reader' };
export type SpaceMember = { id: number; username: string; role: 'owner' | 'editor' | 'reader' };
export type NodeRecord = { id: number; spaceId: number; parentId: number | null; name: string };
export type Tag = { id: number; spaceId: number; name: string };
export type CustomField = { id: number; spaceId: number; name: string; type: 'text'|'number'|'date'|'currency'|'select'|'boolean'; options: string[] };
export type Item = {
  id: number | string; spaceId: number; title: string; description: string; locationId: number | null;
  purchaseUrl: string; purchaseLabel: string; customValues: Record<string, unknown>; imageId: string | null;
  imageMode: string; createdAt: string; updatedAt: string; deletedAt: string | null;
  categories: { id: number; name: string; parentId: number | null }[]; tags: { id: number; name: string }[];
  location: { id: number; name: string; parentId: number | null } | null; imageUrl: string | null; thumbnailUrl: string | null;
  pending?: boolean; pendingImage?: Blob; offlineThumbnail?: Blob;
};
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(url, { ...options, credentials: 'include', headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  observeApiBuild(response);
  if (!response.ok) { let message = 'Não foi possível concluir a operação.'; try { const payload = await response.json(); message = payload.error || payload.message || message; } catch {} throw new ApiError(response.status, message); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

