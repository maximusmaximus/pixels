// A full 10× wave is 1,040 bodies. Phones keep that many only if they have to;
// the wave trim in the spawner still lets every atlas model take a turn.
const PHONE_LIVE_LIMIT = 1100;

export function onPhone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(pointer: coarse)").matches &&
    Math.min(window.screen.width, window.screen.height) < 820
  );
}

export function liveLimit() {
  return onPhone() ? PHONE_LIVE_LIMIT : 1200;
}
