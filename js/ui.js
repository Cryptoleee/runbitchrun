// ── Unit Conversions ──────────────────────────────────

export function kmToMi(km) {
  return km * 0.621371;
}

export function miToKm(mi) {
  return mi / 0.621371;
}

export function kgToLbs(kg) {
  return kg * 2.20462;
}

export function lbsToKg(lbs) {
  return lbs / 2.20462;
}

export function formatDistance(km, units = 'metric') {
  if (units === 'imperial') {
    return { value: kmToMi(km).toFixed(2), unit: 'MI' };
  }
  return { value: km.toFixed(2), unit: 'KM' };
}

export function formatPace(secsPerKm, units = 'metric') {
  let totalSecs = secsPerKm;
  let unit = '/KM';
  if (units === 'imperial') {
    totalSecs = secsPerKm / 0.621371;
    unit = '/MI';
  }
  const mins = Math.floor(totalSecs / 60);
  const secs = Math.round(totalSecs % 60);
  return { value: `${mins}:${String(secs).padStart(2, '0')}`, unit };
}

export function formatDuration(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function formatTimeAgo(date) {
  const now = Date.now();
  const then = date instanceof Date ? date.getTime() : new Date(date).getTime();
  const diffMs = now - then;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  const d = new Date(then);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

// ── Toast Notifications ───────────────────────────────

const TOAST_STYLES = {
  info: 'background:#2b2b2b;color:#fff;',
  success: 'background:#1a3a00;color:#b7fe00;',
  error: 'background:#3a0000;color:#ffb4ab;'
};

export function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.style.cssText = TOAST_STYLES[type] || TOAST_STYLES.info;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Confirmation Dialog ───────────────────────────────

export function showConfirm(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:1000;';

    const card = document.createElement('div');
    card.style.cssText = 'background:#1e1e1e;border-radius:16px;padding:24px;max-width:320px;width:90%;';

    const titleEl = document.createElement('h3');
    titleEl.style.cssText = 'font-size:18px;font-weight:600;color:#fff;margin-bottom:8px;';
    titleEl.textContent = title;

    const msgEl = document.createElement('p');
    msgEl.style.cssText = 'font-size:14px;color:#aaa;margin-bottom:24px;line-height:1.5;';
    msgEl.textContent = message;

    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;justify-content:flex-end;';

    const cancelBtn = document.createElement('button');
    cancelBtn.style.cssText = 'padding:10px 20px;border-radius:12px;border:1px solid #333;background:transparent;color:#fff;font-size:14px;cursor:pointer;';
    cancelBtn.textContent = 'Cancel';

    const confirmBtn = document.createElement('button');
    confirmBtn.style.cssText = 'padding:10px 20px;border-radius:12px;border:none;background:#b7fe00;color:#0e0e0e;font-size:14px;font-weight:600;cursor:pointer;';
    confirmBtn.textContent = 'Confirm';

    btnRow.append(cancelBtn, confirmBtn);
    card.append(titleEl, msgEl, btnRow);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    function cleanup(result) {
      overlay.remove();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => cleanup(false));
    confirmBtn.addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });
  });
}

// ── Image Resize ──────────────────────────────────────

export function resizeImage(file, maxWidth, maxHeight) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxWidth) {
        height = height * (maxWidth / width);
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = width * (maxHeight / height);
        height = maxHeight;
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width);
      canvas.height = Math.round(height);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

export function resizeImageSquare(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { width, height } = img;
      const cropSize = Math.min(width, height);
      const sx = (width - cropSize) / 2;
      const sy = (height - cropSize) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, size, size);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.85);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to load image'));
    };
    img.src = url;
  });
}

// ── Bottom Sheet ──────────────────────────────────────

let activeSheet = null;
let activeOverlay = null;

export function openBottomSheet(contentHTML) {
  closeBottomSheet();

  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  document.body.appendChild(overlay);

  const sheet = document.createElement('div');
  sheet.className = 'bottom-sheet';
  sheet.innerHTML = contentHTML;
  document.body.appendChild(sheet);

  activeSheet = sheet;
  activeOverlay = overlay;

  requestAnimationFrame(() => {
    overlay.classList.add('active');
    sheet.classList.add('active');
  });

  overlay.addEventListener('click', closeBottomSheet);

  return sheet;
}

export function closeBottomSheet() {
  if (!activeSheet) return;

  const sheet = activeSheet;
  const overlay = activeOverlay;
  activeSheet = null;
  activeOverlay = null;

  sheet.classList.remove('active');
  overlay.classList.remove('active');

  setTimeout(() => {
    sheet.remove();
    overlay.remove();
  }, 300);
}

// ── Misc ──────────────────────────────────────────────

export function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Yo';
  if (hour < 12) return 'Rise & grind';
  if (hour < 17) return 'Sup';
  if (hour < 21) return 'Aight';
  return 'Yo';
}
