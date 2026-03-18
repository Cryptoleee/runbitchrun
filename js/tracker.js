import {
  GPS_OPTIONS,
  AUTO_PAUSE_SPEED_THRESHOLD,
  AUTO_PAUSE_DELAY_MS,
  AUTO_RESUME_SPEED_THRESHOLD,
  DEFAULT_WEIGHT_KG
} from './config.js';
import { state } from './app.js';

// ── Module-level state (not exported) ────────────────

let watchId = null;
let timerInterval = null;
let wakeLock = null;

let run = {};
let onUpdateCallback = null;

// ── Helpers ──────────────────────────────────────────

function toRad(deg) {
  return deg * (Math.PI / 180);
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// ── Run state management ─────────────────────────────

function resetRun() {
  run = {
    route: [],
    splits: [],
    startTime: null,
    elapsedSeconds: 0,
    distance: 0,
    currentSegment: 0,
    isPaused: false,
    isAutoPaused: false,
    autoPauseTimer: null,
    lastPosition: null,
    elevationReadings: [],
    elevationGain: 0,
    calories: 0,
    splitStartTime: 0,
    splitStartDist: 0
  };
}

// ── Pace / elevation / calories ──────────────────────

function getCurrentPace() {
  const now = Date.now();
  const windowMs = 30000;
  const recent = run.route.filter(p => (now - p.timestamp) <= windowMs);

  if (recent.length < 2) {
    // fall back to average pace
    return run.distance > 0 ? run.elapsedSeconds / run.distance : 0;
  }

  let dist = 0;
  for (let i = 1; i < recent.length; i++) {
    dist += haversine(recent[i - 1].lat, recent[i - 1].lng, recent[i].lat, recent[i].lng);
  }

  if (dist <= 0) {
    return run.distance > 0 ? run.elapsedSeconds / run.distance : 0;
  }

  const elapsed = (recent[recent.length - 1].timestamp - recent[0].timestamp) / 1000;
  return elapsed / dist; // seconds per km
}

function smoothedElevation(offset = 0) {
  const readings = run.elevationReadings;
  const end = readings.length - offset;
  const start = Math.max(0, end - 5);
  if (end <= 0 || start >= end) return 0;

  const slice = readings.slice(start, end);
  return slice.reduce((sum, v) => sum + v, 0) / slice.length;
}

function calculateSplitElevation() {
  const kmDone = Math.max(1, Math.floor(run.distance));
  return run.elevationGain / kmDone;
}

function updateCalories() {
  const pace = run.distance > 0 ? run.elapsedSeconds / run.distance : 0; // s/km
  const paceMin = pace / 60; // min/km

  let met;
  if (paceMin > 10) met = 3.5;
  else if (paceMin > 7) met = 7;
  else if (paceMin > 5) met = 10;
  else met = 12;

  const weight = (state.profile && state.profile.weight) || DEFAULT_WEIGHT_KG;
  const hours = run.elapsedSeconds / 3600;

  run.calories = met * weight * hours;
}

// ── Auto-pause ───────────────────────────────────────

function handleAutoPause(speed) {
  if (speed < AUTO_PAUSE_SPEED_THRESHOLD) {
    // Start timer if not already ticking
    if (!run.autoPauseTimer && !run.isAutoPaused) {
      run.autoPauseTimer = setTimeout(() => {
        run.isAutoPaused = true;
        run.currentSegment++;
        emitUpdate();
      }, AUTO_PAUSE_DELAY_MS);
    }
  } else {
    // Speed picked up — clear pending timer
    if (run.autoPauseTimer) {
      clearTimeout(run.autoPauseTimer);
      run.autoPauseTimer = null;
    }
    // Resume if auto-paused and speed above resume threshold
    if (run.isAutoPaused && speed >= AUTO_RESUME_SPEED_THRESHOLD) {
      run.isAutoPaused = false;
      emitUpdate();
    }
  }
}

// ── GPS callbacks ────────────────────────────────────

function onGpsPosition(position) {
  const { latitude: lat, longitude: lng, altitude, speed } = position.coords;

  // Auto-pause handling
  if (state.profile && state.profile.autoPause) {
    handleAutoPause(speed || 0);
  }

  // Don't record while paused
  if (run.isPaused || run.isAutoPaused) return;

  const point = {
    lat,
    lng,
    timestamp: position.timestamp,
    elevation: altitude,
    segment: run.currentSegment
  };

  // Distance from last position
  if (run.lastPosition) {
    const d = haversine(run.lastPosition.lat, run.lastPosition.lng, lat, lng);
    run.distance += d;

    // Check for km split boundary
    const prevKm = Math.floor(run.distance - d);
    const currKm = Math.floor(run.distance);
    if (currKm > prevKm && currKm >= 1) {
      const splitDuration = run.elapsedSeconds - run.splitStartTime;
      const splitDist = run.distance - run.splitStartDist;
      run.splits.push({
        km: currKm,
        duration: splitDuration,
        pace: splitDist > 0 ? splitDuration / splitDist : 0,
        elevation: calculateSplitElevation()
      });
      run.splitStartTime = run.elapsedSeconds;
      run.splitStartDist = run.distance;
    }
  }

  // Track elevation with smoothing
  if (altitude != null) {
    run.elevationReadings.push(altitude);
    if (run.elevationReadings.length >= 6) {
      const prev = smoothedElevation(1);
      const curr = smoothedElevation(0);
      const diff = curr - prev;
      if (diff > 0) {
        run.elevationGain += diff;
      }
    }
  }

  run.route.push(point);
  run.lastPosition = { lat, lng };

  emitUpdate();
}

function onGpsError(err) {
  console.warn('GPS error:', err.message || err);
}

// ── Update emission ──────────────────────────────────

function emitUpdate() {
  if (onUpdateCallback) {
    onUpdateCallback(getRunState());
  }
}

// ── Wake lock ────────────────────────────────────────

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {
    // silently fail
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

// Re-acquire wake lock when page becomes visible again
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isRunning()) {
    acquireWakeLock();
  }
});

// ── Exported API ─────────────────────────────────────

export function startRun(onUpdate) {
  resetRun();
  onUpdateCallback = onUpdate;
  run.startTime = Date.now();

  // GPS watch
  watchId = navigator.geolocation.watchPosition(onGpsPosition, onGpsError, GPS_OPTIONS);

  // 1-second timer
  timerInterval = setInterval(() => {
    if (!run.isPaused && !run.isAutoPaused) {
      run.elapsedSeconds++;
      updateCalories();
      emitUpdate();
    }
  }, 1000);

  // Wake lock
  acquireWakeLock();

  // Lock orientation to portrait (no-op on unsupported platforms)
  try {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock('portrait').catch(() => {});
    }
  } catch (_) {
    // no-op (iOS etc.)
  }
}

export function pauseRun() {
  run.isPaused = true;
  run.currentSegment++;
  emitUpdate();
}

export function resumeRun() {
  run.isPaused = false;
  emitUpdate();
}

export function togglePause() {
  if (run.isPaused) {
    resumeRun();
  } else {
    pauseRun();
  }
}

export function stopRun() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  if (timerInterval !== null) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  if (run.autoPauseTimer) {
    clearTimeout(run.autoPauseTimer);
    run.autoPauseTimer = null;
  }

  releaseWakeLock();

  // Unlock orientation
  try {
    if (screen.orientation && screen.orientation.unlock) {
      screen.orientation.unlock();
    }
  } catch (_) {
    // no-op
  }

  return getRunData();
}

export function getRunData() {
  return {
    startedAt: new Date(run.startTime),
    duration: run.elapsedSeconds,
    distance: run.distance,
    avgPace: run.distance > 0 ? run.elapsedSeconds / run.distance : 0,
    splits: [...run.splits],
    route: [...run.route],
    calories: Math.round(run.calories),
    elevationGain: Math.round(run.elevationGain)
  };
}

export function getRunState() {
  return {
    isPaused: run.isPaused,
    isAutoPaused: run.isAutoPaused,
    elapsedSeconds: run.elapsedSeconds,
    distance: run.distance,
    currentPace: getCurrentPace(),
    calories: run.calories,
    elevationGain: run.elevationGain,
    heartRate: null,
    lastPosition: run.lastPosition,
    currentSegment: run.currentSegment
  };
}

export function isRunning() {
  return watchId !== null;
}

export async function checkBattery() {
  try {
    if (!navigator.getBattery) return null;
    const battery = await navigator.getBattery();
    return { level: battery.level, charging: battery.charging };
  } catch (_) {
    return null;
  }
}
