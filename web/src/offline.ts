import { openDB, DBSchema } from 'idb';
import { api, ApiError, Item, User, json } from './api';
import { observeApiBuild } from './version';

type Operation = { id: string; userId: number; localId?: string; spaceId: number; kind: 'create'|'update'|'delete'|'restore'|'image'|'meta'; payload?: any; blob?: Blob; filename?: string; mode?: string; path?:string; method?:string; error?:string };
interface KazariDB extends DBSchema {
  snapshots: { key: string; value: { key: string; items: Item[]; at: string; meta?: Record<string, unknown> } };
  outbox: { key: string; value: Operation; indexes: { 'by-user': number } };
  users: { key: number; value: User };
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
export async function cachedUser(userId?: number) { if(!userId) return null; return (await (await dbPromise).get('users',userId)) || null; }
export async function cacheSpaces(userId: number, spaces: KazariDB['spaces']['value']) { await (await dbPromise).put('spaces',spaces,userId); }
export async function cachedSpaces(userId: number) { return (await (await dbPromise).get('spaces',userId)) || []; }
export async function cacheMeta(userId:number,spaceId:number,meta:Record<string,unknown>) { const db=await dbPromise;const tx=db.transaction('snapshots','readwrite');const key=snapshotKey(userId,spaceId);const old=await tx.store.get(key);await tx.store.put({key,items:old?.items||[],at:new Date().toISOString(),meta});await tx.done; }
export async function hasCachedSnapshot(userId:number,spaceId:number) { return !!(await (await dbPromise).get('snapshots',snapshotKey(userId,spaceId))); }
export async function cachedMeta(userId:number,spaceId:number) { return (await (await dbPromise).get('snapshots',snapshotKey(userId,spaceId)))?.meta || null; }
export async function cacheItems(userId:number,spaceId:number,items:Item[]) {
  const db=await dbPromise; const key=snapshotKey(userId,spaceId); const old=await db.get('snapshots',key); const queue=(await db.getAllFromIndex('outbox','by-user',userId)).filter(op=>op.spaceId===spaceId);const removed=new Set(queue.filter(op=>op.kind==='delete').map(op=>String(op.localId)));const supplied=new Set(items.map(item=>String(item.id)));const pending=[...items.filter(item=>item.pending),...(old?.items||[]).filter(item=>item.pending&&!supplied.has(String(item.id)))].filter(item=>!removed.has(String(item.id)));const pendingIds=new Set(pending.map(item=>String(item.id)));const visible=[...pending,...items.filter(item=>!removed.has(String(item.id))&&!pendingIds.has(String(item.id)))].slice(0,Math.max(80,pending.length));
  for(const item of visible) if(item.thumbnailUrl && !item.pendingImage) {
    try { const response=await fetch(item.thumbnailUrl,{credentials:'include'}); observeApiBuild(response); if(response.ok) await db.put('thumbs',await response.blob(),`${userId}:${item.id}`); } catch {}
  }
  const tx=db.transaction('snapshots','readwrite');const latest=await tx.store.get(key);await tx.store.put({key,items:visible,at:new Date().toISOString(),meta:latest?.meta});await tx.done;
}
export async function cachedItems(userId:number,spaceId:number) {
  const db=await dbPromise; const items=(await db.get('snapshots',snapshotKey(userId,spaceId)))?.items || [];
  return Promise.all(items.map(async item=>({ ...item, offlineThumbnail: item.pendingImage || (await db.get('thumbs',`${userId}:${item.id}`)) })));
}
export async function enqueue(op: Omit<Operation,'id'>) { const db=await dbPromise;const existing=(await db.getAllFromIndex('outbox','by-user',op.userId)).filter(entry=>entry.spaceId===op.spaceId&&entry.localId===op.localId);if(op.kind==='update'){const previous=existing.find(entry=>entry.kind==='update');if(previous){previous.payload={...previous.payload,...op.payload,baseUpdatedAt:previous.payload?.baseUpdatedAt};await db.put('outbox',previous);return previous;}const create=existing.find(entry=>entry.kind==='create');if(create){const {baseUpdatedAt,...payload}=op.payload||{};create.payload={...create.payload,...payload};await db.put('outbox',create);return create;}}if(op.kind==='delete'&&op.localId?.startsWith('local-')){for(const entry of existing)await db.delete('outbox',entry.id);return {...op,id:''} as Operation;}const record:Operation={...op,id:`${Date.now().toString().padStart(13,'0')}-${String(operationSequence++).padStart(6,'0')}-${crypto.randomUUID()}`}; await db.put('outbox',record); return record; }
export async function pendingCount(userId:number) { return (await (await dbPromise).getAllFromIndex('outbox','by-user',userId)).length; }
export async function pendingOperations(userId:number){return (await (await dbPromise).getAllFromIndex('outbox','by-user',userId)).map(op=>({id:op.id,kind:op.kind,name:String(op.payload?.title||op.payload?.name||op.filename||op.path||`Item ${op.localId||''}`),error:op.error}));}
export async function resolveQueuedConflict(userId:number,operationId:string,choice:'local'|'remote',remoteUpdatedAt?:string) { const db=await dbPromise;const op=await db.get('outbox',operationId);if(!op||op.userId!==userId||op.kind!=='update')throw new Error('Alteração pendente não encontrada.');if(choice==='local'){if(!remoteUpdatedAt)throw new Error('Versão do servidor não encontrada.');op.payload={...op.payload,baseUpdatedAt:remoteUpdatedAt,force:false};await db.put('outbox',op);}else{const tx=db.transaction(['outbox','snapshots'],'readwrite');await tx.objectStore('outbox').delete(operationId);const snap=await tx.objectStore('snapshots').get(snapshotKey(userId,op.spaceId));if(snap){snap.items=snap.items.filter(item=>String(item.id)!==op.localId);await tx.objectStore('snapshots').put(snap);}await tx.done;} }
export async function syncQueue(userId:number) {
  const db=await dbPromise; const queue=await db.getAllFromIndex('outbox','by-user',userId); let completed=0;let error:string|undefined;let conflict:{operationId:string;payload:Record<string,unknown>;remote:Item}|undefined;
  for(const initial of queue) {
    const op=await db.get('outbox',initial.id); if(!op) continue;
    try {
      let itemId=op.localId || (typeof op.payload?.id==='number'?String(op.payload.id):undefined);
      if(op.kind==='create') {
        const created=await api<Item>('/api/items',json('POST',op.payload));
        if(op.localId) {
          const tx=db.transaction(['snapshots','outbox'],'readwrite');
          for(const snap of await tx.objectStore('snapshots').getAll()) { snap.items=snap.items.map(i=>String(i.id)===op.localId?{...i,...created,pending:true}:i); await tx.objectStore('snapshots').put(snap); }
          for(const other of await tx.objectStore('outbox').getAll()) if(other.localId===op.localId) { other.localId=String(created.id); other.spaceId=created.spaceId; await tx.objectStore('outbox').put(other); }
          await tx.done;
          itemId=String(created.id);
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
      else if(op.kind==='meta'&&op.path&&op.method) await api(op.path,json(op.method,op.payload));
      await db.delete('outbox',op.id); completed++;
      if(itemId&&!itemId.startsWith('local-')){const remaining=(await db.getAllFromIndex('outbox','by-user',userId)).some(entry=>entry.localId===itemId);if(!remaining){const key=snapshotKey(userId,op.spaceId);const snap=await db.get('snapshots',key);if(snap){snap.items=snap.items.map(item=>String(item.id)===itemId?{...item,pending:false,pendingImage:undefined}:item);await db.put('snapshots',snap);}}}
    } catch(e) { if(op.kind==='update'&&e instanceof ApiError&&e.status===409&&e.payload?.current)conflict={operationId:op.id,payload:op.payload,remote:e.payload.current as Item};error=e instanceof Error?e.message:'Falha ao enviar uma alteração pendente.';await db.put('outbox',{...op,error});break; }
  }
  return {completed,pending:await pendingCount(userId),error,conflict};
}
