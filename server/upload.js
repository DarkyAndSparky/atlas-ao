const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { isValidImageFile } = require('./security/fileValidation');

const UPLOAD_DIR = process.env.ATLAS_UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
if(!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_DIMENSION = 1920; // больше этого по длинной стороне — уменьшаем
const JPEG_QUALITY = 82;
const WEBP_QUALITY = 82;
const PNG_COMPRESSION = 8;

const storage = multer.diskStorage({
  destination: (req, file, cb)=> cb(null, UPLOAD_DIR),
  filename: (req, file, cb)=>{
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, crypto.randomBytes(10).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb)=>{
    const ok = /^image\/(png|jpe?g|webp|gif|svg\+xml)$/.test(file.mimetype);
    cb(ok ? null : new Error('Разрешены только изображения'), ok);
  }
});

// после multer сохранил файл на диск — сверяем реальные байты с заявленным типом
function verifyUploadedImage(req, res, next){
  if(!req.file) return next();
  const ok = isValidImageFile(req.file.path, req.file.mimetype);
  if(!ok){
    fs.unlink(req.file.path, ()=>{});
    return res.status(400).json({ error: 'Файл не похож на настоящее изображение заявленного типа.' });
  }
  next();
}

// SVG — это XML, и в отличие от растровых форматов может содержать <script>,
// обработчики on*="..." и т.п. Если открыть такой файл по прямой ссылке
// (не через <img>, а напрямую в новой вкладке), браузер выполнит это как
// полноценный скрипт в контексте нашего домена — классический stored XSS.
// Прогоняем через DOMPurify (реальный XML/HTML-парсер, а не самодельные
// регулярки, которые легко обойти) и вырезаем весь исполняемый код.
const { JSDOM } = require('jsdom');
const createDOMPurify = require('dompurify');
const svgPurify = createDOMPurify(new JSDOM('').window);

async function sanitizeUploadedSvg(req, res, next){
  if(!req.file || req.file.mimetype !== 'image/svg+xml') return next();
  try{
    const raw = fs.readFileSync(req.file.path, 'utf8');
    const clean = svgPurify.sanitize(raw, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ['script', 'foreignObject'],
    });
    fs.writeFileSync(req.file.path, clean, 'utf8');
    next();
  }catch(e){
    fs.unlink(req.file.path, ()=>{});
    res.status(400).json({ error: 'Не удалось обработать SVG-файл.' });
  }
}

// уменьшаем крупные фото и пережимаем их, чтобы uploads/ не раздувался.
// SVG (векторный) и GIF (может быть анимацией) не трогаем — пропускаем как есть.
async function compressUploadedImage(req, res, next){
  if(!req.file) return next();
  const mime = req.file.mimetype;
  if(!/^image\/(png|jpe?g|webp)$/.test(mime)) return next();
  const filePath = req.file.path;
  try{
    const before = fs.statSync(filePath).size;
    const img = sharp(filePath, { failOn: 'none' });
    const meta = await img.metadata();
    let pipeline = img.rotate(); // учитываем EXIF-ориентацию
    if(meta.width && meta.height && Math.max(meta.width, meta.height) > MAX_DIMENSION){
      pipeline = pipeline.resize({
        width: MAX_DIMENSION, height: MAX_DIMENSION,
        fit: 'inside', withoutEnlargement: true
      });
    }
    if(mime === 'image/png') pipeline = pipeline.png({ compressionLevel: PNG_COMPRESSION });
    else if(mime === 'image/webp') pipeline = pipeline.webp({ quality: WEBP_QUALITY });
    else pipeline = pipeline.jpeg({ quality: JPEG_QUALITY, mozjpeg: true });

    const tmpPath = filePath + '.tmp';
    await pipeline.toFile(tmpPath);
    const after = fs.statSync(tmpPath).size;
    // подстраховка: если пережатый файл почему-то оказался больше исходного, оставляем оригинал
    if(after < before){
      fs.renameSync(tmpPath, filePath);
      req.file.size = after;
    }else{
      fs.unlinkSync(tmpPath);
    }
  }catch(e){
    console.warn('Не удалось сжать изображение (оставляю как есть):', e.message);
  }
  next();
}

function deleteUploadedFile(url){
  // удаляем физический файл только если он лежит в нашей папке uploads/
  if(!url || !url.startsWith('/uploads/')) return;
  const filePath = path.join(UPLOAD_DIR, path.basename(url));
  fs.unlink(filePath, (err)=>{
    if(err && err.code !== 'ENOENT') console.warn('Не удалось удалить файл', filePath, err.message);
  });
}

module.exports = { upload, verifyUploadedImage, sanitizeUploadedSvg, compressUploadedImage, deleteUploadedFile, UPLOAD_DIR };
