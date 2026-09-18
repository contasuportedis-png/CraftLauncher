const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

let store;
async function getStore() {
  if (store) return store;
  const { default: Store } = await import('electron-store');
  store = new Store({
    defaults: {
      username: 'Steve_' + Math.floor(Math.random() * 1000),
      ramMin: 2,
      ramMax: 4,
      javaPath: '',
      gameDir: path.join(app.getPath('userData'), 'minecraft'),
      version: '1.20.1',
      versionType: 'release',
      showSnapshots: false,
      showOld: false,
      modloader: 'vanilla',
      modloaderVersion: '',
      customVersion: '',
      skinPath: '',
      skinModel: 'classic',
      width: 854,
      height: 480,
      fullscreen: false,
      jvmArgs: '',
      gameArgs: '',
      serverHost: '',
      serverPort: '25565',
      demo: false,
      theme: 'creeper',
      closeAction: 'keep', // keep | minimize | close
      enableLogging: true
    }
  });
  return store;
}

let mainWindow = null;
let mcClient = null;
let mcProcess = null;
let lastLaunchAt = 0;
let lastLaunchCtx = '';

function getMCLC() {
  if (!mcClient) {
    const { Client } = require('minecraft-launcher-core');
    mcClient = new Client();
    mcClient.on('debug', (e) => sendLog('[debug] ' + e));
    mcClient.on('data', (e) => {
      const t = String(e).trim();
      if (!t) return;
      sendLog(t);
      // guarda últimas linhas p/ diagnóstico de crash rápido
      recentGameLines.push(t.slice(-300));
      if (recentGameLines.length > 25) recentGameLines.shift();
      const tl = t.toLowerCase();
      if (tl.includes('unsupportedclassversionerror') || tl.includes('class file version')) {
        sendLog('DIAGNÓSTICO: seu Java é velho para essa versão do MC. Troque o Java na aba Config (MC 1.20.5+ precisa de Java 21).');
      } else if (tl.includes('could not reserve enough space') || tl.includes('not enough space')) {
        sendLog('DIAGNÓSTICO: RAM acima do disponível. Baixe a RAM máxima na barra lateral.');
      }
    });
    mcClient.on('progress', (e) => {
      if (mainWindow) mainWindow.webContents.send('launch:progress', e);
    });
    mcClient.on('download', (e) => sendLog(`Baixando: ${e}`));
    mcClient.on('close', (code) => {
      sendLog(`Jogo fechado (código ${code})`);
      const fast = Date.now() - lastLaunchAt < 25000 && lastLaunchAt !== 0;
      if (code !== 0 && code !== null && fast) {
        sendLog(`DIAGNÓSTICO: o jogo fechou em segundos (${lastLaunchCtx}). Causas comuns: Java incompatível, RAM acima do PC, modloader/versão errados. Veja as linhas de ERRO acima.`);
      }
      if (mainWindow) mainWindow.webContents.send('launch:closed', code);
      mcProcess = null;
      lastLaunchAt = 0;
    });
  }
  return mcClient;
}
let recentGameLines = [];

function sendLog(msg) {
  if (mainWindow) mainWindow.webContents.send('launch:log', String(msg));
  console.log(msg);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1020,
    minHeight: 680,
    title: 'CraftLauncher 2 — Minecraft Java (offline)',
    autoHideMenuBar: true,
    backgroundColor: '#0b0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// ---------- helpers ----------
function detectJavaCandidates() {
  const list = [];
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME) list.push(path.join(process.env.JAVA_HOME, 'bin', exe));
  if (process.platform === 'win32') {
    // PATH via `where java`
    try {
      const out = require('child_process').execSync('where java', { timeout: 8000 }).toString();
      for (const line of out.split(/\r?\n/)) {
        const p = line.trim();
        if (p && fs.existsSync(p) && !list.includes(p)) list.push(p);
      }
    } catch {}
    // pastas comuns de instalação
    const bases = [
      process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
      'C:\\Program Files', 'C:\\Program Files (x86)'
    ].filter(Boolean);
    const subs = ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Microsoft', 'Amazon Corretto', 'Azul Systems'];
    for (const base of bases) {
      for (const sub of subs) {
        const dir = path.join(base, sub);
        let entries = [];
        try { entries = fs.readdirSync(dir); } catch { continue; }
        for (const e of entries) {
          for (const cand of [
            path.join(dir, e, 'bin', exe),
            path.join(dir, e, 'bin', 'server', exe)
          ]) {
            try { if (fs.existsSync(cand) && !list.includes(cand)) list.push(cand); } catch {}
          }
        }
      }
    }
    // runtime embutido do launcher oficial da Mojang (se existir)
    try {
      const rtBase = path.join(process.env.APPDATA || '', '.minecraft', 'runtime');
      if (fs.existsSync(rtBase)) {
        const walk = (d, depth) => {
          if (depth > 4) return;
          for (const f of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, f.name);
            if (f.isDirectory()) walk(p, depth + 1);
            else if (/^java(w)?\.exe$/i.test(f.name) && !list.includes(p)) list.push(p);
          }
        };
        walk(rtBase, 0);
      }
    } catch {}
    if (!list.length) list.push(exe);
    return list;
  }
  const common = [
    '/usr/bin/java',
    '/usr/lib/jvm/java-21-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-17-openjdk-amd64/bin/java',
    '/usr/lib/jvm/java-8-openjdk-amd64/bin/java',
    '/usr/lib/jvm/default-java/bin/java'
  ];
  for (const c of common) if (fs.existsSync(c)) list.push(c);
  // varre /usr/lib/jvm (+ /opt no mac)
  const jvmDirs = process.platform === 'darwin'
    ? ['/Library/Java/JavaVirtualMachines']
    : ['/usr/lib/jvm'];
  for (const jvmDir of jvmDirs) {
    try {
      if (!fs.existsSync(jvmDir)) continue;
      for (const d of fs.readdirSync(jvmDir)) {
        const cands = process.platform === 'darwin'
          ? [path.join(jvmDir, d, 'Contents', 'Home', 'bin', 'java')]
          : [path.join(jvmDir, d, 'bin', 'java')];
        for (const bin of cands) {
          if (fs.existsSync(bin) && !list.includes(bin)) list.push(bin);
        }
      }
    } catch {}
  }
  // PATH via `which java` (linux/mac)
  try {
    const out = require('child_process').execSync('which java', { timeout: 8000 }).toString().trim();
    if (out && fs.existsSync(out) && !list.includes(out)) list.push(out);
  } catch {}
  if (!list.length) list.push('/usr/bin/java');
  return list;
}

async function resolveJava(javaPath) {
  if (javaPath && fs.existsSync(javaPath)) return javaPath;
  return 'java';
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}

// UUID v3 offline estável (igual ao vanilla): md5("OfflinePlayer:"+name)
function offlineUUID(username) {
  const hash = crypto.createHash('md5').update('OfflinePlayer:' + username, 'utf8').digest();
  hash[6] = (hash[6] & 0x0f) | 0x30;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  const h = hash.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function dirSize(dir) {
  let total = 0;
  try {
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        try {
          if (f.isDirectory()) walk(p);
          else total += fs.statSync(p).size;
        } catch {}
      }
    };
    if (fs.existsSync(dir)) walk(dir);
  } catch {}
  return total;
}

function fmtBytes(b) {
  if (!b) return '0 MB';
  const mb = b / 1024 / 1024;
  if (mb < 1024) return `${mb.toFixed(0)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

// ---------- lifecycle ----------
app.whenReady().then(async () => {
  await getStore();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- settings ----------
ipcMain.handle('store:get', async (e, key) => (await getStore()).get(key));
ipcMain.handle('store:getAll', async () => (await getStore()).store);
ipcMain.handle('store:set', async (e, obj) => {
  const s = await getStore();
  s.set(obj);
  return s.store;
});
ipcMain.handle('store:reset', async () => {
  const s = await getStore();
  s.clear();
  return s.store;
});

ipcMain.handle('system:info', async () => {
  const s = await getStore();
  return {
    platform: process.platform,
    totalMemGB: +(os.totalmem() / 1024 ** 3).toFixed(1),
    freeMemGB: +(os.freemem() / 1024 ** 3).toFixed(1),
    gameDir: s.get('gameDir'),
    gameDirSize: fmtBytes(dirSize(s.get('gameDir'))),
    javaCandidates: detectJavaCandidates(),
    uuid: offlineUUID(s.get('username') || 'Steve')
  };
});

ipcMain.handle('system:javaVersion', async (e, javaPath) => {
  const bin = await resolveJava(javaPath);
  return new Promise((resolve) => {
    const p = spawn(bin, ['-version']);
    let out = '';
    p.stderr.on('data', (d) => (out += d.toString()));
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', () => resolve(out.trim() || 'não detectado'));
    p.on('error', () => resolve('java não encontrado: ' + bin));
  });
});

ipcMain.handle('dialog:selectJava', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar executável Java', properties: ['openFile']
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:selectGameDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Escolher pasta do jogo', properties: ['openDirectory', 'createDirectory']
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:selectSkin', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar skin (PNG 64x64)', properties: ['openFile'],
    filters: [{ name: 'PNG', extensions: ['png'] }]
  });
  if (r.canceled) return null;
  const src = r.filePaths[0];
  const s = await getStore();
  const destDir = path.join(s.get('gameDir'), 'skins');
  fs.mkdirSync(destDir, { recursive: true });
  const base = 'skin-' + Date.now() + '.png';
  const dest = path.join(destDir, base);
  fs.copyFileSync(src, dest);
  fs.copyFileSync(src, path.join(destDir, 'skin.png'));
  s.set('skinPath', path.join(destDir, 'skin.png'));
  return s.get('skinPath');
});

ipcMain.handle('folder:open', async (e, sub = '') => {
  const s = await getStore();
  const dir = path.join(s.get('gameDir'), sub);
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return dir;
});

// ---------- skins ----------
ipcMain.handle('skins:list', async () => {
  const s = await getStore();
  const dir = path.join(s.get('gameDir'), 'skins');
  fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({
    name: f, path: path.join(dir, f), active: path.join(dir, f) === s.get('skinPath') || (f === 'skin.png')
  }));
});
ipcMain.handle('skins:apply', async (e, name) => {
  const s = await getStore();
  const dir = path.join(s.get('gameDir'), 'skins');
  const src = path.join(dir, name);
  const dest = path.join(dir, 'skin.png');
  fs.copyFileSync(src, dest);
  s.set('skinPath', dest);
  return dest;
});
ipcMain.handle('skins:delete', async (e, name) => {
  if (name === 'skin.png') return { ok: false, error: 'skin ativa não pode ser excluída' };
  const s = await getStore();
  fs.rmSync(path.join(s.get('gameDir'), 'skins', name), { force: true });
  return { ok: true };
});

// ---------- mods ----------
ipcMain.handle('mods:list', async () => {
  const s = await getStore();
  const dir = path.join(s.get('gameDir'), 'mods');
  fs.mkdirSync(dir, { recursive: true });
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.jar') || f.endsWith('.jar.disabled'))
    .map((f) => {
      const p = path.join(dir, f);
      let size = 0;
      try { size = fs.statSync(p).size; } catch {}
      return { name: f, enabled: !f.endsWith('.disabled'), size: fmtBytes(size) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
});
ipcMain.handle('mods:toggle', async (e, name) => {
  const s = await getStore();
  const dir = path.join(s.get('gameDir'), 'mods');
  const cur = path.join(dir, name);
  let next;
  if (name.endsWith('.disabled')) next = path.join(dir, name.replace(/\.disabled$/, ''));
  else next = cur + '.disabled';
  fs.renameSync(cur, next);
  return { ok: true };
});
ipcMain.handle('mods:delete', async (e, name) => {
  const s = await getStore();
  fs.rmSync(path.join(s.get('gameDir'), 'mods', name), { force: true });
  return { ok: true };
});

// Modrinth: instala latest compatível, com cadeia de fallbacks e dicas de disponibilidade.
// args: { slug, fallbacks?: string[], loader?, mcVersion? }
async function modAvailability(slug) {
  try {
    const versions = await fetchJSON(`https://api.modrinth.com/v2/project/${slug}/version`, {
      headers: { 'User-Agent': 'CraftLauncher/2.0' }
    });
    const games = [...new Set(versions.flatMap((v) => v.game_versions || []))];
    const loaders = [...new Set(versions.flatMap((v) => v.loaders || []))];
    // ordena versões MC de forma simples (mais novas primeiro por prefixo)
    games.sort().reverse();
    return { loaders, games: games.slice(0, 12), total: versions.length };
  } catch {
    return { loaders: [], games: [], total: 0 };
  }
}

ipcMain.handle('mods:installModrinth', async (e, { slug, fallbacks = [], loader, mcVersion }) => {
  const s = await getStore();
  const mc = mcVersion || s.get('version');
  let ld = (loader || s.get('modloader') || 'fabric').toLowerCase();
  if (ld === 'vanilla') ld = 'fabric';
  // Quilt roda jars de Fabric: aceita builds dos dois
  const effLoaders = ld === 'quilt' ? ['fabric', 'quilt'] : [ld];
  const chain = [slug, ...(fallbacks || [])].filter(Boolean);
  let lastErr = 'desconhecido';
  for (const c of chain) {
    sendLog(`Buscando ${c} no Modrinth (${mc}/${ld})...`);
    try {
      const url = `https://api.modrinth.com/v2/project/${c}/version?loaders=${encodeURIComponent(JSON.stringify(effLoaders))}&game_versions=${encodeURIComponent(JSON.stringify([mc]))}`;
      const versions = await fetchJSON(url, { headers: { 'User-Agent': 'CraftLauncher/2.0' } });
      if (!versions.length) {
        const av = await modAvailability(c);
        const hint = av.total
          ? ` Disponível para: ${av.games.slice(0, 6).join(', ') || '?'} (${av.loaders.join('/') || '?'})`
          : ' (projeto não encontrado)';
        throw new Error(`sem build de ${c} para MC ${mc} (${ld}).${hint}`);
      }
      // prefere build marcado com o loader atual; senão o primeiro (ex: fabric p/ quilt)
      const best = versions.find((v) => (v.loaders || []).includes(ld)) || versions[0];
      const file = best.files.find((f) => f.primary) || best.files[0];
      const modsDir = path.join(s.get('gameDir'), 'mods');
      fs.mkdirSync(modsDir, { recursive: true });
      const dest = path.join(modsDir, file.filename);
      if (fs.existsSync(dest)) {
        sendLog('Já instalado: mods/' + file.filename);
        return { ok: true, file: file.filename, slug: c, loader: ld, already: true };
      }
      sendLog('Baixando ' + file.filename + '...');
      const dl = await fetch(file.url);
      if (!dl.ok) throw new Error('download HTTP ' + dl.status);
      fs.writeFileSync(dest, Buffer.from(await dl.arrayBuffer()));
      sendLog('Instalado: mods/' + file.filename);
      return { ok: true, file: file.filename, slug: c, loader: ld };
    } catch (err) {
      lastErr = err.message;
      sendLog(`Falha ${c}: ${err.message}`);
    }
  }
  return { ok: false, error: lastErr };
});

// ---------- versions ----------
let manifestCache = null;
async function getManifest(force = false) {
  const s = await getStore();
  if (!force) {
    if (manifestCache && Date.now() - manifestCache.time < 3600_000) return manifestCache.data;
    const c = s.get('manifestCache');
    if (c && Date.now() - c.time < 3600_000) { manifestCache = c; return c.data; }
  }
  const data = await fetchJSON('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  manifestCache = { time: Date.now(), data };
  s.set('manifestCache', { time: Date.now(), data });
  return data;
}

ipcMain.handle('versions:all', async (e, { force = false } = {}) => {
  const s = await getStore();
  const manifest = await getManifest(force);
  const showSnap = !!s.get('showSnapshots');
  const showOld = !!s.get('showOld');
  const allowed = new Set(['release']);
  if (showSnap) allowed.add('snapshot');
  if (showOld) { allowed.add('old_beta'); allowed.add('old_alpha'); }
  return {
    latest: manifest.latest,
    versions: manifest.versions
      .filter((v) => allowed.has(v.type))
      .map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime }))
  };
});

ipcMain.handle('versions:fabric', async (e, mcVersion) => {
  try {
    const data = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    return data.slice(0, 12).map((d) => ({ version: d.loader.version, stable: d.loader.stable }));
  } catch { return []; }
});

ipcMain.handle('versions:quilt', async (e, mcVersion) => {
  try {
    const data = await fetchJSON(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
    return data.slice(0, 12).map((d) => ({ version: d.loader.version }));
  } catch { return []; }
});

ipcMain.handle('versions:forge', async (e, mcVersion) => {
  try {
    const data = await fetchJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const promos = data.promos || {};
    const entries = Object.entries(promos)
      .filter(([mc]) => !mcVersion || mc.startsWith(mcVersion))
      .map(([mc, build]) => ({ mc, build }))
      .reverse();
    return { all: Object.entries(promos).slice(-12).reverse().map(([mc, build]) => ({ mc, build })), filtered: entries.slice(0, 12) };
  } catch { return { all: [], filtered: [] }; }
});

ipcMain.handle('versions:neoforge', async (e, mcVersion) => {
  // NeoForge acompanha o minor do MC: 21.<P>.x -> MC 1.21.<P> | 20.<P>.x -> MC 1.20.<P>
  // (NeoForge só existe a partir da 1.20.2)
  try {
    const data = await fetchJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    let list = (data.versions || []).slice().reverse();
    if (mcVersion) {
      const parts = String(mcVersion).split('.');
      const prefix = parts.length >= 3
        ? `${parts[0] === '1' && parts[1] === '21' ? '21' : parts[1] === '20' ? '20' : '?'}.${parts[2]}.`
        : parts[1] === '21' ? '21.0.' : parts[1] === '20' ? '20.0.' : null;
      if (prefix) list = list.filter((v) => String(v).startsWith(prefix));
      else list = [];
    }
    return list.slice(0, 15);
  } catch {
    return [];
  }
});

// ---------- modloader installers ----------
// O installer oficial (Forge/NeoForge) EXIGE um launcher_profiles.json no destino,
// senão aborta com "you need to run the launcher first". Criamos um mínimo válido.
function ensureLauncherProfile(gameDir) {
  const p = path.join(gameDir, 'launcher_profiles.json');
  if (fs.existsSync(p)) return;
  fs.mkdirSync(gameDir, { recursive: true });
  const token = crypto.randomUUID().replace(/-/g, '');
  fs.writeFileSync(p, JSON.stringify({
    profiles: {},
    selectedProfile: '(Default)',
    clientToken: token,
    authenticationDatabase: {},
    launcherVersion: { name: 'CraftLauncher', format: 21 }
  }, null, 2));
  sendLog('Profile do launcher criado (exigido pelo installer oficial).');
}

function listVersionDirs(root) {
  try {
    const dir = path.join(root, 'versions');
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((d) => {
      try { return fs.statSync(path.join(dir, d)).isDirectory(); } catch { return false; }
    });
  } catch { return []; }
}

function readCustomInherits(root, id) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'versions', id, `${id}.json`), 'utf8'));
    return j.inheritsFrom || null;
  } catch { return null; }
}

// roda o installer e retorna { code, createdId }
function runJavaInstaller(jarPath, gameDir) {
  return new Promise((resolve) => {
    sendLog('Executando installer: ' + path.basename(jarPath));
    sendLog('Isso pode levar alguns minutos (baixa ~200-400 MB)…');
    const before = new Set(listVersionDirs(gameDir));
    const s = store;
    const javaBin = (s && s.get('javaPath') && fs.existsSync(s.get('javaPath'))) ? s.get('javaPath') : 'java';
    const t0 = Date.now();
    const p = spawn(javaBin, ['-jar', jarPath, '--installClient', gameDir]);
    p.stdout.on('data', (d) => { const t = String(d).trim(); if (t) sendLog(t); });
    p.stderr.on('data', (d) => { const t = String(d).trim(); if (t) sendLog(t); });
    p.on('close', (code) => {
      const mins = ((Date.now() - t0) / 60000).toFixed(1);
      sendLog(`Installer terminou em ${mins} min (código ${code})`);
      const created = listVersionDirs(gameDir).filter((d) => !before.has(d));
      resolve({ code, createdId: created.length ? created[created.length - 1] : null });
    });
    p.on('error', (err) => { sendLog('Erro installer: ' + err.message); resolve({ code: 1, createdId: null }); });
  });
}

// pós-install: valida profile criado, ajusta versão do MC se preciso e salva customVersion
async function finishModloaderInstall(root, createdId, kind) {
  const s = await getStore();
  let id = createdId;
  if (!id) {
    const found = detectCustomVersion(root, kind === 'neoforge' ? 'neoforge' : 'forge');
    if (found) id = found;
  }
  if (!id) throw new Error('installer rodou mas nenhum profile foi criado em versions/ — veja os logs acima');
  const inherits = readCustomInherits(root, id);
  sendLog(`${kind} instalado: ${id}` + (inherits ? ` (requer MC ${inherits})` : ''));
  const patch = { modloader: kind, modloaderVersion: '', customVersion: id };
  if (inherits && inherits !== s.get('version')) {
    patch.version = inherits;
    sendLog(`Versão do jogo ajustada para ${inherits} (exigida por ${id})`);
  }
  s.set(patch);
  return { id, mc: inherits || s.get('version') };
}

ipcMain.handle('modloader:installForge', async (e, { mcVersion, build }) => {
  const s = await getStore();
  const mc = mcVersion || s.get('version');
  const forgeVer = build || null;
  try {
    // descobre build se não informado
    let bv = forgeVer;
    if (!bv) {
      const data = await fetchJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
      bv = data.promos[`${mc}-recommended`] || data.promos[`${mc}-latest`];
      if (!bv) throw new Error('sem build Forge recommended/latest para ' + mc);
    }
    const full = `${mc}-${bv}`;
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
    sendLog('Baixando Forge installer ' + full + '...');
    const dl = await fetch(url);
    if (!dl.ok) throw new Error('installer HTTP ' + dl.status + ' — abra files.minecraftforge.net manualmente');
    const tmp = path.join(app.getPath('temp'), `forge-${full}-installer.jar`);
    fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
    ensureLauncherProfile(s.get('gameDir'));
    const { code, createdId } = await runJavaInstaller(tmp, s.get('gameDir'));
    if (code !== 0) return { ok: false, error: 'installer saiu com código ' + code + ' — veja os logs acima' };
    const done = await finishModloaderInstall(s.get('gameDir'), createdId, 'forge');
    return { ok: true, ...done };
  } catch (err) {
    sendLog('Falha Forge: ' + err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('modloader:installNeoForge', async (e, { neoVersion }) => {
  const s = await getStore();
  try {
    let nv = neoVersion;
    if (!nv) {
      const data = await fetchJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
      nv = (data.versions || []).slice(-1)[0];
      if (!nv) throw new Error('não foi possível listar NeoForge');
    }
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${nv}/neoforge-${nv}-installer.jar`;
    sendLog('Baixando NeoForge installer ' + nv + '...');
    const dl = await fetch(url);
    if (!dl.ok) throw new Error('installer HTTP ' + dl.status);
    // NeoForge 21.<P>.x exige MC 1.21.<P>: avisa cedo em vez de instalar errado
    const m = String(nv).match(/^(\d+)\.(\d+)\./);
    if (m) {
      const needMC = `${m[1] === '21' ? '1.21' : m[1] === '20' ? '1.20' : '?'}.${m[2]}`;
      const cur = s.get('version');
      if (needMC !== '?.' + m[2] && cur !== needMC) {
        sendLog(`Atenção: NeoForge ${nv} é para MC ${needMC} (você está na ${cur}). A versão será ajustada após instalar.`);
      }
    }
    const tmp = path.join(app.getPath('temp'), `neoforge-${nv}-installer.jar`);
    fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
    ensureLauncherProfile(s.get('gameDir'));
    const { code, createdId } = await runJavaInstaller(tmp, s.get('gameDir'));
    if (code !== 0) return { ok: false, error: 'installer saiu com código ' + code + ' — veja os logs acima' };
    const done = await finishModloaderInstall(s.get('gameDir'), createdId, 'neoforge');
    return { ok: true, ...done };
  } catch (err) {
    sendLog('Falha NeoForge: ' + err.message);
    return { ok: false, error: err.message };
  }
});

// ---------- launch ----------
async function installFabricProfile(root, mcVersion, loaderVersion) {
  let loader = loaderVersion;
  if (!loader) {
    const list = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}`);
    if (!list.length) throw new Error('sem loader Fabric para ' + mcVersion);
    loader = list[0].loader.version;
  }
  const profile = await fetchJSON(`https://meta.fabricmc.net/v2/versions/loader/${mcVersion}/${loader}/profile/json`);
  const dir = path.join(root, 'versions', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}

async function installQuiltProfile(root, mcVersion, loaderVersion) {
  let loader = loaderVersion;
  if (!loader) {
    const list = await fetchJSON(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}`);
    if (!list.length) throw new Error('sem loader Quilt para ' + mcVersion);
    loader = list[0].loader.version;
  }
  const profile = await fetchJSON(`https://meta.quiltmc.org/v3/versions/loader/${mcVersion}/${loader}/profile/json`);
  const dir = path.join(root, 'versions', profile.id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.id}.json`), JSON.stringify(profile));
  return profile.id;
}

function detectCustomVersion(root, needle) {
  try {
    const dir = path.join(root, 'versions');
    if (!fs.existsSync(dir)) return null;
    const found = fs.readdirSync(dir).find((d) => d.toLowerCase().includes(needle.toLowerCase()));
    return found || null;
  } catch { return null; }
}

ipcMain.handle('game:launch', async (e, opts = {}) => {
  const s = await getStore();
  const settings = { ...s.store, ...opts };
  s.set({
    username: settings.username, ramMin: settings.ramMin, ramMax: settings.ramMax,
    javaPath: settings.javaPath, gameDir: settings.gameDir, version: settings.version,
    modloader: settings.modloader || 'vanilla', modloaderVersion: settings.modloaderVersion || '',
    width: settings.width, height: settings.height, fullscreen: !!settings.fullscreen,
    jvmArgs: settings.jvmArgs || '', gameArgs: settings.gameArgs || '',
    serverHost: settings.serverHost || '', serverPort: settings.serverPort || '25565',
    demo: !!settings.demo, theme: settings.theme || 'creeper', closeAction: settings.closeAction || 'keep'
  });

  const username = (settings.username || 'Steve').slice(0, 16) || 'Steve';
  const root = settings.gameDir;
  fs.mkdirSync(root, { recursive: true });
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }

  const javaPath = await resolveJava(settings.javaPath);
  const client = getMCLC();
  const { Authenticator } = require('minecraft-launcher-core');
  const uuid = offlineUUID(username);
  // getAuth é assíncrono: resolve primeiro e SÓ então aplica o UUID estável
  const auth = await Authenticator.getAuth(username);
  auth.uuid = uuid.replace(/-/g, '');
  auth.access_token = '0';
  auth.client_token = uuid.replace(/-/g, '');
  auth.meta = { type: 'mojang', demo: !!settings.demo };

  // valida Java antes de baixar nada
  const javaCheck = await new Promise((res) => {
    const p = spawn(javaPath, ['-version']);
    let out = '';
    p.stderr.on('data', (d) => (out += d.toString()));
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (c) => res({ ok: c === 0, out: out.trim().split('\n')[0] || '' }));
    p.on('error', (err) => res({ ok: false, out: err.message }));
  });
  if (!javaCheck.ok) {
    const msg = `Java inválido (${javaPath}): ${javaCheck.out}. Escolha outro na aba Config.`;
    sendLog('ERRO: ' + msg);
    return { ok: false, error: msg };
  }
  sendLog('Java OK: ' + javaCheck.out.slice(0, 80));

  // RAM sanidade: não deixa pedir mais do que o PC tem
  const totalGB = os.totalmem() / 1024 ** 3;
  if (settings.ramMax > totalGB) {
    const clamped = Math.max(1, Math.floor(totalGB * 0.6));
    sendLog(`AVISO: RAM máxima (${settings.ramMax}G) maior que a do PC (${totalGB.toFixed(1)}G). Ajustando para ${clamped}G.`);
    settings.ramMax = clamped;
    if (settings.ramMin > clamped) settings.ramMin = clamped;
    s.set({ ramMax: settings.ramMax, ramMin: settings.ramMin });
  }

  const splitArgs = (str) => String(str || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];

  const launchOpts = {
    authorization: auth,
    root,
    version: { number: settings.version, type: 'release' },
    memory: { max: `${settings.ramMax}G`, min: `${settings.ramMin}G` },
    javaPath: javaPath === 'java' ? undefined : javaPath,
    overrides: { detached: false }
  };

  // janela
  const w = parseInt(settings.width, 10) || 854;
  const h = parseInt(settings.height, 10) || 480;
  launchOpts.window = { width: w, height: h, fullscreen: !!settings.fullscreen };

  // servidor quick-join (API correta: quickPlay; legacy p/ MC < 1.20)
  if (settings.serverHost && settings.serverHost.trim()) {
    const host = settings.serverHost.trim();
    const port = parseInt(settings.serverPort, 10) || 25565;
    const mcParts = String(settings.version).split('.').map(Number);
    const modern = mcParts[0] > 1 || (mcParts[0] === 1 && mcParts[1] >= 20);
    launchOpts.quickPlay = { type: modern ? 'multiplayer' : 'legacy', identifier: `${host}:${port}` };
    sendLog(`Quick-join: ${host}:${port}`);
  }

  // args extras (nomes corretos da API: customArgs=JVM, customLaunchArgs=jogo)
  const jvm = splitArgs(settings.jvmArgs);
  const game = splitArgs(settings.gameArgs);
  if (jvm.length) { launchOpts.customArgs = jvm; sendLog('JVM args: ' + jvm.join(' ')); }
  if (game.length) { launchOpts.customLaunchArgs = game; sendLog('Game args: ' + game.join(' ')); }

  // resolve profile custom já instalado: prefere o salvo no install, valida inheritsFrom
  function resolveInstalledCustom(kind) {
    const needles = kind === 'forge' ? ['forge'] : ['neoforge', 'neoforged'];
    const candidates = [];
    const saved = settings.customVersion;
    if (saved && fs.existsSync(path.join(root, 'versions', saved, `${saved}.json`))) candidates.push(saved);
    for (const n of needles) {
      const f = detectCustomVersion(root, n);
      if (f && !candidates.includes(f)) candidates.push(f);
    }
    for (const id of candidates) {
      const inh = readCustomInherits(root, id);
      if (!inh) return { id, ok: true }; // sem inherits legível: tenta mesmo assim
      if (inh === settings.version) return { id, ok: true };
      sendLog(`Profile ${id} é para MC ${inh}, mas a versão selecionada é ${settings.version} — ignorado.`);
    }
    return { id: null, ok: false };
  }

  try {
    const ml = (settings.modloader || 'vanilla').toLowerCase();
    if (ml === 'fabric') {
      sendLog('Fabric: instalando profile...');
      const id = await installFabricProfile(root, settings.version, settings.modloaderVersion || undefined);
      sendLog('Fabric profile: ' + id);
      s.set({ customVersion: id });
      launchOpts.version = { number: settings.version, type: 'release', custom: id };
    } else if (ml === 'quilt') {
      sendLog('Quilt: instalando profile...');
      const id = await installQuiltProfile(root, settings.version, settings.modloaderVersion || undefined);
      sendLog('Quilt profile: ' + id);
      s.set({ customVersion: id });
      launchOpts.version = { number: settings.version, type: 'release', custom: id };
    } else if (ml === 'forge') {
      const { id } = resolveInstalledCustom('forge');
      if (id) { sendLog('Forge detectado: ' + id); s.set({ customVersion: id }); launchOpts.version = { number: settings.version, type: 'release', custom: id }; }
      else { sendLog('Forge NÃO instalado para MC ' + settings.version + ' — abra a aba Modloaders e clique ⬇ Instalar. Seguindo com vanilla.'); }
    } else if (ml === 'neoforge') {
      const { id } = resolveInstalledCustom('neoforge');
      if (id) { sendLog('NeoForge detectado: ' + id); s.set({ customVersion: id }); launchOpts.version = { number: settings.version, type: 'release', custom: id }; }
      else { sendLog('NeoForge NÃO instalado para MC ' + settings.version + ' — abra a aba Modloaders e clique ⬇ Instalar. Seguindo com vanilla.'); }
    }
  } catch (err) {
    sendLog('Aviso modloader: ' + err.message + ' — seguindo com vanilla.');
  }

  sendLog(`Iniciando Minecraft ${settings.version} (${settings.modloader}) como ${username} [${uuid.slice(0, 8)}...]`);
  sendLog(`RAM ${settings.ramMin}G–${settings.ramMax}G | ${w}x${h}${settings.fullscreen ? ' fullscreen' : ''} | Java: ${javaPath}`);

  try {
    lastLaunchAt = Date.now();
    recentGameLines = [];
    lastLaunchCtx = `${settings.version}/${settings.modloader}`;
    const proc = await client.launch(launchOpts);
    mcProcess = proc || null;
    const action = settings.closeAction;
    if (mainWindow) {
      if (action === 'minimize') mainWindow.minimize();
      else if (action === 'close') mainWindow.hide();
    }
    if (mainWindow) mainWindow.webContents.send('launch:started');
    return { ok: true };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    sendLog('ERRO ao iniciar: ' + msg);
    return { ok: false, error: msg };
  }
});

ipcMain.handle('game:isRunning', async () => !!mcProcess);

// notícias simples: latest + dicas
ipcMain.handle('news:get', async () => {
  try {
    const m = await getManifest(false);
    return {
      latestRelease: m.latest.release,
      latestSnapshot: m.latest.snapshot,
      count: m.versions.length,
      items: [
        { tag: 'VANILLA', title: `Latest release: ${m.latest.release}`, desc: 'Versão estável recomendada para mods e multiplayer.' },
        { tag: 'SNAPSHOT', title: `Snapshot atual: ${m.latest.snapshot}`, desc: 'Ative snapshots na aba Versões para testar novidades.' },
        { tag: 'NEOFORGE', title: 'NeoForge suportado', desc: 'Instale o NeoForge pela aba Modloaders (MC 1.20.5+).' }
      ]
    };
  } catch {
    return { latestRelease: '1.21', latestSnapshot: '—', count: 0, items: [] };
  }
});
