// Хранилище сессий на той же SQLite-базе, что и остальные данные.
//
// Зачем: express-session по умолчанию использует MemoryStore — он утекает
// по памяти на долгоживущем процессе (сам express предупреждает об этом в
// консоли) и, что важнее для однопользовательского локального инструмента,
// теряет все сессии при каждом рестарте сервера (значит — принудительный
// логаут при каждом обновлении). SQLite-хранилище переживает рестарт и
// ничего не течёт.
//
// Мог бы использовать готовый connect-sqlite3, но он тянет нативный пакет
// sqlite3 — а весь проект специально держится на встроенном node:sqlite
// без единой нативной компиляции (см. README/db.js). Поэтому свой стор,
// благо интерфейс express-session.Store совсем небольшой.

const session = require('express-session');
const db = require('./db');

const DAY_MS = 1000 * 60 * 60 * 24;

class SqliteSessionStore extends session.Store {
  constructor(){
    super();
    this._get = db.prepare('SELECT sess, expires FROM sessions WHERE sid = ?');
    this._upsert = db.prepare(`
      INSERT INTO sessions (sid, sess, expires) VALUES (@sid, @sess, @expires)
      ON CONFLICT(sid) DO UPDATE SET sess=excluded.sess, expires=excluded.expires
    `);
    this._destroy = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this._touch = db.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');
    this._clearExpired = db.prepare('DELETE FROM sessions WHERE expires < ?');

    // подчищаем протухшие сессии раз в час, чтобы таблица не росла бесконечно
    // (express-session сам не удаляет истёкшие записи из стора)
    this._cleanupTimer = setInterval(()=>{
      try{ this._clearExpired.run(Date.now()); }catch(e){ /* база могла закрыться в тестах */ }
    }, 1000 * 60 * 60);
    this._cleanupTimer.unref(); // не держит процесс живым только ради этого таймера
  }

  _expiresOf(sess){
    return sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + DAY_MS;
  }

  get(sid, cb){
    try{
      const row = this._get.get(sid);
      if(!row) return cb(null, null);
      if(row.expires < Date.now()){
        this._destroy.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    }catch(e){ cb(e); }
  }

  set(sid, sess, cb){
    try{
      this._upsert.run({ sid, sess: JSON.stringify(sess), expires: this._expiresOf(sess) });
      cb && cb(null);
    }catch(e){ cb && cb(e); }
  }

  destroy(sid, cb){
    try{
      this._destroy.run(sid);
      cb && cb(null);
    }catch(e){ cb && cb(e); }
  }

  touch(sid, sess, cb){
    try{
      this._touch.run(this._expiresOf(sess), sid);
      cb && cb(null);
    }catch(e){ cb && cb(e); }
  }
}

module.exports = SqliteSessionStore;
