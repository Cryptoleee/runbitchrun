// ── Interval Timer Module ─────────────────────────────
// Same pattern as tracker.js: private state, exported API, callback-based updates.

let timerInterval = null;
let wakeLock = null;
let onUpdateCallback = null;

let workout = {};

// ── Pre-generated voice clips ─────────────────────────
const AUDIO_CLIPS = {
  three:    '/assets/audio/three.mp3',
  two:      '/assets/audio/two.mp3',
  one:      '/assets/audio/one.mp3',
  work:     '/assets/audio/work.mp3',
  rest:     '/assets/audio/rest.mp3',
  getready: '/assets/audio/getready.mp3',
  done:     '/assets/audio/done.mp3',
};

const HYPE_HOME_CLIPS = Array.from({length: 8}, (_, i) => `/assets/audio/hype_home_${i + 1}.mp3`);
const HYPE_DONE_CLIPS = Array.from({length: 8}, (_, i) => `/assets/audio/hype_done_${i + 1}.mp3`);

const audioCache = {};
let audioUnlocked = false;

// Pre-load all clips into Audio elements for instant playback
function preloadAudio() {
  for (const [key, src] of Object.entries(AUDIO_CLIPS)) {
    if (!audioCache[key]) {
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.load();
      audioCache[key] = audio;
    }
  }
}

// iOS requires a user-gesture to unlock audio playback.
// We play a silent snippet from one clip to unlock the audio context.
function unlockAudio() {
  if (audioUnlocked) return;
  try {
    const a = audioCache.three || new Audio(AUDIO_CLIPS.three);
    a.volume = 0.01;
    a.play().then(() => { a.pause(); a.currentTime = 0; a.volume = 1; }).catch(() => {});
    audioUnlocked = true;
  } catch (_) {}
}

function playClip(name) {
  try {
    const audio = audioCache[name];
    if (!audio) return;
    // Clone for overlapping playback support
    const clone = audio.cloneNode();
    clone.volume = 1;
    clone.play().catch(() => {});
  } catch (_) {}
}

// Countdown voice: "3", "2", "1"
function playCountdown(remaining) {
  if (remaining === 3) playClip('three');
  else if (remaining === 2) playClip('two');
  else if (remaining === 1) playClip('one');
}

function playWorkVoice()     { playClip('work'); }
function playRestVoice()     { playClip('rest'); }
function playGetReadyVoice() { playClip('getready'); }
function playDoneVoice()     { playClip('done'); }

export function playRandomHypeHome() {
  const src = HYPE_HOME_CLIPS[Math.floor(Math.random() * HYPE_HOME_CLIPS.length)];
  try {
    const a = new Audio(src);
    a.volume = 1;
    a.play().catch(() => {});
  } catch (_) {}
}

export function playRandomHypeDone() {
  const src = HYPE_DONE_CLIPS[Math.floor(Math.random() * HYPE_DONE_CLIPS.length)];
  try {
    const a = new Audio(src);
    a.volume = 1;
    a.play().catch(() => {});
  } catch (_) {}
}

// ── Reset ─────────────────────────────────────────────

function resetWorkout() {
  workout = {
    config: { rounds: 0, workSeconds: 0, restSeconds: 0, prepSeconds: 0 },
    startTime: null,
    phaseStartedAt: null,
    totalElapsed: 0,
    currentRound: 0,
    currentPhase: 'idle',   // 'idle' | 'prep' | 'work' | 'rest' | 'complete'
    phaseTimeRemaining: 0,
    phaseDuration: 0,
    isPaused: false,
    pausedAt: null,
    pauseAccumulated: 0,
    completedRounds: 0,
    totalWorkTime: 0,
    totalRestTime: 0,
    lastCountdownPlayed: -1,
  };
}

// ── Phase Transitions ─────────────────────────────────

function advancePhase() {
  const now = Date.now();
  workout.lastCountdownPlayed = -1; // reset for new phase

  if (workout.currentPhase === 'prep') {
    workout.currentPhase = 'work';
    workout.currentRound = 1;
    workout.phaseDuration = workout.config.workSeconds;
    workout.phaseTimeRemaining = workout.config.workSeconds;
    workout.phaseStartedAt = now;
    workout.pauseAccumulated = 0;
    playWorkVoice();
  } else if (workout.currentPhase === 'work') {
    workout.completedRounds++;
    workout.totalWorkTime += workout.config.workSeconds;

    if (workout.completedRounds >= workout.config.rounds) {
      workout.currentPhase = 'complete';
      playDoneVoice();
      emitUpdate();
      return;
    }

    workout.currentPhase = 'rest';
    workout.phaseDuration = workout.config.restSeconds;
    workout.phaseTimeRemaining = workout.config.restSeconds;
    workout.phaseStartedAt = now;
    workout.pauseAccumulated = 0;
    playRestVoice();
  } else if (workout.currentPhase === 'rest') {
    workout.totalRestTime += workout.config.restSeconds;
    workout.currentRound++;
    workout.currentPhase = 'work';
    workout.phaseDuration = workout.config.workSeconds;
    workout.phaseTimeRemaining = workout.config.workSeconds;
    workout.phaseStartedAt = now;
    workout.pauseAccumulated = 0;
    playWorkVoice();
  }

  emitUpdate();
}

// ── Tick (uses Date.now() for accuracy) ───────────────

function tick() {
  if (workout.isPaused || workout.currentPhase === 'complete' || workout.currentPhase === 'idle') return;

  const now = Date.now();
  const elapsed = (now - workout.phaseStartedAt - workout.pauseAccumulated) / 1000;
  workout.phaseTimeRemaining = Math.max(0, workout.phaseDuration - Math.floor(elapsed));
  workout.totalElapsed = Math.floor((now - workout.startTime - workout.pauseAccumulated) / 1000);

  // Voice countdown at 3, 2, 1
  if (workout.phaseTimeRemaining <= 3 && workout.phaseTimeRemaining > 0) {
    if (workout.lastCountdownPlayed !== workout.phaseTimeRemaining) {
      workout.lastCountdownPlayed = workout.phaseTimeRemaining;
      playCountdown(workout.phaseTimeRemaining);
    }
  }

  if (workout.phaseTimeRemaining <= 0) {
    advancePhase();
  } else {
    emitUpdate();
  }
}

// ── Wake Lock ─────────────────────────────────────────

async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (_) {}
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && isWorkoutRunning()) {
    acquireWakeLock();
  }
});

// ── Emit ──────────────────────────────────────────────

function emitUpdate() {
  if (onUpdateCallback) {
    onUpdateCallback(getWorkoutState());
  }
}

// ── Exported API ──────────────────────────────────────

export function startWorkout(config, onUpdate, weightKg = 70) {
  resetWorkout();
  workout.config = { ...config };
  workout.weightKg = weightKg;
  onUpdateCallback = onUpdate;

  // Pre-load audio clips and unlock iOS audio on user gesture
  preloadAudio();
  unlockAudio();

  const now = Date.now();
  workout.startTime = now;
  workout.phaseStartedAt = now;
  workout.pauseAccumulated = 0;

  if (config.prepSeconds > 0) {
    workout.currentPhase = 'prep';
    workout.phaseDuration = config.prepSeconds;
    workout.phaseTimeRemaining = config.prepSeconds;
    workout.currentRound = 0;
    playGetReadyVoice();
  } else {
    workout.currentPhase = 'work';
    workout.phaseDuration = config.workSeconds;
    workout.phaseTimeRemaining = config.workSeconds;
    workout.currentRound = 1;
    playWorkVoice();
  }

  timerInterval = setInterval(tick, 200); // 200ms for smooth ring animation
  acquireWakeLock();
  emitUpdate();
}

export function pauseWorkout() {
  workout.isPaused = true;
  workout.pausedAt = Date.now();
  emitUpdate();
}

export function resumeWorkout() {
  if (workout.pausedAt) {
    workout.pauseAccumulated += Date.now() - workout.pausedAt;
    workout.pausedAt = null;
  }
  workout.isPaused = false;
  emitUpdate();
}

export function togglePauseWorkout() {
  if (workout.isPaused) {
    resumeWorkout();
  } else {
    pauseWorkout();
  }
}

export function stopWorkout() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  releaseWakeLock();
  return getWorkoutData();
}

export function getWorkoutState() {
  return {
    currentPhase: workout.currentPhase,
    currentRound: workout.currentRound,
    totalRounds: workout.config.rounds,
    phaseTimeRemaining: workout.phaseTimeRemaining,
    phaseDuration: workout.phaseDuration,
    isPaused: workout.isPaused,
    totalElapsed: workout.totalElapsed,
    completedRounds: workout.completedRounds,
    nextPhase: workout.currentPhase === 'work' ? 'rest' : 'work',
    nextPhaseDuration: workout.currentPhase === 'work'
      ? workout.config.restSeconds
      : workout.config.workSeconds
  };
}

export function getWorkoutData() {
  return {
    type: 'interval',
    startedAt: new Date(workout.startTime),
    duration: workout.totalElapsed,
    config: { ...workout.config },
    completedRounds: workout.completedRounds,
    totalWorkTime: workout.totalWorkTime,
    totalRestTime: workout.totalRestTime,
    calories: calculateWorkoutCalories()
  };
}

export function isWorkoutRunning() {
  return timerInterval !== null;
}

function calculateWorkoutCalories() {
  // MET ~8 for high-intensity interval training
  const met = 8;
  const weightKg = workout.weightKg || 70;
  const hours = workout.totalElapsed / 3600;
  return Math.round(met * weightKg * hours);
}
