export type SoundName = "move" | "capture" | "check" | "correct" | "wrong" | "notify";

const FILES: Record<SoundName, string> = {
  move: "/sounds/Move.mp3",
  capture: "/sounds/Capture.mp3",
  check: "/sounds/Check.mp3",
  correct: "/sounds/GenericNotify.mp3",
  wrong: "/sounds/Error.mp3",
  notify: "/sounds/GenericNotify.mp3",
};

let enabled = true;
const players = new Map<SoundName, HTMLAudioElement>();

export function setSoundEnabled(value: boolean) {
  enabled = value;
}

function playerFor(name: SoundName) {
  let audio = players.get(name);
  if (!audio) {
    audio = new Audio(FILES[name]);
    audio.preload = "auto";
    audio.volume = 0.4;
    players.set(name, audio);
  }
  return audio;
}

export function playSound(name: SoundName) {
  if (!enabled) return;
  try {
    const audio = playerFor(name);
    audio.currentTime = 0;
    const promise = audio.play();
    if (promise?.catch) promise.catch(() => {});
  } catch {
    // Sound is optional.
  }
}

export function playMoveSound(capture = false, check = false) {
  playSound(check ? "check" : capture ? "capture" : "move");
}
