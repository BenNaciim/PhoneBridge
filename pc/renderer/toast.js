const $ = (id) => document.getElementById(id);
let timer = null;

function fit() {
  window.toast.size($('card').offsetHeight);
}

function arm(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => window.toast.close(), ms);
}

window.toast.onData((d) => {
  $('title').textContent = d.title || '';
  if (d.icon) {
    $('appic').src = d.icon;
    $('appic').style.display = 'block';
  }
  $('sub').textContent = d.subtitle || '';
  $('text').textContent = d.body || '';
  $('reply').classList.toggle('hidden', !d.reply);
  if (d.image) {
    const img = $('img');
    img.onload = fit;
    img.src = d.image;
    img.style.display = 'block';
  }
  fit();
  arm(d.reply ? 14000 : 8000);
});

$('x').addEventListener('click', () => window.toast.close());
$('open').addEventListener('click', () => window.toast.open());
$('inp').addEventListener('focus', () => clearTimeout(timer));
$('card').addEventListener('mouseenter', () => clearTimeout(timer));
$('card').addEventListener('mouseleave', () => { if (document.activeElement !== $('inp')) arm(5000); });
$('reply').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('inp').value.trim();
  if (v) window.toast.reply(v);
});
