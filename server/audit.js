const db = require('./db');

/* ======================================================================
   Роадмап п.20 (аудит, BUG-006): audit-логирование критических действий.
   Тонкая обёртка над INSERT — не выбрасывает исключение наружу при сбое
   записи лога (например, БД заблокирована долгой транзакцией) — сам факт
   аудита не должен ронять реальное действие пользователя, ради которого
   он вообще вызвал эндпоинт. В худшем случае теряем одну запись лога,
   не саму операцию.
   ====================================================================== */

// req — объект Express-запроса (для req.session.userId/username, если
// действие совершено залогиненным пользователем) либо null/undefined,
// если действие системное (например, вызвано из скрипта, а не HTTP-запроса).
function logAudit(req, { action, targetType, targetId, targetLabel, details }){
  try{
    const actorId = req && req.session ? (req.session.userId ?? null) : null;
    const actorUsername = req && req.session ? (req.session.username ?? null) : null;
    db.prepare(`
      INSERT INTO audit_log (created_at, actor_id, actor_username, action, target_type, target_id, target_label, details)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(
      Date.now(),
      actorId,
      actorUsername,
      action,
      targetType || null,
      targetId != null ? String(targetId) : null,
      targetLabel || null,
      details ? JSON.stringify(details) : null
    );
  }catch(e){
    console.error('[audit] не удалось записать запись в audit_log:', e.message);
  }
}

module.exports = { logAudit };
