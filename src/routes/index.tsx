import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PileCanvas } from "@/components/pile/scene";
import { emitPile, pileBus, subscribePile } from "@/components/pile/bus";
import { BASE_WAVE } from "@/data/atlas";
import { readVisit, type Visit } from "@/data/visit";

export const Route = createFileRoute("/")({ component: Home });

let sensorsArmed = false;

function armSensors() {
  if (sensorsArmed || typeof window === "undefined") return;
  sensorsArmed = true;
  let last = { x: 0, y: 0, z: 0 };
  let cool = 0;
  let sawOrient = false;
  let beta = 0;
  let gamma = 0;
  const bias = { x: 0, y: 0, z: 0 };

  window.addEventListener("deviceorientation", (event) => {
    if (event.beta == null || event.gamma == null) return;
    sawOrient = true;
    beta += (event.beta - beta) * 0.4;
    gamma += (event.gamma - gamma) * 0.4;
    pileBus.orient.beta = beta;
    pileBus.orient.gamma = gamma;
    pileBus.orient.active = true;
  });

  window.addEventListener("devicemotion", (event) => {
    const now = performance.now();
    const incl = event.accelerationIncludingGravity;
    const raw = event.acceleration;
    const inclMag = incl && incl.x != null ? Math.hypot(incl.x ?? 0, incl.y ?? 0, incl.z ?? 0) : 0;
    const scale = inclMag > 0 && inclMag < 4 ? 9.81 : 1;

    let ax = 0;
    let ay = 0;
    let az = 0;
    if (raw && raw.x != null && raw.y != null && raw.z != null) {
      ax = raw.x * scale;
      ay = raw.y * scale;
      az = raw.z * scale;
    } else if (incl && incl.x != null) {
      const x = (incl.x ?? 0) * scale;
      const y = (incl.y ?? 0) * scale;
      const z = (incl.z ?? 0) * scale;
      ax = (x - last.x) * 2.4;
      ay = (y - last.y) * 2.4;
      az = (z - last.z) * 2.4;
      last = { x, y, z };
    }

    if (!sawOrient && incl && incl.x != null && inclMag > 0.2) {
      const x = ((incl.x ?? 0) * scale) / (inclMag * scale || 1);
      const y = ((incl.y ?? 0) * scale) / (inclMag * scale || 1);
      const z = ((incl.z ?? 0) * scale) / (inclMag * scale || 1);
      beta += ((Math.atan2(-y, z) * 180) / Math.PI - beta) * 0.35;
      gamma += ((Math.asin(Math.max(-1, Math.min(1, x))) * 180) / Math.PI - gamma) * 0.35;
      pileBus.orient.beta = beta;
      pileBus.orient.gamma = gamma;
      pileBus.orient.active = true;
    }

    pileBus.jolt.x += (ax - bias.x - pileBus.jolt.x) * 0.55;
    pileBus.jolt.y += (ay - bias.y - pileBus.jolt.y) * 0.55;
    pileBus.jolt.z += (az - bias.z - pileBus.jolt.z) * 0.55;
    bias.x += (ax - bias.x) * 0.04;
    bias.y += (ay - bias.y) * 0.04;
    bias.z += (az - bias.z) * 0.04;
    const mag = Math.hypot(ax - bias.x, ay - bias.y, az - bias.z);
    pileBus.jolt.mag = Math.hypot(pileBus.jolt.x, pileBus.jolt.y, pileBus.jolt.z);
    const sample = Math.min(1, Math.max(0, (mag - 1.6) / 22));
    if (sample > pileBus.rush) pileBus.rush = sample;
    if (sample > 0.02) pileBus.heat = Math.min(1, pileBus.heat + sample * 0.18);

    if (mag > 3 && now - cool > 110) {
      cool = now;
      const violence = Math.min(1, (mag - 3) / 18);
      pileBus.shakePower = 0.6 + violence * 4.2;
      pileBus.shakeSeq += 1;
    }
  });
}

function requestFullscreenNow() {
  const el = document.documentElement as HTMLElement & {
    webkitRequestFullscreen?: () => Promise<void> | void;
  };
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  if (document.fullscreenElement || doc.webkitFullscreenElement) return;
  try {
    const pending = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    void Promise.resolve(pending).catch(() => {
      // desktop preview and some in-app browsers refuse fullscreen
    });
  } catch {
    // needs a user gesture; the next tap tries again
  }
}

async function fillAndLock() {
  requestFullscreenNow();
  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: string) => Promise<void>;
  };
  if (!orientation?.lock) return;
  try {
    await orientation.lock(orientation.type);
  } catch {
    try {
      await orientation.lock("portrait");
    } catch {
      // iOS Safari cannot lock a page orientation
    }
  }
}

async function enableMotion() {
  await fillAndLock();
  const motion = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
  const orientation = DeviceOrientationEvent as unknown as {
    requestPermission?: () => Promise<string>;
  };
  try {
    await motion.requestPermission?.();
  } catch {
    // desktop and most Android browsers have no permission gate
  }
  try {
    await orientation.requestPermission?.();
  } catch {
    // same
  }
  armSensors();
}

function Home() {
  const [mounted, setMounted] = useState(false);
  const [visit, setVisit] = useState<Visit | null>(null);
  const lit = useSyncExternalStore(subscribePile, () => pileBus.lit, () => true);
  const more = useSyncExternalStore(subscribePile, () => pileBus.moreReady, () => false);
  const hold = useSyncExternalStore(subscribePile, () => pileBus.hold, () => null);
  const wave = visit ? Math.round(BASE_WAVE * visit.mult) : 0;

  useEffect(() => {
    armSensors();
    setVisit(readVisit());
    setMounted(true);
    let opened = false;
    const unlock = () => {
      if (opened) return;
      opened = true;
      requestFullscreenNow();
      pileBus.heat = Math.min(1, pileBus.heat + 0.14);
      void enableMotion();
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("touchstart", unlock, { capture: true, passive: true });
    const block = (event: TouchEvent) => {
      if ((event.target as HTMLElement | null)?.closest("button, a")) return;
      event.preventDefault();
    };
    document.body.addEventListener("touchmove", block, { passive: false });
    return () => {
      window.removeEventListener("pointerdown", unlock, { capture: true });
      window.removeEventListener("touchstart", unlock, { capture: true });
      document.body.removeEventListener("touchmove", block);
    };
  }, []);

  return (
    <main
      className="fixed inset-0 h-[100dvh] w-[100vw] overflow-hidden bg-bg text-fg"
      data-wave={wave || undefined}
      data-atlas="6194"
    >
      <div className="absolute inset-0">
        {mounted && visit ? <PileCanvas lit={lit} visit={visit} /> : null}
      </div>

      {hold ? (
        <p className="hold-name" style={{ color: hold.color }}>
          {hold.label}
        </p>
      ) : null}

      <footer className="pile-dock" data-dock="1">
        <div className="pile-dock-row">
        <button
          type="button"
          aria-pressed={lit}
          aria-label={lit ? "Lights on" : "Turn lights on"}
          onClick={() => {
            pileBus.heat = Math.min(1, pileBus.heat + 0.1);
            pileBus.lit = !pileBus.lit;
            emitPile();
          }}
          className={`inline-flex size-12 shrink-0 items-center justify-center rounded-full border backdrop-blur-md ${lit ? "border-amber bg-amber/30" : "border-line bg-surface/85"}`}
        >
          <img src="/xero/1f4a1.svg" alt="" className={`size-8 ${lit ? "" : "opacity-60"}`} />
        </button>
        {more ? (
          <button
            type="button"
            className="more-stuff relative"
            onClick={() => {
              pileBus.moreTick += 1;
              emitPile();
            }}
          >
            <span className="more-stuff-bulbs" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => {
                const top = i < 7;
                const slot = top ? i : i - 7;
                return (
                  <i
                    key={i}
                    style={{
                      left: `${8 + slot * 14}%`,
                      top: top ? -11 : undefined,
                      bottom: top ? undefined : -11,
                      animationDelay: `${slot * 0.08}s`,
                    }}
                  />
                );
              })}
              <i style={{ left: -10, top: "50%", marginTop: -5, animationDelay: "0.16s" }} />
              <i style={{ right: -10, top: "50%", marginTop: -5, animationDelay: "0.4s" }} />
            </span>
            <span className="more-stuff-label">More Stuff</span>
          </button>
        ) : null}
        <a
          href="https://github.com/maximusmaximus/pixels"
          target="_blank"
          rel="noreferrer"
          aria-label="About PIXELS"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-line bg-surface/85 backdrop-blur-md"
        >
          <img src="/xero/2139.svg" alt="" className="size-8" />
        </a>
        </div>
        <p className="pointer-events-auto text-center text-xs leading-none text-fg/90">
          made with <img src="/xero/1f9e1.svg" alt="🧡" className="inline size-3.5 align-[-2px]" /> in SF{" "}
          <a
            href="https://maxi.grok.me"
            target="_blank"
            rel="noreferrer"
            className="underline decoration-line underline-offset-2"
          >
            maxi.grok.me
          </a>
        </p>
      </footer>
    </main>
  );
}
