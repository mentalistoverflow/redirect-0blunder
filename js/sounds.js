/**
 * Sound manager for chess game events.
 * Uses Web Audio API (new Audio()) with lazy loading.
 * Sound files expected at /static/sounds/{name}.mp3
 * Preference saved in localStorage key 'chess-learn-sounds' (default: true).
 */

const STORAGE_KEY = 'chess-learn-sounds';

const SOUND_NAMES = ['move', 'capture', 'check', 'castle', 'game-end'];

/** @type {Map<string, HTMLAudioElement>} */
const audioCache = new Map();

/** @type {Set<string>} */
const failedSounds = new Set();

/**
 * Initialize sounds module. Preloads nothing — sounds are lazy-loaded on first play.
 */
export function initSounds() {
  // Nothing to initialize eagerly; sounds are loaded lazily in playSound().
}

/**
 * Play a sound by name. Clones the audio element to allow overlapping plays.
 * Silently ignores errors (missing files, playback failures).
 * @param {string} name - One of: move, capture, check, castle, game-end
 */
export function playSound(name) {
  if (!isSoundsEnabled()) return;
  if (failedSounds.has(name)) return;

  try {
    let audio = audioCache.get(name);
    if (!audio) {
      audio = new Audio(`/static/sounds/${name}.mp3`);
      audio.addEventListener('error', () => {
        failedSounds.add(name);
        audioCache.delete(name);
      }, { once: true });
      audioCache.set(name, audio);
    }

    // Clone for overlapping plays
    const clone = audio.cloneNode();
    clone.volume = audio.volume;
    clone.play().catch(() => {
      // Silently ignore playback errors (e.g. autoplay policy)
    });
  } catch {
    // Silently ignore any errors
  }
}

/**
 * Enable or disable sound effects and persist the preference.
 * @param {boolean} enabled
 */
export function setSoundsEnabled(enabled) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(!!enabled));
  } catch {
    // localStorage unavailable — ignore
  }
}

/**
 * Check whether sound effects are enabled.
 * @returns {boolean} Defaults to true if no preference is stored.
 */
export function isSoundsEnabled() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return true;
    return JSON.parse(stored) === true;
  } catch {
    return true;
  }
}
