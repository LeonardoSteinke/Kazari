import { openDB, DBSchema } from 'idb';
import { api, Item, json } from './api';

type Operation = { id: string; userId: number; localId?: string; spaceId: number; kind: 'create'|'update'|'delete'|'restore'|'image'; payload?: any; blob?: Blob; filename?: string; mode?: string };
interface KazariDB extends DBSchema {
  snapshots: { key: string; value: { key: string; items: Item[]; at: string; meta?: Record<string, unknown> } };
  outbox: { key: string; value: Operation; indexes: { 'by-user': number } };
  users: { key: number; value: { id: number; username: string; isAdmin: boolean } };
  spaces: { key: number; value: { id: number; name: string; role: string }[] };
  thumbs: { key: string; value: Blob };
}
const dbPromise = openDB<KazariDB>('kazari-local-v1', 1, { upgrade(db) {
  db.createObjectStore('snapshots', { keyPath: 'key' }); const queue=db.createObjectStore('outbox',{keyPath:'id'}); queue.createIndex('by-user','userId');
  db.createObjectStore('users'); db.createObjectStore('spaces'); db.createObjectStore('thumbs');
} });
let operationSequence=0;
const snapshotKey = (userId: number, spaceId: number) => `${userId}:${spaceId}`;
export async function cacheUser(user: KazariDB['users']['value'] | null) { const db=await dbPromise; if(user) await db.put('users',user,user.id); }
export async function cachedUser(userId?: number) { if(!userId) return null; return (await dbPromise).get('users',userId) || null; }
export async function cacheSpaces(userId: number, spaces: KazariDB['spaces']['value']) { await (await dbPromise).put('spaces',spaces,userId); }
export async function cachedSpaces(userId: number) { return (await dbPromise).get('spaces',userId) || []; }
export async function cacheMeta(userId:number,spaceId:number,meta:Record<string,unknown>) { const db=await dbPromise; const key=snapshotKey(userId,spaceId); const old=await db.get('snapshots',key); await db.put('snapshots',{key,items:old?.items||[],at:new Date().toISOString(),meta}); }
export async function cachedMeta(userId:number,spaceId:number) { return (await (await dbPromise).get('snapshots',snapshotKey(userId,spaceId)))?.meta || null; }
export async function cacheItems(userId:number,spaceId:number,items:Item[]) {
  const db=await dbPromise; const key=snapshotKey(userId,spaceId); const old=await db.get('snapshots',key); const visible=items.slice(0,80);
  for(const item of visible) if(item.thumbnailUrl && !item.pendingImage) {
    try { const response=await fetch(item.thumbnailUrl,{credentials:'include'}); if(response.ok) await db.put('thumbs',await response.blob(),`${userId}:${item.id}`); } catch {}
  }
  await db.put('snapshots',{key,items:visible,at:new Date().toISOString(),meta:old?.meta});
}
export async function cachedItems(userId:number,spaceId:number) {
  const db=await dbPromise; const items=(await db.get('snapshots',snapshotKey(userId,spaceId)))?.items || [];
  return Promise.all(items.map(async item=>({ ...item, offlineThumbnail: item.pendingImage || (await db.get('thumbs',`${userId}:${item.id}`)) })));
}
export async function enqueue(op: Omit<Operation,'id'>) { const record:Operation={...op,id:`${Date.now().toString().padStart(13,'0')}-${String(operationSequence++).padStart(6,'0')}-${crypto.randomUUID()}`}; await (await dbPromise).put('outbox',record); return record; }
export async function pendingCount(userId:number) { return (await (await dbPromise).getAllFromIndex('outbox','by-user',userId)).length; }
export async function syncQueue(userId:number) {
  const db=await dbPromise; const queue=await db.getAllFromIndex('outbox','by-user',userId); let completed=0;let error:string|undefined;
  for(const initial of queue) {
    const op=await db.get('outbox',initial.id); if(!op) continue;
    try {
      const itemId=op.localId || (typeof op.payload?.id==='number'?String(op.payload.id):undefined);
      if(op.kind==='create') {
        const created=await api<Item>('/api/items',json('POST',op.payload));
        if(op.localId) {
          const tx=db.transaction(['snapshots','outbox'],'readwrite');
          for(const snap of await tx.objectStore('snapshots').getAll()) { snap.items=snap.items.map(i=>String(i.id)===op.localId?{...i,...created,pending:true}:i); await tx.objectStore('snapshots').put(snap); }
          for(const other of await tx.objectStore('outbox').getAll()) if(other.localId===op.localId) { other.localId=String(created.id); other.spaceId=created.spaceId; await tx.objectStore('outbox').put(other); }
          await tx.done;
        }
      } else if(op.kind==='image') {
        if(!itemId || itemId.startsWith('local-')) throw new Error('Aguardando criação do item.');
        const form=new FormData(); form.append('image',op.blob!,op.filename||'foto'); form.append('mode',op.mode||'optimized');
        const updated=await api<Item>(`/api/items/${itemId}/image`,{method:'POST',body:form});
        for(const snap of await db.getAll('snapshots')) { snap.items=snap.items.map(i=>String(i.id)===String(itemId)?{...i,...updated,pending:false,pendingImage:undefined}:i); await db.put('snapshots',snap); }
      } else if(op.kind==='update') {
        if(!itemId || itemId.startsWith('local-')) throw new Error('Aguardando criação do item.');
        await api(`/api/items/${itemId}`,json('PATCH',op.payload));
      } else if(op.kind==='delete') {
        if(!itemId || itemId.startsWith('local-')) { await db.delete('outbox',op.id); completed++; continue; }
        await api(`/api/items/${itemId}`,{method:'DELETE'});
      } else if(op.kind==='restore' && itemId) await api(`/api/items/${itemId}/restore`,{method:'POST'});
      await db.delete('outbox',op.id); completed++;
    } catch(e) { error=e instanceof Error?e.message:'Falha ao enviar uma alteração pendente.';break; }
  }
  return {completed,pending:await pendingCount(userId),error};
}
