import { getSound } from "./prefs";

export type SoundName = "move" | "capture" | "check" | "correct" | "wrong" | "notify";

const FILES: Record<SoundName, string> = {
  move: "/sounds/Move.mp3",
  capture: "/sounds/Capture.mp3",
  check: "/sounds/Check.mp3",
  correct: "/sounds/GenericNotify.mp3",
  wrong: "/sounds/Error.mp3",
  notify: "/sounds/GenericNotify.mp3",
};

const players = new Map<SoundName, HTMLAudioElement>();

function playerFor(name: SoundName) {
  let audio = players.get(name);
  if (!audio) {
    audio = new Audio(FILES[name]);
    audio.preload = "auto";
    audio.volume = 0.38;
    players.set(name, audio);
  }
  return audio;
}

/** Sound preferences live in localStorage and are mirrored from Settings. */
export function playSound(name: SoundName, force = false) {
  if (!force && !getSound()) return;
  try {
    const audio = playerFor(name);
    audio.pause();
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise?.catch) promise.catch(() => {});
  } catch {
    // Audio is a nice-to-have; never block training on it.
  }
}

export function playMoveSound(capture = false, check = false) {
  if (check) playSound("check");
  else if (capture) playSound("capture");
  else playSound("move");
}
