'use strict';

const CONFIG_KEY = 'proxyflowConfig';
const TEST_TRACE_URL = 'https://cloudflare.com/cdn-cgi/trace';
const TEST_HTTPS_URL = 'https://example.com/';
const PROXYSCRAPE_BASE = 'https://api.proxyscrape.com/v4/free-proxy-list/get';

const BLOCKED_PROXY = {
  type: 'socks',
  host: 'proxyflow-block.invalid',
  port: 1,
  proxyDNS: true,
  failoverTimeout: 1,
  username: 'blocked',
  password: 'blocked'
};

let config = makeDefaultConfig();
let testSessions = new Map();

// Cache de RegExp compilados — evita criar novo objeto em cada requisição de rede
const _regexCache = new Map();

function makeDefaultConfig() {
  return {
    version: 2,
    profiles: {
      '__default': { mode: 'direct', input: '', proxy: null },
      'firefox-default': { mode: 'inherit', input: '', proxy: null },
      'firefox-private': { mode: 'inherit', input: '', proxy: null },
      'firefox-unknown': { mode: 'inherit', input: '', proxy: null }
    },
    rules: [],
    savedProxies: [],
    preferences: {
      proxyDnsForSocks: true,
      blockInvalidProxy: true
    }
  };
}

function mergeConfig(raw) {
  const base = makeDefaultConfig();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  return {
    ...base,
    ...raw,
    profiles: { ...base.profiles, ...(raw.profiles || {}) },
    rules: Array.isArray(raw.rules) ? raw.rules : [],
    savedProxies: Array.isArray(raw.savedProxies) ? raw.savedProxies : [],
    preferences: { ...base.preferences, ...(raw.preferences || {}) }
  };
}

function normalizeStoreId(details) {
  if (details && details.cookieStoreId) {
    if (details.cookieStoreId === 'firefox-default' && details.tabId === -1) {
      return 'firefox-unknown';
    }
    return details.cookieStoreId;
  }
  if (details && details.incognito) {
    return 'firefox-private';
  }
  if (details && details.tabId !== -1) {
    return 'firefox-default';
  }
  return 'firefox-unknown';
}

function formatProxyInput(input, protocolHint = 'socks5') {
  const text = String(input || '').trim();
  if (!text) return '';
  if (text.includes('://')) return text;
  return `${String(protocolHint || 'socks5').toLowerCase()}://${text}`;
}

function parseProxyInput(input, options = {}) {
  const text = String(input || '').trim();
  const proxyDns = options.proxyDnsForSocks !== false;

  if (!text) {
    return { ok: false, error: 'Informe um proxy.' };
  }

  let candidate = text;
  if (!candidate.includes('://')) {
    candidate = `socks5://${candidate}`;
  }

  let url;
  try {
    url = new URL(candidate);
  } catch (error) {
    return { ok: false, error: 'Formato inválido. Use host:porta, socks5://host:porta ou http://host:porta.' };
  }

  const protocol = url.protocol.replace(':', '').toLowerCase();
  const supported = {
    socks: 'socks',
    socks5: 'socks',
    socks4: 'socks4',
    http: 'http',
    https: 'https'
  };

  if (!supported[protocol]) {
    return { ok: false, error: 'Tipo de proxy não suportado. Use socks5, socks4, http ou https.' };
  }

  const host = url.hostname;
  const port = Number(url.port || (protocol === 'http' ? 80 : protocol === 'https' ? 443 : 1080));

  if (!host) return { ok: false, error: 'Host ausente.' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, error: 'Porta inválida.' };
  }

  const proxy = {
    type: supported[protocol],
    host,
    port,
    failoverTimeout: 3
  };

  if (url.username) proxy.username = decodeURIComponent(url.username);
  if (url.password) proxy.password = decodeURIComponent(url.password);
  if (proxy.type === 'socks' || proxy.type === 'socks4') proxy.proxyDNS = proxyDns;

  return { ok: true, proxy };
}

function sanitizeSetting(setting) {
  const clean = setting && typeof setting === 'object' ? { ...setting } : {};
  const mode = clean.mode || 'inherit';
  if (mode === 'proxy') {
    const parsed = parseProxyInput(clean.input, config.preferences);
    return {
      mode: 'proxy',
      input: String(clean.input || '').trim(),
      proxy: parsed.ok ? parsed.proxy : null,
      error: parsed.ok ? '' : parsed.error
    };
  }
  if (['inherit', 'firefox', 'direct', 'block'].includes(mode)) {
    return { mode, input: '', proxy: null };
  }
  return { mode: 'inherit', input: '', proxy: null };
}

function settingToProxyInfo(setting, storeId) {
  const clean = sanitizeSetting(setting);
  if (clean.mode === 'inherit') {
    if (storeId === '__default') return null;
    return settingToProxyInfo(config.profiles.__default, '__default');
  }
  if (clean.mode === 'firefox') return undefined;
  if (clean.mode === 'direct') return null;
  if (clean.mode === 'block') return [BLOCKED_PROXY, null];
  if (clean.mode === 'proxy' && clean.proxy) {
    return [{ ...clean.proxy, connectionIsolationKey: String(storeId || 'proxyflow') }, null];
  }
  return config.preferences.blockInvalidProxy ? [BLOCKED_PROXY, null] : null;
}

function wildcardToRegex(pattern) {
  if (_regexCache.has(pattern)) return _regexCache.get(pattern);
  const escaped = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  const re = new RegExp(`^${escaped}$`, 'i');
  // Mantém o cache com no máximo 256 entradas
  if (_regexCache.size >= 256) _regexCache.delete(_regexCache.keys().next().value);
  _regexCache.set(pattern, re);
  return re;
}

function hostMatches(host, pattern) {
  let p = String(pattern || '').trim().toLowerCase();
  if (!p) return false;
  if (p.includes('://') || p.includes('/')) return false;
  p = p.replace(/^\.+/, '').replace(/\.+$/, '');
  if (!p) return false;
  if (p.includes('*')) return wildcardToRegex(p.replace(/^\*\./, '*')).test(host);
  return host === p || host.endsWith(`.${p}`);
}

function urlMatchesRule(urlText, patternText) {
  const patterns = String(patternText || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  if (!patterns.length) return false;

  let url;
  try {
    url = new URL(urlText);
  } catch (error) {
    return false;
  }

  return patterns.some(pattern => {
    if (pattern.includes('://') || pattern.includes('/')) return wildcardToRegex(pattern).test(urlText);
    return hostMatches(url.hostname.toLowerCase(), pattern);
  });
}

function findMatchingRule(details, storeId) {
  const rules = Array.isArray(config.rules) ? config.rules : [];
  for (const rule of rules) {
    if (!rule || rule.enabled === false) continue;
    if (rule.storeId && rule.storeId !== '*' && rule.storeId !== storeId) continue;
    if (urlMatchesRule(details.url, rule.pattern)) return rule;
  }
  return null;
}

function extractProxyFlowTestId(urlText) {
  try {
    const url = new URL(urlText);
    return url.searchParams.get('pf') || url.searchParams.get('proxyflow');
  } catch (error) {
    return '';
  }
}

function handleProxyRequest(details) {
  const testId = details && details.url ? extractProxyFlowTestId(details.url) : '';
  if (testId && testSessions.has(testId)) {
    const session = testSessions.get(testId);
    if (Date.now() - session.createdAt < 30000) {
      return settingToProxyInfo(session.setting, `test-${testId}`);
    }
    testSessions.delete(testId);
  }

  const storeId = normalizeStoreId(details);
  const rule = findMatchingRule(details, storeId);
  if (rule) return settingToProxyInfo(rule.setting, storeId);

  const setting = config.profiles[storeId] || { mode: 'inherit' };
  return settingToProxyInfo(setting, storeId);
}

// Debounce por aba: evita chamadas redundantes quando tabs.onUpdated
// dispara múltiplas vezes num único carregamento de página
const _iconDebounce = new Map();

function refreshActionIcon(tab) {
  if (!tab || tab.id === -1) return;
  const tabId = tab.id;

  if (_iconDebounce.has(tabId)) clearTimeout(_iconDebounce.get(tabId));

  _iconDebounce.set(tabId, setTimeout(async () => {
    _iconDebounce.delete(tabId);

    const storeId = normalizeStoreId(tab);
    const setting = sanitizeSetting(config.profiles[storeId] || { mode: 'inherit' });
    const resolved = setting.mode === 'inherit' ? sanitizeSetting(config.profiles.__default) : setting;

    let path = 'icons/icon-48.png';
    let title = 'ProxyFlow Containers';

    if (resolved.mode === 'direct') {
      path = 'icons/direct-48.png';
      title = 'ProxyFlow: conexão direta';
    } else if (resolved.mode === 'block') {
      path = 'icons/block-48.png';
      title = 'ProxyFlow: bloqueado';
    } else if (resolved.mode === 'firefox') {
      path = 'icons/firefox-48.png';
      title = 'ProxyFlow: configurações do Firefox';
    } else if (resolved.mode === 'proxy' && resolved.proxy) {
      path = 'icons/proxy-48.png';
      title = `ProxyFlow: ${resolved.proxy.host}:${resolved.proxy.port}`;
    }

    try {
      await browser.browserAction.setIcon({ tabId, path });
      await browser.browserAction.setTitle({ tabId, title });
    } catch (error) {
      // Aba pode ter sido fechada antes do timeout — ignorar silenciosamente
    }
  }, 120));
}


function makeTestId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseTrace(text) {
  return {
    ip: (text.match(/^ip=(.+)$/m) || [])[1] || '',
    loc: (text.match(/^loc=(.+)$/m) || [])[1] || '',
    colo: (text.match(/^colo=(.+)$/m) || [])[1] || ''
  };
}

function classifySpeed(ms, ok = true) {
  if (!ok) return { speed: 'fail', speedLabel: 'falhou' };
  if (!ms || ms <= 0) return { speed: 'unknown', speedLabel: 'sem medição' };
  if (ms <= 2000) return { speed: 'fast', speedLabel: 'rápido' };
  if (ms <= 5000) return { speed: 'medium', speedLabel: 'médio' };
  return { speed: 'slow', speedLabel: 'lento' };
}

async function fetchWithTimeout(url, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const startedAt = performance.now();
    const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      text,
      elapsedMs: Math.round(performance.now() - startedAt)
    };
  } finally {
    clearTimeout(timer);
  }
}

async function testConnection(setting, options = {}) {
  const clean = sanitizeSetting(setting);
  if (clean.mode === 'inherit' || clean.mode === 'block' || clean.mode === 'firefox') {
    return { ok: false, status: 'error', message: 'Escolha Conexão direta ou Proxy manual para testar.' };
  }
  if (clean.mode === 'proxy' && !clean.proxy) {
    return { ok: false, status: 'error', message: clean.error || 'Proxy inválido.' };
  }

  const id = makeTestId();
  testSessions.set(id, { id, setting: clean, createdAt: Date.now() });
  const timeoutMs = Math.max(3000, Math.min(20000, Number(options.timeoutMs || 8000)));

  try {
    const traceUrl = `${TEST_TRACE_URL}?pf=${encodeURIComponent(id)}&t=${Date.now()}`;
    const trace = await fetchWithTimeout(traceUrl, timeoutMs);
    const parsed = parseTrace(trace.text || '');

    let httpsOk = true;
    let httpsMs = 0;
    if (options.fullHttps !== false) {
      const httpsUrl = `${TEST_HTTPS_URL}?pf=${encodeURIComponent(id)}&t=${Date.now()}`;
      const https = await fetchWithTimeout(httpsUrl, timeoutMs);
      httpsOk = https.ok && String(https.text || '').length > 100;
      httpsMs = https.elapsedMs;
    }

    const totalMs = Math.max(trace.elapsedMs || 0, httpsMs || 0);
    const speed = classifySpeed(totalMs, trace.ok && httpsOk);

    if (!trace.ok || !httpsOk) {
      return {
        ok: false,
        status: 'fail',
        message: 'Proxy respondeu, mas falhou ao carregar HTTPS completo.',
        ms: totalMs || trace.elapsedMs,
        timeoutMs,
        ignored: true,
        speed: 'fail',
        speedLabel: 'ignorado',
        ip: parsed.ip,
        loc: parsed.loc,
        colo: parsed.colo
      };
    }

    return {
      ok: true,
      status: 'success',
      message: clean.mode === 'direct' ? 'Conexão direta funcionando.' : 'Proxy respondeu e carregou HTTPS.',
      ms: totalMs || trace.elapsedMs,
      timeoutMs,
      speed: speed.speed,
      speedLabel: speed.speedLabel,
      ip: parsed.ip,
      loc: parsed.loc,
      colo: parsed.colo
    };
  } catch (error) {
    const isTimeout = error && error.name === 'AbortError';
    return {
      ok: false,
      status: isTimeout ? 'timeout' : 'fail',
      message: isTimeout ? `Ignorado: não respondeu em até ${Math.round(timeoutMs / 1000)}s.` : 'Não foi possível conectar usando essa configuração.',
      timeoutMs,
      timedOut: isTimeout,
      ignored: true,
      speed: isTimeout ? 'timeout' : 'fail',
      speedLabel: isTimeout ? 'timeout' : 'falhou',
      error: error && error.message ? error.message : String(error)
    };
  } finally {
    testSessions.delete(id);
  }
}

function normalizeProxyLines(text, protocolHint) {
  const seen = new Set();
  return String(text || '')
    .split(/\r?\n|,/)
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => formatProxyInput(item, protocolHint))
    .filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

// ── Fontes de proxies públicos gratuitos ──────────────────────────────────
const PROXY_SOURCES = {
  proxyscrape_socks5:  { name: 'ProxyScrape — SOCKS5', fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: (p, l) => `${PROXYSCRAPE_BASE}?request=display_proxies&protocol=socks5&proxy_format=protocolipport&format=text` },
  proxyscrape_socks4:  { name: 'ProxyScrape — SOCKS4', fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => `${PROXYSCRAPE_BASE}?request=display_proxies&protocol=socks4&proxy_format=protocolipport&format=text` },
  proxyscrape_http:    { name: 'ProxyScrape — HTTP',   fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => `${PROXYSCRAPE_BASE}?request=display_proxies&protocol=http&proxy_format=protocolipport&format=text` },
  proxyscrape_https:   { name: 'ProxyScrape — HTTPS',  fixedProtocol: 'https',  supportsProtocol: false, buildUrl: ()     => `${PROXYSCRAPE_BASE}?request=display_proxies&protocol=https&proxy_format=protocolipport&format=text` },
  speedx_socks5:       { name: 'TheSpeedX — SOCKS5',   fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt' },
  speedx_socks4:       { name: 'TheSpeedX — SOCKS4',   fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks4.txt' },
  speedx_http:         { name: 'TheSpeedX — HTTP',     fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt' },
  monosans_socks5:     { name: 'Monosans — SOCKS5',    fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt' },
  monosans_socks4:     { name: 'Monosans — SOCKS4',    fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks4.txt' },
  monosans_http:       { name: 'Monosans — HTTP',      fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt' },
  shiftytr_socks5:     { name: 'ShiftyTR — SOCKS5',    fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt' },
  shiftytr_socks4:     { name: 'ShiftyTR — SOCKS4',    fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks4.txt' },
  shiftytr_http:       { name: 'ShiftyTR — HTTP',      fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt' },
  hookzof_socks5:      { name: 'Hookzof — SOCKS5',     fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt' },
  roosterkid_socks5:   { name: 'RoosterKid — SOCKS5',  fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS5_RAW.txt' },
  roosterkid_socks4:   { name: 'RoosterKid — SOCKS4',  fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/SOCKS4_RAW.txt' },
  roosterkid_http:     { name: 'RoosterKid — HTTP',    fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt' },
  zloi_socks5:         { name: 'Zloi — SOCKS5',        fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks5.txt' },
  zloi_socks4:         { name: 'Zloi — SOCKS4',        fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt' },
  zloi_http:           { name: 'Zloi — HTTP',          fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt' },
  proxyscan_socks5:    { name: 'ProxyScan.io — SOCKS5',fixedProtocol: 'socks5', supportsProtocol: false, buildUrl: ()     => 'https://www.proxyscan.io/download?type=socks5' },
  proxyscan_socks4:    { name: 'ProxyScan.io — SOCKS4',fixedProtocol: 'socks4', supportsProtocol: false, buildUrl: ()     => 'https://www.proxyscan.io/download?type=socks4' },
  proxyscan_http:      { name: 'ProxyScan.io — HTTP',  fixedProtocol: 'http',   supportsProtocol: false, buildUrl: ()     => 'https://www.proxyscan.io/download?type=http' },
};

async function fetchPublicProxies(sourceId = 'proxyscrape_socks5', protocol = 'socks5', limit = 50) {
  const source = PROXY_SOURCES[sourceId] || PROXY_SOURCES.proxyscrape_socks5;
  const proto = source.fixedProtocol || String(protocol || 'socks5').toLowerCase();
  const url = source.buildUrl(proto, limit);
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${source.name} retornou HTTP ${response.status}.`);
  const text = await response.text();
  const proxies = normalizeProxyLines(text, proto).slice(0, Number(limit || 50));
  return { ok: true, source: source.name, protocol: proto, total: proxies.length, proxies };
}

async function testManyProxies(items, options = {}) {
  const candidates = Array.isArray(items) ? items : [];
  const concurrency = Math.max(1, Math.min(20, Number(options.concurrency || 2)));
  const keep = Math.max(1, Math.min(50, Number(options.keep || 10)));
  const timeoutMs = Math.max(3000, Math.min(20000, Number(options.timeoutMs || 8000)));

  const queue = candidates.map(input => String(input || '').trim()).filter(Boolean);
  const results = [];
  let index = 0;

  async function worker() {
    while (index < queue.length) {
      const input = queue[index++];
      const result = await testConnection({ mode: 'proxy', input }, { timeoutMs, fullHttps: true });
      results.push({
        input,
        ok: !!result.ok,
        status: result.status || (result.ok ? 'success' : 'fail'),
        message: result.message || '',
        ms: result.ms || 0,
        ip: result.ip || '',
        loc: result.loc || '',
        colo: result.colo || '',
        error: result.error || '',
        timedOut: !!result.timedOut,
        ignored: !!result.ignored,
        speed: result.speed || '',
        speedLabel: result.speedLabel || ''
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, () => worker()));

  const sorted = results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.ms || 999999) - (b.ms || 999999);
  });

  const fast = sorted.filter(item => item.ok).slice(0, keep);
  return {
    ok: true,
    tested: results.length,
    success: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    fast,
    results: sorted
  };
}

async function saveFastProxies(fastItems) {
  const existing = Array.isArray(config.savedProxies) ? config.savedProxies : [];
  const byInput = new Map(existing.map(item => [String(item.input || '').toLowerCase(), item]));
  const now = new Date().toISOString();

  for (const item of fastItems || []) {
    if (!item || !item.input) continue;
    byInput.set(String(item.input).toLowerCase(), {
      input: item.input,
      protocol: (String(item.input).split('://')[0] || '').toLowerCase(),
      ms: item.ms || 0,
      ip: item.ip || '',
      loc: item.loc || '',
      source: item.source || 'ProxyScrape',
      testedAt: now
    });
  }

  config.savedProxies = Array.from(byInput.values())
    .sort((a, b) => (a.ms || 999999) - (b.ms || 999999))
    .slice(0, 100);

  await browser.storage.local.set({ [CONFIG_KEY]: config });
  return { ok: true, saved: config.savedProxies.length, savedProxies: config.savedProxies };
}

async function loadConfig() {
  const data = await browser.storage.local.get(CONFIG_KEY);
  config = mergeConfig(data[CONFIG_KEY]);
}

async function saveConfig(next) {
  config = mergeConfig(next);
  await browser.storage.local.set({ [CONFIG_KEY]: config });
}

browser.proxy.onRequest.addListener(handleProxyRequest, { urls: ['<all_urls>'] });
browser.proxy.onError.addListener(error => console.warn('ProxyFlow proxy error:', error && error.message));

browser.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== 'object') return undefined;

  if (message.type === 'GET_CONFIG') return Promise.resolve(config);
  if (message.type === 'SAVE_CONFIG') return saveConfig(message.config).then(() => ({ ok: true }));
  if (message.type === 'TEST_PROXY') return testConnection(message.setting, message.options || {});
  if (message.type === 'PARSE_PROXY') return Promise.resolve(parseProxyInput(message.input, config.preferences));
  if (message.type === 'FETCH_PUBLIC_PROXIES') return fetchPublicProxies(message.sourceId || 'proxyscrape_socks5', message.protocol || 'socks5', message.limit || 50);
  if (message.type === 'GET_PROXY_SOURCES') {
    const list = Object.entries(PROXY_SOURCES).map(([id, s]) => ({ id, name: s.name, fixedProtocol: s.fixedProtocol }));
    return Promise.resolve(list);
  }
  if (message.type === 'TEST_MANY_PROXIES') return testManyProxies(message.proxies || [], message.options || {});
  if (message.type === 'SAVE_FAST_PROXIES') return saveFastProxies(message.items || []);

  return undefined;
});

browser.browserAction.onClicked.addListener(async () => {
  await browser.runtime.openOptionsPage();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes[CONFIG_KEY]) {
    config = mergeConfig(changes[CONFIG_KEY].newValue);
  }
});

browser.tabs.onActivated.addListener(async info => {
  const tab = await browser.tabs.get(info.tabId);
  await refreshActionIcon(tab);
});

browser.tabs.onUpdated.addListener(async (_tabId, _changeInfo, tab) => {
  await refreshActionIcon(tab);
});

loadConfig()
  .then(async () => {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    if (tabs[0]) await refreshActionIcon(tabs[0]);
  })
  .catch(error => console.error('ProxyFlow load failed:', error));

// ProxyFlow Containers — background.js
// Funções internas: parseProxyInput, urlMatchesRule, normalizeStoreId

