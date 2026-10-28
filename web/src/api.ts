import { observeApiBuild } from './version';

export type User = { id: number; username: string; displayName?:string; avatarUrl?:string|null; isAdmin: boolean };
export type Space = { id: number; name: string; role: 'owner' | 'editor' | 'reader' };
export type SpaceMember = { id: number; username: string; role: 'owner' | 'editor' | 'reader' };
export type NodeRecord = { id: number; spaceId: number; parentId: number | null; name: string; icon?: string | null };
export type Tag = { id: number; spaceId: number; name: string };
export type CustomField = { id: number; spaceId: number; name: string; type: 'text'|'number'|'date'|'currency'|'select'|'boolean'; options: string[] };
export type Item = {
  id: number | string; spaceId: number; title: string; description: string; locationId: number | null;
  purchaseUrl: string; purchaseLabel: string; customValues: Record<string, unknown>; imageId: string | null;
  imageMode: string; createdAt: string; updatedAt: string; deletedAt: string | null;
  inventory?: {favorite?:boolean;status?:'guardado'|'emprestado'|'vendido'|'descartado';borrower?:string;dueDate?:string;purchaseDate?:string;purchasePrice?:string;warrantyDate?:string;receiptUrl?:string};
  categories: { id: number; name: string; parentId: number | null; icon?: string | null }[]; tags: { id: number; name: string }[];
  location: { id: number; name: string; parentId: number | null; icon?: string | null } | null; imageUrl: string | null; thumbnailUrl: string | null;
  pending?: boolean; pendingImage?: Blob; offlineThumbnail?: Blob;
};
export class ApiError extends Error { constructor(public status: number, message: string, public payload?: Record<string, unknown>) { super(message); } }

export async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const isForm = options.body instanceof FormData;
  const response = await fetch(url, { ...options, signal:options.signal||AbortSignal.timeout(isForm?120000:20000), credentials: 'include', headers: { ...(isForm ? {} : { 'Content-Type': 'application/json' }), ...options.headers } });
  observeApiBuild(response);
  if (!response.ok) { let message = 'Não foi possível concluir a operação.'; let payload:Record<string,unknown>|undefined; try { payload = await response.json(); if(payload) message = String(payload.error || payload.message || message); } catch {} throw new ApiError(response.status, message, payload); }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

