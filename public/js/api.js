/* ====================== API HELPERS ====================== */
async function api(path, opts={}){
  const res = await fetch('/api'+path, {
    headers: opts.body && !(opts.body instanceof FormData) ? {'Content-Type':'application/json'} : undefined,
    credentials: 'same-origin',
    ...opts,
    body: opts.body && !(opts.body instanceof FormData) ? JSON.stringify(opts.body) : opts.body
  });
  let data = null;
  try{ data = await res.json(); }catch(e){}
  if(!res.ok){
    const err = new Error((data&&data.error) || ('Ошибка запроса: '+res.status));
    err.status = res.status;
    err.body = data; // для конфликтов (409) — тут лежит {error:'conflict', current:{...}}, см. resolveConflict() в picker.js
    throw err;
  }
  return data;
}
