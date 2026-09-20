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
        sendLog('DIAGNÓSTICO: seu Java é velho para essa versão do MC. O launcher baixa o certo sozinho — veja "Java" nos logs acima.');
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
  mainWindow.on('close', (event) => {
    if (mcProcess) {
      event.preventDefault();
      mainWindow.hide();
      sendLog('Launcher ocultado; o Minecraft continuará rodando.');
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// ---------- helpers ----------
function safeChildPath(root, name = '') {
  const base = path.resolve(root);
  const target = path.resolve(base, String(name));
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error('Caminho inválido');
  }
  return target;
}
function profileKey(version, loader) {
  return `${String(version || 'unknown')}-${String(loader || 'vanilla').toLowerCase()}`
    .replace(/[^a-zA-Z0-9._-]/g, '_');
}
function activeGameDir(settings) {
  const base = settings.gameDir;
  if (!base) return base;
  return path.join(base, 'profiles', profileKey(settings.version, settings.modloader));
}
async function backupProfile(root) {
  if (!fs.existsSync(root)) return null;
  const backupRoot = path.join(path.dirname(root), 'backups');
  fs.mkdirSync(backupRoot, { recursive: true });
  const target = path.join(backupRoot, `${path.basename(root)}-${new Date().toISOString().replace(/[:.]/g, '-')}.tar.gz`);
  const tar = require('tar');
  const entries = ['saves', 'mods', 'config', 'options.txt'].filter((entry) => fs.existsSync(path.join(root, entry)));
  if (!entries.length) return null;
  await tar.c({ gzip: true, file: target, cwd: root }, entries);
  return target;
}
async function getActiveGameDir() {
  const s = await getStore();
  return activeGameDir(s.store);
}
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

// ---------- Java gerenciado (o app baixa sozinho o JRE certo) ----------
// Fonte autoritativa: javaVersion.majorVersion do JSON oficial da versão.
// Fallback: 26.x+ -> 25 | 1.21.x -> 21 | 1.17-1.20.4 -> 17 | resto -> 8
async function requiredJavaMajor(mcVersion) {
  const mc = String(mcVersion || '');
  try {
    const s = await getStore();
    const cache = s.get('javaReqCache') || {};
    if (cache[mc]) return cache[mc];
    const manifest = await getManifest(false);
    const entry = (manifest.versions || []).find((v) => v.id === mc);
    if (entry && entry.url) {
      const j = await fetchJSON(entry.url);
      if (j && j.javaVersion && j.javaVersion.majorVersion) {
        const major = parseInt(j.javaVersion.majorVersion, 10);
        cache[mc] = major;
        s.set('javaReqCache', cache);
        return major;
      }
    }
  } catch {}
  const m = mc.match(/^(\d+)\.(\d+)/);
  if (!m) return 21;
  const maj = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (maj > 1) return 25; // 26.x e futuras: acompanha o major do MC
  if (min > 20 || (min === 20 && parseInt((mc.split('.')[2] || '0'), 10) >= 5)) return 21;
  if (min >= 17) return 17;
  return 8;
}

function parseJavaMajor(versionOutput) {
  // openjdk version "21.0.11" | java version "1.8.0_422"
  let m = String(versionOutput || '').match(/version "(\d+)\.(\d+)\.(\d+)/);
  if (m) {
    if (m[1] === '1') return parseInt(m[2], 10); // 1.8.x -> 8
    return parseInt(m[1], 10);
  }
  m = String(versionOutput || '').match(/(\d+)\.(\d+)/);
  return m ? parseInt(m[1] === '1' ? m[2] : m[1], 10) : 0;
}

function javaVersionOf(bin) {
  return new Promise((resolve) => {
    const p = spawn(bin, ['-version']);
    let out = '';
    p.stderr.on('data', (d) => (out += d.toString()));
    p.stdout.on('data', (d) => (out += d.toString()));
    p.on('close', (c) => resolve({ ok: c === 0, major: parseJavaMajor(out), raw: out.trim().split('\n')[0] || '' }));
    p.on('error', (err) => resolve({ ok: false, major: 0, raw: err.message }));
  });
}

function findManagedJavaBin(dir) {
  // procura bin/java[.exe] recursivamente (zip/tarball tem pasta top-level variável)
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  try {
    const walk = (d, depth) => {
      if (depth > 4) return null;
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) {
          if (f.name === 'bin') {
            const c = path.join(p, exe);
            if (fs.existsSync(c)) return c;
          }
          const r = walk(p, depth + 1);
          if (r) return r;
        }
      }
      return null;
    };
    return fs.existsSync(dir) ? walk(dir, 0) : null;
  } catch { return null; }
}

async function downloadManagedJava(major, gameDir) {
  const plat = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x64';
  const urls = [
    `https://api.adoptium.net/v3/binary/latest/${major}/ga/${plat}/${arch}/jre/hotspot/normal/eclipse`
  ];
  // Java 21 tem espelho da Microsoft (só Windows x64 tem build MS para 8/17? MS publica 17 e 21)
  if (major === 21 && plat === 'windows' && arch === 'x64') {
    urls.push('https://aka.ms/download-jdk/microsoft-jdk-21-windows-x64.zip');
  }
  const destDir = path.join(gameDir, 'runtime', `java-${major}`);
  const tmp = path.join(app.getPath('temp'), `cl-java-${major}-${plat}-${arch}.pkg`);
  let lastErr = 'sem fonte';
  for (const url of urls) {
    try {
      sendLog(`Baixando Java ${major} (~50-190 MB, uma vez só)...`);
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const total = parseInt(res.headers.get('content-length') || '0', 10);
      const out = fs.createWriteStream(tmp);
      let got = 0, lastPct = -1;
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
        got += chunk.length;
        if (total > 0) {
          const pct = Math.floor((got / total) * 100);
          if (pct >= lastPct + 25) { lastPct = pct; sendLog(`Java ${major}: ${pct}% (${(got / 1048576).toFixed(0)} MB)`); }
        }
      }
      await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
      const downloaded = fs.statSync(tmp).size;
      if (downloaded < 20 * 1024 * 1024) throw new Error(`download incompleto (${(downloaded / 1024).toFixed(0)} KB)`);
      sendLog(`Extraindo Java ${major}... (pode levar 1-2 min)`);
      fs.rmSync(destDir, { recursive: true, force: true });
      fs.mkdirSync(destDir, { recursive: true });
      const header = Buffer.alloc(2);
      const fd = fs.openSync(tmp, 'r'); fs.readSync(fd, header, 0, 2, 0); fs.closeSync(fd);
      const isZip = header[0] === 0x50 && header[1] === 0x4b;
      if (isZip) {
        const AdmZip = require('adm-zip');
        new AdmZip(tmp).extractAllTo(destDir, true);
      } else {
        const tar = require('tar');
        await tar.x({ file: tmp, cwd: destDir });
      }
      const bin = findManagedJavaBin(destDir);
      if (!bin) throw new Error('extração ok mas binário java não encontrado');
      if (process.platform !== 'win32') {
        try { fs.chmodSync(bin, 0o755); } catch {}
      }
      const check = await javaVersionOf(bin);
      if (!check.ok || check.major < major) throw new Error('java baixado inválido: ' + (check.raw || check.major));
      sendLog(`Java ${major} pronto: ${check.raw.slice(0, 60)}`);
      try { fs.rmSync(tmp, { force: true }); } catch {}
      return bin;
    } catch (err) {
      lastErr = err.message;
      sendLog(`Fonte Java falhou (${url.split('/')[2]}): ${lastErr} — tentando próxima...`);
    }
  }
  try { fs.rmSync(tmp, { force: true }); } catch {}
  throw new Error('download do Java ' + major + ' falhou: ' + lastErr);
}

// Resolve o java ideal: 1) escolha do usuário (se atende o MC), 2) gerenciado, 3) baixa sozinho, 4) PATH
async function ensureJava(mcVersion, userJavaPath, gameDir) {
  const need = await requiredJavaMajor(mcVersion);
  if (userJavaPath && fs.existsSync(userJavaPath)) {
    const c = await javaVersionOf(userJavaPath);
    if (c.ok && c.major >= need) {
      sendLog(`Java configurado OK: ${c.raw.slice(0, 60)}`);
      return { bin: userJavaPath, major: c.major, source: 'config' };
    }
    if (c.ok) sendLog(`AVISO: seu Java (${c.major}) é velho para MC ${mcVersion} (precisa ${need}+). Usando Java ${need} do launcher.`);
    else sendLog(`AVISO: Java configurado não executa (${c.raw}). Usando Java ${need} do launcher.`);
  }
  const destDir = path.join(gameDir, 'runtime', `java-${need}`);
  let bin = findManagedJavaBin(destDir);
  if (bin) {
    const c = await javaVersionOf(bin);
    if (c.ok && c.major >= need) {
      sendLog(`Java do launcher OK: ${c.raw.slice(0, 60)}`);
      return { bin, major: c.major, source: 'launcher' };
    }
  }
  try {
    bin = await downloadManagedJava(need, gameDir);
    return { bin, major: need, source: 'download' };
  } catch (err) {
    sendLog(`Falha ao baixar Java ${need}: ${err.message} — tentando Java do sistema...`);
    const c = await javaVersionOf('java');
    if (!c.ok) throw new Error('sem Java utilizável. Instale o Java ' + need + ' (https://adoptium.net) ou verifique a internet.');
    if (c.major < need) sendLog(`AVISO: Java do sistema (${c.major}) é velho para MC ${mcVersion} (precisa ${need}+). O jogo pode não abrir.`);
    return { bin: 'java', major: c.major, source: 'system' };
  }
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  return res.json();
}
async function downloadFileWithRetry(url, dest, attempts = 3) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    const tmp = `${dest}.part`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'CraftLauncher/2.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const out = fs.createWriteStream(tmp);
      for await (const chunk of res.body) {
        if (!out.write(chunk)) await new Promise((resolve) => out.once('drain', resolve));
      }
      await new Promise((resolve, reject) => { out.end(resolve); out.on('error', reject); });
      if (fs.statSync(tmp).size < 1024) throw new Error('arquivo baixado vazio ou incompleto');
      fs.renameSync(tmp, dest);
      return;
    } catch (err) {
      last = err;
      try { fs.rmSync(tmp, { force: true }); } catch {}
      if (i < attempts) await new Promise((resolve) => setTimeout(resolve, 700 * i));
    }
  }
  throw new Error(`download falhou após ${attempts} tentativas: ${last?.message || 'erro desconhecido'}`);
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

// Qual Java a versão X exige (p/ mostrar na UI)
ipcMain.handle('java:required', async (e, mcVersion) => {
  const s = await getStore();
  return await requiredJavaMajor(mcVersion || s.get('version'));
});

// Baixa o Java certo agora (botão da aba Config) — sem isso o launch baixa sozinho ao jogar
ipcMain.handle('java:provision', async (e, mcVersion) => {
  const s = await getStore();
  try {
    const info = await ensureJava(mcVersion || s.get('version'), '', s.get('gameDir'));
    return { ok: true, bin: info.bin, major: info.major, source: info.source };
  } catch (err) {
    sendLog('Falha ao provisionar Java: ' + err.message);
    return { ok: false, error: err.message };
  }
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
  const destDir = path.join(activeGameDir(s.store), 'skins');
  fs.mkdirSync(destDir, { recursive: true });
  const base = 'skin-' + Date.now() + '.png';
  const dest = path.join(destDir, base);
  fs.copyFileSync(src, dest);
  fs.copyFileSync(src, path.join(destDir, 'skin.png'));
  s.set('skinPath', path.join(destDir, 'skin.png'));
  return s.get('skinPath');
});

ipcMain.handle('folder:open', async (e, sub = '') => {
  const dir = safeChildPath(await getActiveGameDir(), sub);
  fs.mkdirSync(dir, { recursive: true });
  await shell.openPath(dir);
  return dir;
});

// ---------- skins ----------
ipcMain.handle('skins:list', async () => {
  const s = await getStore();
  const dir = path.join(activeGameDir(s.store), 'skins');
  fs.mkdirSync(dir, { recursive: true });
  const active = s.get('skinPath') || path.join(dir, 'skin.png');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => ({
    name: f, path: path.join(dir, f), active: path.resolve(path.join(dir, f)) === path.resolve(active)
  }));
});
ipcMain.handle('skins:apply', async (e, name) => {
  const s = await getStore();
  const dir = path.join(activeGameDir(s.store), 'skins');
  const src = safeChildPath(dir, name);
  const dest = path.join(dir, 'skin.png');
  fs.copyFileSync(src, dest);
  s.set('skinPath', dest);
  return dest;
});
ipcMain.handle('skins:delete', async (e, name) => {
  if (name === 'skin.png') return { ok: false, error: 'skin ativa não pode ser excluída' };
  const s = await getStore();
  const target = safeChildPath(path.join(activeGameDir(s.store), 'skins'), name);
  fs.rmSync(target, { force: true });
  if (s.get('skinPath') === target) s.set('skinPath', '');
  return { ok: true };
});

// ---------- mods ----------
ipcMain.handle('mods:list', async () => {
  const s = await getStore();
  const dir = path.join(activeGameDir(s.store), 'mods');
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
  const dir = path.join(activeGameDir(s.store), 'mods');
  const cur = safeChildPath(dir, name);
  let next;
  if (name.endsWith('.disabled')) next = path.join(dir, name.replace(/\.disabled$/, ''));
  else next = cur + '.disabled';
  fs.renameSync(cur, next);
  return { ok: true };
});
ipcMain.handle('mods:delete', async (e, name) => {
  const s = await getStore();
  fs.rmSync(safeChildPath(path.join(activeGameDir(s.store), 'mods'), name), { force: true });
  return { ok: true };
});

// Modrinth: instala latest compatível, com cadeia de fallbacks e dicas de disponibilidade.
// args: { slug, fallbacks?: string[], loader?, mcVersion? }
async function modAvailability(slug, forLoader) {
  try {
    const versions = await fetchJSON(`https://api.modrinth.com/v2/project/${slug}/version?limit=200`, {
      headers: { 'User-Agent': 'CraftLauncher/2.0' }
    });
    const games = [...new Set(versions.flatMap((v) => v.game_versions || []))];
    const loaders = [...new Set(versions.flatMap((v) => v.loaders || []))];
    // ordena versões MC de forma simples (mais novas primeiro por prefixo)
    games.sort().reverse();
    // versões que têm build para ESTE loader (quilt aceita fabric)
    let loaderGames = [];
    if (forLoader) {
      const lds = forLoader === 'quilt' ? ['quilt', 'fabric'] : [forLoader];
      loaderGames = [...new Set(versions
        .filter((v) => (v.loaders || []).some((l) => lds.includes(l)))
        .flatMap((v) => v.game_versions || []))];
      loaderGames.sort().reverse();
    }
    return { loaders, games: games.slice(0, 12), loaderGames: loaderGames.slice(0, 8), total: versions.length };
  } catch {
    return { loaders: [], games: [], loaderGames: [], total: 0 };
  }
}

async function installModrinthSlug(slug, fallbacks, ctx) {
  const { mc, ld, dir, depth, visited } = ctx;
  // Quilt roda jars de Fabric: aceita builds dos dois. Shaders/datapacks: sem filtro de loader.
  const effLoaders = dir === 'mods' ? (ld === 'quilt' ? ['fabric', 'quilt'] : [ld]) : null;
  const chain = [slug, ...(fallbacks || [])].filter(Boolean);
  let lastErr = 'desconhecido';
  for (const c of chain) {
    sendLog(`Buscando ${c} no Modrinth (${mc}${dir === 'mods' ? '/' + ld : ''})...`);
    try {
      const params = [`game_versions=${encodeURIComponent(JSON.stringify([mc]))}`];
      if (effLoaders) params.unshift(`loaders=${encodeURIComponent(JSON.stringify(effLoaders))}`);
      const url = `https://api.modrinth.com/v2/project/${c}/version?${params.join('&')}`;
      const versions = await fetchJSON(url, { headers: { 'User-Agent': 'CraftLauncher/2.0' } });
      if (!versions.length) {
        const av = await modAvailability(c, ld);
        const hint = !av.total
          ? ' (projeto não encontrado)'
          : av.loaderGames.length
            ? ` Existe para ${ld} em: ${av.loaderGames.slice(0, 6).join(', ')}.`
            : ` Não há build para ${ld} (só: ${av.loaders.join('/') || '?'})`;
        throw new Error(`sem build de ${c} para MC ${mc} (${ld}).${hint}`);
      }
      // prefere build marcado com o loader atual; senão o primeiro (ex: fabric p/ quilt)
      const best = versions.find((v) => (v.loaders || []).includes(ld)) || versions[0];
      const file = best.files.find((f) => f.primary) || best.files[0];
      const extOk = dir === 'mods'
        ? file && file.url && file.filename.toLowerCase().endsWith('.jar')
        : file && file.url && /\.(jar|zip)$/i.test(file.filename);
      if (!extOk) {
        throw new Error(`build inválida de ${c}`);
      }
      const modsDir = path.join(activeGameDir({ version: mc, modloader: ld, gameDir: ctx.gameDir }), dir);
      fs.mkdirSync(modsDir, { recursive: true });
      const dest = safeChildPath(modsDir, file.filename);
      const existed = fs.existsSync(dest);
      if (!existed) {
        sendLog('Baixando ' + file.filename + '...');
        await downloadFileWithRetry(file.url, dest);
        sendLog('Instalado: ' + dir + '/' + file.filename);
      } else {
        sendLog('Já instalado: ' + dir + '/' + file.filename);
      }
      // Dependências "required" do Modrinth (ex: Waystones precisa do Balm):
      // instala junto, senão o jogo crasha na abertura dizendo que falta dependência.
      if (depth < 3) {
        const reqs = (best.dependencies || []).filter((d) => d.dependency_type === 'required' && d.project_id);
        for (const dep of reqs) {
          if (visited.has(dep.project_id)) continue;
          visited.add(dep.project_id);
          try {
            const proj = await fetchJSON(`https://api.modrinth.com/v2/project/${dep.project_id}`, { headers: { 'User-Agent': 'CraftLauncher/2.0' } });
            if (proj && proj.slug && proj.slug !== c) {
              sendLog(`Dependência obrigatória: ${proj.title || proj.slug}...`);
              const r = await installModrinthSlug(proj.slug, [], { ...ctx, depth: depth + 1 });
              if (!r.ok) sendLog(`AVISO: dependência ${proj.slug} falhou: ${r.error} — o mod pode não carregar.`);
            }
          } catch (depErr) {
            sendLog(`AVISO: dependência ${dep.project_id} não resolvida: ${depErr.message}`);
          }
        }
      }
      return { ok: true, file: file.filename, slug: c, loader: ld, already: existed };
    } catch (err) {
      lastErr = err.message;
      sendLog(`Falha ${c}: ${err.message}`);
    }
  }
  return { ok: false, error: lastErr };
}

ipcMain.handle('mods:installModrinth', async (e, { slug, fallbacks = [], loader, mcVersion, dir = 'mods' }) => {
  const s = await getStore();
  const mc = mcVersion || s.get('version');
  let ld = (loader || s.get('modloader') || 'fabric').toLowerCase();
  if (ld === 'vanilla') ld = 'fabric';
  if (dir === 'mods' && ld === 'forge' && isNewMcForForge(mc)) {
    const msg = `Forge não existe para MC ${mc} (o loader Forge parou na 1.20.1 — o app CurseForge usa NeoForge nas versões novas). Troque o modloader para NeoForge e instale de novo.`;
    sendLog('Mods: ' + msg);
    return { ok: false, error: msg };
  }
  return installModrinthSlug(slug, fallbacks, { mc, ld, dir, depth: 0, visited: new Set(), gameDir: s.get('gameDir') });
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

// Prefixo das builds NeoForge para um MC: "1.21.1" -> "21.1.", "26.2" -> "26.2."
function neoForgePrefix(mcVersion) {
  const mc = String(mcVersion || '');
  let m = mc.match(/^1\.(\d+)\.(\d+)/);
  if (m) return `${m[1]}.${m[2]}.`;
  m = mc.match(/^(\d+)\.(\d+)/);
  if (m) return `${m[1]}.${m[2]}.`;
  return null;
}
// MC exigido por uma build NeoForge: "26.2.0.88" -> "26.2", "21.1.209" -> "1.21.1"
function neoForgeMcFor(nv) {
  const m = String(nv).match(/^(\d+)\.(\d+)\./);
  if (!m) return null;
  if (m[1] === '20' || m[1] === '21') return `1.${m[1]}.${m[2]}`;
  return `${m[1]}.${m[2]}`;
}
// Forge acabou na 1.20.1 — para MC novo o caminho é NeoForge (é o que o app CurseForge usa).
function isNewMcForForge(mc) {
  const m = String(mc || '').match(/^(\d+)\.(\d+)/);
  if (!m) return false;
  const maj = parseInt(m[1], 10), min = parseInt(m[2], 10);
  return maj > 1 || (maj === 1 && min >= 21);
}

ipcMain.handle('versions:neoforge', async (e, mcVersion) => {
  // NeoForge acompanha o MC: 1.20.x -> "20.x.", 1.21.x -> "21.x.", 26.x -> "26.x."
  // (só existe a partir da 1.20.2; não há NeoForge para 1.20.1 e anteriores)
  try {
    const data = await fetchJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    let list = (data.versions || []).slice().reverse();
    const prefix = neoForgePrefix(mcVersion);
    if (mcVersion) {
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

// mclc ignora o arguments.jvm do profile custom — sem ele, Forge/NeoForge crasham
// no Java 16+ (InaccessibleObjectException no SecureJar). Extraímos e aplicamos.
function profileJvmArgs(root, customId) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, 'versions', customId, `${customId}.json`), 'utf8'));
    const raw = (j.arguments && j.arguments.jvm) || [];
    if (!raw.length) return [];
    const libDir = path.join(root, 'libraries');
    const sep = process.platform === 'win32' ? ';' : ':';
    const osName = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux';
    const allowRule = (rules) => {
      let allow = false;
      for (const r of rules || []) {
        if (r.os && r.os.name && r.os.name !== osName) continue;
        allow = r.action === 'allow';
      }
      return allow;
    };
    const out = [];
    for (const e of raw) {
      if (typeof e === 'string') out.push(e);
      else if (e && Array.isArray(e.value)) { if (!e.rules || allowRule(e.rules)) out.push(...e.value); }
      else if (e && typeof e.value === 'string') { if (!e.rules || allowRule(e.rules)) out.push(e.value); }
    }
    return out.map((a) => String(a)
      .replace(/\$\{library_directory\}/g, libDir)
      .replace(/\$\{classpath_separator\}/g, sep)
      .replace(/\$\{version_name\}/g, customId));
  } catch { return []; }
}

// roda o installer e retorna { code, createdId }
function runJavaInstaller(jarPath, gameDir, mcVersion) {
  return new Promise(async (resolve) => {
    sendLog('Executando installer: ' + path.basename(jarPath));
    sendLog('Isso pode levar alguns minutos (baixa ~200-400 MB)…');
    const before = new Set(listVersionDirs(gameDir));
    const s = store;
    // installer moderno exige Java 17+: usa o gerenciado se o sistema não servir
    let javaBin = 'java';
    try {
      const ji = await ensureJava(mcVersion || (s && s.get('version')) || '1.21.1', (s && s.get('javaPath')) || '', gameDir);
      javaBin = ji.bin;
    } catch (err) {
      sendLog('AVISO installer: ' + err.message);
      javaBin = (s && s.get('javaPath') && fs.existsSync(s.get('javaPath'))) ? s.get('javaPath') : 'java';
    }
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
    // Forge morreu na 1.20.1 — para 1.21+ o caminho é NeoForge
    const m = String(mc).match(/^(\d+)\.(\d+)/);
    if (m && (parseInt(m[1], 10) > 1 || (parseInt(m[1], 10) === 1 && parseInt(m[2], 10) >= 21))) {
      throw new Error(`Forge não existe para MC ${mc} (só até 1.20.1). Para ${mc} use ⚡ NeoForge na aba Modloaders.`);
    }
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
    const installRoot = activeGameDir({ ...s.store, version: mc, modloader: 'forge' });
    ensureLauncherProfile(installRoot);
    const { code, createdId } = await runJavaInstaller(tmp, installRoot, mc);
    if (code !== 0) return { ok: false, error: 'installer saiu com código ' + code + ' — veja os logs acima' };
    const done = await finishModloaderInstall(installRoot, createdId, 'forge');
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
      const prefix = neoForgePrefix(s.get('version'));
      const cands = (data.versions || []).filter((v) => prefix && String(v).startsWith(prefix));
      nv = cands.filter((v) => !/beta|alpha/i.test(String(v))).slice(-1)[0] || cands.slice(-1)[0];
      if (!nv) throw new Error(`não há build NeoForge compatível com MC ${s.get('version')}`);
    }
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${nv}/neoforge-${nv}-installer.jar`;
    sendLog('Baixando NeoForge installer ' + nv + '...');
    const dl = await fetch(url);
    if (!dl.ok) throw new Error('installer HTTP ' + dl.status);
    // NeoForge X.Y.* exige MC correspondente: avisa cedo em vez de instalar errado
    const needMC = neoForgeMcFor(nv);
    if (needMC) {
      const cur = s.get('version');
      if (cur !== needMC) {
        sendLog(`Atenção: NeoForge ${nv} é para MC ${needMC} (você está na ${cur}). A versão será ajustada após instalar.`);
      }
    }
    const tmp = path.join(app.getPath('temp'), `neoforge-${nv}-installer.jar`);
    fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
    const mc = s.get('version');
    const installRoot = activeGameDir({ ...s.store, version: mc, modloader: 'neoforge' });
    ensureLauncherProfile(installRoot);
    const { code, createdId } = await runJavaInstaller(tmp, installRoot, mc);
    if (code !== 0) return { ok: false, error: 'installer saiu com código ' + code + ' — veja os logs acima' };
    const done = await finishModloaderInstall(installRoot, createdId, 'neoforge');
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

async function ensureModloaderInstalled(kind, mcVersion, root) {
  const needle = kind === 'forge' ? 'forge-' : 'neoforge';
  const existing = detectCustomVersion(root, needle);
  if (existing && readCustomInherits(root, existing) === mcVersion) return existing;
  sendLog(`${kind}: não encontrado para MC ${mcVersion}; instalando automaticamente...`);
  let url;
  if (kind === 'forge') {
    const data = await fetchJSON('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
    const build = data.promos[`${mcVersion}-recommended`] || data.promos[`${mcVersion}-latest`];
    if (!build) throw new Error(`não há build Forge disponível para ${mcVersion}`);
    const full = `${mcVersion}-${build}`;
    url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar`;
  } else {
    const data = await fetchJSON('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
    const prefix = neoForgePrefix(mcVersion);
    const cands = (data.versions || []).filter((v) => prefix && String(v).startsWith(prefix));
    // prefere estável (sem beta/alpha); cai para a mais recente do prefixo
    const version = cands.filter((v) => !/beta|alpha/i.test(String(v))).slice(-1)[0] || cands.slice(-1)[0];
    if (!version) throw new Error(`não há build NeoForge compatível com ${mcVersion}`);
    url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${version}/neoforge-${version}-installer.jar`;
  }
  const dl = await fetch(url);
  if (!dl.ok) throw new Error(`download do installer falhou (HTTP ${dl.status})`);
  const tmp = path.join(app.getPath('temp'), `${kind}-auto-installer.jar`);
  fs.writeFileSync(tmp, Buffer.from(await dl.arrayBuffer()));
  try {
    ensureLauncherProfile(root);
    const result = await runJavaInstaller(tmp, root, mcVersion);
    if (result.code !== 0) throw new Error(`installer terminou com código ${result.code}`);
    return (await finishModloaderInstall(root, result.createdId, kind)).id;
  } finally {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
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
  const root = activeGameDir(settings);
  try {
    const backup = await backupProfile(root);
    if (backup) sendLog('Backup criado: ' + path.basename(backup));
  } catch (err) {
    sendLog('AVISO: backup não criado: ' + err.message);
  }
  fs.mkdirSync(root, { recursive: true });
  for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'screenshots']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true });
  }

  // Java: garante o major certo p/ a versão (baixa sozinho se preciso)
  let javaInfo;
  try {
    javaInfo = await ensureJava(settings.version, settings.javaPath, root);
  } catch (err) {
    sendLog('ERRO: ' + err.message);
    return { ok: false, error: err.message };
  }
  const javaPath = javaInfo.bin;
  const client = getMCLC();
  const { Authenticator } = require('minecraft-launcher-core');
  const uuid = offlineUUID(username);
  // getAuth é assíncrono: resolve primeiro e SÓ então aplica o UUID estável
  const auth = await Authenticator.getAuth(username);
  auth.uuid = uuid.replace(/-/g, '');
  auth.access_token = '0';
  auth.client_token = uuid.replace(/-/g, '');
  auth.meta = { type: 'mojang', demo: !!settings.demo };

  // (Java já validado pelo ensureJava acima)

  // RAM sanidade: limita pelo TOTAL e pela LIVRE (máquina lotada mata o Java na hora)
  const totalGB = os.totalmem() / 1024 ** 3;
  const freeGB = os.freemem() / 1024 ** 3;
  const capTotal = Math.floor(totalGB * 0.6);
  const capFree = Math.floor(freeGB * 0.8);
  let cap = Math.min(capTotal, capFree);
  if (cap < 2) {
    sendLog(`⚠️ ATENÇÃO: só há ${freeGB.toFixed(1)}G livres de ${totalGB.toFixed(1)}G — feche programas antes de jogar!`);
    cap = Math.max(1, Math.min(2, Math.floor(totalGB * 0.25)));
  }
  if (settings.ramMax > cap) {
    sendLog(`AVISO: RAM máxima ajustada ${settings.ramMax}G → ${cap}G (livre: ${freeGB.toFixed(1)}G).`);
    settings.ramMax = cap;
    s.set({ ramMax: settings.ramMax });
  }
  if (settings.ramMin > settings.ramMax) {
    settings.ramMin = Math.max(1, settings.ramMax - 1);
    s.set({ ramMin: settings.ramMin });
  }
  sendLog(`RAM: livre ${freeGB.toFixed(1)}G/total ${totalGB.toFixed(1)}G → jogo com ${settings.ramMin}–${settings.ramMax}G.`);

  const splitArgs = (str) => String(str || '').match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [];

  const launchOpts = {
    authorization: auth,
    root,
    version: { number: settings.version, type: 'release' },
    memory: { max: `${settings.ramMax}G`, min: `${settings.ramMin}G` },
    javaPath: javaPath === 'java' ? undefined : javaPath,
    // Mantém o jogo independente do processo do Electron quando a janela é fechada.
    overrides: { detached: true }
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
    const needles = kind === 'forge' ? ['forge-'] : ['neoforge', 'neoforged'];
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
      let { id } = resolveInstalledCustom('forge');
      if (!id) id = await ensureModloaderInstalled('forge', settings.version, root);
      if (id) {
        sendLog('Forge detectado: ' + id); s.set({ customVersion: id });
        launchOpts.version = { number: settings.version, type: 'release', custom: id };
        const pjvm = profileJvmArgs(root, id);
        if (pjvm.length) {
          launchOpts.customArgs = [...(launchOpts.customArgs || []), ...pjvm];
          sendLog(`JVM do Forge aplicada (${pjvm.length} args: módulos/--add-opens).`);
        }
      }
      else throw new Error('Forge não está instalado para MC ' + settings.version + '. Instale-o na aba Modloaders antes de jogar.');
    } else if (ml === 'neoforge') {
      let { id } = resolveInstalledCustom('neoforge');
      if (!id) id = await ensureModloaderInstalled('neoforge', settings.version, root);
      if (id) {
        sendLog('NeoForge detectado: ' + id); s.set({ customVersion: id });
        launchOpts.version = { number: settings.version, type: 'release', custom: id };
        const pjvm = profileJvmArgs(root, id);
        if (pjvm.length) {
          launchOpts.customArgs = [...(launchOpts.customArgs || []), ...pjvm];
          sendLog(`JVM do NeoForge aplicada (${pjvm.length} args: módulos/--add-opens).`);
        }
      }
      else throw new Error('NeoForge não está instalado para MC ' + settings.version + '. Instale-o na aba Modloaders antes de jogar.');
    }
  } catch (err) {
    const msg = 'ERRO no modloader: ' + err.message;
    sendLog(msg);
    return { ok: false, error: err.message };
  }

  sendLog(`Iniciando Minecraft ${settings.version} (${settings.modloader}) como ${username} [${uuid.slice(0, 8)}...]`);
  sendLog(`RAM ${settings.ramMin}G–${settings.ramMax}G | ${w}x${h}${settings.fullscreen ? ' fullscreen' : ''} | Java: ${javaPath}`);
  try {
    const ml = (settings.modloader || 'vanilla').toLowerCase();
    const mc = settings.version;
    const modFiles = fs.readdirSync(path.join(root, 'mods')).filter((f) => f.endsWith('.jar'));
    if (ml === 'vanilla' && modFiles.length) {
      sendLog(`AVISO: ${modFiles.length} mod(s) na pasta mas loader é Vanilla — não vão carregar. Troque para Fabric.`);
    } else if (modFiles.length) {
      sendLog(`Mods ativos (${modFiles.length}): ` + modFiles.slice(0, 8).join(', ') + (modFiles.length > 8 ? '…' : ''));
      // heurística: jar marcado p/ outro loader ou outra versão do MC
      const loaders = ['fabric', 'forge', 'neoforge', 'quilt'];
      const bad = modFiles.filter((f) => {
        const n = f.toLowerCase();
        const tagLoader = loaders.find((l) => n.includes('-' + l + '-') || n.includes('-' + l + '.') || n.includes(l + '-fabric') || n.includes(l + '-forge'));
        if (tagLoader && tagLoader !== ml && !(ml === 'quilt' && tagLoader === 'fabric')) return true;
        const mcv = n.match(/mc\s?(\d+\.\d+(\.\d+)?)|(\d+\.\d+(\.\d+)?)\.jar$|[-+](\d+\.\d+(\.\d+)?)([-+.])/);
        const hint = mcv ? (mcv[1] || mcv[3] || mcv[5]) : null;
        if (hint && mc && !mc.startsWith(hint) && !hint.startsWith(mc)) return true;
        return false;
      });
      if (bad.length) {
        sendLog(`⚠️ ${bad.length} mod(s) parecem de OUTRO loader/versão e podem crashar: ` + bad.slice(0, 6).join(', ') + (bad.length > 6 ? '…' : ''));
        sendLog(`Dica: jogando ${mc} (${ml}). Desative-os na aba Mods ou baixe as builds certas no catálogo.`);
      }
    }
  } catch {}

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

// ---------- auto-update ----------
const UPDATE_REPO = 'contasuportedis-png/CraftLauncher';
function cmpVersions(a, b) {
  const pa = String(a || '').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function fetchLatestRelease() {
  const rel = await fetchJSON(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
    headers: { 'User-Agent': 'CraftLauncher', Accept: 'application/vnd.github+json' }
  });
  const assets = rel.assets || [];
  const pick = process.platform === 'win32'
    ? assets.find((a) => /setup.*\.exe$/i.test(a.name))
    : process.platform === 'darwin'
      ? assets.find((a) => /\.dmg$/i.test(a.name))
      : assets.find((a) => /\.AppImage$/i.test(a.name));
  return { rel, pick };
}

ipcMain.handle('update:check', async () => {
  const current = app.getVersion();
  try {
    const { rel, pick } = await fetchLatestRelease();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    return {
      ok: true, current, latest, tag: rel.tag_name,
      update: cmpVersions(latest, current) > 0,
      hasAsset: !!pick, name: pick?.name, url: pick?.browser_download_url,
      notes: String(rel.body || '').slice(0, 600), htmlUrl: rel.html_url
    };
  } catch (err) {
    return { ok: false, error: err.message, current };
  }
});

ipcMain.handle('update:openPage', async () => {
  try {
    const { rel } = await fetchLatestRelease();
    await shell.openExternal(rel.html_url || `https://github.com/${UPDATE_REPO}/releases/latest`);
    return { ok: true };
  } catch {
    await shell.openExternal(`https://github.com/${UPDATE_REPO}/releases/latest`);
    return { ok: true };
  }
});

ipcMain.handle('update:apply', async () => {
  // Baixa o artefato da plataforma e aplica: Linux AppImage troca+reinicia,
  // Windows roda o Setup silencioso e fecha o app. Sem asset/suporte: abre a página.
  let info;
  try {
    const { pick, rel } = await fetchLatestRelease();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    if (cmpVersions(latest, app.getVersion()) <= 0) return { ok: false, error: 'já atualizado' };
    if (!pick) {
      await shell.openExternal(rel.html_url);
      return { ok: false, error: 'sem instalador para este sistema — página aberta' };
    }
    info = { url: pick.browser_download_url, name: pick.name, digest: pick.digest || '' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    sendLog('Baixando atualização ' + info.name + '...');
    const res = await fetch(info.url);
    if (!res.ok) throw new Error('download HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20 * 1024 * 1024) throw new Error('download incompleto');
    if (info.digest) {
      const expected = info.digest.replace(/^sha256:/i, '').toLowerCase();
      const actual = crypto.createHash('sha256').update(buf).digest('hex');
      if (actual !== expected) throw new Error('hash SHA-256 da atualização não confere');
    } else {
      sendLog('AVISO: release não publicou SHA-256; atualização sem verificação de hash.');
    }
    const tmp = path.join(app.getPath('temp'), info.name);
    fs.writeFileSync(tmp, buf);

    if (process.platform === 'linux' && process.env.APPIMAGE) {
      fs.chmodSync(tmp, 0o755);
      sendLog('Trocando AppImage e reiniciando...');
      // rename atômico no MESMO diretório (rename entre filesystems falha + copiar
      // por cima do binário em execução dá ETXTBSY)
      const staged = process.env.APPIMAGE + '.new';
      fs.copyFileSync(tmp, staged);
      fs.renameSync(staged, process.env.APPIMAGE);
      fs.chmodSync(process.env.APPIMAGE, 0o755);
      try { fs.rmSync(tmp, { force: true }); } catch {}
      const s = await getStore();
      s.set('lastUpdateApplied', Date.now());
      app.relaunch({ execPath: process.env.APPIMAGE, args: process.argv.slice(1) });
      app.exit(0);
      return { ok: true, restarted: true };
    }
    if (process.platform === 'win32') {
      sendLog('Abrindo instalador da nova versão e fechando...');
      const child = spawn(tmp, ['/S'], { detached: true, stdio: 'ignore' });
      child.unref();
      setTimeout(() => app.quit(), 1500);
      return { ok: true, installer: true };
    }
    await shell.openPath(path.dirname(tmp));
    await shell.openExternal(`https://github.com/${UPDATE_REPO}/releases/latest`);
    return { ok: false, error: 'atualização baixada — abra a página da release' };
  } catch (err) {
    sendLog('Falha ao atualizar: ' + err.message);
    return { ok: false, error: err.message };
  }
});

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
