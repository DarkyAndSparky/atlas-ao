/* ====================== LIGHTBOX ====================== */
const lightbox = document.getElementById('lightbox');
const lbImg = document.getElementById('lbImg');
const lbCount = document.getElementById('lbCount');
let lbList = [];
let lbIndex = 0;

function openLightbox(list, index){
  lbList = list;
  lbIndex = index;
  renderLightbox();
  lightbox.classList.add('show');
}
function closeLightbox(){ lightbox.classList.remove('show'); }
function renderLightbox(){
  if(!lbList.length) return closeLightbox();
  const g = lbList[lbIndex];
  lbImg.src = g.url;
  lbCount.textContent = (lbIndex+1) + ' / ' + lbList.length + (g.caption ? '  ·  ' + g.caption : '');
}
function lbStep(delta){
  if(!lbList.length) return;
  lbIndex = (lbIndex + delta + lbList.length) % lbList.length;
  renderLightbox();
}

document.getElementById('lbClose').addEventListener('click', closeLightbox);
document.getElementById('lbPrev').addEventListener('click', ()=>lbStep(-1));
document.getElementById('lbNext').addEventListener('click', ()=>lbStep(1));
lightbox.addEventListener('mousedown', e=>{ if(e.target===lightbox) closeLightbox(); });
window.addEventListener('keydown', e=>{
  if(!lightbox.classList.contains('show')) return;
  if(e.key==='Escape') closeLightbox();
  if(e.key==='ArrowLeft') lbStep(-1);
  if(e.key==='ArrowRight') lbStep(1);
});
