const $ = (id) => document.getElementById(id);
const logsEl = $('logs');
window.addEventListener('unhandledrejection', (e) => {
  console.error('UNHANDLED REJECTION:', e.reason && e.reason.stack ? e.reason.stack : e.reason);
});
let S = {};
let allVers = { latest: {}, versions: [] };
let verShown = 40;
let launching = false;

const NICKS = ['Steve', 'Alex', 'Herobrine', 'Creeper', 'Ender', 'Miner', 'Craft', 'Nether', 'Diamond', 'Redstone'];

// ---------- utils ----------
function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => t.remove(), 3800);
}
function log(msg) {
  logsEl.textContent += '\n' + msg;
  logsEl.scrollTop = logsEl.scrollHeight;
}
window.api.onLog(log);
window.api.onProgress((p) => {
  if (p && typeof p === 'object' && p.total && p.current != null) {
    const pct = Math.min(100, Math.round((p.current / p.total) * 100));
    $('progressBar').style.width = pct + '%';
    $('status').textContent = `${p.task || p.type || 'Baixando'}: ${p.current}/${p.total}`;
    $('playSub').textContent = `${pct}% — ${p.task || 'baixando'}`;
  }
});
window.api.onClosed((code) => {
  launching = false;
  setBtnPlay(false);
  $('status').textContent = 'Jogo fechado.';
  $('progressBar').style.width = '0%';
  $('playSub').textContent = 'pronto';
});
window.api.onStarted(() => {
  $('status').textContent = 'Jogo rodando… bom jogo! ⛏️';
  $('playSub').textContent = 'rodando…';
});

function setBtnPlay(busy) {
  $('btnPlay').disabled = busy;
  $('btnPlay').querySelector('.play-title').textContent = busy ? '⏳ INICIANDO…' : '▶ JOGAR';
}

// tabs
document.querySelectorAll('.tabs button').forEach((b) => {
  b.onclick = () => goTab(b.dataset.tab);
});
function goTab(name) {
  document.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x.dataset.tab === name));
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x.id === 'tab-' + name));
}

// theme
document.querySelectorAll('[data-theme-btn]').forEach((b) => {
  b.onclick = async () => {
    document.body.dataset.theme = b.dataset.themeBtn;
    document.querySelectorAll('[data-theme-btn]').forEach((x) => x.classList.toggle('active', x === b));
    await window.api.set({ theme: b.dataset.themeBtn });
  };
});

// ---------- boot ----------
async function loadAll() {
  S = await window.api.getAll();
  document.body.dataset.theme = S.theme || 'creeper';
  document.querySelectorAll('[data-theme-btn]').forEach((x) => x.classList.toggle('active', x.dataset.themeBtn === (S.theme || 'creeper')));

  $('username').value = S.username || 'Steve';
  $('ramMin').value = S.ramMin || 2;
  $('ramMax').value = S.ramMax || 4;
  $('ramMinVal').textContent = $('ramMin').value + 'G';
  $('ramMaxVal').textContent = $('ramMax').value + 'G';
  $('version').innerHTML = `<option>${S.version || '1.20.1'}</option>`;
  $('modloader').value = S.modloader || 'vanilla';
  syncMlPills();
  $('width').value = S.width || 854;
  $('height').value = S.height || 480;
  $('fullscreen').checked = !!S.fullscreen;
  $('jvmArgs').value = S.jvmArgs || '';
  $('gameArgs').value = S.gameArgs || '';
  $('serverHost').value = S.serverHost || '';
  $('serverPort').value = S.serverPort || '25565';
  $('demo').checked = !!S.demo;
  $('closeAction').value = S.closeAction || 'keep';
  $('javaPath').value = S.javaPath || '';
  $('gameDir').value = S.gameDir || '';
  $('skinModel').value = S.skinModel || 'classic';
  $('autoTune').checked = S.autoTune !== false;
  $('fRelease').checked = true;
  $('fSnapshot').checked = !!S.showSnapshots;
  $('fOld').checked = !!S.showOld;

  refreshHero();
  drawSkin(S.skinPath);
  drawSkinBig(S.skinPath);

  await Promise.allSettled([
    refreshHeader(), loadVersionSelect(), loadVersionGrid(true),
    loadLoaders(), loadSkins(), loadMods(), loadConfig(), loadNews(), refreshJavaNeed()
  ]);
  silentUpdateCheck();
}

async function refreshHeader() {
  try {
    const info = await window.api.systemInfo();
    sysMem = { total: info.totalMemGB, free: info.freeMemGB };
    $('ramPill').textContent = `${info.freeMemGB}/${info.totalMemGB} GB livres`;
    $('uuidText').textContent = info.uuid || '—';
    $('metaSize').textContent = info.gameDirSize || '—';
    $('statSize').textContent = info.gameDirSize || '—';
    const jv = await window.api.javaVersion(S.javaPath || info.javaCandidates[0] || 'java');
    const first = (jv.split('\n')[0] || '').slice(0, 60);
    $('javaPill').textContent = first.includes('not') || first.includes('não') ? 'Java?' : first.replace(/"/g, '');
    $('statJava').textContent = first.match(/(\d+\.\d+\.\d+|\d+)/)?.[0] ? 'Java ' + first.match(/version "([^"]+)"/)?.[1] || first.slice(0, 24) : first.slice(0, 24);
    $('statJavaSub').textContent = info.javaCandidates[0] || 'PATH';
    $('sysInfo').textContent = `SO: ${info.platform} | RAM total ${info.totalMemGB} GB (livre ${info.freeMemGB} GB)\nUUID offline: ${info.uuid}\nPasta: ${info.gameDir} (${info.gameDirSize})`;
    // java presets
    const sel = $('javaPreset');
    sel.innerHTML = '<option value="">java (PATH)</option>';
    (info.javaCandidates || []).forEach((c) => {
      const o = document.createElement('option');
      o.value = c; o.textContent = c;
      sel.appendChild(o);
    });
    if (S.javaPath) { const o = document.createElement('option'); o.value = S.javaPath; o.textContent = S.javaPath + ' (atual)'; sel.appendChild(o); sel.value = S.javaPath; }
  } catch (e) { /* offline */ }
  // mojang status via versions
  try {
    await window.api.allVersions({});
    $('mojangDot').className = 'dot ok';
    $('mojangText').textContent = 'Mojang online';
  } catch {
    $('mojangDot').className = 'dot bad';
    $('mojangText').textContent = 'offline / sem internet';
  }
}

function refreshHero() {
  const v = $('version').value || S.version || '1.20.1';
  const ml = ($('modloader').value || 'vanilla').toUpperCase();
  $('heroVersion').textContent = v;
  $('heroLoader').textContent = ml;
  $('heroName').textContent = ($('username').value || 'Steve').slice(0, 16);
  $('heroDesc').textContent = `${ml} ${v} • ${$('ramMin').value}–${$('ramMax').value} GB • ${$('width').value}×${$('height').value}${$('fullscreen').checked ? ' fullscreen' : ''} • singleplayer + servidores offline.`;
  $('metaRes').textContent = `${$('width').value}×${$('height').value}${$('fullscreen').checked ? ' ⛶' : ''}`;
  $('metaRam').textContent = `${$('ramMin').value}–${$('ramMax').value}G`;
  document.querySelectorAll('.ml-card').forEach((c) => c.classList.toggle('selected', c.dataset.card === ($('modloader').value || 'vanilla')));
  $('statVer').textContent = `${ml} ${v}`;
}

// ---------- versions ----------
async function loadVersionSelect() {
  try {
    const data = await window.api.allVersions({});
    allVers = data;
    const sel = $('version');
    const cur = S.version || data.latest?.release || '1.20.1';
    sel.innerHTML = '';
    data.versions.slice(0, 60).forEach((v) => {
      const o = document.createElement('option');
      o.value = v.id; o.textContent = v.id + (v.id === data.latest?.release ? ' ★' : '');
      sel.appendChild(o);
    });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    refreshHero();
  } catch (e) {
    log('Versões: sem internet, usando fallback.');
  }
}

async function loadVersionGrid(reset = false) {
  if (reset) verShown = 40;
  try {
    // sincroniza filtros com backend
    await window.api.set({ showSnapshots: $('fSnapshot').checked, showOld: $('fOld').checked });
    const data = await window.api.allVersions({ force: false });
    allVers = data;
    const q = ($('verSearch').value || '').toLowerCase();
    let list = data.versions;
    if (q) list = list.filter((v) => v.id.toLowerCase().includes(q));
    $('verCount').textContent = `${list.length} versões • latest: ${data.latest?.release || '—'} • snapshot: ${data.latest?.snapshot || '—'}`;
    const grid = $('versionGrid');
    grid.innerHTML = '';
    list.slice(0, verShown).forEach((v) => {
      const d = document.createElement('div');
      d.className = 'ver-card' + (v.id === $('version').value ? ' selected' : '');
      const dt = v.releaseTime ? new Date(v.releaseTime).toLocaleDateString('pt-BR') : '';
      d.innerHTML = `<span class="vtype ${v.type}">${v.type.replace('old_', '')}</span><span class="v-id">${v.id}</span><span class="v-meta">${dt}</span>`;
      const btn = document.createElement('button');
      btn.className = 'btn small' + (v.id === $('version').value ? ' primary' : '');
      btn.textContent = v.id === $('version').value ? '✓ Em uso' : 'Usar';
      btn.onclick = async () => { $('version').value = v.id; await collectAndSave(); refreshHero(); loadVersionGrid(); loadLoaders(); toast('Versão ' + v.id + ' selecionada'); };
      d.appendChild(btn);
      grid.appendChild(d);
    });
    $('btnMoreVersions').style.display = list.length > verShown ? '' : 'none';
  } catch (e) {
    $('verCount').textContent = 'Sem internet — confira a conexão.';
  }
}

// ---------- modloaders ----------
function syncMlPills() {
  const ml = $('modloader').value || 'vanilla';
  document.querySelectorAll('.ml-pills button').forEach((b) => b.classList.toggle('active', b.dataset.ml === ml));
  const hints = { vanilla: 'puro, sem loader', fabric: 'auto = mais recente', forge: 'recommended/latest', neoforge: 'mais recente 20.x/21.x', quilt: 'auto = mais recente' };
  $('loaderHint').textContent = hints[ml] || '';
}
document.querySelectorAll('.ml-pills button').forEach((b) => {
  b.onclick = async () => { $('modloader').value = b.dataset.ml; syncMlPills(); refreshHero(); renderCatalog(); await collectAndSave(); if ($('autoTune').checked) autoTune('auto'); else loadLoaders(); };
});
document.querySelectorAll('.use-ml').forEach((b) => {
  b.onclick = async () => { $('modloader').value = b.dataset.use; syncMlPills(); refreshHero(); renderCatalog(); await collectAndSave(); toast(b.dataset.use.toUpperCase() + ' selecionado'); goTab('inicio'); };
});
$('btnAutoTune').onclick = () => autoTune('manual');
$('autoTune').onchange = collectAndSave;

async function loadLoaders() {
  const mc = $('version').value || S.version || '1.20.1';
  // fabric
  try {
    const f = await window.api.fabricVersions(mc);
    $('fabList').textContent = f.length ? f.slice(0, 6).map((x) => x.version).join('\n') : 'sem loader p/ ' + mc;
    const sel = $('fabVer'); const cur = sel.value;
    sel.innerHTML = '<option value="">auto</option>';
    f.forEach((x) => { const o = document.createElement('option'); o.value = x.version; o.textContent = x.version + (x.stable ? ' ★' : ''); sel.appendChild(o); });
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    fillLoaderSelect(f.map((x) => x.version));
  } catch { $('fabList').textContent = 'erro de rede'; }
  // quilt
  try {
    const q = await window.api.quiltVersions(mc);
    $('quiltList').textContent = q.length ? q.slice(0, 6).map((x) => x.version).join('\n') : 'sem loader p/ ' + mc;
    const sel = $('quiltVer'); sel.innerHTML = '<option value="">auto</option>';
    q.forEach((x) => { const o = document.createElement('option'); o.value = x.version; o.textContent = x.version; sel.appendChild(o); });
  } catch { $('quiltList').textContent = 'erro de rede'; }
  // forge
  try {
    const m = String(mc).match(/^(\d+)\.(\d+)/);
    const mcNew = m && (parseInt(m[1], 10) > 1 || (parseInt(m[1], 10) === 1 && parseInt(m[2], 10) >= 21));
    if (mcNew) {
      $('forgeList').textContent = `⚠️ Forge NÃO existe para MC ${mc} (só até 1.20.1).\nUse ⚡ NeoForge ao lado.`;
      $('forgeVer').innerHTML = '<option value="">indisponível p/ ' + mc + '</option>';
    } else {
      const fg = await window.api.forgeVersions(mc);
      const list = (fg.filtered && fg.filtered.length ? fg.filtered : fg.all) || [];
      $('forgeList').textContent = list.length ? list.slice(0, 6).map((x) => `${x.mc} → ${x.build}`).join('\n') : 'sem promo p/ ' + mc;
      const sel = $('forgeVer'); sel.innerHTML = '<option value="">recommended/latest (auto)</option>';
      list.slice(0, 10).forEach((x) => { const o = document.createElement('option'); o.value = x.build; o.textContent = `${x.mc} — ${x.build}`; sel.appendChild(o); });
    }
  } catch { $('forgeList').textContent = 'erro de rede'; }
  // neoforge
  try {
    const n = await window.api.neoforgeVersions(mc);
    $('neoList').textContent = n.length ? n.slice(0, 6).join('\n') : 'sem build p/ ' + mc + ' (tente outra versão do MC)';
    const sel = $('neoVer'); sel.innerHTML = '<option value="">mais recente (auto)</option>';
    n.slice(0, 10).forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
  } catch { $('neoList').textContent = 'erro de rede'; }
}

function fillLoaderSelect(vers) {
  const ml = $('modloader').value;
  const sel = $('modloaderVersion');
  const cur = sel.value;
  const map = { fabric: $('fabVer').value, quilt: $('quiltVer').value, forge: $('forgeVer').value, neoforge: $('neoVer').value };
  sel.innerHTML = '<option value="">auto (recomendado)</option>';
  const active = ml === 'fabric' ? vers : ml === 'quilt' ? [...$('quiltVer').options].map((o) => o.value).filter(Boolean) : ml === 'forge' ? [...$('forgeVer').options].map((o) => o.value).filter(Boolean) : ml === 'neoforge' ? [...$('neoVer').options].map((o) => o.value).filter(Boolean) : [];
  active.forEach((v) => { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); });
  if (map[ml] && [...sel.options].some((o) => o.value === map[ml])) sel.value = map[ml];
  else if (cur && [...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

// ---------- skins ----------
function fileURL(p) {
  // caminho absoluto -> file:// URL válida em Linux, macOS e Windows
  let s = String(p || '').replace(/\\/g, '/');
  if (/^[A-Za-z]:/.test(s)) s = '/' + s; // C:/... -> /C:/...
  return 'file://' + s;
}
function skinImg(src) {
  return new Promise((res, rej) => {
    if (!src) return rej(new Error('sem skin'));
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = fileURL(src) + '?t=' + Date.now();
  });
}
async function drawSkin(src) {
  const cv = $('skinPreview'); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = '#0b0f13'; ctx.fillRect(0, 0, 64, 64);
  try {
    const img = await skinImg(src);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 0, 0, 64, 64); // head
    try { ctx.drawImage(img, 40, 8, 8, 8, 0, 0, 64, 64); } catch {} // hat overlay
  } catch {
    ctx.fillStyle = '#c68642'; ctx.fillRect(24, 8, 16, 16);
    ctx.fillStyle = '#00a2ff'; ctx.fillRect(24, 28, 16, 20);
  }
}
async function drawSkinBig(src) {
  const cv = $('skinBig'); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, 128, 128);
  ctx.fillStyle = '#0b0f13'; ctx.fillRect(0, 0, 128, 128);
  try {
    const img = await skinImg(src);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 8, 8, 8, 8, 32, 4, 64, 64); // head
    try { ctx.drawImage(img, 40, 8, 8, 8, 32, 4, 64, 64); } catch {}
    ctx.drawImage(img, 20, 20, 8, 12, 44, 70, 40, 52); // torso
    ctx.drawImage(img, 4, 20, 4, 12, 28, 70, 14, 52); // arm L
    ctx.drawImage(img, 44, 20, 4, 12, 86, 70, 14, 52); // arm R
  } catch {
    ctx.fillStyle = '#c68642'; ctx.fillRect(48, 12, 32, 32);
    ctx.fillStyle = '#00a2ff'; ctx.fillRect(48, 48, 32, 60);
  }
}
async function loadSkins() {
  try {
    const list = await window.api.skinsList();
    const g = $('skinGallery');
    g.innerHTML = '';
    list.forEach((sk) => {
      const d = document.createElement('div');
      d.className = 'skin-item' + (sk.active ? ' active' : '');
      d.innerHTML = `<img /><div>${sk.name}</div>`;
      d.querySelector('img').src = fileURL(sk.path) + '?t=' + Date.now();
      const row = document.createElement('div'); row.className = 'row';
      const use = document.createElement('button'); use.className = 'btn small'; use.textContent = sk.active ? '✓' : 'Usar';
      use.onclick = async () => { const p = await window.api.skinsApply(sk.name); drawSkin(p); drawSkinBig(p); loadSkins(); toast('Skin aplicada'); };
      row.appendChild(use);
      if (!sk.active && sk.name !== 'skin.png') {
        const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕';
        del.onclick = async () => { await window.api.skinsDelete(sk.name); loadSkins(); };
        row.appendChild(del);
      }
      d.appendChild(row);
      g.appendChild(d);
    });
  } catch {}
}

// ---------- mods ----------
async function loadMods() {
  try {
    const list = await window.api.modsList();
    installedMods = list.map((m) => m.name);
    renderCatalog();
    $('modsCount').textContent = list.length;
    $('statMods').textContent = list.filter((m) => m.enabled).length;
    const box = $('modsList');
    box.innerHTML = '';
    $('modsEmpty').style.display = list.length ? 'none' : '';
    list.forEach((m) => {
      const d = document.createElement('div');
      d.className = 'mod-row' + (m.enabled ? '' : ' disabled');
      d.innerHTML = `<span>🧩</span><span class="name" title="${m.name}">${m.name}</span><span class="size">${m.size}</span>`;
      const t = document.createElement('button');
      t.className = 'toggle' + (m.enabled ? ' on' : '');
      t.title = m.enabled ? 'Desativar' : 'Ativar';
      t.onclick = async () => { await window.api.modsToggle(m.name); loadMods(); };
      const del = document.createElement('button');
      del.className = 'del'; del.textContent = 'Excluir';
      del.onclick = async () => { if (confirm('Excluir ' + m.name + '?')) { await window.api.modsDelete(m.name); loadMods(); } };
      d.appendChild(t); d.appendChild(del);
      box.appendChild(d);
    });
    loadPacks();
  } catch {}
}

// ---------- config / news ----------
async function loadConfig() {
  $('javaOut').textContent = '';
}
async function loadNews() {
  try {
    const n = await window.api.news();
    const g = $('newsGrid');
    g.innerHTML = '';
    (n.items || []).forEach((it) => {
      const d = document.createElement('div');
      d.className = 'news-card';
      d.innerHTML = `<div class="tag">${it.tag}</div><h4>${it.title}</h4><p>${it.desc}</p>`;
      g.appendChild(d);
    });
  } catch {}
}

// ---------- auto-update ----------
async function silentUpdateCheck() {
  try {
    const last = parseInt(localStorage.getItem('cl_lastUpdCheck') || '0', 10);
    if (Date.now() - last < 24 * 3600 * 1000) return;
    const r = await window.api.updateCheck();
    localStorage.setItem('cl_lastUpdCheck', String(Date.now()));
    if (!r) return;
    $('verTag').textContent = 'v' + (r.current || '?');
    if (r.ok && r.update) {
      $('btnUpdate').classList.add('primary');
      toast(`Nova versão do launcher: ${r.tag} — clique em 🔄 para atualizar`);
      log(`Atualização disponível: ${r.current} → ${r.tag}`);
    }
  } catch {}
}
$('btnUpdate').onclick = async () => {
  toast('Verificando atualização...');
  const r = await window.api.updateCheck();
  if (!r) return;
  $('verTag').textContent = 'v' + (r.current || '?');
  if (!r.ok) { toast('Falha ao verificar: ' + (r.error || '?'), true); return; }
  if (!r.update) {
    $('btnUpdate').classList.remove('primary');
    toast(`Já atualizado (v${r.current}) ✅`);
    return;
  }
  $('btnUpdate').classList.add('primary');
  const msg = `Nova versão ${r.tag} disponível (você tem v${r.current}).\n\n${(r.notes || '').slice(0, 300)}\n\nAtualizar agora?`;
  if (!confirm(msg)) {
    window.api.updateOpenPage();
    return;
  }
  toast('Baixando atualização... acompanhe na aba Modloaders');
  goTab('modloaders');
  const a = await window.api.updateApply();
  if (a.ok) {
    toast(a.restarted ? 'Reiniciando com a nova versão...' : 'Instalador aberto — o app vai fechar');
  } else {
    toast('Atualização: ' + a.error, true);
    log('Atualização: ' + a.error);
  }
};

// ---------- save / launch ----------
async function collectAndSave() {
  // sincroniza loader secundário -> principal
  const ml = $('modloader').value;
  let lv = $('modloaderVersion').value;
  if (!lv) {
    if (ml === 'fabric' && $('fabVer').value) lv = $('fabVer').value;
    else if (ml === 'quilt' && $('quiltVer').value) lv = $('quiltVer').value;
    else if (ml === 'forge' && $('forgeVer').value) lv = $('forgeVer').value;
    else if (ml === 'neoforge' && $('neoVer').value) lv = $('neoVer').value;
  }
  const obj = {
    username: ($('username').value.trim() || 'Steve').slice(0, 16),
    version: $('version').value,
    modloader: ml,
    modloaderVersion: lv,
    ramMin: parseInt($('ramMin').value, 10),
    ramMax: parseInt($('ramMax').value, 10),
    javaPath: $('javaPreset').value || $('javaPath').value.trim(),
    gameDir: $('gameDir').value.trim() || S.gameDir,
    width: parseInt($('width').value, 10) || 854,
    height: parseInt($('height').value, 10) || 480,
    fullscreen: $('fullscreen').checked,
    jvmArgs: $('jvmArgs').value.trim(),
    gameArgs: $('gameArgs').value.trim(),
    serverHost: $('serverHost').value.trim(),
    serverPort: $('serverPort').value.trim() || '25565',
    demo: $('demo').checked,
    closeAction: $('closeAction').value,
    skinModel: $('skinModel').value,
    autoTune: $('autoTune').checked
  };
  if (obj.ramMin > obj.ramMax) [obj.ramMin, obj.ramMax] = [obj.ramMax, obj.ramMin];
  S = { ...S, ...obj };
  await window.api.set(obj);
  refreshHero();
  return obj;
}

async function doLaunch() {
  if (launching) return;
  const opts = await collectAndSave();
  launching = true;
  setBtnPlay(true);
  $('status').textContent = 'Iniciando…';
  $('playSub').textContent = 'iniciando…';
  goTab('modloaders');
  log(`\n=== JOGAR: ${opts.version} (${opts.modloader}${opts.modloaderVersion ? ' ' + opts.modloaderVersion : ''}) como ${opts.username} ===`);
  const r = await window.api.launch(opts);
  if (!r.ok) {
    launching = false;
    setBtnPlay(false);
    $('status').textContent = 'Erro ao iniciar. Veja os logs.';
    $('playSub').textContent = 'erro — veja logs';
    toast('Erro: ' + r.error, true);
    log('ERRO: ' + r.error);
  }
}

// ---------- events ----------
$('btnPlay').onclick = doLaunch;
$('btnPlayHero').onclick = doLaunch;
$('btnOpenGame').onclick = () => window.api.openFolder('');
$('btnGoVersions').onclick = () => goTab('versoes');
$('btnNews').onclick = loadNews;
$('btnDice').onclick = async () => {
  $('username').value = NICKS[Math.floor(Math.random() * NICKS.length)] + '_' + Math.floor(Math.random() * 999);
  await collectAndSave(); refreshHeader(); refreshHero();
};
$('btnCopyUUID').onclick = () => { navigator.clipboard?.writeText($('uuidText').textContent); toast('UUID copiado'); };
$('username').oninput = refreshHero;
$('ramMin').oninput = () => { $('ramMinVal').textContent = $('ramMin').value + 'G'; refreshHero(); };
$('ramMax').oninput = () => { $('ramMaxVal').textContent = $('ramMax').value + 'G'; refreshHero(); };
$('width').oninput = refreshHero; $('height').oninput = refreshHero; $('fullscreen').onchange = refreshHero;
$('version').onchange = async () => { refreshHero(); refreshJavaNeed(); await collectAndSave(); loadVersionGrid(); if ($('autoTune').checked) autoTune('auto'); else loadLoaders(); };
$('btnReloadVersions').onclick = async () => { await window.api.allVersions({ force: true }); await loadVersionSelect(); loadVersionGrid(true); toast('Lista de versões atualizada'); };
$('verSearch').oninput = () => loadVersionGrid();
$('fRelease').onchange = () => loadVersionGrid(true);
$('fSnapshot').onchange = () => loadVersionGrid(true);
$('fOld').onchange = () => loadVersionGrid(true);
$('btnRefreshVersions').onclick = async () => { await window.api.allVersions({ force: true }); loadVersionGrid(true); };
$('btnMoreVersions').onclick = () => { verShown += 40; loadVersionGrid(); };
$('fabVer').onchange = () => { $('modloaderVersion').value = ''; };
$('quiltVer').onchange = () => { $('modloaderVersion').value = ''; };
$('forgeVer').onchange = () => { $('modloaderVersion').value = ''; };
$('neoVer').onchange = () => { $('modloaderVersion').value = ''; };

let installingMl = false;
async function installModloader(kind, btn, fn) {
  if (installingMl) { toast('Já há uma instalação em andamento…', true); return; }
  installingMl = true;
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '⏳ Instalando… (minutos)';
  try {
    const r = await fn();
    if (r.ok) {
      S = await window.api.getAll();
      // reflete versão (pode ter sido ajustada) e profile no UI
      if (S.version && [...$('version').options].some((o) => o.value === S.version)) $('version').value = S.version;
      else { const o = document.createElement('option'); o.value = S.version; o.textContent = S.version; $('version').appendChild(o); $('version').value = S.version; }
      refreshHero();
      toast(`${kind} pronto: ${r.id} (MC ${r.mc}) ✅ Clique em JOGAR.`);
      log(`=== ${kind} PRONTO: ${r.id} | MC ${r.mc} — clique em JOGAR ===`);
    } else {
      toast(`Falha ${kind}: ` + r.error, true);
    }
  } finally {
    installingMl = false;
    btn.disabled = false;
    btn.textContent = old;
  }
}

$('btnInstallForge').onclick = (e) => {
  const mc = $('version').value;
  log(`Instalando Forge para ${mc}… (pode levar minutos, ~300 MB)`);
  toast('Instalando Forge — acompanhe os logs na caixa abaixo');
  goTab('modloaders');
  installModloader('Forge', e.target, () => window.api.installForge({ mcVersion: mc, build: $('forgeVer').value || undefined }));
};
$('btnInstallNeo').onclick = (e) => {
  const nv = $('neoVer').value;
  log(`Instalando NeoForge ${nv || '(mais recente)'}… (pode levar minutos, ~300 MB)`);
  toast('Instalando NeoForge — acompanhe os logs na caixa abaixo');
  goTab('modloaders');
  installModloader('NeoForge', e.target, () => window.api.installNeoForge({ neoVersion: nv || undefined }));
};

const pickSkin = async () => {
  const p = await window.api.selectSkin();
  if (p) { drawSkin(p); drawSkinBig(p); loadSkins(); toast('Skin adicionada à galeria'); }
};
$('btnSkin').onclick = pickSkin;
$('btnSkin2').onclick = pickSkin;
// ---------- catálogo de mods 1-clique ----------
// resolve: slug do Modrinth por loader. loaders: onde o mod funciona.
const MOD_CATALOG = [
  { cat: '⚡ PERFORMANCE (FPS, RAM, boot)' },
  { key: 'sodium', name: '⚡ Sodium', desc: 'Muito mais FPS. Essencial. (Forge usa Embeddium)', check: ['sodium', 'embeddium'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'sodium', quilt: 'sodium', neoforge: 'sodium', forge: 'embeddium' } },
  { key: 'lithium', name: '🧠 Lithium', desc: 'Otimiza física e ticks. (Forge usa Canary)', check: ['lithium', 'canary'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'lithium', quilt: 'lithium', neoforge: 'lithium', forge: 'canary' } },
  { key: 'ferrite', name: '💾 FerriteCore', desc: 'Usa bem menos RAM.', check: ['ferrite'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'ferrite-core', quilt: 'ferrite-core', forge: 'ferrite-core', neoforge: 'ferrite-core' } },
  { key: 'modernfix', name: '🚀 ModernFix', desc: 'Boot mais rápido + FPS.', check: ['modernfix'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'modernfix', quilt: 'modernfix', forge: 'modernfix', neoforge: 'modernfix' }, noMc: ['26.2', '26.3'], noMcHint: 'Disponível até 1.21.1 — na 26.x use 💾 FerriteCore' },
  { key: 'entityculling', name: '👁️ Entity Culling', desc: 'Não renderiza o que você não vê.', check: ['entityculling'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'entityculling', quilt: 'entityculling', forge: 'entityculling', neoforge: 'entityculling' } },
  { key: 'krypton', name: '🌐 Krypton', desc: 'Rede otimizada (Fabric/Quilt).', check: ['krypton'], loaders: ['fabric', 'quilt'], resolve: { fabric: 'krypton', quilt: 'krypton' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' },
  { key: 'alternate', name: '⚡ Alternate Current', desc: 'Redstone mais leve.', check: ['alternate'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'alternate-current', quilt: 'alternate-current', forge: 'alternate-current', neoforge: 'alternate-current' } },
  { key: 'dynamicfps', name: '💤 Dynamic FPS', desc: 'Economiza GPU com jogo minimizado.', check: ['dynamic'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'dynamic-fps', quilt: 'dynamic-fps', forge: 'dynamic-fps', neoforge: 'dynamic-fps' } },
  { cat: '🌅 GRÁFICOS' },
  { key: 'iris', name: '🌅 Iris', desc: 'Shaders. (Forge usa Oculus)', check: ['iris', 'oculus'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'iris', quilt: 'iris', neoforge: 'iris', forge: 'oculus' } },
  { key: 'sodium-extra', name: '✨ Sodium Extra', desc: 'Opções extras p/ Sodium.', check: ['sodium-extra'], loaders: ['fabric', 'neoforge', 'quilt'], resolve: { fabric: 'sodium-extra', quilt: 'sodium-extra', neoforge: 'sodium-extra' } },
  { key: 'reeses', name: '⚙️ Reese\u2019s Sodium Options', desc: 'Menu de vídeo melhorado.', check: ['reeses'], loaders: ['fabric', 'neoforge', 'quilt'], resolve: { fabric: 'reeses-sodium-options', quilt: 'reeses-sodium-options', neoforge: 'reeses-sodium-options' }, deps: ['sodium'] },
  { key: 'lambdynamic', name: '💡 Dynamic Lights', desc: 'Tocha na mão ilumina.', check: ['lambdynamiclights'], loaders: ['fabric', 'neoforge', 'quilt'], resolve: { fabric: 'lambdynamiclights', quilt: 'lambdynamiclights', neoforge: 'lambdynamiclights' } },
  { key: 'continuity', name: '🧱 Continuity', desc: 'Texturas conectadas (vidro etc).', check: ['continuity'], loaders: ['fabric', 'forge', 'quilt'], resolve: { fabric: 'continuity', quilt: 'continuity', forge: 'continuity' } },
  { cat: '🌄 SHADERS (pasta shaderpacks, precisa do Iris)' },
  { key: 'bsl', name: '🌄 BSL Shaders', desc: 'Shader bonito e leve.', check: ['bsl'], dir: 'shaderpacks', loaders: [], resolve: { fabric: 'bsl-shaders' } },
  { key: 'complementary', name: '🌇 Complementary', desc: 'Shader famoso, visual incrível.', check: ['complementary'], dir: 'shaderpacks', loaders: [], resolve: { fabric: 'complementary-reimagined' } },
  { cat: '🧰 UTILIDADES' },
  { key: 'appleskin', name: '🍎 AppleSkin', desc: 'Mostra fome/saturação.', check: ['appleskin'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'appleskin', quilt: 'appleskin', forge: 'appleskin', neoforge: 'appleskin' } },
  { key: 'jei', name: '📖 JEI', desc: 'Vê receitas de todos os itens.', check: ['jei'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'jei', quilt: 'jei', forge: 'jei', neoforge: 'jei' } },
  { key: 'rei', name: '📚 REI', desc: 'Alternativa ao JEI.', check: ['roughly', 'rei'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'rei', quilt: 'rei', forge: 'rei', neoforge: 'rei' }, deps: ['cloth', 'architectury'], noMc: ['26.3'], noMcHint: 'Disponível até 26.2 — ou use 📖 JEI' },
  { key: 'jade', name: '🔍 Jade', desc: 'Diz o bloco que você mira.', check: ['jade'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'jade', quilt: 'jade', forge: 'jade', neoforge: 'jade' } },
  { key: 'wthit', name: '🎯 WTHIT', desc: 'Tooltip leve de blocos.', check: ['wthit', 'wthit-'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'wthit', quilt: 'wthit', forge: 'wthit', neoforge: 'wthit' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2 — ou use 🔍 Jade' },
  { key: 'journeymap', name: '🗺️ JourneyMap', desc: 'Minimapa + mapa tela cheia.', check: ['journeymap'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'journeymap', quilt: 'journeymap', forge: 'journeymap', neoforge: 'journeymap' } },
  { key: 'mousetweaks', name: '🖱️ Mouse Tweaks', desc: 'Arrastar itens com botão direito.', check: ['mousetweaks', 'mouse-tweaks'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'mouse-tweaks', quilt: 'mouse-tweaks', forge: 'mouse-tweaks', neoforge: 'mouse-tweaks' } },
  { key: 'ipn', name: '🎒 Inventory Profiles', desc: 'Organiza inventário (R).', check: ['inventoryprofilesnext', 'inventory-profiles'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'inventory-profiles-next', quilt: 'inventory-profiles-next', forge: 'inventory-profiles-next', neoforge: 'inventory-profiles-next' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' },
  { key: 'shulkertooltip', name: '📦 Shulker Tooltip', desc: 'Vê dentro da shulker sem abrir.', check: ['shulkerboxtooltip', 'shulker-box'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'shulkerboxtooltip', quilt: 'shulkerboxtooltip', forge: 'shulkerboxtooltip', neoforge: 'shulkerboxtooltip' } },
  { key: 'betterf3', name: '📊 BetterF3', desc: 'Tela F3 limpa e útil.', check: ['betterf3', 'better-f3'], loaders: ['fabric', 'forge', 'quilt'], resolve: { fabric: 'betterf3', quilt: 'betterf3', forge: 'betterf3' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' },
  { key: 'nochatreports', name: '💬 No Chat Reports', desc: 'Protege sua conta (sem report).', check: ['no-chat-reports', 'nochatreports'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'no-chat-reports', quilt: 'no-chat-reports', forge: 'no-chat-reports', neoforge: 'no-chat-reports' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' },
  { key: 'modmenu', name: '📋 Mod Menu', desc: 'Lista os mods no menu (Fabric/Quilt).', check: ['modmenu'], loaders: ['fabric', 'quilt'], resolve: { fabric: 'modmenu', quilt: 'modmenu' } },
  { cat: '🏔️ MUNDO & CONTEÚDO' },
  { key: 'terralith', name: '🏔️ Terralith', desc: 'Biomas novos incríveis.', check: ['terralith'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'terralith', quilt: 'terralith', forge: 'terralith', neoforge: 'terralith' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' },
  { key: 'bop', name: '🌳 Biomes O\u2019 Plenty', desc: 'Dezenas de biomas novos.', check: ['biomes-o-plenty', 'biomesoplenty'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'biomes-o-plenty', quilt: 'biomes-o-plenty', forge: 'biomes-o-plenty', neoforge: 'biomes-o-plenty' }, noMc: ['1.20.1', '26.3'], noMcHint: 'Na 1.20.1 use 🏔️ Terralith' },
  { key: 'waystones', name: '🗿 Waystones', desc: 'Teleporte entre pedras.', check: ['waystones'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'waystones', quilt: 'waystones', forge: 'waystones', neoforge: 'waystones' }, deps: ['balm'] },
  { key: 'supplementaries', name: '🏺 Supplementaries', desc: 'Móveis e utilidades.', check: ['supplementaries'], loaders: ['fabric', 'forge', 'neoforge'], resolve: { fabric: 'supplementaries', forge: 'supplementaries', neoforge: 'supplementaries' }, deps: ['puzzles'], noMc: ['26.2', '26.3'], noMcHint: 'Disponível até 1.21.1' },
  { key: 'create', name: '⚙️ Create', desc: 'Engenharia e máquinas (Forge 1.20).', check: ['create-'], loaders: ['forge'], resolve: { forge: 'create' } },
  { key: 'farmersdelight', name: '🌾 Farmer\u2019s Delight', desc: 'Culinária nova (Forge 1.20).', check: ['farmersdelight', 'farmers-delight'], loaders: ['forge'], resolve: { forge: 'farmers-delight' } },
  { cat: '🎨 SKINS' },
  { key: 'skinshuffle', name: '🎨 Skin Shuffle', desc: 'Troca de skin dentro do jogo.', check: ['skinshuffle', 'skin-shuffle'], loaders: ['fabric', 'quilt'], resolve: { fabric: 'skinshuffle', quilt: 'skinshuffle' } },
  { cat: '🔧 BIBLIOTECAS (dependências)' },
  { key: 'cloth', name: '🔧 Cloth Config', desc: 'Exigida por vários mods.', check: ['cloth-config'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'cloth-config', quilt: 'cloth-config', forge: 'cloth-config', neoforge: 'cloth-config' } },
  { key: 'architectury', name: '🏗️ Architectury', desc: 'Exigida por vários mods.', check: ['architectury'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'architectury-api', quilt: 'architectury-api', forge: 'architectury-api', neoforge: 'architectury-api' } },
  { key: 'balm', name: '🧪 Balm', desc: 'Exigida pelo Waystones.', check: ['balm'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'balm', quilt: 'balm', forge: 'balm', neoforge: 'balm' } },
  { key: 'puzzles', name: '🧩 Puzzles Lib', desc: 'Exigida pelo Supplementaries.', check: ['puzzles-lib', 'puzzleslib'], loaders: ['fabric', 'forge', 'neoforge', 'quilt'], resolve: { fabric: 'puzzles-lib', quilt: 'puzzles-lib', forge: 'puzzles-lib', neoforge: 'puzzles-lib' }, noMc: ['26.3'], noMcHint: 'Disponível até 26.2' }
];
let installedMods = [];
let sysMem = null; // {total, free} GB — preenchido em refreshHeader

function isNewMc(mc) {
  const m = String(mc || '').match(/^(\d+)\.(\d+)/);
  return !!m && (parseInt(m[1], 10) > 1 || (parseInt(m[1], 10) === 1 && parseInt(m[2], 10) >= 21));
}
function pickLatestStable(sel) {
  const opts = [...sel.options].map((o) => o.value).filter(Boolean);
  return opts.find((v) => !/beta|alpha/i.test(v)) || opts[0] || '';
}
// Ajusta tudo sozinho conforme versão/loader: loader compatível, versão do
// loader, RAM dentro do limite do PC e aviso de mods incompatíveis.
async function autoTune(mode) {
  const manual = mode === 'manual';
  const mc = $('version').value;
  let ml = $('modloader').value || 'vanilla';
  const notes = [];
  if (ml === 'forge' && isNewMc(mc)) {
    ml = 'neoforge';
    $('modloader').value = 'neoforge';
    syncMlPills();
    notes.push('Forge não existe aqui → NeoForge ⚡');
  }
  await loadLoaders();
  const map = { fabric: 'fabVer', quilt: 'quiltVer', forge: 'forgeVer', neoforge: 'neoVer' };
  if (map[ml]) {
    const v = pickLatestStable($(map[ml]));
    if (v) { $(map[ml]).value = v; notes.push('loader ' + v); }
    $('modloaderVersion').value = '';
  }
  if (!sysMem) {
    try { const i = await window.api.systemInfo(); sysMem = { total: i.totalMemGB, free: i.freeMemGB }; } catch {}
  }
  const cap = sysMem ? Math.max(1, Math.min(Math.floor(sysMem.total * 0.6), Math.floor(sysMem.free * 0.8))) : 8;
  let rMin = parseInt($('ramMin').value, 10) || 2;
  let rMax = parseInt($('ramMax').value, 10) || 4;
  const modded = ml !== 'vanilla';
  if (manual) {
    rMin = modded ? 3 : 2;
    rMax = modded ? Math.min(6, cap) : Math.min(4, cap);
    if (rMin > rMax) rMin = Math.max(1, rMax - 1);
    notes.push(`RAM ${rMin}–${rMax}G`);
  } else if (rMax > cap) {
    rMax = cap;
    if (rMin > rMax) rMin = rMax;
    notes.push(`RAM ajustada p/ ${rMax}G (limite do PC)`);
  }
  $('ramMin').value = rMin; $('ramMax').value = rMax;
  $('ramMinVal').textContent = rMin + 'G'; $('ramMaxVal').textContent = rMax + 'G';
  await collectAndSave();
  refreshHero(); refreshJavaNeed(); renderCatalog();
  try {
    const a = await window.api.modsAudit({ mcVersion: mc, loader: ml });
    if (ml === 'vanilla' && a.total) notes.push(`${a.total} mod(s) ignorados no Vanilla`);
    else if (a.bad.length) notes.push(`⚠️ ${a.bad.length} mod(s) de outro loader/versão`);
  } catch {}
  const msg = notes.length ? 'Auto: ' + notes.join(' • ') : 'Auto: tudo certo ✓';
  toast(msg, false);
  log(msg);
  await loadMods();
}

function renderCatalog() {
  const box = $('modCatalog');
  if (!box) return;
  box.innerHTML = '';
  let grid = null;
  let category = 'all';
  const search = ($('modSearch')?.value || '').trim().toLowerCase();
  const loaderFilter = $('modLoaderFilter')?.value || 'all';
  const categoryFilter = $('modCategoryFilter')?.value || 'all';
  for (const entry of MOD_CATALOG) {
    if (entry.cat) {
      category = entry.cat.includes('PERFORMANCE') ? 'performance'
        : entry.cat.includes('GRÁFICOS') ? 'graphics'
          : entry.cat.includes('SHADERS') ? 'shaders'
            : entry.cat.includes('UTILIDADES') ? 'utility'
              : entry.cat.includes('MUNDO') ? 'world'
                : entry.cat.includes('SKINS') ? 'skins'
                  : entry.cat.includes('BIBLIOTECAS') ? 'libs' : 'all';
      if (categoryFilter !== 'all' && categoryFilter !== category) { grid = null; continue; }
      const t = document.createElement('div');
      t.className = 'mod-cat-title';
      t.textContent = entry.cat;
      box.appendChild(t);
      grid = document.createElement('div');
      grid.className = 'mod-catalog';
      box.appendChild(grid);
      continue;
    }
    const cur = $('modloader').value || 'vanilla';
    const isShader = (entry.dir || 'mods') !== 'mods';
    const supportsCur = isShader || entry.loaders.includes(cur);
    const text = `${entry.name} ${entry.desc} ${entry.loaders.join(' ')}`.toLowerCase();
    if ((loaderFilter !== 'all' && !isShader && !entry.loaders.includes(loaderFilter)) ||
        (categoryFilter !== 'all' && category !== categoryFilter) ||
        (search && !text.includes(search))) continue;
    const installed = entry.check.some((p) => installedMods.some((m) => m.toLowerCase().startsWith(p)));
    const deadMc = (entry.noMc || []).includes($('version').value);
    const card = document.createElement('div');
    card.className = 'mod-card' + (installed ? ' installed' : '') + (deadMc ? ' unavailable' : '');
    const tagLine = isShader ? 'shaderpack 🎨 (pasta shaderpacks)' : `para: <b>${entry.loaders.join(' • ')}</b>`;
    card.innerHTML = `<h4>${entry.name}</h4><p>${entry.desc}</p><div class="tags">${tagLine}${installed ? ' <span class="ok">✓ INSTALADO</span>' : ''}${deadMc ? `<div class="unav-hint">🚫 Sem build p/ MC ${$('version').value}. ${entry.noMcHint || ''}</div>` : ''}</div>`;
    const btn = document.createElement('button');
    btn.className = 'btn small' + (installed && !deadMc ? '' : ' primary');
    btn.textContent = deadMc ? '🚫 Indisponível' : installed ? '✓ Instalado' : (supportsCur ? '⬇ Instalar' : `⬇ Instalar (${entry.loaders[0]})`);
    btn.disabled = deadMc;
    btn.onclick = () => installCatalog(entry, btn);
    card.appendChild(btn);
    grid.appendChild(card);
  }
  const vw = $('vanillaWarn');
  if (vw) vw.style.display = ($('modloader').value || 'vanilla') === 'vanilla' ? '' : 'none';
}

async function installCatalog(entry, btn) {
  const isShader = (entry.dir || 'mods') !== 'mods';
  let cur = $('modloader').value || 'vanilla';
  const mc = $('version').value;
  if ((entry.noMc || []).includes(mc)) {
    const msg = `"${entry.name}" não tem build para MC ${mc}. ${entry.noMcHint || ''}`;
    toast(msg, true);
    log('Mods: ' + msg);
    return;
  }
  const mcNew = (() => { const m = String(mc).match(/^(\d+)\.(\d+)/); return m && (parseInt(m[1], 10) > 1 || (parseInt(m[1], 10) === 1 && parseInt(m[2], 10) >= 21)); })();
  if (!isShader && cur === 'forge' && mcNew && entry.loaders.includes('neoforge')) {
    // Forge não existe para MC novo (só até 1.20.1): migra para NeoForge sozinho
    cur = 'neoforge';
    $('modloader').value = 'neoforge';
    syncMlPills(); await collectAndSave(); refreshHero();
    toast(`Forge não existe para MC ${mc} — trocado para NeoForge ⚡`);
    log(`Mods: Forge indisponível para MC ${mc}, usando NeoForge.`);
  }
  if (!isShader && !entry.loaders.includes(cur)) {
    if (cur === 'vanilla' && entry.loaders.includes('fabric')) {
      cur = 'fabric';
      $('modloader').value = 'fabric';
      syncMlPills(); await collectAndSave(); refreshHero();
      toast('Modloader trocado para Fabric 🧵 (mods não rodam no Vanilla)');
    } else {
      const msg = `"${entry.name}" só tem para ${entry.loaders.join('/')} — troque o modloader na barra lateral.`;
      toast(msg, true);
      log('Mods: ' + msg);
      return;
    }
  }
  if (isShader) cur = 'fabric'; // só p/ filtro de versão; shaders ignoram loader
  // dependências primeiro (ex: Waystones precisa do Balm)
  for (const depKey of entry.deps || []) {
    const dep = MOD_CATALOG.find((x) => x.key === depKey);
    if (!dep) continue;
    const depSlug = dep.resolve[cur] || dep.resolve.fabric;
    if (!depSlug) continue;
    log(`Dependência: instalando ${dep.name}...`);
    const rd = await window.api.installModrinth({ slug: depSlug, loader: cur, mcVersion: $('version').value, dir: dep.dir || 'mods' });
    if (!rd.ok) {
      toast(`Dependência falhou (${dep.name}): ` + rd.error, true);
      log(`Dependência ${dep.name} falhou: ` + rd.error);
      return;
    }
  }
  const slug = entry.resolve[cur] || entry.resolve.fabric;
  if (!slug) {
    const msg = `"${entry.name}" não tem build para ${cur}.`;
    toast(msg, true);
    log('Mods: ' + msg);
    return;
  }
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '⏳ Baixando…';
  log(`Instalando ${entry.name} (${isShader ? 'shader' : cur}, MC ${$('version').value})…`);
  try {
    const r = await window.api.installModrinth({ slug, loader: cur, mcVersion: $('version').value, dir: entry.dir || 'mods' });
    toast(r.ok ? (r.already ? 'Já estava instalado: ' + r.file : 'Instalado: ' + r.file + ' ✅') : 'Falha: ' + r.error, !r.ok);
  } finally {
    btn.disabled = false;
    btn.textContent = old;
    await loadMods();
  }
}

const activateSkin = async () => {
  let ml = $('modloader').value;
  let loader = ml === 'vanilla' ? 'fabric' : ml;
  // Quilt usa build fabric; forge/neoforge não têm mod de skin offline -> força fabric
  if (loader === 'forge' || loader === 'neoforge') loader = 'fabric';
  log('Instalando mod de skin offline (OfflineSkins → StraySkins)…');
  const r = await window.api.installModrinth({ slug: 'offlineskins', fallbacks: ['strayskins'], loader, mcVersion: $('version').value });
  toast(r.ok ? `Skin ativada: ${r.file} ✅ (mod: ${r.slug})` : 'Falha: ' + r.error, !r.ok);
  if (r.ok && (ml === 'vanilla' || ml === 'forge' || ml === 'neoforge')) {
    $('modloader').value = 'fabric';
    syncMlPills(); await collectAndSave(); refreshHero();
    toast('Modloader trocado para Fabric 🧵 (necessário p/ skin offline)');
  }
  loadMods();
};
$('btnSkinMod').onclick = activateSkin;
$('btnSkinMod2').onclick = activateSkin;
$('skinModel').onchange = collectAndSave;

$('btnRefreshMods').onclick = loadMods;
$('btnExportPack').onclick = async (e) => {
  const btn = e.target.closest('button');
  btn.disabled = true;
  try {
    const r = await window.api.exportPack();
    toast(r.ok ? `Exportado: ${r.count} mods ✅` : 'Falha: ' + r.error, !r.ok);
    if (r.ok) log('Exportado para ' + r.file);
  } finally { btn.disabled = false; }
};
$('btnLinkInstall').onclick = async () => {
  const input = $('linkInput').value.trim();
  if (!input) { toast('Cole um link ou nome primeiro', true); return; }
  goTab('modloaders');
  log(`Instalando por link: ${input} (MC ${$('version').value}/${$('modloader').value})…`);
  const r = await window.api.linkInstall({ input });
  toast(r.ok ? `Instalado: ${r.file || r.name} ✅` : 'Falha: ' + r.error, !r.ok);
  await loadMods();
  await loadPacks();
};
$('btnSearchAll').onclick = async () => {
  const q = $('modSearchAll').value.trim();
  if (!q) { toast('Digite algo para buscar', true); return; }
  const box = $('searchResults');
  box.innerHTML = '<div class="muted">Buscando no Modrinth...</div>';
  try {
    const res = await window.api.modsSearch({ query: q, mcVersion: $('version').value, loader: $('modloader').value });
    const hits = res.hits || [];
    box.innerHTML = `<div class="muted">Resultados para <b>${res.mc}/${res.loader}</b> — ✓ tem build, ✖ não tem.</div>`;
    if (!hits.length) box.innerHTML += '<div class="muted">Nada encontrado.</div>';
    const typeName = { mod: '🧩 mod', shader: '🌅 shader', resourcepack: '🎨 textura' };
    hits.slice(0, 10).forEach((h) => {
      const d = document.createElement('div');
      d.className = 'mod-row' + (h.compatible ? '' : ' disabled');
      const badge = h.compatible
        ? `<span class="ok">✓ ${res.mc}</span>`
        : `<span style="color:var(--danger);font-size:11px;font-weight:800">✖ ${res.mc}</span>`;
      d.innerHTML = `<span>${(typeName[h.type] || h.type).split(' ')[0]}</span><span class="name" title="${(h.description || '').slice(0, 200)}"><b>${h.title}</b> <span class="muted">· ${typeName[h.type] || h.type}</span> ${badge}<br><span class="muted">${(h.description || '').slice(0, 90)}</span></span>`;
      const btn = document.createElement('button');
      if (h.compatible) {
        btn.className = 'btn small primary'; btn.textContent = '⬇ Instalar';
      } else {
        btn.className = 'btn small'; btn.textContent = 'Sem build'; btn.disabled = true;
        btn.title = `Sem build para MC ${res.mc} (${res.loader}) — troque a versão ou o loader`;
      }
      btn.onclick = async () => {
        btn.disabled = true;
        goTab('modloaders');
        const r = await window.api.linkInstall({ input: h.slug });
        toast(r.ok ? `Instalado: ${r.file || r.name} ✅` : 'Falha: ' + r.error, !r.ok);
        btn.disabled = false;
        await loadMods();
        await loadPacks();
      };
      d.appendChild(btn);
      box.appendChild(d);
    });
  } catch (e) {
    box.innerHTML = '<div class="muted">Erro: ' + e.message + '</div>';
  }
};
async function loadPacks() {
  try {
    const list = await window.api.packsInstalled();
    $('packInstalled').textContent = list.length
      ? 'Instalados: ' + list.map((p) => `${p.name} (${p.mc}/${p.loader})`).join(' • ')
      : '';
  } catch {}
}
$('btnPackSearch').onclick = async () => {
  const q = $('packQuery').value.trim();
  if (!q) { toast('Digite o nome ou link do pack', true); return; }
  const box = $('packResults');
  box.innerHTML = '<div class="muted">Buscando...</div>';
  try {
    const hits = await window.api.packsSearch({ query: q });
    box.innerHTML = '';
    if (!hits.length) box.innerHTML = '<div class="muted">Nenhum pack encontrado.</div>';
    // se for slug/URL exato, oferece as versões disponíveis
    const exact = cleanSlug(q);
    let vers = [];
    if (exact) {
      try { vers = await window.api.packsVersions({ slug: exact }); } catch {}
    }
    hits.slice(0, 8).forEach((h) => {
      const d = document.createElement('div');
      d.className = 'mod-row';
      d.innerHTML = `<span>🎁</span><span class="name" title="${(h.description || '').slice(0, 200)}"><b>${h.title}</b><br><span class="muted">${(h.description || '').slice(0, 90)}</span></span>`;
      if (h.slug === exact && vers.length > 1) {
        const sel = document.createElement('select');
        sel.style.maxWidth = '150px';
        vers.forEach((v) => {
          const o = document.createElement('option');
          o.value = v.id; o.textContent = v.number;
          sel.appendChild(o);
        });
        d.appendChild(sel);
        const btn = document.createElement('button');
        btn.className = 'btn small primary'; btn.textContent = '⬇ Instalar versão';
        btn.onclick = () => installPack({ slug: h.slug, versionId: sel.value }, btn);
        d.appendChild(btn);
      } else {
        const btn = document.createElement('button');
        btn.className = 'btn small primary'; btn.textContent = '⬇ Instalar';
        btn.onclick = () => installPack({ slug: h.slug }, btn);
        d.appendChild(btn);
      }
      box.appendChild(d);
    });
  } catch (e) {
    box.innerHTML = '<div class="muted">Erro na busca: ' + e.message + '</div>';
  }
};
function cleanSlug(s) {
  return String(s || '').trim().split('?')[0].split('/').filter(Boolean).pop() || '';
}
async function installPack(args, btn) {
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = '⏳ Instalando pack…';
  goTab('modloaders');
  log(`Instalando modpack ${args.slug} (MC ${$('version').value}/${$('modloader').value})…`);
  try {
    const r = await window.api.packsInstall(args);
    toast(r.ok ? `Pack instalado: ${r.name} ✅ (${r.files} arquivos)` : 'Falha: ' + r.error, !r.ok);
    await loadMods();
    await loadPacks();
  } finally {
    btn.disabled = false;
    btn.textContent = old;
  }
}
$('btnPackImport').onclick = async () => {
  log('Importando .mrpack...');
  const r = await window.api.packsImport();
  if (r.ok !== false || r.error !== 'cancelado') {
    toast(r.ok ? `Pack importado ✅ (${r.files} arquivos)` : 'Falha: ' + r.error, !r.ok);
  }
  await loadMods();
  await loadPacks();
};
$('modSearch').oninput = renderCatalog;
$('modLoaderFilter').onchange = renderCatalog;
$('modCategoryFilter').onchange = renderCatalog;
$('btnMods').onclick = () => window.api.openFolder('mods');
$('btnResourcepacks').onclick = () => window.api.openFolder('resourcepacks');
$('btnShaders').onclick = () => window.api.openFolder('shaderpacks');
$('btnScreenshots').onclick = () => window.api.openFolder('screenshots');

$('btnJava').onclick = async () => {
  const p = await window.api.selectJava();
  if (p) { $('javaPath').value = p; $('javaPreset').value = ''; }
};
$('javaPreset').onchange = () => { if ($('javaPreset').value) $('javaPath').value = $('javaPreset').value; };
$('btnJavaTest').onclick = async () => {
  $('javaOut').textContent = 'Testando…';
  $('javaOut').textContent = await window.api.javaVersion($('javaPreset').value || $('javaPath').value);
};
$('btnJavaGet').onclick = async (e) => {
  const btn = e.target.closest('button');
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.textContent = '⏳ Baixando Java (~190 MB)… acompanhe na aba Modloaders';
  goTab('modloaders');
  log('Baixando Java recomendado para MC ' + $('version').value + '…');
  const r = await window.api.provisionJava($('version').value);
  btn.disabled = false;
  btn.innerHTML = old;
  if (r.ok) {
    $('javaOut').textContent = `Pronto: Java ${r.major} em\n${r.bin}`;
    toast(`Java ${r.major} pronto ✅ (usado automaticamente ao jogar)`);
    log(`Java ${r.major} pronto: ${r.bin}`);
  } else {
    $('javaOut').textContent = 'Falha: ' + r.error;
    toast('Falha: ' + r.error, true);
  }
};
async function refreshJavaNeed() {
  try { $('javaNeed').textContent = 'Java ' + (await window.api.javaRequired($('version').value)); }
  catch { $('javaNeed').textContent = 'automático'; }
}
document.querySelectorAll('[data-res]').forEach((b) => {
  b.onclick = () => {
    const [w, h] = b.dataset.res.split('x').map(Number);
    $('width').value = w; $('height').value = h; refreshHero();
  };
});
$('btnGameDirPick').onclick = async () => {
  const p = await window.api.selectGameDir();
  if (p) $('gameDir').value = p;
};
$('btnSave').onclick = async () => { await collectAndSave(); await refreshHeader(); toast('Configurações salvas 💾'); };
$('btnReset').onclick = async () => {
  if (!confirm('Restaurar configurações padrão?')) return;
  S = await window.api.reset();
  location.reload();
};
$('btnCopyDiag').onclick = async () => {
  const info = await window.api.systemInfo();
  const jv = await window.api.javaVersion(S.javaPath || 'java');
  const txt = `CraftLauncher 2 diag\nuser=${S.username} ver=${S.version} loader=${S.modloader} ${S.modloaderVersion}\nram=${S.ramMin}-${S.ramMax}G res=${S.width}x${S.height} fs=${S.fullscreen}\njava=${S.javaPath || 'PATH'} :: ${jv.split('\n')[0]}\ndir=${info.gameDir} (${info.gameDirSize})\nuuid=${info.uuid}`;
  navigator.clipboard?.writeText(txt);
  toast('Diagnóstico copiado');
};
$('btnOpenLogs').onclick = () => window.api.openFolder('');

loadAll();
