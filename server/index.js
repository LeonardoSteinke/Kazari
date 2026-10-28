import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import sharp from 'sharp';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { db, DATA_DIR, snapshot } from './db.js';

const app = express();
const PORT = Number(process.env.PORT || 3000);
const SECRET = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const MAX_IMAGE = Math.min(10, Math.max(1, Number(process.env.MAX_IMAGE_MB || 10))) * 1024 * 1024;
if (process.env.NODE_ENV === 'production' && (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'dev-only-change-this-secret' || !process.env.MASTER_CODE)) {
  throw new Error('Configure JWT_SECRET e MASTER_CODE fortes antes de iniciar em produção.');
}
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|heic|heif|avif)$/.test(file.mimetype)) });
// Keep the build identifier on every API response so clients can detect a
// deploy on their next request, even when the PWA has been suspended.
const webDir=path.resolve('web/dist');
let buildId='dev'; try { buildId=JSON.parse(readFileSync(path.join(webDir,'version.json'),'utf8')).build; } catch {}
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], imgSrc: ["'self'", 'blob:', 'data:'], styleSrc: ["'self'"], fontSrc: ["'self'"], scriptSrc: ["'self'"], connectSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'self'"] } } }));
app.use('/api', (_req,res,next) => { res.set('X-Kazari-Build',buildId||'dev'); next(); });
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const hashCode = (value) => crypto.createHash('sha256').update(value).digest('hex');
const tokenCookie = (req) => ({ httpOnly: true, sameSite: 'lax', secure: req.secure, path: '/', maxAge: 30 * 86400000 });
function auth(req, res, next) {
 try {
   const token = req.cookies.kazari_session;
   if (!token) return res.status(401).json({ error: 'Entre na sua conta para continuar.' });
   req.user = jwt.verify(token, SECRET);
   next();
 } catch { res.clearCookie('kazari_session', { path: '/' }); res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' }); }
}
function admin(req, res, next) { if (!req.user?.admin) return res.status(403).json({ error: 'Apenas a conta master pode fazer isso.' }); next(); }
const userView = (u) => ({ id: u.id, username: u.username, isAdmin: !!u.is_admin });
const parseId = (v) => Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null;
function fail(res, message, status = 400) { return res.status(status).json({ error: message }); }
const registerLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, handler: (_req, res) => fail(res, 'Muitas tentativas de cadastro. Aguarde 15 minutos e tente novamente.', 429) });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, handler: (_req, res) => fail(res, 'Muitas tentativas de acesso. Aguarde 15 minutos e tente novamente.', 429) });
const asyncHandler = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'kazari' }));
app.post('/api/auth/register', registerLimiter, asyncHandler(async (req, res) => {
 const schema = z.object({ username: z.string().trim().min(3).max(40).regex(/^[\p{L}\p{N}_.-]+$/u), password: z.string().min(10).max(200), code: z.string().trim().min(8).max(200) });
 const parsed = schema.safeParse(req.body); if (!parsed.success) return fail(res, 'Informe usuário, senha de ao menos 10 caracteres e código válido.');
 const { username, password, code } = parsed.data;
 const passwordHash=await bcrypt.hash(password,12);let user;
 try {
  user=db.transaction(()=>{
   if(db.prepare('SELECT 1 FROM users WHERE username=? COLLATE NOCASE').get(username))throw Object.assign(new Error('DUPLICATE_USER'),{code:'DUPLICATE_USER'});
   const isFirst=!db.prepare('SELECT 1 FROM users LIMIT 1').get();
   let isAdmin=false;
   if(isFirst){if(!process.env.MASTER_CODE||code!==process.env.MASTER_CODE)throw Object.assign(new Error('INVALID_MASTER'),{code:'INVALID_MASTER'});isAdmin=true;}
   else {const invite=db.prepare('SELECT id FROM invites WHERE code_hash=? AND used_at IS NULL AND expires_at>?').get(hashCode(code),new Date().toISOString());if(!invite)throw Object.assign(new Error('INVALID_INVITE'),{code:'INVALID_INVITE'});db.prepare('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL').run(new Date().toISOString(),invite.id);}
   const result=db.prepare('INSERT INTO users(username,password_hash,is_admin) VALUES(?,?,?)').run(username,passwordHash,Number(isAdmin));
   return {id:Number(result.lastInsertRowid),username,admin:isAdmin};
  }).immediate();
 }catch(e){if(e.code==='DUPLICATE_USER'||String(e.message).includes('UNIQUE constraint failed: users.username'))return fail(res,'Esse nome de usuário já está em uso.',409);if(e.code==='INVALID_MASTER')return fail(res,'Código master inválido.',403);if(e.code==='INVALID_INVITE')return fail(res,'Código de convite inválido, expirado ou já utilizado.',403);throw e;}
 res.cookie('kazari_session', jwt.sign(user, SECRET, { expiresIn: '30d' }), tokenCookie(req)); res.status(201).json({ user: { id: user.id, username, isAdmin:user.admin } });
}));
app.post('/api/auth/login', loginLimiter, asyncHandler(async (req, res) => {
 const { username, password } = req.body || {};
 if (typeof username !== 'string' || typeof password !== 'string') return fail(res, 'Informe usuário e senha.', 400);
 const row = db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(username.trim());
 if (!row || !(await bcrypt.compare(password, row.password_hash))) return fail(res, 'Usuário ou senha incorretos.', 401);
 const user = { id: row.id, username: row.username, admin: !!row.is_admin };
 res.cookie('kazari_session', jwt.sign(user, SECRET, { expiresIn: '30d' }), tokenCookie(req)); res.json({ user: userView(row) });
}));
app.post('/api/auth/logout', (_req, res) => { res.clearCookie('kazari_session', { path: '/' }); res.json({ ok: true }); });
app.get('/api/auth/me', auth, (req, res) => res.json({ user: { id: req.user.id, username: req.user.username, isAdmin: !!req.user.admin } }));

app.post('/api/invites', auth, admin, (req, res) => {
 const code = crypto.randomBytes(18).toString('base64url'); const expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
 db.prepare('INSERT INTO invites(code_hash,created_by,expires_at) VALUES(?,?,?)').run(hashCode(code), req.user.id, expiresAt);
 res.status(201).json({ code, expiresAt });
});
app.get('/api/invites', auth, admin, (_req, res) => res.json(db.prepare("SELECT id,expires_at AS expiresAt,used_at AS usedAt FROM invites ORDER BY id DESC LIMIT 100").all()));
app.get('/api/admin/users',auth,admin,(_req,res)=>res.json(db.prepare(`
 SELECT u.id,u.username,CASE WHEN u.is_admin=1 THEN 1 ELSE 0 END AS isAdmin,
  u.created_at AS createdAt,
  COUNT(DISTINCT CASE WHEN s.deleted_at IS NULL THEN s.id END) AS ownedSpaces,
  COUNT(DISTINCT CASE WHEN sm.space_id IS NOT NULL AND shared.deleted_at IS NULL THEN sm.space_id END) AS sharedSpaces,
  COUNT(DISTINCT CASE WHEN s.deleted_at IS NULL AND i.deleted_at IS NULL THEN i.id END) AS activeItems
 FROM users u
 LEFT JOIN spaces s ON s.owner_id=u.id
 LEFT JOIN items i ON i.space_id=s.id
 LEFT JOIN space_members sm ON sm.user_id=u.id
 LEFT JOIN spaces shared ON shared.id=sm.space_id
 GROUP BY u.id
 ORDER BY u.created_at DESC,u.username COLLATE NOCASE
`).all().map(row=>({...row,isAdmin:!!row.isAdmin}))));

app.get('/api/spaces', auth, (req, res) => res.json(db.prepare(`
 SELECT * FROM (
  SELECT id,name,'owner' AS role,created_at AS createdAt FROM spaces WHERE owner_id=? AND deleted_at IS NULL
  UNION ALL
  SELECT s.id,s.name,m.role,s.created_at AS createdAt FROM space_members m JOIN spaces s ON s.id=m.space_id WHERE m.user_id=? AND s.deleted_at IS NULL
 ) ORDER BY name COLLATE NOCASE
`).all(req.user.id,req.user.id)));
app.get('/api/spaces/deleted',auth,(req,res)=>res.json(db.prepare(`
 SELECT id,name,deleted_at AS deletedAt FROM spaces
 WHERE owner_id=? AND deleted_at IS NOT NULL AND julianday(deleted_at)>julianday('now','-7 days')
 ORDER BY deleted_at DESC
`).all(req.user.id)));
app.post('/api/spaces', auth, (req, res) => {
 const name = z.string().trim().min(1).max(80).safeParse(req.body?.name); if (!name.success) return fail(res, 'Nome do espaço obrigatório (até 80 caracteres).');
 const r=db.prepare('INSERT INTO spaces(name,owner_id) VALUES(?,?)').run(name.data,req.user.id);
 res.status(201).json({ id:Number(r.lastInsertRowid), name:name.data, role:'owner' });
});
app.patch('/api/spaces/:id', auth, (req,res,next)=>isSpaceOwner(Number(req.params.id),req.user.id)?next():fail(res,'Apenas o proprietário pode renomear este espaço.',403), (req, res) => {
 const name=z.string().trim().min(1).max(80).safeParse(req.body?.name);if(!name.success)return fail(res,'Nome do espaço inválido.');
 db.prepare('UPDATE spaces SET name=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(name.data,req.params.id);res.json({id:Number(req.params.id),name:name.data});
});
app.delete('/api/spaces/:id',auth,(req,res)=>{
 const sid=parseId(req.params.id);if(!sid||!isSpaceOwner(sid,req.user.id))return fail(res,'Apenas o proprietário pode excluir este espaço.',403);
 const space=db.prepare('SELECT name FROM spaces WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(sid,req.user.id);
 if(!space)return fail(res,'Espaço não encontrado.',404);
 if(req.body?.confirmName!==space.name)return fail(res,'Digite o nome exato do espaço para confirmar a exclusão.');
 const active=db.prepare('SELECT COUNT(*) AS total FROM spaces WHERE owner_id=? AND deleted_at IS NULL').get(req.user.id).total;
 if(active<=1)return fail(res,'Crie outro espaço antes de excluir o último espaço ativo.');
 const deletedAt=new Date().toISOString();
 db.prepare('UPDATE spaces SET deleted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(deletedAt,sid);
 res.json({ok:true,id:sid,name:space.name,deletedAt,restoreDays:7});
});
app.post('/api/spaces/:id/restore',auth,(req,res)=>{
 const sid=parseId(req.params.id);if(!sid)return fail(res,'Espaço inválido.');
 const space=db.prepare(`SELECT id,name,deleted_at AS deletedAt FROM spaces WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL`).get(sid,req.user.id);
 if(!space)return fail(res,'Espaço não encontrado na lixeira.',404);
 if(!db.prepare("SELECT 1 FROM spaces WHERE id=? AND owner_id=? AND julianday(deleted_at)>julianday('now','-7 days')").get(sid,req.user.id))return fail(res,'O prazo de restauração de 7 dias expirou.',410);
 db.prepare('UPDATE spaces SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(sid);
 res.json({id:sid,name:space.name,role:'owner'});
});
app.get('/api/spaces/:id/members',auth,(req,res)=>{
 const sid=parseId(req.params.id);if(!sid||!isSpaceOwner(sid,req.user.id))return fail(res,'Apenas o proprietário pode gerenciar o acesso.',403);
 const owner=db.prepare('SELECT id,username,\'owner\' AS role FROM users WHERE id=(SELECT owner_id FROM spaces WHERE id=?)').get(sid);
 const members=db.prepare("SELECT u.id,u.username,m.role FROM space_members m JOIN users u ON u.id=m.user_id WHERE m.space_id=? ORDER BY u.username COLLATE NOCASE").all(sid);
 res.json([owner,...members]);
});
app.post('/api/spaces/:id/members',auth,(req,res)=>{
 const sid=parseId(req.params.id);if(!sid||!isSpaceOwner(sid,req.user.id))return fail(res,'Apenas o proprietário pode compartilhar este espaço.',403);
 const input=z.object({username:z.string().trim().min(3).max(40),role:z.enum(['editor','reader'])}).safeParse(req.body);
 if(!input.success)return fail(res,'Informe um usuário cadastrado e o nível de acesso.');
 const target=db.prepare('SELECT id,username FROM users WHERE username=? COLLATE NOCASE').get(input.data.username);
 if(!target)return fail(res,'Não encontrei essa conta. Ela precisa criar uma conta no Kazari primeiro.',404);
 if(target.id===req.user.id)return fail(res,'Você já é o proprietário deste espaço.');
 db.prepare(`INSERT INTO space_members(space_id,user_id,role,added_by) VALUES(?,?,?,?)
  ON CONFLICT(space_id,user_id) DO UPDATE SET role=excluded.role,added_by=excluded.added_by`).run(sid,target.id,input.data.role,req.user.id);
 res.status(201).json({id:target.id,username:target.username,role:input.data.role});
});
app.delete('/api/spaces/:id/members/:userId',auth,(req,res)=>{
 const sid=parseId(req.params.id);const uid=parseId(req.params.userId);
 if(!sid||!isSpaceOwner(sid,req.user.id))return fail(res,'Apenas o proprietário pode gerenciar o acesso.',403);
 if(!uid)return fail(res,'Conta inválida.');
 const removed=db.prepare('DELETE FROM space_members WHERE space_id=? AND user_id=?').run(sid,uid);
 if(!removed.changes)return fail(res,'Essa conta não tem acesso compartilhado a este espaço.',404);
 res.json({ok:true});
});
function treeRoutes(table, noun) {
 const icons=['none','banheiro','cozinha','decoracao','eletros','escritorio','louca','moveis','quarto','sala','utensilios'];
 app.get(`/api/${noun}`, auth, (req, res) => {
   const sid = parseId(req.query.spaceId); if (!sid) return fail(res, 'spaceId obrigatório.');
   if (!canAccessSpace(sid,req.user.id)) return fail(res, 'Espaço não encontrado.', 404);
   res.json(db.prepare(`SELECT id,space_id AS spaceId,parent_id AS parentId,name,icon FROM ${table} WHERE space_id=? ORDER BY name COLLATE NOCASE`).all(sid));
 });
 app.post(`/api/${noun}`, auth, (req, res) => {
   const sid = parseId(req.body?.spaceId); if (!sid) return fail(res, 'spaceId obrigatório.');
   if (!canAccessSpace(sid,req.user.id,true)) return fail(res, 'Sem permissão para editar.', 403);
   const name = z.string().trim().min(1).max(100).safeParse(req.body?.name); if (!name.success) return fail(res, 'Nome inválido.');
   const parent = req.body?.parentId ? parseId(req.body.parentId) : null;
   const icon = req.body?.icon == null || req.body.icon === '' ? null : z.enum(icons).safeParse(req.body.icon).success ? req.body.icon : undefined;
   if (icon === undefined) return fail(res, 'Ícone inválido.');
   if (parent && !db.prepare(`SELECT id FROM ${table} WHERE id=? AND space_id=?`).get(parent, sid)) return fail(res, 'Categoria ou localização pai inválida.');
   const r = db.prepare(`INSERT INTO ${table}(space_id,parent_id,name,icon) VALUES(?,?,?,?)`).run(sid, parent, name.data, icon);
   res.status(201).json({ id: Number(r.lastInsertRowid), spaceId: sid, parentId: parent, name: name.data, icon });
 });
 app.patch(`/api/${noun}/:id`, auth, (req,res)=>{
   const id=parseId(req.params.id);const row=id&&db.prepare(`SELECT space_id AS spaceId FROM ${table} WHERE id=?`).get(id);
   if(!row)return fail(res,'Não encontrado.',404);
   if(!canAccessSpace(row.spaceId,req.user.id,true))return fail(res,'Sem permissão.',403);
   const name=req.body?.name===undefined?undefined:z.string().trim().min(1).max(100).safeParse(req.body.name);
   if(name&& !name.success)return fail(res,'Nome inválido.');
   let icon;
   if(req.body?.icon!==undefined){icon=req.body.icon==null||req.body.icon===''?null:z.enum(icons).safeParse(req.body.icon).success?req.body.icon:undefined;if(icon===undefined&&req.body.icon!==null&&req.body.icon!=='')return fail(res,'Ícone inválido.');}
   db.prepare(`UPDATE ${table} SET name=COALESCE(?,name),icon=CASE WHEN ? THEN ? ELSE icon END WHERE id=?`).run(name?.data||null,req.body?.icon!==undefined?1:0,icon??null,id);
   res.json(db.prepare(`SELECT id,space_id AS spaceId,parent_id AS parentId,name,icon FROM ${table} WHERE id=?`).get(id));
 });
 app.delete(`/api/${noun}/:id`, auth, (req, res) => {
   const row = db.prepare(`SELECT space_id FROM ${table} WHERE id=?`).get(req.params.id); if (!row) return fail(res, 'Não encontrado.', 404);
   if (!canAccessSpace(row.space_id,req.user.id,true)) return fail(res, 'Sem permissão.', 403);
   db.prepare(`DELETE FROM ${table} WHERE id=?`).run(req.params.id); res.json({ ok: true });
 });
}
treeRoutes('categories', 'categories'); treeRoutes('locations', 'locations');

app.get('/api/tags', auth, (req, res) => {
 const sid = parseId(req.query.spaceId); if (!sid || !canAccessSpace(sid,req.user.id)) return fail(res, 'Espaço não encontrado.', 404);
 res.json(db.prepare('SELECT id,space_id AS spaceId,name FROM tags WHERE space_id=? ORDER BY name COLLATE NOCASE').all(sid));
});
app.post('/api/tags', auth, (req, res) => {
 const sid = parseId(req.body?.spaceId); const name = z.string().trim().min(1).max(40).safeParse(req.body?.name); if (!sid || !name.success) return fail(res, 'Espaço e nome da tag obrigatórios.');
 if (!canAccessSpace(sid,req.user.id,true)) return fail(res, 'Sem permissão.', 403);
 const r = db.prepare('INSERT INTO tags(space_id,name) VALUES(?,?) ON CONFLICT(space_id,name) DO NOTHING').run(sid, name.data);
 const row = db.prepare('SELECT id,space_id AS spaceId,name FROM tags WHERE space_id=? AND name=?').get(sid, name.data); res.status(r.changes ? 201 : 200).json(row);
});
app.get('/api/fields', auth, (req, res) => {
 const sid = parseId(req.query.spaceId); if (!sid || !canAccessSpace(sid,req.user.id)) return fail(res, 'Espaço não encontrado.', 404);
 res.json(db.prepare('SELECT id,space_id AS spaceId,name,type,options FROM custom_fields WHERE space_id=? ORDER BY position,id').all(sid).map(x => ({ ...x, options: JSON.parse(x.options) })));
});
app.post('/api/fields', auth, (req, res) => {
 const sid = parseId(req.body?.spaceId); const s = z.object({ name: z.string().trim().min(1).max(50), type: z.enum(['text','number','date','currency','select','boolean']), options: z.array(z.string().max(50)).max(30).optional() }).safeParse(req.body);
 if (!sid || !s.success) return fail(res, 'Definição do campo inválida.');
 if (!canAccessSpace(sid,req.user.id,true)) return fail(res, 'Sem permissão.', 403);
 const r = db.prepare('INSERT INTO custom_fields(space_id,name,type,options) VALUES(?,?,?,?)').run(sid, s.data.name, s.data.type, JSON.stringify(s.data.options || []));
 res.status(201).json({ id: Number(r.lastInsertRowid), spaceId: sid, ...s.data, options: s.data.options || [] });
});

function isSpaceOwner(spaceId,userId) {
 return !!db.prepare('SELECT 1 FROM spaces WHERE id=? AND owner_id=? AND deleted_at IS NULL').get(spaceId,userId);
}
function canAccessSpace(spaceId, userId, write = false) {
 if(isSpaceOwner(spaceId,userId))return {role:'owner'};
 const member=db.prepare('SELECT m.role FROM space_members m JOIN spaces s ON s.id=m.space_id WHERE m.space_id=? AND m.user_id=? AND s.deleted_at IS NULL').get(spaceId,userId);
 if(!member||(write&&member.role!=='editor'))return null;
 return member;
}
function getItem(id, includeDeleted = false) {
 const item = db.prepare(`SELECT * FROM items WHERE id=? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
 if (!item) return null;
 return { id: item.id, spaceId: item.space_id, title: item.title, description: item.description, locationId: item.location_id,
   purchaseUrl: item.purchase_url, purchaseLabel: item.purchase_label, customValues: JSON.parse(item.custom_values), imageId: item.image_id, imageFormat:item.image_format,
   imageMode: item.image_mode, createdAt: item.created_at, updatedAt: item.updated_at, deletedAt: item.deleted_at,
   categories: db.prepare('SELECT c.id,c.name,c.parent_id AS parentId,c.icon FROM item_categories ic JOIN categories c ON c.id=ic.category_id WHERE ic.item_id=? ORDER BY c.name').all(id),
   tags: db.prepare('SELECT t.id,t.name FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=? ORDER BY t.name').all(id),
   location: item.location_id ? db.prepare('SELECT id,name,parent_id AS parentId,icon FROM locations WHERE id=?').get(item.location_id) : null,
   imageUrl: item.image_id ? `/api/items/${id}/image?v=${item.image_id}` : null, thumbnailUrl: item.image_id ? `/api/items/${id}/thumbnail?v=${item.image_id}` : null };
}
const itemSchema = z.object({ spaceId: z.number().int().positive(), title: z.string().trim().min(1).max(160), description: z.string().max(10000).optional(), clientId:z.string().max(100).optional(),
 categoryIds: z.array(z.number().int().positive()).max(100).optional(), tagIds: z.array(z.number().int().positive()).max(100).optional(), locationId: z.number().int().positive().nullable().optional(),
 purchaseUrl: z.string().max(2048).optional().refine(v => !v || /^https?:\/\//i.test(v), 'URL deve começar com http:// ou https://'), purchaseLabel: z.string().max(100).optional(), customValues: z.record(z.string(),z.unknown()).optional() });
function saveRelations(itemId, spaceId, data) {
 const cats = data.categoryIds || []; const tags = data.tagIds || [];
 if (cats.length && db.prepare(`SELECT COUNT(*) n FROM categories WHERE space_id=? AND id IN (${cats.map(() => '?').join(',')})`).get(spaceId, ...cats).n !== new Set(cats).size) throw new Error('Uma ou mais categorias não pertencem a este espaço.');
 if (tags.length && db.prepare(`SELECT COUNT(*) n FROM tags WHERE space_id=? AND id IN (${tags.map(() => '?').join(',')})`).get(spaceId, ...tags).n !== new Set(tags).size) throw new Error('Uma ou mais tags não pertencem a este espaço.');
 if (data.locationId && !db.prepare('SELECT 1 FROM locations WHERE id=? AND space_id=?').get(data.locationId, spaceId)) throw new Error('Localização não pertence a este espaço.');
 const fields=db.prepare('SELECT id,type,options FROM custom_fields WHERE space_id=?').all(spaceId);
 for(const [fieldId,value] of Object.entries(data.customValues||{})) {
  const field=fields.find(x=>String(x.id)===fieldId);if(!field)throw new Error('Um campo personalizado não pertence a este espaço.');
  if(typeof value==='string'&&value.length>10000)throw new Error('O valor de um campo personalizado é grande demais.');
  if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new Error('Tipo de valor personalizado inválido.');
  if(field.type==='select'&&value!==null&&value!==''&&!JSON.parse(field.options).includes(String(value)))throw new Error('Selecione uma opção válida para o campo personalizado.');
 }
 db.prepare('DELETE FROM item_categories WHERE item_id=?').run(itemId); db.prepare('DELETE FROM item_tags WHERE item_id=?').run(itemId);
 const cat = db.prepare('INSERT INTO item_categories(item_id,category_id) VALUES(?,?)'); for (const id of new Set(cats)) cat.run(itemId,id);
 const tag = db.prepare('INSERT INTO item_tags(item_id,tag_id) VALUES(?,?)'); for (const id of new Set(tags)) tag.run(itemId,id);
}
app.get('/api/items', auth, (req, res) => {
 const sid = parseId(req.query.spaceId); if (!sid || !canAccessSpace(sid, req.user.id)) return fail(res, 'Espaço não encontrado.', 404);
 const terms = ['i.space_id=?','i.deleted_at IS NULL']; const params = [sid]; const q = String(req.query.q || '').trim();
 if (q) { terms.push(`(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\' OR i.custom_values LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM item_tags it JOIN tags t ON t.id=it.tag_id WHERE it.item_id=i.id AND t.name LIKE ?))`); const needle = `%${q.replace(/[\\%_]/g, '\\$&')}%`; params.push(needle,needle,needle,needle); }
 const categoryId = parseId(req.query.categoryId); if (categoryId && req.query.includeChildren === '1') { terms.push(`EXISTS(SELECT 1 FROM item_categories ic WHERE ic.item_id=i.id AND ic.category_id IN (WITH RECURSIVE descendants(id) AS (SELECT id FROM categories WHERE id=? AND space_id=? UNION ALL SELECT c.id FROM categories c JOIN descendants d ON c.parent_id=d.id WHERE c.space_id=?) SELECT id FROM descendants))`); params.push(categoryId,sid,sid); }
 else if (categoryId) { terms.push('EXISTS(SELECT 1 FROM item_categories ic WHERE ic.item_id=i.id AND ic.category_id=?)'); params.push(categoryId); }
 const tagId = parseId(req.query.tagId); if (tagId) { terms.push('EXISTS(SELECT 1 FROM item_tags it WHERE it.item_id=i.id AND it.tag_id=?)'); params.push(tagId); }
 const locationId = parseId(req.query.locationId); if (locationId) { terms.push('i.location_id=?'); params.push(locationId); }
 const rows = db.prepare(`SELECT i.id FROM items i WHERE ${terms.join(' AND ')} ORDER BY i.updated_at DESC LIMIT 500`).all(...params);
 res.json(rows.map(r => getItem(r.id)));
});
app.post('/api/items', auth, (req, res) => {
 const parsed = itemSchema.safeParse(req.body); if (!parsed.success) return fail(res, parsed.error.issues[0]?.message || 'Dados do item inválidos.');
 const d = parsed.data; if (!canAccessSpace(d.spaceId, req.user.id, true)) return fail(res, 'Sem permissão para editar este espaço.', 403);
 if(d.clientId){const previous=db.prepare('SELECT id FROM items WHERE sync_id=? AND created_by=?').get(d.clientId,req.user.id);if(previous)return res.json(getItem(previous.id,true));}
 try {
  const create = db.transaction(() => { const r = db.prepare(`INSERT INTO items(space_id,title,description,location_id,purchase_url,purchase_label,custom_values,created_by,updated_by,sync_id) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(d.spaceId,d.title,d.description||'',d.locationId||null,d.purchaseUrl||'',d.purchaseLabel||'',JSON.stringify(d.customValues||{}),req.user.id,req.user.id,d.clientId||null); saveRelations(r.lastInsertRowid,d.spaceId,d); return Number(r.lastInsertRowid); });
  res.status(201).json(getItem(create()));
 } catch(e) { fail(res, e.message); }
});
app.patch('/api/items/:id', auth, (req, res) => {
 const existing = getItem(req.params.id); if (!existing) return fail(res, 'Item não encontrado.', 404);
 if (!canAccessSpace(existing.spaceId, req.user.id, true)) return fail(res, 'Sem permissão.', 403);
 const patch = z.object({ title: z.string().trim().min(1).max(160).optional(), description: z.string().max(10000).optional(), categoryIds: z.array(z.number().int().positive()).max(100).optional(), tagIds: z.array(z.number().int().positive()).max(100).optional(), locationId: z.number().int().positive().nullable().optional(), purchaseUrl: z.string().max(2048).optional().refine(v => !v || /^https?:\/\//i.test(v)), purchaseLabel: z.string().max(100).optional(), customValues: z.record(z.string(),z.unknown()).optional() }).safeParse(req.body);
 if (!patch.success) return fail(res, patch.error.issues[0]?.message || 'Dados inválidos.');
 const d = patch.data;
 try { const save = db.transaction(() => { db.prepare(`UPDATE items SET title=?,description=?,location_id=?,purchase_url=?,purchase_label=?,custom_values=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(d.title ?? existing.title,d.description ?? existing.description,d.locationId === undefined ? existing.locationId : d.locationId,d.purchaseUrl ?? existing.purchaseUrl,d.purchaseLabel ?? existing.purchaseLabel,JSON.stringify(d.customValues ?? existing.customValues),req.user.id,existing.id); if (d.categoryIds || d.tagIds || d.locationId !== undefined || d.customValues) saveRelations(existing.id,existing.spaceId,{ categoryIds:d.categoryIds ?? existing.categories.map(x=>x.id),tagIds:d.tagIds ?? existing.tags.map(x=>x.id),locationId:d.locationId === undefined ? existing.locationId : d.locationId,customValues:d.customValues ?? existing.customValues }); }); save(); res.json(getItem(existing.id)); }
 catch(e) { fail(res,e.message); }
});
app.delete('/api/items/:id', auth, (req, res) => {
 const item = getItem(req.params.id); if (!item) return fail(res,'Item não encontrado.',404);
 if (!canAccessSpace(item.spaceId,req.user.id,true)) return fail(res,'Sem permissão.',403);
 db.prepare('UPDATE items SET deleted_at=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(new Date().toISOString(),item.id); res.json({ ok:true, deletedAt: new Date().toISOString() });
});
app.get('/api/trash', auth, (req,res) => {
 const sid=parseId(req.query.spaceId); if(!sid||!canAccessSpace(sid,req.user.id)) return fail(res,'Espaço não encontrado.',404);
 res.json(db.prepare("SELECT id FROM items WHERE space_id=? AND deleted_at IS NOT NULL AND julianday(deleted_at)>julianday('now','-7 days') ORDER BY deleted_at DESC").all(sid).map(x=>getItem(x.id,true)));
});
app.post('/api/items/:id/restore', auth, (req,res) => {
 const item=getItem(req.params.id,true); if(!item||!item.deletedAt) return fail(res,'Item não está na lixeira.',404);
 if(Date.now()-Date.parse(item.deletedAt)>7*86400000) return fail(res,'O prazo de restauração expirou.',410);
 if(!canAccessSpace(item.spaceId,req.user.id,true)) return fail(res,'Sem permissão.',403);
 db.prepare('UPDATE items SET deleted_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(item.id); res.json(getItem(item.id));
});

async function normalized(buffer, high, inputMime) {
 if(high&&buffer.length<=MAX_IMAGE&&!['image/heic','image/heif'].includes(inputMime)) {
  const format=({ 'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/avif':'avif' })[inputMime];
  if(format)return {buffer,format};
 }
 let width = high ? 3200 : 1800; let quality = high ? 90 : 80; let output;
 for (let i=0;i<8;i++) { output = await sharp(buffer,{limitInputPixels:40000000}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).webp({quality,effort:5}).toBuffer(); if(output.length<=MAX_IMAGE) break; if(quality>60) quality-=7; else width=Math.floor(width*0.82); }
 if(!output || output.length>MAX_IMAGE) throw new Error('Não foi possível reduzir a imagem para o limite configurado.');
 return {buffer:output,format:'webp'};
}
app.post('/api/items/:id/image', auth, upload.single('image'), async (req,res) => {
 const item=getItem(req.params.id); if(!item) return fail(res,'Item não encontrado.',404);
 if(!canAccessSpace(item.spaceId,req.user.id,true)) return fail(res,'Sem permissão.',403);
 if(!req.file) return fail(res,'Selecione uma imagem JPEG, PNG, WebP, HEIC ou AVIF.');
 try {
  const high = req.body?.mode === 'high'; const main = await normalized(req.file.buffer,high,req.file.mimetype); const thumb=await sharp(main.buffer).rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:68,effort:4}).toBuffer();
  const id=crypto.randomUUID(); const dir=path.join(DATA_DIR,'media'); await fs.writeFile(path.join(dir,`${id}.${main.format}`),main.buffer,{flag:'wx'}); await fs.writeFile(path.join(dir,`${id}-thumb.webp`),thumb,{flag:'wx'});
  if(item.imageId) await removeMedia(item.imageId);
  db.prepare('UPDATE items SET image_id=?,image_format=?,image_mode=?,updated_at=CURRENT_TIMESTAMP,updated_by=? WHERE id=?').run(id,main.format,high?'high':'optimized',req.user.id,item.id);
  res.json(getItem(item.id));
 } catch(e) { fail(res,e.message||'Falha ao processar imagem.'); }
});
async function removeMedia(id) { if(!id) return; await Promise.allSettled(['webp','jpg','png','avif'].map(format=>fs.unlink(path.join(DATA_DIR,'media',`${id}.${format}`))).concat([fs.unlink(path.join(DATA_DIR,'media',`${id}-thumb.webp`))])); }
async function serveImage(req,res,thumb) {
 const item=getItem(req.params.id,true); if(!item) { console.warn('Image request references a missing item.'); res.set('Cache-Control','no-store'); return res.sendStatus(404); }
 if(!item.imageId) { console.warn('Image request references an item without an image.'); res.set('Cache-Control','no-store'); return res.sendStatus(404); }
 if(!canAccessSpace(item.spaceId,req.user.id)) { console.warn('Image request denied for private space.'); res.set('Cache-Control','no-store'); return res.sendStatus(404); }
 const format=item.imageFormat||'webp';
 let filename=path.join(DATA_DIR,'media',`${item.imageId}${thumb?'-thumb.webp':`.${format}`}`);
 try { await fs.access(filename); } catch {
  if(!thumb) { console.warn('Image file missing (original).'); res.set('Cache-Control','no-store'); return res.sendStatus(404); }
  const original=path.join(DATA_DIR,'media',`${item.imageId}.${format}`);
  const temporary=`${filename}.${crypto.randomUUID()}.tmp`;
  try {
   const generated=await sharp(original,{limitInputPixels:40000000}).rotate().resize({width:480,height:480,fit:'inside',withoutEnlargement:true}).webp({quality:68,effort:4}).toBuffer();
   await fs.writeFile(temporary,generated,{flag:'wx'});
   await fs.rename(temporary,filename);
  } catch(error) {
   // Another request may have repaired the same thumbnail concurrently.
   await fs.unlink(temporary).catch(()=>{});
   try { await fs.access(filename); } catch { console.warn('Image file missing (thumbnail and original fallback).'); res.set('Cache-Control','no-store'); return res.sendStatus(404); }
  }
 }
 res.set('Cache-Control','private, max-age=86400, stale-while-revalidate=604800'); res.type(thumb?'image/webp':format==='jpg'?'image/jpeg':`image/${format}`); res.sendFile(filename,err=>{if(err&&!res.headersSent){console.warn(`Image delivery failed (${thumb?'thumbnail':'original'}).`);res.set('Cache-Control','no-store');res.sendStatus(404);}});
}
app.get('/api/items/:id/image',auth,(req,res)=>serveImage(req,res,false));
app.get('/api/items/:id/thumbnail',auth,(req,res)=>serveImage(req,res,true));

// Purga registros e imagens sete dias após a exclusão. Backup diário consistente do SQLite.
async function purgeTrash() {
 const old=db.prepare("SELECT id,image_id FROM items WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday('now','-7 days')").all();
 const remove=db.transaction(rows=>{ for(const row of rows) db.prepare('DELETE FROM items WHERE id=?').run(row.id); }); remove(old);
 for(const row of old) await removeMedia(row.image_id);
}
async function purgeDeletedSpaces() {
 const expired=db.prepare("SELECT id FROM spaces WHERE deleted_at IS NOT NULL AND julianday(deleted_at)<=julianday('now','-7 days')").all();
 for(const space of expired){
  const images=db.prepare('SELECT image_id FROM items WHERE space_id=? AND image_id IS NOT NULL').all(space.id);
  db.prepare('DELETE FROM spaces WHERE id=?').run(space.id);
  for(const image of images)await removeMedia(image.image_id);
 }
}
setInterval(() => purgeTrash().catch(err=>console.error('purge trash:',err)), 60*60*1000).unref();
setTimeout(() => purgeTrash().catch(err=>console.error('purge trash:',err)),2000).unref();
setInterval(() => purgeDeletedSpaces().catch(err=>console.error('purge deleted spaces:',err)), 60*60*1000).unref();
setTimeout(() => purgeDeletedSpaces().catch(err=>console.error('purge deleted spaces:',err)),2500).unref();
setInterval(() => snapshot().catch(err=>console.error('backup:',err)), 24*60*60*1000).unref();
setTimeout(() => snapshot().catch(err=>console.error('backup:',err)),5000).unref();

app.get('/api/version',(_req,res)=>{res.set('Cache-Control','no-store');res.json({build:buildId||'dev'});});
app.use(express.static(webDir,{setHeaders(res,file){ const base=path.basename(file); res.set('Cache-Control',/[.-][A-Za-z0-9_-]{8,}\.(js|css|woff2?|png|svg)$/.test(base)?'public, max-age=31536000, immutable':'no-cache'); }}));
app.get(/^(?!\/api\/).*/,(_req,res)=>{res.set('Cache-Control','no-cache');res.sendFile(path.join(webDir,'index.html'));});
app.use((err, req, res, next) => {
 console.error(`Request failed: ${req.method} ${req.path}`, err);
 if (res.headersSent) return next(err);
 const status = Number(err.status || err.statusCode) || 500;
 const message = status >= 500 ? 'Falha interna ao concluir a operação.' : err.message || 'Requisição inválida.';
 res.status(status).json({ error: message });
});
app.listen(PORT,()=>console.log(`Kazari na porta ${PORT}`));
