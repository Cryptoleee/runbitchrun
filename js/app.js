import { showToast } from './ui.js';

// ── App State ─────────────────────────────────────────

export const state = {
  user: null,
  profile: null,
  friends: []
};

export function setUser(user, profile) {
  state.user = user;
  state.profile = profile;
}

// ── Page History ──────────────────────────────────────

const pageHistory = [];
const HIDE_NAV_PAGES = ['run', 'summary'];

// ── Navigation ────────────────────────────────────────

export function navigateTo(page, opts = {}) {
  const currentPage = document.querySelector('.page.active');
  const nextPage = document.getElementById(`page-${page}`);
  if (!nextPage) return;

  if (currentPage) {
    const currentId = currentPage.id.replace('page-', '');
    if (!opts.skipHistory) {
      pageHistory.push(currentId);
    }
    currentPage.classList.remove('active');
  }

  nextPage.classList.add('active');
  nextPage.classList.remove('page-enter');
  requestAnimationFrame(() => {
    nextPage.classList.add('page-enter');
  });

  updateNavHighlight(page);

  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.style.display = HIDE_NAV_PAGES.includes(page) ? 'none' : '';
  }

  const gpsBadge = document.getElementById('gps-badge');
  if (gpsBadge) {
    gpsBadge.style.display = page === 'run' ? 'flex' : 'none';
  }

  window.dispatchEvent(new CustomEvent('page:enter', { detail: { page } }));
}

export function goBack() {
  if (pageHistory.length === 0) return;
  const previous = pageHistory.pop();
  navigateTo(previous, { skipHistory: true });
}

export function updateNavHighlight(page) {
  const navButtons = document.querySelectorAll('#bottom-nav [data-page]');
  navButtons.forEach((btn) => {
    const btnPage = btn.dataset.page;
    const icon = btn.querySelector('.material-symbols-outlined');
    const label = btn.querySelector('span:not(.material-symbols-outlined)');

    if (btnPage === page) {
      btn.style.color = '#B8FF00';
      btn.style.transform = 'scale(1.1)';
      btn.style.filter = 'drop-shadow(0 0 8px rgba(184, 255, 0, 0.4))';
      if (icon) icon.style.fontVariationSettings = "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24";
    } else {
      btn.style.color = '#4A4A4A';
      btn.style.transform = 'scale(1)';
      btn.style.filter = 'none';
      if (icon) icon.style.fontVariationSettings = "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24";
    }
  });
}

// ── Install Banners ───────────────────────────────────

let deferredInstallPrompt = null;

export function showInstallBanner(prompt) {
  deferredInstallPrompt = prompt;
  const banner = document.getElementById('install-banner');
  if (!banner) return;
  banner.style.display = 'flex';

  const installBtn = banner.querySelector('[data-install]');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      banner.style.display = 'none';
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('App installed!', 'success');
        }
        deferredInstallPrompt = null;
      }
    }, { once: true });
  }

  const dismissBtn = banner.querySelector('[data-dismiss]');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    }, { once: true });
  }
}

export function showIOSInstallBanner() {
  const banner = document.getElementById('ios-install-banner');
  if (!banner) return;
  banner.style.display = 'flex';

  const dismissBtn = banner.querySelector('[data-dismiss]');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      banner.style.display = 'none';
    }, { once: true });
  }
}

// ── App Init ──────────────────────────────────────────

export async function initApp() {
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' });
      reg.update();
    } catch (err) {
      console.warn('SW registration failed:', err);
    }
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    showInstallBanner(e);
  });

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !isStandalone) {
    const visitCount = parseInt(localStorage.getItem('rbr_visit_count') || '0', 10) + 1;
    localStorage.setItem('rbr_visit_count', String(visitCount));
    if (visitCount >= 2) {
      showIOSInstallBanner();
    }
  }

  const navButtons = document.querySelectorAll('#bottom-nav [data-page]');
  navButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      navigateTo(btn.dataset.page);
    });
  });
}
