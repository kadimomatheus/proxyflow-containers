'use strict';

const profilesEl = document.querySelector('#profiles');
const rulesEl = document.querySelector('#rules');
const profileTemplate = document.querySelector('#profileTemplate');
const ruleTemplate = document.querySelector('#ruleTemplate');
const addRuleButton = document.querySelector('#addRule');
const reloadButton = document.querySelector('#reloadContainers');
const exportButton = document.querySelector('#exportConfig');
const importInput = document.querySelector('#importConfig');

const proxySource    = document.querySelector('#proxySource');
const fetchLimit     = document.querySelector('#fetchLimit');
const testConcurrency= document.querySelector('#testConcurrency');
const keepFast       = document.querySelector('#keepFast');
const proxyTimeout   = document.querySelector('#proxyTimeout');
const fetchFastButton= document.querySelector('#fetchFastProxies');
const publicStatus   = document.querySelector('#publicProxyStatus');
const fastProxyList  = document.querySelector('#fastProxyList');
const applyFastTarget= document.querySelector('#applyFastTarget');
const applyBestProxy = document.querySelector('#applyBestProxy');

// TXT import elements
const txtProxyPaste   = document.querySelector('#txtProxyPaste');
const txtDefaultProto = document.querySelector('#txtDefaultProtocol');
const importTxtFile   = document.querySelector('#importTxtFile');
const parseTxtBtn     = document.querySelector('#parseTxtBtn');
const testTxtBtn      = document.querySelector('#testTxtBtn');
const clearTxtBtn     = document.querySelector('#clearTxtBtn');
const txtParseStatus  = document.querySelector('#txtParseStatus');
const txtPreviewList  = document.querySelector('#txtPreviewList');

const prefProxyDns   = document.querySelector('#prefProxyDns');
const prefBlockInvalid = document.querySelector('#prefBlockInvalid');

const testProgressPanel = document.querySelector('#testProgressPanel');
const closeProgressPanel = document.querySelector('#closeProgressPanel');
const progressSummary = document.querySelector('#progressSummary');
const progressBarFill = document.querySelector('#progressBarFill');
const currentProxy = document.querySelector('#currentProxy');
const progressLog = document.querySelector('#progressLog');

let config;
let identities = [];
let storeChoices = [];
let lastFastResults = [];
let parsedTxtProxies = []; // proxies parsed from TXT import

function localizeHtmlPage() {
  // Translate textContent
  const elements = document.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const translation = browser.i18n.getMessage(key);
    if (translation) {
      el.textContent = translation;
    }
  }

  // Translate placeholders
  const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholders) {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = browser.i18n.getMessage(key);
    if (translation) {
      el.placeholder = translation;
    }
  }
}

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
  return {
    ...base,
    ...(raw || {}),
    profiles: { ...base.profiles, ...((raw && raw.profiles) || {}) },
    rules: Array.isArray(raw && raw.rules) ? raw.rules : [],
    savedProxies: Array.isArray(raw && raw.savedProxies) ? raw.savedProxies : [],
    preferences: { ...base.preferences, ...((raw && raw.preferences) || {}) }
  };
}

function makeSetting(mode = 'inherit', input = '') {
  return { mode, input, proxy: null };
}

const MODE_LABELS = {
  direct:  browser.i18n.getMessage('mode_direct') || 'Conexão direta',
  proxy:   browser.i18n.getMessage('mode_proxy') || 'Proxy manual',
  block:   browser.i18n.getMessage('mode_block') || 'Bloqueado',
  firefox: browser.i18n.getMessage('mode_firefox') || 'Usar Firefox',
  inherit: browser.i18n.getMessage('mode_inherit') || 'Herdando padrão'
};

function modeOptions(allowInherit = true) {
  return [
    ...(allowInherit ? [{ value: 'inherit', text: MODE_LABELS.inherit }] : []),
    { value: 'direct', text: MODE_LABELS.direct },
    { value: 'proxy', text: MODE_LABELS.proxy },
    { value: 'block', text: MODE_LABELS.block },
    { value: 'firefox', text: MODE_LABELS.firefox }
  ];
}

function fillModeSelect(select, value, allowInherit) {
  select.textContent = '';
  for (const option of modeOptions(allowInherit)) {
    const item = document.createElement('option');
    item.value = option.value;
    item.textContent = option.text;
    select.appendChild(item);
  }
  select.value = value || (allowInherit ? 'inherit' : 'direct');
}

function normalizeSettingFromRow(row) {
  const mode = row.querySelector('.mode-select').value;
  const inputEl = row.querySelector('.proxy-input');
  const input = inputEl ? inputEl.value.trim() : '';
  return makeSetting(mode, mode === 'proxy' ? input : '');
}

async function save() {
  await browser.runtime.sendMessage({ type: 'SAVE_CONFIG', config });
}

function updateProxyPanel(row) {
  const mode = row.querySelector('.mode-select').value;
  const panel = row.querySelector('.proxy-panel');
  if (panel) panel.hidden = mode !== 'proxy';
  const input = row.querySelector('.proxy-input');
  if (input) input.disabled = mode !== 'proxy';
}

function setResult(target, status, message) {
  if (!target) return;
  target.className = `test-result ${status || ''}`.trim();
  target.textContent = message || '';
}

function setPublicStatus(status, message) {
  publicStatus.className = `status-line ${status || ''}`.trim();
  publicStatus.textContent = message || '';
}

function getTimeoutMs() {
  return Number((proxyTimeout && proxyTimeout.value) || 8000);
}

function formatSeconds(ms) {
  return (ms / 1000).toFixed(ms >= 10000 ? 0 : 1).replace('.0', '');
}

function startProgress(target, prefix, timeoutMs) {
  const started = Date.now();
  const tick = () => {
    const elapsed = Date.now() - started;
    const left = Math.max(0, timeoutMs - elapsed);
    const text = `${prefix} ${formatSeconds(elapsed)}s / ${formatSeconds(timeoutMs)}s • timeout em ${formatSeconds(left)}s`;
    if (target === publicStatus) {
      setPublicStatus('loading', text);
    } else {
      setResult(target, 'loading', text);
    }
  };
  tick();
  const timer = setInterval(tick, 500);
  return () => clearInterval(timer);
}

function describeSpeed(response) {
  if (!response) return { className: 'fail', label: browser.i18n.getMessage('speed_fail') || 'falhou' };
  if (response.timedOut || response.status === 'timeout') {
    return { className: 'timeout', label: browser.i18n.getMessage('speed_timeout') || 'timeout / ignorado' };
  }
  if (!response.ok) {
    return { className: 'fail', label: response.ignored ? (browser.i18n.getMessage('speed_ignored') || 'ignorado') : (browser.i18n.getMessage('speed_fail') || 'falhou') };
  }
  if (response.speed === 'fast') return { className: 'fast', label: browser.i18n.getMessage('speed_fast') || 'rápido' };
  if (response.speed === 'medium') return { className: 'medium', label: browser.i18n.getMessage('speed_medium') || 'médio' };
  if (response.speed === 'slow') return { className: 'slow', label: browser.i18n.getMessage('speed_slow') || 'lento' };
  if (response.ms && response.ms <= 2000) return { className: 'fast', label: browser.i18n.getMessage('speed_fast') || 'rápido' };
  if (response.ms && response.ms <= 5000) return { className: 'medium', label: browser.i18n.getMessage('speed_medium') || 'médio' };
  return { className: 'slow', label: browser.i18n.getMessage('speed_slow') || 'lento' };
}

function showProgressPanel() {
  if (testProgressPanel) testProgressPanel.hidden = false;
}

function hideProgressPanel() {
  if (testProgressPanel) testProgressPanel.hidden = true;
}

function resetProgressPanel(total) {
  showProgressPanel();
  progressLog.textContent = '';
  progressBarFill.style.width = '0%';
  progressSummary.textContent = browser.i18n.getMessage('testPreparing', [String(total)]) || `Preparando ${total} proxies...`;
  currentProxy.textContent = browser.i18n.getMessage('testWaiting') || 'Aguardando início dos testes...';
}

function updateProgressPanel(done, total, ok, failed, activeText = '') {
  const percent = total ? Math.round((done / total) * 100) : 0;
  progressBarFill.style.width = `${percent}%`;
  progressSummary.textContent = browser.i18n.getMessage('testProgressSummary', [String(done), String(total), String(ok), String(failed)]) || `${done}/${total} testados • ${ok} OK • ${failed} ignorados`;
  if (activeText) currentProxy.textContent = activeText;
}

function addProgressLog(proxyText, response) {
  const speed = describeSpeed(response);
  const line = document.createElement('div');
  line.className = 'log-line';

  const proxy = document.createElement('div');
  proxy.className = 'log-proxy';
  proxy.textContent = proxyText || '';

  const status = document.createElement('div');
  status.className = `log-status ${speed.className}`;
  const time = response && response.ms ? ` ${response.ms}ms` : '';
  status.textContent = response && response.ok
    ? `${speed.label}${time}`
    : `${speed.label}`;

  line.append(proxy, status);
  progressLog.prepend(line);

  while (progressLog.children.length > 40) {
    progressLog.removeChild(progressLog.lastChild);
  }
}

async function testProxyQueue(proxies, options) {
  const queue = proxies.map(item => String(item || '').trim()).filter(Boolean);
  const total = queue.length;
  const concurrency = Math.max(1, Math.min(20, Number(options.concurrency || 2)));
  const keep = Math.max(1, Math.min(50, Number(options.keep || 5)));
  const timeoutMs = Math.max(3000, Math.min(20000, Number(options.timeoutMs || 8000)));

  resetProgressPanel(total);

  const results = [];
  let nextIndex = 0;
  let done = 0;
  let ok = 0;
  let failed = 0;

  async function worker(workerId) {
    while (nextIndex < queue.length) {
      const index = nextIndex++;
      const input = queue[index];

      const activeMsg = browser.i18n.getMessage('testingActive', [String(index + 1), String(total), input]) || `Testando ${index + 1}/${total}: ${input}`;
      updateProgressPanel(done, total, ok, failed, activeMsg);
      const response = await browser.runtime.sendMessage({
        type: 'TEST_PROXY',
        setting: { mode: 'proxy', input },
        options: { fullHttps: true, timeoutMs }
      });

      const item = {
        input,
        ok: !!response.ok,
        status: response.status || (response.ok ? 'success' : 'fail'),
        message: response.message || '',
        ms: response.ms || 0,
        ip: response.ip || '',
        loc: response.loc || '',
        colo: response.colo || '',
        error: response.error || '',
        timedOut: !!response.timedOut,
        ignored: !!response.ignored,
        speed: response.speed || '',
        speedLabel: response.speedLabel || ''
      };

      results.push(item);
      if (item.ok) ok += 1;
      else failed += 1;
      done += 1;

      addProgressLog(input, item);
      const lastMsg = browser.i18n.getMessage('testLast', [input]) || `Último: ${input}`;
      updateProgressPanel(done, total, ok, failed, lastMsg);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, (_, i) => worker(i + 1)));

  const sorted = results.sort((a, b) => {
    if (a.ok !== b.ok) return a.ok ? -1 : 1;
    return (a.ms || 999999) - (b.ms || 999999);
  });

  return {
    ok: true,
    tested: results.length,
    success: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    fast: sorted.filter(item => item.ok).slice(0, keep),
    results: sorted
  };
}

async function testFromRow(row) {
  const result = row.querySelector('.test-result');
  const button = row.querySelector('.test-button');
  const setting = normalizeSettingFromRow(row);
  const timeoutMs = getTimeoutMs();

  if (button) button.disabled = true;
  const stopProgress = startProgress(result, browser.i18n.getMessage('txtTesting', ['...', '...']) || 'Testando HTTPS...', timeoutMs);

  try {
    const response = await browser.runtime.sendMessage({
      type: 'TEST_PROXY',
      setting,
      options: { fullHttps: true, timeoutMs }
    });

    stopProgress();

    const speed = describeSpeed(response);
    const labelUpper = speed.label.toUpperCase();
    const msgVal = response.message || '';
    const msVal = response.ms ? `${response.ms}` : '?';
    const limitVal = `${formatSeconds(timeoutMs)}`;
    const ipVal = response.ip || '';
    const locVal = response.loc || '';

    const message = browser.i18n.getMessage('testResultText', [labelUpper, msgVal, msVal, limitVal, ipVal, locVal]) ||
                    `${labelUpper}: ${msgVal} • ${msVal} ms • limite ${limitVal}s • IP: ${ipVal} (${locVal})`.trim();
    setResult(result, speed.className, message);
  } catch (error) {
    stopProgress();
    setResult(result, 'fail', browser.i18n.getMessage('testErrorText') || 'Falha ao testar.');
  } finally {
    if (button) button.disabled = false;
  }
}

function renderProfile(profile) {
  const node = profileTemplate.content.cloneNode(true);
  const row = node.querySelector('.config-row');
  const mark = node.querySelector('.identity-mark');
  const nameEl = node.querySelector('.profile-name');
  const detailEl = node.querySelector('.profile-detail');
  const select = node.querySelector('.mode-select');
  const input = node.querySelector('.proxy-input');
  const testButton = node.querySelector('.test-button');

  const setting = config.profiles[profile.id] || makeSetting(profile.id === '__default' ? 'direct' : 'inherit');

  row.dataset.storeId = profile.id;
  mark.dataset.letter = profile.letter;
  nameEl.textContent = profile.name;
  detailEl.textContent = profile.detail;
  fillModeSelect(select, setting.mode, profile.id !== '__default');
  input.value = setting.input || '';
  updateProxyPanel(row);

  // Localize template elements
  const placeholders = row.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholders) {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = browser.i18n.getMessage(key);
    if (translation) el.placeholder = translation;
  }
  const testBtnLocal = row.querySelector('[data-i18n="ruleTestBtn"]');
  if (testBtnLocal) testBtnLocal.textContent = browser.i18n.getMessage('ruleTestBtn') || 'Testar';

  select.addEventListener('change', async () => {
    updateProxyPanel(row);
    config.profiles[profile.id] = normalizeSettingFromRow(row);
    await save();
  });

  input.addEventListener('change', async () => {
    config.profiles[profile.id] = normalizeSettingFromRow(row);
    await save();
  });

  testButton.addEventListener('click', async () => {
    config.profiles[profile.id] = normalizeSettingFromRow(row);
    await save();
    await testFromRow(row);
  });

  profilesEl.appendChild(node);
}

function settingEditor(setting, allowInherit = true) {
  const wrap = document.createElement('div');
  wrap.className = 'setting-box';
  wrap.innerHTML = `
    <div class="setting-grid">
      <div class="setting-head">
        <div class="setting-title" data-i18n="ruleSettingTitle">${browser.i18n.getMessage('ruleSettingTitle') || 'Ação da regra'}</div>
        <div class="setting-desc" data-i18n="ruleSettingDesc">${browser.i18n.getMessage('ruleSettingDesc') || 'Defina o que fazer quando o site combinar.'}</div>
      </div>
      <select class="mode-select"></select>
    </div>
    <div class="proxy-panel" hidden>
      <input class="proxy-input" type="text" data-i18n-placeholder="ruleInputPlaceholder" placeholder="${browser.i18n.getMessage('ruleInputPlaceholder') || 'SOCKS, HTTP ou HTTPS...'}">
      <button class="test-button secondary" type="button" data-i18n="ruleTestBtn">${browser.i18n.getMessage('ruleTestBtn') || 'Testar'}</button>
      <span class="test-result" role="status"></span>
    </div>`;

  const elements = wrap.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const translation = browser.i18n.getMessage(key);
    if (translation) el.textContent = translation;
  }
  const placeholders = wrap.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholders) {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = browser.i18n.getMessage(key);
    if (translation) el.placeholder = translation;
  }

  fillModeSelect(wrap.querySelector('.mode-select'), setting.mode || 'proxy', allowInherit);
  wrap.querySelector('.proxy-input').value = setting.input || '';
  updateProxyPanel(wrap);
  wrap.querySelector('.mode-select').addEventListener('change', () => updateProxyPanel(wrap));
  wrap.querySelector('.test-button').addEventListener('click', () => testFromRow(wrap));
  return wrap;
}

function readSettingEditor(editor) {
  return normalizeSettingFromRow(editor);
}

function fillStoreSelect(select, selected) {
  select.textContent = '';
  for (const choice of storeChoices) {
    const option = document.createElement('option');
    option.value = choice.id;
    option.textContent = choice.name;
    select.appendChild(option);
  }
  select.value = selected || '*';
}

function renderRule(rule, index) {
  const node = ruleTemplate.content.cloneNode(true);
  const card = node.querySelector('.rule-card');
  const enabled = node.querySelector('.rule-enabled');
  const pattern = node.querySelector('.rule-pattern');
  const store = node.querySelector('.rule-store');
  const settingWrap = node.querySelector('.rule-setting');
  const deleteButton = node.querySelector('.delete-rule');
  const editor = settingEditor(rule.setting || makeSetting('proxy'), false);

  enabled.checked = rule.enabled !== false;
  pattern.value = rule.pattern || '';
  fillStoreSelect(store, rule.storeId || '*');
  settingWrap.appendChild(editor);

  // Translate template elements
  const placeholders = card.querySelectorAll('[data-i18n-placeholder]');
  for (const el of placeholders) {
    const key = el.getAttribute('data-i18n-placeholder');
    const translation = browser.i18n.getMessage(key);
    if (translation) el.placeholder = translation;
  }
  const elements = card.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const translation = browser.i18n.getMessage(key);
    if (translation) el.textContent = translation;
  }

  async function persistRule() {
    config.rules[index] = {
      id: rule.id,
      enabled: enabled.checked,
      pattern: pattern.value.trim(),
      storeId: store.value,
      setting: readSettingEditor(editor)
    };
    await save();
  }

  enabled.addEventListener('change', persistRule);
  pattern.addEventListener('change', persistRule);
  store.addEventListener('change', persistRule);
  editor.addEventListener('change', persistRule);

  deleteButton.addEventListener('click', async () => {
    config.rules.splice(index, 1);
    await save();
    renderAll();
  });

  rulesEl.appendChild(card);
}

function buildProfiles() {
  const common = [
    {
      id: '__default',
      name: browser.i18n.getMessage('ruleDefaultText') || 'Padrão da extensão',
      detail: browser.i18n.getMessage('ruleDefaultDesc') || 'Usado quando nada mais combinar.',
      letter: 'P'
    },
    {
      id: 'firefox-default',
      name: browser.i18n.getMessage('ruleNoContainer') || 'Sem container',
      detail: browser.i18n.getMessage('ruleNoContainerDesc') || 'Abas normais fora dos Containers.',
      letter: 'S'
    },
    {
      id: 'firefox-private',
      name: browser.i18n.getMessage('rulePrivate') || 'Janela privada',
      detail: browser.i18n.getMessage('rulePrivateDesc') || 'Funciona se a extensão estiver liberada para janelas privadas.',
      letter: 'J'
    },
    {
      id: 'firefox-unknown',
      name: browser.i18n.getMessage('ruleUnknown') || 'Requisições internas/desconhecidas',
      detail: browser.i18n.getMessage('ruleUnknownDesc') || 'Downloads internos, extensões ou abas sem identificação.',
      letter: '?'
    }
  ];

  const containerProfiles = identities.map(identity => ({
    id: identity.cookieStoreId,
    name: identity.name,
    detail: `${browser.i18n.getMessage('ruleContainerPrefix') || 'Container Firefox'} • ${identity.cookieStoreId}`,
    letter: identity.name.trim().slice(0, 1).toUpperCase() || 'C'
  }));

  return [...common, ...containerProfiles];
}

function renderSavedProxies() {
  fastProxyList.textContent = '';
  const items = lastFastResults.length ? lastFastResults : (config.savedProxies || []);

  if (!items.length) {
    const empty = document.createElement('p');
    empty.textContent = browser.i18n.getMessage('noFastSaved') || 'Nenhum proxy rápido salvo ainda.';
    fastProxyList.appendChild(empty);
    return;
  }

  for (const item of items.slice(0, 20)) {
    const row = document.createElement('div');
    row.className = 'fast-item';

    const proxy = document.createElement('div');
    proxy.className = 'fast-proxy';
    proxy.textContent = item.input || '';

    const speed = describeSpeed(item);
    const meta = document.createElement('div');
    meta.className = `fast-meta ${speed.className}`.trim();
    meta.textContent = item.ok === false
      ? speed.label
      : `${speed.label} • ${item.ms || '?'} ms${item.loc ? ` • ${item.loc}` : ''}`;

    const use = document.createElement('button');
    use.className = 'secondary';
    use.type = 'button';
    use.textContent = browser.i18n.getMessage('useBtn') || 'Usar';
    use.addEventListener('click', async () => {
      await applyProxyToTarget(item.input);
    });

    row.append(proxy, meta, use);
    fastProxyList.appendChild(row);
  }
}

async function applyProxyToTarget(input) {
  const target = applyFastTarget.value || '__default';
  if (!input) {
    setPublicStatus('fail', browser.i18n.getMessage('applyNoProxy') || 'Nenhum proxy rápido disponível para aplicar.');
    return;
  }
  config.profiles[target] = makeSetting('proxy', input);
  await save();
  
  const targetName = storeChoices.find(x => x.id === target)?.name || target;
  setPublicStatus('success', browser.i18n.getMessage('applySuccess', [targetName]) || `Proxy aplicado.`);
  renderAll();
}

async function fetchAndTestPublicProxies() {
  fetchFastButton.disabled = true;
  applyBestProxy.disabled = true;
  lastFastResults = [];
  renderSavedProxies();

  const timeoutMs = getTimeoutMs();

  try {
    const sourceId    = proxySource ? proxySource.value : 'proxyscrape_socks5';
    const limit       = Number(fetchLimit.value);
    const concurrency = Number(testConcurrency.value);
    const keep        = Number(keepFast.value);

    setPublicStatus('loading', browser.i18n.getMessage('testLoadingSource', [String(limit)]) || `Buscando ${limit} proxies...`);
    resetProgressPanel(limit);
    currentProxy.textContent = browser.i18n.getMessage('testLoadingSourceList') || `Carregando lista da fonte...`;

    const fetched = await browser.runtime.sendMessage({
      type: 'FETCH_PUBLIC_PROXIES',
      sourceId,
      limit
    });

    if (!fetched || !fetched.proxies || !fetched.proxies.length) {
      setPublicStatus('fail', browser.i18n.getMessage('testNoProxiesReturned') || 'Nenhum proxy retornado.');
      currentProxy.textContent = browser.i18n.getMessage('testNoProxiesReturnedText') || 'Nenhum proxy retornado.';
      return;
    }

    const startTestMsg = browser.i18n.getMessage('testTestingProxiesTimeout', [String(fetched.proxies.length), formatSeconds(timeoutMs)]) || 'Testando...';
    setPublicStatus('loading', startTestMsg);
    const tested = await testProxyQueue(fetched.proxies, { concurrency, keep, timeoutMs });

    const fast = (tested.fast || []).map(item => ({ ...item, source: 'ProxyScrape' }));
    lastFastResults = fast.length ? fast : (tested.results || []).slice(0, keep);

    if (fast.length) {
      const saved = await browser.runtime.sendMessage({
        type: 'SAVE_FAST_PROXIES',
        items: fast
      });
      config = mergeConfig({ ...config, savedProxies: saved.savedProxies || config.savedProxies });
      const best = fast[0];
      const bestSpeed = describeSpeed(best);
      
      const successText = browser.i18n.getMessage('testBestResult', [String(tested.success), String(tested.tested), String(tested.failed), bestSpeed.label, String(best.ms)]) || 'Concluído.';
      setPublicStatus(bestSpeed.className, successText);
      currentProxy.textContent = browser.i18n.getMessage('testBestProxyText', [best.input, String(best.ms)]) || `Melhor proxy: ${best.input}`;
    } else {
      const failText = browser.i18n.getMessage('testAllFailed', [formatSeconds(timeoutMs), String(tested.tested), String(tested.failed)]) || 'Todos falharam.';
      setPublicStatus('fail', failText);
      currentProxy.textContent = browser.i18n.getMessage('testAllFailedText') || 'Todos falharam.';
    }

    renderSavedProxies();
  } catch (error) {
    const errorText = browser.i18n.getMessage('testError', [error && error.message ? error.message : 'error']) || 'Erro.';
    setPublicStatus('fail', errorText);
    if (currentProxy) currentProxy.textContent = browser.i18n.getMessage('testErrorText') || 'Erro.';
  } finally {
    fetchFastButton.disabled = false;
    applyBestProxy.disabled = false;
  }
}

function renderPreferences() {
  if (!config.preferences) return;
  if (prefProxyDns) prefProxyDns.checked = !!config.preferences.proxyDnsForSocks;
  if (prefBlockInvalid) prefBlockInvalid.checked = !!config.preferences.blockInvalidProxy;
}

async function savePreference(key, value) {
  config.preferences = { ...config.preferences, [key]: value };
  await save();
}

function renderAll() {
  profilesEl.textContent = '';
  rulesEl.textContent = '';

  const profiles = buildProfiles();
  storeChoices = [
    { id: '*', name: browser.i18n.getMessage('ruleAllContexts') || 'Todos os contextos' },
    ...profiles.map(profile => ({ id: profile.id, name: profile.name }))
  ];

  const applyChoices = profiles.map(profile => ({ id: profile.id, name: profile.name }));
  applyFastTarget.textContent = '';
  for (const choice of applyChoices) {
    const option = document.createElement('option');
    option.value = choice.id;
    option.textContent = choice.name;
    applyFastTarget.appendChild(option);
  }

  profiles.forEach(renderProfile);
  config.rules.forEach(renderRule);

  if (!config.rules.length) {
    const empty = document.createElement('p');
    empty.textContent = browser.i18n.getMessage('noRules') || 'Nenhuma regra por site ainda. Clique em “Adicionar”.';
    rulesEl.appendChild(empty);
  }

  renderSavedProxies();
  renderPreferences();
}


async function load() {
  localizeHtmlPage();
  const response = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });
  config = mergeConfig(response);
  identities = await browser.contextualIdentities.query({});
  renderAll();
  await loadProxySources();
}

// ── Carregar fontes de proxies no dropdown ──────────────────────────────────
async function loadProxySources() {
  if (!proxySource) return;
  try {
    const sources = await browser.runtime.sendMessage({ type: 'GET_PROXY_SOURCES' });
    if (!Array.isArray(sources) || !sources.length) return;
    proxySource.textContent = '';
    // Agrupar por provedor
    const groups = {};
    for (const s of sources) {
      const provider = s.name.split(' — ')[0];
      if (!groups[provider]) groups[provider] = [];
      groups[provider].push(s);
    }
    for (const [provider, items] of Object.entries(groups)) {
      const grp = document.createElement('optgroup');
      grp.label = provider;
      for (const item of items) {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = item.name;
        grp.appendChild(opt);
      }
      proxySource.appendChild(grp);
    }
  } catch (error) {
    console.warn('ProxyFlow: não foi possível carregar fontes:', error);
  }
}

// ── TXT Import — normalizar linhas ─────────────────────────────────────────
function normalizeTxtLines(text, defaultProtocol = 'socks5') {
  const proto = String(defaultProtocol || 'socks5').toLowerCase();
  const seen = new Set();
  return String(text || '')
    .split(/[\r\n,;|]+/)
    .map(line => line.trim())
    .filter(line => {
      if (!line || line.startsWith('#')) return false;
      // Aceita qualquer linha que contiver host:port
      return /\d+\.\d+\.\d+\.\d+:\d+/.test(line) ||
             /[a-zA-Z0-9.-]+:\d+/.test(line);
    })
    .map(line => {
      let rest = line;
      let protoPart = '';
      if (line.includes('://')) {
        const parts = line.split('://');
        protoPart = parts[0].toLowerCase() + '://';
        rest = parts.slice(1).join('://');
      } else {
        protoPart = `${proto}://`;
      }

      // Se não contiver '@' mas tiver 3 dois-pontos (ex: host:port:user:pass), normalizar
      if (!rest.includes('@')) {
        const colonParts = rest.split(':');
        if (colonParts.length === 4) {
          const host = colonParts[0];
          const port = colonParts[1];
          const user = colonParts[2];
          const pass = colonParts[3];
          rest = `${user}:${pass}@${host}:${port}`;
        }
      }

      let finalUrl = protoPart + rest;
      // Normalizar protocolo socks -> socks5
      finalUrl = finalUrl.replace(/^socks:\/\//i, 'socks5://');
      return finalUrl;
    })
    .filter(line => {
      const key = line.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function setTxtStatus(status, message) {
  if (!txtParseStatus) return;
  txtParseStatus.className = `status-line ${status || ''}`.trim();
  txtParseStatus.textContent = message || '';
}

function renderTxtPreview(proxies) {
  if (!txtPreviewList) return;
  if (!proxies.length) {
    txtPreviewList.hidden = true;
    return;
  }
  txtPreviewList.hidden = false;
  txtPreviewList.textContent = '';

  const header = document.createElement('div');
  header.className = 'txt-preview-header';
  header.textContent = `${proxies.length} proxies detectados:`;
  txtPreviewList.appendChild(header);

  const list = document.createElement('div');
  list.className = 'txt-preview-items';
  for (const proxy of proxies.slice(0, 30)) {
    const item = document.createElement('div');
    item.className = 'txt-preview-item';
    const proto = proxy.split('://')[0] || '';
    const addr = proxy.split('://')[1] || proxy;
    
    const protoSpan = document.createElement('span');
    protoSpan.className = `txt-proto ${proto}`;
    protoSpan.textContent = proto.toUpperCase();

    const addrSpan = document.createElement('span');
    addrSpan.className = 'txt-addr';
    addrSpan.textContent = addr;

    item.append(protoSpan, addrSpan);
    list.appendChild(item);
  }
  if (proxies.length > 30) {
    const more = document.createElement('div');
    more.className = 'txt-preview-more';
    more.textContent = `+ ${proxies.length - 30} mais...`;
    list.appendChild(more);
  }
  txtPreviewList.appendChild(list);
}

function handleParseTxt() {
  const text = txtProxyPaste ? txtProxyPaste.value : '';
  const proto = txtDefaultProto ? txtDefaultProto.value : 'socks5';
  if (!text.trim()) {
    setTxtStatus('fail', browser.i18n.getMessage('txtNoText') || 'Nenhum texto para analisar.');
    return;
  }
  parsedTxtProxies = normalizeTxtLines(text, proto);
  if (!parsedTxtProxies.length) {
    setTxtStatus('fail', browser.i18n.getMessage('txtNoProxies') || 'Nenhum proxy válido encontrado.');
    if (testTxtBtn) testTxtBtn.disabled = true;
    renderTxtPreview([]);
    return;
  }
  const parsedMsg = browser.i18n.getMessage('txtParsedSuccess', [String(parsedTxtProxies.length)]) || `Concluído.`;
  setTxtStatus('success', parsedMsg);
  if (testTxtBtn) testTxtBtn.disabled = false;
  renderTxtPreview(parsedTxtProxies);
}

async function handleTestTxt() {
  if (!parsedTxtProxies.length) {
    setTxtStatus('fail', browser.i18n.getMessage('txtNoProxies') || 'Nenhum proxy para testar.');
    return;
  }

  if (testTxtBtn) testTxtBtn.disabled = true;
  if (parseTxtBtn) parseTxtBtn.disabled = true;

  const timeoutMs = getTimeoutMs();
  const concurrency = Number(testConcurrency ? testConcurrency.value : 5);
  const keep = Number(keepFast ? keepFast.value : 5);

  const startTestMsg = browser.i18n.getMessage('txtTesting', [String(parsedTxtProxies.length), formatSeconds(timeoutMs)]) || 'Testando...';
  setTxtStatus('loading', startTestMsg);

  try {
    const tested = await testProxyQueue(parsedTxtProxies, { concurrency, keep, timeoutMs });
    const fast = (tested.fast || []).map(item => ({ ...item, source: 'TXT Import' }));
    lastFastResults = fast.length ? fast : (tested.results || []).slice(0, keep);

    if (fast.length) {
      const saved = await browser.runtime.sendMessage({ type: 'SAVE_FAST_PROXIES', items: fast });
      config = mergeConfig({ ...config, savedProxies: saved.savedProxies || config.savedProxies });
      const best = fast[0];
      const bestSpeed = describeSpeed(best);
      
      const successText = browser.i18n.getMessage('txtCompleted', [String(tested.success), String(tested.tested), bestSpeed.label, String(best.ms)]) || 'Concluído.';
      setTxtStatus(bestSpeed.className, successText);
    } else {
      const failText = browser.i18n.getMessage('txtAllFailed', [formatSeconds(timeoutMs), String(tested.tested)]) || 'Todos falharam.';
      setTxtStatus('fail', failText);
    }
    renderSavedProxies();
  } catch (error) {
    setTxtStatus('fail', browser.i18n.getMessage('testError', [error && error.message ? error.message : 'error']) || 'Erro.');
  } finally {
    if (testTxtBtn) testTxtBtn.disabled = false;
    if (parseTxtBtn) parseTxtBtn.disabled = false;
  }
}

// ── Tab switching ───────────────────────────────────────────────────────────
document.querySelectorAll('.tab[data-tab]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.tab;
    document.querySelectorAll('.tab[data-tab]').forEach(t => {
      const isActive = t === btn;
      t.classList.toggle('active', isActive);
      t.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(panel => {
      const isActive = panel.id === `tab-${target}`;
      panel.classList.toggle('active', isActive);
      panel.hidden = !isActive;
    });
  });
});

// ── Bitcoin copy ────────────────────────────────────────────────────────────
const copyBtcBtn      = document.querySelector('#copyBtc');
const copyFeedbackEl  = document.querySelector('#copyFeedback');
if (copyBtcBtn) {
  copyBtcBtn.addEventListener('click', async () => {
    const addr = (document.querySelector('#btcAddress') || {}).textContent || '';
    try {
      await navigator.clipboard.writeText(addr.trim());
      if (copyFeedbackEl) copyFeedbackEl.textContent = browser.i18n.getMessage('copySuccess') || '✅ Endereço copiado!';
    } catch (_) {
      if (copyFeedbackEl) {
        copyFeedbackEl.textContent = browser.i18n.getMessage('copyManual') || 'Selecione e copie manualmente.';
        copyFeedbackEl.style.color = 'var(--c-warning, #f59e0b)';
      }
    }
    if (copyFeedbackEl) setTimeout(() => { copyFeedbackEl.textContent = ''; }, 3000);
  });
}

addRuleButton.addEventListener('click', async () => {
  config.rules.push({
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    enabled: true,
    pattern: '',
    storeId: '*',
    setting: makeSetting('proxy')
  });
  await save();
  renderAll();
});

reloadButton.addEventListener('click', load);
fetchFastButton.addEventListener('click', fetchAndTestPublicProxies);
if (closeProgressPanel) closeProgressPanel.addEventListener('click', hideProgressPanel);

applyBestProxy.addEventListener('click', async () => {
  const best = (config.savedProxies && config.savedProxies[0]) || lastFastResults[0];
  await applyProxyToTarget(best && best.input);
});

if (prefProxyDns) {
  prefProxyDns.addEventListener('change', () => savePreference('proxyDnsForSocks', prefProxyDns.checked));
}
if (prefBlockInvalid) {
  prefBlockInvalid.addEventListener('change', () => savePreference('blockInvalidProxy', prefBlockInvalid.checked));
}

// TXT import listeners
if (importTxtFile) {
  importTxtFile.addEventListener('change', async () => {
    const file = importTxtFile.files && importTxtFile.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (txtProxyPaste) txtProxyPaste.value = text;
      handleParseTxt();
    } catch (_) {
      setTxtStatus('fail', browser.i18n.getMessage('txtReadError') || 'Não foi possível ler o arquivo.');
    } finally {
      importTxtFile.value = '';
    }
  });
}
if (parseTxtBtn)  parseTxtBtn.addEventListener('click', handleParseTxt);
if (testTxtBtn)   testTxtBtn.addEventListener('click', handleTestTxt);
if (clearTxtBtn) {
  clearTxtBtn.addEventListener('click', () => {
    if (txtProxyPaste) txtProxyPaste.value = '';
    parsedTxtProxies = [];
    setTxtStatus('', '');
    renderTxtPreview([]);
    if (testTxtBtn) testTxtBtn.disabled = true;
  });
}

exportButton.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'proxyflow-containers-config.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

importInput.addEventListener('change', async () => {
  const file = importInput.files && importInput.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    config = mergeConfig(JSON.parse(text));
    await save();
    renderAll();
  } catch (error) {
    alert(browser.i18n.getMessage('jsonImportError') || 'Não foi possível importar o JSON.');
  } finally {
    importInput.value = '';
  }
});

load().catch(error => {
  console.error(error);
  profilesEl.textContent = browser.i18n.getMessage('configError') || 'Erro ao carregar configurações.';
});
