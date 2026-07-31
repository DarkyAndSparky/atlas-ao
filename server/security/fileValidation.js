const fs = require('fs');

// Сигнатуры (magic bytes) распространённых форматов изображений.
const SIGNATURES = [
  { ext: 'png',  bytes: [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a] },
  { ext: 'jpg',  bytes: [0xff,0xd8,0xff] },
  { ext: 'gif',  bytes: [0x47,0x49,0x46,0x38] },
  { ext: 'webp', bytes: [0x52,0x49,0x46,0x46], offset:0, extraCheck: (buf)=> buf.slice(8,12).toString('ascii')==='WEBP' },
];

function matchesSignature(buf, sig){
  for(let i=0;i<sig.bytes.length;i++){
    if(buf[i] !== sig.bytes[i]) return false;
  }
  if(sig.extraCheck) return sig.extraCheck(buf);
  return true;
}

function isValidImageFile(filePath, declaredMime){
  // SVG — текстовый формат, проверяем иначе: должен начинаться с <svg или <?xml
  if(declaredMime === 'image/svg+xml'){
    const head = fs.readFileSync(filePath, { encoding:'utf-8', flag:'r' }).slice(0, 200).trim();
    return /^(<\?xml|<svg)/i.test(head);
  }
  const buf = Buffer.alloc(16);
  const fd = fs.openSync(filePath, 'r');
  fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  return SIGNATURES.some(sig => matchesSignature(buf, sig));
}

module.exports = { isValidImageFile };
