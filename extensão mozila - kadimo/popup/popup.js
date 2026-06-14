'use strict';

const statusBadge = document.querySelector('#statusBadge');
const statusText  = document.querySelector('#statusText');

function localizeHtmlPage() {
  const elements = document.querySelectorAll('[data-i18n]');
  for (const el of elements) {
    const key = el.getAttribute('data-i18n');
    const translation = browser.i18n.getMessage(key);
    if (translation) {
      el.textContent = translation;
    }
  }
}

const MODE_LABELS = {
  direct:  browser.i18n.getMessage('mode_direct') || 'Conexão direta',
  proxy:   browser.i18n.getMessage('mode_proxy') || 'Proxy manual',
  block:   browser.i18n.getMessage('mode_block') || 'Bloqueado',
  firefox: browser.i18n.getMessage('mode_firefox') || 'Usando Firefox',
  inherit: browser.i18n.getMessage('mode_inherit') || 'Herdando padrão'
};

async function showCurrentStatus() {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const config = await browser.runtime.sendMessage({ type: 'GET_CONFIG' });

    let storeId = 'firefox-default';
    if (tab) {
      if (tab.cookieStoreId === 'firefox-default' && tab.id === -1) storeId = 'firefox-unknown';
      else if (tab.cookieStoreId) storeId = tab.cookieStoreId;
      else if (tab.incognito) storeId = 'firefox-private';
    }

    const profile = (config && config.profiles && config.profiles[storeId]) || { mode: 'inherit' };
    const resolved = profile.mode === 'inherit'
      ? (config && config.profiles && config.profiles['__default']) || { mode: 'direct' }
      : profile;

    const mode   = resolved.mode || 'direct';
    const label  = MODE_LABELS[mode] || mode;
    const detail = mode === 'proxy' && resolved.proxy
      ? ` — ${resolved.proxy.host}:${resolved.proxy.port}`
      : '';

    statusBadge.className = `status-badge ${mode}`;
    statusText.textContent = label + detail;
  } catch (_) {
    statusText.textContent = browser.i18n.getMessage('popupError') || 'Não foi possível obter o status.';
  }
}

document.querySelector('#openOptions').addEventListener('click', async () => {
  await browser.runtime.openOptionsPage();
  window.close();
});

// Initialize i18n and display status
localizeHtmlPage();
showCurrentStatus();
