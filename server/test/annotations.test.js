// Тесты векторного слоя рисования на карте: текстовые подписи, линии,
// прямоугольники, круги. Своя изолированная БД — не мешает остальным файлам.

const path = require('path');
const fs = require('fs');
const os = require('os');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-test-annotations-'));
process.env.ATLAS_DB_PATH = path.join(TEST_DIR, 'test.db');
process.env.ATLAS_UPLOAD_DIR = path.join(TEST_DIR, 'uploads');
process.env.ATLAS_BACKUPS_DIR = path.join(TEST_DIR, 'backups');
process.env.SESSION_SECRET = 'test-secret-not-for-production';

const { createApp } = require('../app');

let server, baseUrl;
const PROJECT = 'Аллоды Онлайн';

before(async ()=>{
  const app = createApp();
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const c = makeClient();
  const reg = await c.post('/api/auth/register', { username:'annotator', password:'annotator-pass-1' });
  assert.equal(reg.status, 200);
});

after(async ()=>{
  await new Promise(resolve => server.close(resolve));
  try{ require('../db').close(); }catch(e){ /* уже могла быть закрыта */ }
  fs.rmSync(TEST_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

function makeClient(){
  let cookie = '';
  async function request(method, p, body){
    const opts = { method, headers: {} };
    if(cookie) opts.headers['Cookie'] = cookie;
    if(body !== undefined){
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(baseUrl + p, opts);
    const setCookie = res.headers.get('set-cookie');
    if(setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if(ct.includes('application/json')) data = await res.json().catch(()=>null);
    return { status: res.status, data };
  }
  return {
    get: p=>request('GET',p), post:(p,b)=>request('POST',p,b),
    patch:(p,b)=>request('PATCH',p,b), del: p=>request('DELETE',p),
  };
}
async function loginClient(){
  const c = makeClient();
  const r = await c.post('/api/auth/login', { username:'annotator', password:'annotator-pass-1' });
  assert.equal(r.status, 200);
  return c;
}

test('список пометок без project -> 400', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/annotations');
  assert.equal(r.status, 400);
});

test('список пометок публичный (без входа) и пустой по умолчанию', async ()=>{
  const c = makeClient();
  const r = await c.get('/api/annotations?project=' + encodeURIComponent(PROJECT));
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, []);
});

test('создание пометки без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'text', x1:0, y1:0, text:'x' });
  assert.equal(r.status, 401);
});

test('создание текстовой подписи: без текста -> 400', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'text', x1:10, y1:10, text:'   ' });
  assert.equal(r.status, 400);
});

test('создание текстовой подписи проходит и появляется в списке', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'text', x1:100, y1:200, text:'Здесь драконы' });
  assert.equal(r.status, 200);
  assert.equal(r.data.type, 'text');
  assert.equal(r.data.text, 'Здесь драконы');
  assert.equal(r.data.x1, 100);
  assert.equal(r.data.color, '#e8c874'); // дефолтный цвет, раз не передали свой

  const list = await c.get('/api/annotations?project=' + encodeURIComponent(PROJECT));
  assert.equal(list.data.length, 1);
});

test('неизвестный тип пометки отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'triangle', x1:0, y1:0 });
  assert.equal(r.status, 400);
});

test('линия без второй точки отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'line', x1:0, y1:0 });
  assert.equal(r.status, 400);
});

test('линия с корректными координатами создаётся', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'line', x1:0, y1:0, x2:50, y2:80, color:'#ff0000' });
  assert.equal(r.status, 200);
  assert.equal(r.data.x2, 50);
  assert.equal(r.data.color, '#ff0000');
});

test('некорректный (не hex) цвет тихо заменяется на дефолтный, а не ломает запрос', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'line', x1:0, y1:0, x2:1, y2:1, color:'javascript:alert(1)' });
  assert.equal(r.status, 200);
  assert.equal(r.data.color, '#e8c874');
});

test('прямоугольник без второй точки отклоняется', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'rect', x1:0, y1:0 });
  assert.equal(r.status, 400);
});

test('прямоугольник с корректными координатами создаётся', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'rect', x1:10, y1:10, x2:60, y2:90 });
  assert.equal(r.status, 200);
  assert.equal(r.data.type, 'rect');
});

test('круг без радиуса или с нулевым/отрицательным радиусом отклоняется', async ()=>{
  const c = await loginClient();
  const bad1 = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0 });
  assert.equal(bad1.status, 400);
  const bad2 = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0, r:0 });
  assert.equal(bad2.status, 400);
});

test('круг с корректным радиусом создаётся', async ()=>{
  const c = await loginClient();
  const r = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:200, y1:200, r:40 });
  assert.equal(r.status, 200);
  assert.equal(r.data.r, 40);
});

test('пометки разных проектов не смешиваются в списке', async ()=>{
  const c = await loginClient();
  await c.post('/api/annotations', { project: 'Пираты Штурм Небес', type:'text', x1:5, y1:5, text:'Другой проект' });
  const listMain = await c.get('/api/annotations?project=' + encodeURIComponent(PROJECT));
  const listPirates = await c.get('/api/annotations?project=' + encodeURIComponent('Пираты Штурм Небес'));
  assert.ok(!listMain.data.some(a=>a.text==='Другой проект'));
  assert.ok(listPirates.data.some(a=>a.text==='Другой проект'));
});

test('PATCH меняет координаты/цвет пометки', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/annotations', { project: PROJECT, type:'text', x1:1, y1:1, text:'До' });
  const id = created.data.id;
  const r = await c.patch(`/api/annotations/${id}`, { x1:500, color:'#00ff00' });
  assert.equal(r.status, 200);
  assert.equal(r.data.x1, 500);
  assert.equal(r.data.color, '#00ff00');
  assert.equal(r.data.text, 'До'); // не переданное поле не трогается
});

test('PATCH несуществующей пометки -> 404', async ()=>{
  const c = await loginClient();
  const r = await c.patch('/api/annotations/does-not-exist', { x1:1 });
  assert.equal(r.status, 404);
});

test('PATCH без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.patch('/api/annotations/whatever', { x1:1 });
  assert.equal(r.status, 401);
});

test('DELETE удаляет пометку, повторный DELETE -> 404', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/annotations', { project: PROJECT, type:'text', x1:1, y1:1, text:'Удалю' });
  const id = created.data.id;

  const del = await c.del(`/api/annotations/${id}`);
  assert.equal(del.status, 200);

  const listAfter = await c.get('/api/annotations?project=' + encodeURIComponent(PROJECT));
  assert.ok(!listAfter.data.some(a=>a.id===id));

  const delAgain = await c.del(`/api/annotations/${id}`);
  assert.equal(delAgain.status, 404);
});

test('DELETE без входа -> 401', async ()=>{
  const c = makeClient();
  const r = await c.del('/api/annotations/whatever');
  assert.equal(r.status, 401);
});

/* ---------------- новые типы фигур: стрелка, полигон, от руки ---------------- */

test('стрелка (arrow) создаётся как линия — нужна вторая точка', async ()=>{
  const c = await loginClient();
  const bad = await c.post('/api/annotations', { project: PROJECT, type:'arrow', x1:0, y1:0 });
  assert.equal(bad.status, 400);
  const ok = await c.post('/api/annotations', { project: PROJECT, type:'arrow', x1:0, y1:0, x2:50, y2:50 });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.type, 'arrow');
  assert.equal(ok.data.x2, 50);
});

test('полигон: меньше 3 точек отклоняется, 3+ создаётся с points', async ()=>{
  const c = await loginClient();
  const tooFew = await c.post('/api/annotations', {
    project: PROJECT, type:'polygon', x1:0, y1:0, points:[{x:0,y:0},{x:10,y:10}],
  });
  assert.equal(tooFew.status, 400);

  const ok = await c.post('/api/annotations', {
    project: PROJECT, type:'polygon', x1:0, y1:0,
    points:[{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.points.length, 4);
  assert.deepEqual(ok.data.points[2], { x:10, y:10 });
});

test('от руки (freehand): меньше 2 точек отклоняется, точки с не-числами отклоняются', async ()=>{
  const c = await loginClient();
  const tooFew = await c.post('/api/annotations', {
    project: PROJECT, type:'freehand', x1:0, y1:0, points:[{x:0,y:0}],
  });
  assert.equal(tooFew.status, 400);

  const badPoint = await c.post('/api/annotations', {
    project: PROJECT, type:'freehand', x1:0, y1:0, points:[{x:0,y:0},{x:'oops',y:5}],
  });
  assert.equal(badPoint.status, 400);

  const ok = await c.post('/api/annotations', {
    project: PROJECT, type:'freehand', x1:0, y1:0,
    points:[{x:0,y:0},{x:5,y:2},{x:9,y:8},{x:14,y:3}],
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.points.length, 4);
});

test('слишком много точек (>500) отклоняется', async ()=>{
  const c = await loginClient();
  const points = Array.from({length: 501}, (_,i)=>({x:i, y:i}));
  const r = await c.post('/api/annotations', { project: PROJECT, type:'freehand', x1:0, y1:0, points });
  assert.equal(r.status, 400);
});

/* ---------------- прозрачность ---------------- */

test('opacity: значение сохраняется и ограничивается диапазоном [0.1, 1]', async ()=>{
  const c = await loginClient();
  const half = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0, r:10, opacity:0.5 });
  assert.equal(half.data.opacity, 0.5);

  const tooLow = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0, r:10, opacity:0 });
  assert.equal(tooLow.data.opacity, 0.1);

  const tooHigh = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0, r:10, opacity:5 });
  assert.equal(tooHigh.data.opacity, 1);

  const omitted = await c.post('/api/annotations', { project: PROJECT, type:'circle', x1:0, y1:0, r:10 });
  assert.equal(omitted.data.opacity, 1);
});

test('PATCH может обновить points у полигона (перемещение фигуры целиком) и opacity', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/annotations', {
    project: PROJECT, type:'polygon', x1:0, y1:0,
    points:[{x:0,y:0},{x:10,y:0},{x:5,y:10}],
  });
  const id = created.data.id;

  const moved = await c.patch(`/api/annotations/${id}`, {
    points:[{x:100,y:100},{x:110,y:100},{x:105,y:110}],
    opacity: 0.3,
  });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.data.points[0], { x:100, y:100 });
  assert.equal(moved.data.opacity, 0.3);
});

test('PATCH points у типов, для которых points не применим (line), игнорируется молча', async ()=>{
  const c = await loginClient();
  const created = await c.post('/api/annotations', { project: PROJECT, type:'line', x1:0, y1:0, x2:5, y2:5 });
  const id = created.data.id;
  const r = await c.patch(`/api/annotations/${id}`, { points:[{x:1,y:1},{x:2,y:2}] });
  assert.equal(r.status, 200);
  assert.equal(r.data.points, null);
});
