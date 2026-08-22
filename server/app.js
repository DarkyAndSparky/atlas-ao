const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const { getSessionSecret } = require('./config');
const SqliteSessionStore = require('./sessionStore');
const { router: authRouter } = require('./routes/auth');
const allodsRouter = require('./routes/allods');
const backupRouter = require('./routes/backup');
const settingsRouter = require('./routes/settings');
const annotationsRouter = require('./routes/annotations');
const decorationsRouter = require('./routes/decorations');
const factionsRouter = require('./routes/factions');
const sourcesRouter = require('./routes/sources');
const { router: systemRouter } = require('./routes/system');
const seoRouter = require('./routes/seo');
const { UPLOAD_DIR } = require('./upload');

require('./db'); // инициализирует (и при первом запуске засеивает) базу до старта сервера

function createApp(){
  const app = express();

  // Если сервер стоит за реверс-прокси (Caddy/nginx в Docker-режиме, см. docker-compose.yml),
  // ATLAS_TRUST_PROXY=1 включает express-session/req.ip корректную обработку X-Forwarded-*,
  // иначе req.secure и rate-limit по IP работали бы неверно за прокси.
  if(process.env.ATLAS_TRUST_PROXY === '1') app.set('trust proxy', 1);

  const cspDirectives = {
    ...helmet.contentSecurityPolicy.getDefaultDirectives(),
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
    'font-src': ["'self'", 'https://fonts.gstatic.com'],
    // Фронтенд больше не использует inline onclick="..." (см. delegated click
    // handlers в detailView.js/wikiView.js/settings.js/main.js) — script-src
    // можно держать строго 'self', без 'unsafe-inline'.
    'script-src': ["'self'"],
    'script-src-attr': ["'none'"],
  };
  if(process.env.ATLAS_HTTPS === '1') cspDirectives['upgrade-insecure-requests'] = [];
  else delete cspDirectives['upgrade-insecure-requests'];

  app.use(helmet({
    // приложение отдаёт свои же скрипты/картинки одним источником и не грузит сторонние
    // фреймы/embeds — стартуем с безопасного дефолта и точечно разрешаем шрифты Google.
    // useDefaults:false — иначе helmet молча подмешивает свои дефолты поверх
    // cspDirectives и upgrade-insecure-requests возвращается, даже если он удалён ниже.
    contentSecurityPolicy: { useDefaults: false, directives: cspDirectives },
    // HSTS имеет смысл только если сервер реально отдаётся по HTTPS (Docker-режим за Caddy).
    // Слать его поверх обычного http://localhost — не только бесполезно, но и опасно:
    // браузер запомнит домен как https-only и сломает доступ, если позже тот же хост
    // поднимут без TLS.
    hsts: process.env.ATLAS_HTTPS === '1',
  }));

  app.use(express.json({ limit: '5mb' }));
  const sessionStore = new SqliteSessionStore();
  sessionStore.on('error', (err)=>{
    console.warn('Хранилище сессий: не удалось сохранить/обновить сессию —', err.message);
  });

  app.use(session({
    store: sessionStore,
    secret: getSessionSecret(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // secure-куки требуют HTTPS — в Docker-режиме за Caddy (см. ниже) это true;
      // при обычном локальном http://localhost оставляем false, иначе логин не заработает.
      secure: process.env.ATLAS_HTTPS === '1',
      maxAge: 1000*60*60*24*30,
    },
  }));

  app.get('/api/health', (req, res)=> res.json({ ok: true }));

  // Общий rate limit на API — защита от примитивного скрапинга/DoS, не мешает
  // обычному использованию сайта. Логин защищён отдельно, гораздо строже
  // (security/rateLimiter.js, по попыткам, а не по времени) — этот лимитер его
  // не заменяет, а накрывает всё остальное API, включая сам логин-эндпоинт как
  // дополнительный слой. /api/health исключён, чтобы внешний аптайм-мониторинг
  // (UptimeRobot и т.п.) не словил 429 на частых пингах.
  // Лимит настраивается через ATLAS_RATE_LIMIT_MAX (запросов за ATLAS_RATE_LIMIT_WINDOW_MS,
  // по умолчанию 300/мин) — тестам нужен маленький лимит, чтобы не слать сотни запросов.
  const apiLimiter = rateLimit({
    windowMs: Number(process.env.ATLAS_RATE_LIMIT_WINDOW_MS) || 60 * 1000,
    max: Number(process.env.ATLAS_RATE_LIMIT_MAX) || 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req)=> req.path === '/api/health',
    message: { error: 'Слишком много запросов, попробуйте позже.' },
  });
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api', allodsRouter);
  app.use('/api/backup', backupRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api', annotationsRouter);
  app.use('/api', decorationsRouter);
  app.use('/api', factionsRouter);
  app.use('/api', sourcesRouter);
  app.use('/api/system', systemRouter);

  app.use(seoRouter);

  app.use('/uploads', express.static(UPLOAD_DIR));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Явный JSON 404 для несуществующих API-путей — без этого запрос проваливался
  // бы в app.get('*') ниже и отдавал бы HTML index.html с кодом 200 вместо
  // понятной ошибки.
  app.use('/api', (req, res)=> res.status(404).json({ error: 'Такого маршрута нет.' }));

  app.get('*', (req, res)=>{
    res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
  });

  // Единая обработка ошибок. БЕЗ этого обработчика Express использует свой
  // дефолтный — а он в dev-режиме (NODE_ENV не 'production', то есть всегда
  // при запуске обычным `node server.js` вне Docker) отдаёт HTML-страницу с
  // ПОЛНЫМ стектрейсом, включая абсолютные пути на сервере — причём ЛЮБОМУ,
  // даже не вошедшему в аккаунт клиенту (например, просто отправив кривой
  // JSON в теле запроса на /api/auth/login). Регистрируется последним —
  // Express находит error-обработчики по сигнатуре (err, req, res, next).
  app.use((err, req, res, next)=>{
    if(res.headersSent) return next(err);

    // невалидный JSON в теле запроса (express.json()) — это ошибка клиента, не сервера
    if(err.type === 'entity.parse.failed' || err instanceof SyntaxError && 'body' in err){
      return res.status(400).json({ error: 'Некорректный формат запроса (невалидный JSON).' });
    }
    if(err.code === 'LIMIT_FILE_SIZE'){
      return res.status(413).json({ error: 'Файл слишком большой (максимум 15 МБ).' });
    }
    if(err.message === 'Разрешены только изображения'){
      return res.status(400).json({ error: err.message });
    }

    console.error('Необработанная ошибка на сервере:', err);
    res.status(err.status || err.statusCode || 500).json({
      error: 'Внутренняя ошибка сервера. Подробности — в логе сервера.',
    });
  });

  return app;
}

module.exports = { createApp };
