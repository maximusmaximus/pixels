import type { GLTFLoader } from "three-stdlib";

const MAX_ACTIVE = 6;

let active = 0;
const waiting: (() => void)[] = [];
const limited = new WeakSet<GLTFLoader>();

function pump() {
  while (active < MAX_ACTIVE) {
    const start = waiting.shift();
    if (!start) return;
    active += 1;
    start();
  }
}

function finish() {
  active -= 1;
  pump();
}

// The shared GLTFLoader fetches at most MAX_ACTIVE files at a time.
export function limitLoads(loader: GLTFLoader) {
  if (limited.has(loader)) return;
  limited.add(loader);
  const load = loader.load.bind(loader);
  loader.load = (url, onLoad, onProgress, onError) => {
    waiting.push(() =>
      load(
        url,
        (gltf) => {
          finish();
          onLoad(gltf);
        },
        onProgress,
        (error) => {
          finish();
          onError?.(error);
        },
      ),
    );
    pump();
  };
}
