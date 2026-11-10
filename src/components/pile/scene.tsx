import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import {
  CoefficientCombineRule,
  CuboidCollider,
  Physics,
  RigidBody,
  useRapier,
  type RapierRigidBody,
} from "@react-three/rapier";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { ATLAS, BASE_WAVE, type PropAsset } from "@/data/atlas";
import { scaleFor, shuffleVisit, type Visit } from "@/data/visit";
import { bodies, bodyIds, emitPile, pileBus, setHold } from "./bus";
import { liveLimit, onPhone } from "./device";
import { limitLoads } from "./glb-queue";

// stuff.grok.me ring was 2.85, and objects landed inside a disk of radius 1.8.
const AREA = 2.85 * 2;
const FALL_RADIUS = (2.85 - 1.05) * 2;

type Bounds = { minY: number; center: [number, number, number]; size: [number, number, number] };

type Drop = {
  key: string;
  asset: PropAsset;
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
};

function Lights({ lit }: { lit: boolean }) {
  return (
    <>
      <hemisphereLight args={lit ? ["#fff6e8", "#cbbba6", 1.15] : ["#3a342c", "#090807", 0.16]} />
      <ambientLight intensity={lit ? 0.72 : 0.05} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={lit ? 2.4 : 0.35}
        color={lit ? "#fffaf2" : "#ffe0b0"}
      />
      <directionalLight position={[-7, 8, -5]} intensity={lit ? 0.9 : 0.08} color={lit ? "#ffe7c2" : "#8a7a66"} />
    </>
  );
}

function Backdrop({ lit }: { lit: boolean }) {
  const { scene } = useThree();
  useEffect(() => {
    const color = new THREE.Color(lit ? "#f3ece3" : "#0e0d0b");
    scene.background = color;
    scene.fog = new THREE.Fog(color, 55, 160);
  }, [lit, scene]);
  return null;
}

function discGeometry(radius: number, rings: number, segs: number) {
  const positions = [0, 0, 0];
  const indices: number[] = [];
  for (let ring = 1; ring <= rings; ring++) {
    const rad = (ring / rings) * radius;
    for (let seg = 0; seg < segs; seg++) {
      const angle = (seg / segs) * Math.PI * 2;
      positions.push(Math.cos(angle) * rad, Math.sin(angle) * rad, 0);
    }
  }
  for (let seg = 0; seg < segs; seg++) {
    indices.push(0, 1 + seg, 1 + ((seg + 1) % segs));
  }
  for (let ring = 1; ring < rings; ring++) {
    const row = 1 + (ring - 1) * segs;
    const next = row + segs;
    for (let seg = 0; seg < segs; seg++) {
      const a = row + seg;
      const b = row + ((seg + 1) % segs);
      const c = next + seg;
      const d = next + ((seg + 1) % segs);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function Membrane({ lit }: { lit: boolean }) {
  const rings = 18;
  const segs = 40;
  const geometry = useMemo(() => discGeometry(AREA, rings, segs), []);
  const rest = useMemo(() => Float32Array.from(geometry.attributes.position.array), [geometry]);
  const velocity = useMemo(() => new Float32Array(geometry.attributes.position.count), [geometry]);
  const edgeStart = 1 + (rings - 1) * segs;

  useFrame((_, delta) => {
    const step = Math.min(delta, 0.033);
    const position = geometry.attributes.position;
    const array = position.array as Float32Array;
    const presses: { x: number; y: number; depth: number }[] = [];
    for (const body of bodies) {
      if (body === pileBus.held) continue;
      const t = body.translation();
      const speed = body.linvel();
      if (t.y > 1.1) continue;
      const localX = t.x;
      const localY = -t.z;
      if (Math.hypot(localX, localY) > AREA) continue;
      const depth = Math.min(0.55, Math.max(0, -speed.y) * 0.04 + Math.max(0, 0.5 - t.y) * 0.5);
      if (depth > 0.012) presses.push({ x: localX, y: localY, depth });
    }
    const sample = presses.length > 90 ? presses.filter((_, i) => i % 2 === 0) : presses;
    for (let i = 0; i < position.count; i++) {
      const o = i * 3;
      if (i >= edgeStart) {
        array[o + 2] = 0;
        velocity[i] = 0;
        continue;
      }
      const x = rest[o] ?? 0;
      const y = rest[o + 1] ?? 0;
      let target = 0;
      for (const press of sample) {
        const dist = Math.hypot(x - press.x, y - press.y);
        const reach = 0.9;
        if (dist >= reach) continue;
        target -= press.depth * Math.cos((dist / reach) * Math.PI * 0.5);
      }
      target = Math.max(target, -0.55);
      const z = array[o + 2] ?? 0;
      const next = (velocity[i] ?? 0) + ((target - z) * 78 - (velocity[i] ?? 0) * 8.5) * step;
      velocity[i] = next;
      array[o + 2] = z + next * step;
    }
    position.needsUpdate = true;
    geometry.computeVertexNormals();
  });

  return (
    <mesh geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
      <meshStandardMaterial color={lit ? "#d7c2ae" : "#241c16"} roughness={0.48} metalness={0} />
    </mesh>
  );
}

function Floor({ lit }: { lit: boolean }) {
  const posts = 36;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow>
        <circleGeometry args={[28, 72]} />
        <meshStandardMaterial color={lit ? "#e6ded2" : "#12100c"} roughness={1} metalness={0} />
      </mesh>
      <Membrane lit={lit} />
      <RigidBody type="fixed" colliders={false} friction={0.55} restitution={0.62}>
        <CuboidCollider
          args={[30, 4, 30]}
          position={[0, -4, 0]}
          friction={0.55}
          restitution={0.62}
          restitutionCombineRule={CoefficientCombineRule.Max}
        />
        {Array.from({ length: posts }, (_, i) => {
          const a = (i / posts) * Math.PI * 2;
          return (
            <CuboidCollider
              key={i}
              args={[0.18, 2.6, 0.62]}
              position={[Math.sin(a) * (AREA + 0.28), 2.4, Math.cos(a) * (AREA + 0.28)]}
              rotation={[0, a - Math.PI / 2, 0]}
              friction={0.75}
              restitution={0.12}
            />
          );
        })}
      </RigidBody>
    </group>
  );
}

class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return null;
    return this.props.children;
  }
}

const prepared = new WeakSet<THREE.Object3D>();
const boundsCache = new WeakMap<THREE.Object3D, Bounds>();

function prepareScene(source: THREE.Object3D) {
  if (prepared.has(source)) return source;
  prepared.add(source);
  source.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const standard = mat as THREE.MeshStandardMaterial;
      standard.side = THREE.DoubleSide;
      standard.metalness = 0;
      standard.roughness = 0.84;
      if (standard.color) standard.color.set(0xffffff);
      if (standard.map) {
        standard.map.magFilter = THREE.NearestFilter;
        standard.map.minFilter = THREE.NearestFilter;
        standard.map.generateMipmaps = false;
        standard.map.needsUpdate = true;
      }
    }
  });
  return source;
}

function measure(source: THREE.Object3D): Bounds {
  const cached = boundsCache.get(source);
  if (cached) return cached;
  source.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(source);
  if (box.isEmpty()) {
    const empty: Bounds = { minY: 0, center: [0, 0.5, 0], size: [1, 1, 1] };
    boundsCache.set(source, empty);
    return empty;
  }
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const measured: Bounds = {
    minY: box.min.y,
    center: [center.x, center.y, center.z],
    size: [Math.max(size.x, 0.08), Math.max(size.y, 0.08), Math.max(size.z, 0.08)],
  };
  boundsCache.set(source, measured);
  return measured;
}

type Shard = {
  key: string;
  position: [number, number, number];
  size: number;
  color: string;
  velocity: [number, number, number];
  ang: [number, number, number];
};

type Pixel = { r: number; g: number; b: number; u: number; v: number };

function hexColor(r: number, g: number, b: number) {
  const channel = (n: number) => Math.max(0, Math.min(255, n | 0)).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const colorCache = new Map<string, string>();

function colorFor(id: string, root: THREE.Object3D) {
  const cached = colorCache.get(id);
  if (cached) return cached;
  const pixels = readPixels(root);
  if (!pixels.length) return "#f4efe6";
  let r = 0;
  let g = 0;
  let b = 0;
  for (const pixel of pixels) {
    r += pixel.r;
    g += pixel.g;
    b += pixel.b;
  }
  const n = pixels.length;
  const color = hexColor(r / n, g / n, b / n);
  colorCache.set(id, color);
  return color;
}

function readPixels(root: THREE.Object3D): Pixel[] {
  const found: { tex: THREE.Texture | null } = { tex: null };
  root.traverse((obj) => {
    if (found.tex) return;
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    if (mat?.map) found.tex = mat.map;
  });
  const image = found.tex?.image as (CanvasImageSource & { width?: number; height?: number }) | undefined;
  if (!image) return [];
  const sw = 16;
  const sh = 16;
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  try {
    ctx.drawImage(image, 0, 0, sw, sh);
    const data = ctx.getImageData(0, 0, sw, sh).data;
    const pixels: Pixel[] = [];
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        const i = (y * sw + x) * 4;
        if ((data[i + 3] ?? 0) < 48) continue;
        pixels.push({
          r: data[i] ?? 0,
          g: data[i + 1] ?? 0,
          b: data[i + 2] ?? 0,
          u: (x + 0.5) / sw,
          v: (y + 0.5) / sh,
        });
      }
    }
    return pixels;
  } catch {
    return [];
  }
}

function fallbackPixels(): Pixel[] {
  const swatches: Array<[number, number, number]> = [
    [255, 43, 214],
    [57, 246, 255],
    [255, 225, 74],
    [125, 255, 106],
    [227, 155, 43],
    [244, 239, 230],
  ];
  const pixels: Pixel[] = [];
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const color = swatches[(x + y * 3) % swatches.length]!;
      pixels.push({ r: color[0], g: color[1], b: color[2], u: (x + 0.5) / 4, v: (y + 0.5) / 4 });
    }
  }
  return pixels;
}

function blastAround(origin: THREE.Vector3, power: number, radius: number, skip: RapierRigidBody | null) {
  for (const body of bodies) {
    if (body === skip) continue;
    const t = body.translation();
    const dx = t.x - origin.x;
    const dy = t.y - origin.y;
    const dz = t.z - origin.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > radius || dist < 1e-3) continue;
    const mass = body.mass();
    if (!Number.isFinite(mass) || mass <= 0) continue;
    const fall = (1 - dist / radius) ** 2;
    const mag = power * fall * Math.min(mass, 9);
    const nx = dx / dist;
    const ny = dy / dist;
    const nz = dz / dist;
    body.wakeUp();
    body.applyImpulse({ x: nx * mag, y: (ny * 0.55 + 0.55) * mag, z: nz * mag }, true);
    body.applyTorqueImpulse(
      {
        x: (Math.random() - 0.5) * mag * 0.4,
        y: (Math.random() - 0.5) * mag * 0.22,
        z: (Math.random() - 0.5) * mag * 0.4,
      },
      true,
    );
  }
}

function PixelShard({ shard }: { shard: Shard }) {
  const ref = useRef<RapierRigidBody>(null);
  useEffect(() => {
    const current = ref.current;
    if (!current) return;
    bodies.add(current);
    current.setLinvel({ x: shard.velocity[0], y: shard.velocity[1], z: shard.velocity[2] }, true);
    current.setAngvel({ x: shard.ang[0], y: shard.ang[1], z: shard.ang[2] }, true);
    return () => {
      bodies.delete(current);
      if (pileBus.held === current) pileBus.held = null;
    };
  }, [shard.ang, shard.velocity]);
  return (
    <RigidBody
      ref={ref}
      position={shard.position}
      colliders="cuboid"
      mass={Math.max(0.08, shard.size * shard.size * 4.5)}
      linearDamping={0.06}
      angularDamping={0.18}
      friction={0.62}
      restitution={0.38}
      ccd
      canSleep
    >
      <mesh>
        <boxGeometry args={[shard.size, shard.size, shard.size]} />
        <meshStandardMaterial color={shard.color} roughness={0.72} metalness={0} />
      </mesh>
    </RigidBody>
  );
}

function Prop({
  asset,
  scale,
  position,
  rotation,
  onBurst,
  onGone,
}: {
  asset: PropAsset;
  scale: number;
  position: [number, number, number];
  rotation: [number, number, number];
  onBurst: (shards: Shard[]) => void;
  onGone: () => void;
}) {
  const gltf = useGLTF(asset.url, false, true, limitLoads);
  const body = useRef<RapierRigidBody>(null);
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const held = useRef(false);
  const mode = useRef<"none" | "charge" | "drag">("none");
  const timer = useRef(0);
  const pointerStart = useRef({ x: 0, y: 0 });
  const burstRef = useRef(onBurst);
  const goneRef = useRef(onGone);
  burstRef.current = onBurst;
  goneRef.current = onGone;
  const ndc = useRef(new THREE.Vector2());
  const raycaster = useRef(new THREE.Raycaster());
  const plane = useRef(new THREE.Plane());
  const hit = useRef(new THREE.Vector3());
  const grabOffset = useRef(new THREE.Vector3());
  const velocity = useRef(new THREE.Vector3());
  const normal = useRef(new THREE.Vector3());
  const fitted = useMemo(() => measure(prepareScene(gltf.scene)), [gltf.scene]);
  const scene = useMemo(() => {
    const clone = prepareScene(gltf.scene).clone(true);
    clone.scale.setScalar(scale);
    return clone;
  }, [gltf.scene, scale]);
  const mass = Math.min(32, Math.max(0.2, 0.42 * scale ** 3));
  const center: [number, number, number] = [
    fitted.center[0] * scale,
    fitted.center[1] * scale,
    fitted.center[2] * scale,
  ];
  const half: [number, number, number] = [
    Math.max(0.04, (fitted.size[0] * scale) / 2),
    Math.max(0.04, (fitted.size[1] * scale) / 2),
    Math.max(0.04, (fitted.size[2] * scale) / 2),
  ];

  useEffect(() => {
    const current = body.current;
    if (!current) return;
    bodies.add(current);
    bodyIds.set(current, asset.id);
    const sink = fitted.minY * scale;
    if (sink < -0.02) {
      const t = current.translation();
      current.setTranslation({ x: t.x, y: t.y - sink, z: t.z }, true);
    }
    if (pileBus.rush > 0.05) {
      current.setLinvel({ x: 0, y: -(4 + pileBus.rush * 9), z: 0 }, true);
    }
    return () => {
      bodies.delete(current);
      bodyIds.delete(current);
      if (pileBus.held === current) pileBus.held = null;
    };
  }, [asset.id, fitted.minY, scale]);

  const release = () => {
    if (!held.current) return;
    held.current = false;
    pileBus.dragging = false;
    if (pileBus.held === body.current) pileBus.held = null;
    if (controls) controls.enabled = true;
    const current = body.current;
    if (!current) return;
    const v = velocity.current;
    const speed = v.length();
    if (speed > 8) v.multiplyScalar(8 / speed);
    current.setLinvel({ x: v.x * 0.7, y: v.y * 0.7, z: v.z * 0.7 }, true);
  };

  const clearHold = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = 0;
  };

  const explode = () => {
    const current = body.current;
    if (!current || mode.current === "none") return;
    mode.current = "none";
    held.current = false;
    clearHold();
    if (pileBus.hold?.id === asset.id) setHold(null);
    pileBus.dragging = false;
    if (pileBus.held === current) pileBus.held = null;
    if (controls) controls.enabled = true;
    const t = current.translation();
    const r = current.rotation();
    const v = current.linvel();
    const quat = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const centerLocal = new THREE.Vector3(center[0], center[1], center[2]);
    const origin = centerLocal.applyQuaternion(quat).add(new THREE.Vector3(t.x, t.y, t.z));
    const sizeX = Math.max(0.2, fitted.size[0] * scale);
    const sizeY = Math.max(0.2, fitted.size[1] * scale);
    const sizeZ = Math.max(0.12, fitted.size[2] * scale);
    const block = Math.max(0.055, Math.min(sizeX, sizeY) / 15);
    let pixels = readPixels(gltf.scene);
    if (pixels.length < 4) pixels = fallbackPixels();
    const cap = Math.round(Math.min(42, 16 + scale * 8));
    if (pixels.length > cap) {
      const stride = pixels.length / cap;
      const picked: Pixel[] = [];
      for (let i = 0; i < cap; i++) picked.push(pixels[Math.floor(i * stride)]!);
      pixels = picked;
    }
    const layers = scale > 1.15 ? 3 : 2;
    const shards: Shard[] = [];
    const local = new THREE.Vector3();
    const world = new THREE.Vector3();
    outer: for (let index = 0; index < pixels.length; index++) {
      const pixel = pixels[index]!;
      for (let layer = 0; layer < layers; layer++) {
        if (shards.length >= 48) break outer;
        const z01 = layer / (layers - 1);
        local.set((pixel.u - 0.5) * sizeX, (0.5 - pixel.v) * sizeY, (z01 - 0.5) * sizeZ);
        world.copy(local).applyQuaternion(quat).add(origin);
        const dir = local.clone();
        if (dir.lengthSq() < 1e-4) dir.set(Math.random() - 0.5, 0.2, Math.random() - 0.5);
        dir.normalize();
        const speed = 4.2 + scale * 2.4 + Math.random() * 2.4;
        shards.push({
          key: `${asset.id}-${index}-${layer}`,
          position: [world.x, world.y, world.z],
          size: block,
          color: hexColor(pixel.r, pixel.g, pixel.b),
          velocity: [
            dir.x * speed + v.x * 0.35 + (Math.random() - 0.5) * 1.2,
            Math.abs(dir.y) * speed * 0.55 + 2.4 + Math.random() * 2.2 + Math.min(0, v.y) * 0.25,
            dir.z * speed + v.z * 0.35 + (Math.random() - 0.5) * 1.2,
          ],
          ang: [(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 14],
        });
      }
    }
    blastAround(origin, 8 + scale * 7, 1.15 + scale * 1.9, current);
    burstRef.current(shards);
    goneRef.current();
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (mode.current === "charge") {
        const dx = event.clientX - pointerStart.current.x;
        const dy = event.clientY - pointerStart.current.y;
        if (dx * dx + dy * dy > 196) {
          clearHold();
          mode.current = "drag";
          held.current = true;
          pileBus.held = body.current;
          const current = body.current;
          if (current) {
            const rect = gl.domElement.getBoundingClientRect();
            ndc.current.set(
              ((event.clientX - rect.left) / rect.width) * 2 - 1,
              -((event.clientY - rect.top) / rect.height) * 2 + 1,
            );
            raycaster.current.setFromCamera(ndc.current, camera);
            camera.getWorldDirection(normal.current);
            const p = current.translation();
            const point = raycaster.current.ray.intersectPlane(plane.current, hit.current) ?? new THREE.Vector3(p.x, p.y, p.z);
            plane.current.setFromNormalAndCoplanarPoint(normal.current, point);
            grabOffset.current.set(p.x - point.x, p.y - point.y, p.z - point.z);
            velocity.current.set(0, 0, 0);
            current.setLinvel({ x: 0, y: 0, z: 0 }, true);
            current.setAngvel({ x: 0, y: 0, z: 0 }, true);
          }
        }
      }
      if (!held.current || pileBus.held !== body.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      ndc.current.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      );
    };
    const up = () => {
      clearHold();
      if (mode.current === "drag") release();
      else {
        pileBus.dragging = false;
        if (controls) controls.enabled = true;
      }
      mode.current = "none";
      if (pileBus.hold?.id === asset.id) setHold(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      clearHold();
      if (pileBus.hold?.id === asset.id) setHold(null);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [gl, controls, camera]);

  useFrame((_, delta) => {
    if (mode.current === "charge") {
      const pulse = 1 + Math.sin(performance.now() * 0.028) * 0.045;
      scene.scale.setScalar(scale * pulse);
    } else if (scene.scale.x !== scale) {
      scene.scale.setScalar(scale);
    }
    const current = body.current;
    if (!held.current || !current || pileBus.held !== current) return;
    raycaster.current.setFromCamera(ndc.current, camera);
    const point = raycaster.current.ray.intersectPlane(plane.current, hit.current);
    if (!point) return;
    point.add(grabOffset.current);
    point.y = Math.max(0.06, point.y);
    const p = current.translation();
    const dt = Math.max(delta, 0.016);
    velocity.current.set((point.x - p.x) / dt, (point.y - p.y) / dt, (point.z - p.z) / dt);
    current.setTranslation({ x: point.x, y: point.y, z: point.z }, true);
    current.setLinvel({ x: 0, y: 0, z: 0 }, true);
    current.setAngvel({ x: 0, y: 0, z: 0 }, true);
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const current = body.current;
    if (!current || mode.current !== "none") return;
    mode.current = "charge";
    pileBus.dragging = true;
    pileBus.heat = Math.min(1, pileBus.heat + 0.16);
    if (controls) controls.enabled = false;
    pointerStart.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    const rect = gl.domElement.getBoundingClientRect();
    ndc.current.set(
      ((e.nativeEvent.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.nativeEvent.clientY - rect.top) / rect.height) * 2 + 1,
    );
    camera.getWorldDirection(normal.current);
    plane.current.setFromNormalAndCoplanarPoint(normal.current, e.point);
    current.wakeUp();
    setHold({ id: asset.id, label: asset.label, color: colorFor(asset.id, gltf.scene) });
    clearHold();
    timer.current = window.setTimeout(() => {
      timer.current = 0;
      if (mode.current === "charge") explode();
    }, 480);
  };

  return (
    <RigidBody
      ref={body}
      position={position}
      rotation={rotation}
      colliders={false}
      mass={mass}
      linearDamping={0.12}
      angularDamping={0.42}
      ccd={scale > 1.15}
      canSleep
    >
      <group onPointerDown={onDown}>
        <primitive object={scene} />
        <mesh position={center}>
          <boxGeometry args={[half[0] * 2, half[1] * 2, half[2] * 2]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <CuboidCollider args={half} position={center} friction={0.86} restitution={0.05} />
    </RigidBody>
  );
}

function Spawner({ visit }: { visit: Visit }) {
  const [drops, setDrops] = useState<Drop[]>([]);
  const [shards, setShards] = useState<Shard[]>([]);
  const queue = useRef<PropAsset[] | null>(null);
  const ready = useRef(false);
  const batch = useRef(BASE_WAVE * 2);
  const limit = useRef(1200);
  const live = useRef(0);
  const waveLeft = useRef(0);
  const falling = useRef(false);
  const landAt = useRef(0);
  const moreSeen = useRef(0);
  const nextDrop = useRef(0);
  const perTick = useRef(2);

  const beginWave = (remaining: number) => {
    const count = Math.min(remaining, batch.current);
    if (count <= 0) {
      falling.current = false;
      pileBus.moreReady = false;
      emitPile();
      return;
    }
    const overflow = Math.max(0, live.current + count - limit.current);
    if (overflow > 0) {
      setDrops((prev) => prev.slice(overflow));
      live.current = Math.max(0, live.current - overflow);
    }
    waveLeft.current = count;
    falling.current = true;
    nextDrop.current = performance.now();
    landAt.current = Number.POSITIVE_INFINITY;
    pileBus.moreReady = false;
    emitPile();
  };

  useEffect(() => {
    limit.current = liveLimit();
    const pending = shuffleVisit(ATLAS, visit.seed);
    queue.current = pending;
    batch.current = Math.round(BASE_WAVE * visit.mult);
    perTick.current = Math.max(1, Math.round(batch.current / 150));
    live.current = 0;
    ready.current = true;
    setDrops([]);
    beginWave(pending.length);
    // The visit is fixed for this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit.seed, visit.mult]);

  useFrame(() => {
    const pending = queue.current;
    if (!ready.current || !pending) return;
    if (pileBus.moreTick !== moreSeen.current && !falling.current && pending.length > 0) {
      moreSeen.current = pileBus.moreTick;
      beginWave(pending.length);
    }
    if (waveLeft.current > 0) {
      const now = performance.now();
      const next: Drop[] = [];
      while (waveLeft.current > 0 && pending.length > 0 && now >= nextDrop.current) {
        const n = Math.min(perTick.current, waveLeft.current, pending.length);
        for (let i = 0; i < n; i++) {
          const asset = pending.pop();
          if (!asset) break;
          waveLeft.current -= 1;
          const scale = scaleFor(asset.id, visit.seed);
          const angle = Math.random() * Math.PI * 2;
          const radius = Math.sqrt(Math.random()) * FALL_RADIUS;
          next.push({
            key: asset.id,
            asset,
            scale,
            position: [
              Math.cos(angle) * radius,
              18 + Math.random() * 16,
              Math.sin(angle) * radius,
            ],
            rotation: [Math.random() * Math.PI, Math.random() * Math.PI * 2, Math.random() * Math.PI],
          });
        }
        nextDrop.current += 70;
      }
      if (next.length) {
        live.current += next.length;
        setDrops((prev) => [...prev, ...next]);
      }
      if (waveLeft.current === 0) landAt.current = performance.now() + 2200;
    }
    if (!falling.current || waveLeft.current > 0 || performance.now() < landAt.current) return;
    falling.current = false;
    pileBus.moreReady = pending.length > 0;
    emitPile();
  });

  return (
    <>
      {drops.map((drop) => (
        <QuietBoundary key={drop.key}>
          <Suspense fallback={null}>
            <Prop
              asset={drop.asset}
              scale={drop.scale}
              position={drop.position}
              rotation={drop.rotation}
              onBurst={(next) => {
                setShards((prev) => {
                  const merged = prev.concat(next);
                  return merged.length > 240 ? merged.slice(merged.length - 240) : merged;
                });
              }}
              onGone={() => {
                setDrops((prev) => prev.filter((item) => item.key !== drop.key));
                live.current = Math.max(0, live.current - 1);
              }}
            />
          </Suspense>
        </QuietBoundary>
      ))}
      {shards.map((shard) => (
        <PixelShard key={shard.key} shard={shard} />
      ))}
    </>
  );
}

function WorldForces() {
  const { world } = useRapier();
  const camera = useThree((s) => s.camera);
  const seen = useRef(0);
  const right = useRef(new THREE.Vector3());
  const screenUp = useRef(new THREE.Vector3());
  const gravity = useRef(new THREE.Vector3(0, -13, 0));
  const target = useRef(new THREE.Vector3(0, -13, 0));

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    pileBus.rush *= Math.exp(-dt * 1.35);
    pileBus.heat = Math.max(0, pileBus.heat - dt * 0.035);
    const rush = pileBus.rush;
    const G = 13 + rush * 8;
    right.current.setFromMatrixColumn(camera.matrixWorld, 0);
    right.current.y = 0;
    if (right.current.lengthSq() < 1e-6) right.current.set(1, 0, 0);
    else right.current.normalize();
    screenUp.current.setFromMatrixColumn(camera.matrixWorld, 1);
    screenUp.current.y = 0;
    if (screenUp.current.lengthSq() < 1e-6) screenUp.current.set(0, 0, -1);
    else screenUp.current.normalize();

    if (pileBus.orient.active) {
      const orientAngle =
        ((window.screen.orientation?.angle ?? (window as Window & { orientation?: number }).orientation ?? 0) *
          Math.PI) /
        180;
      const beta = (pileBus.orient.beta * Math.PI) / 180;
      const gamma = (pileBus.orient.gamma * Math.PI) / 180;
      const dx = Math.sin(gamma);
      const dy = -Math.cos(gamma) * Math.sin(beta);
      const dz = -Math.cos(gamma) * Math.cos(beta);
      const cos = Math.cos(-orientAngle);
      const sin = Math.sin(-orientAngle);
      const sx = dx * cos - dy * sin;
      const sy = dx * sin + dy * cos;
      target.current.set(0, dz * G, 0);
      target.current.addScaledVector(right.current, sx * G);
      target.current.addScaledVector(screenUp.current, sy * G);
      if (target.current.lengthSq() > 1e-6) target.current.normalize().multiplyScalar(G);
    } else {
      target.current.set(0, -G, 0);
    }
    const blend = 1 - Math.exp(-dt * 9);
    gravity.current.lerp(target.current, blend);
    world.gravity.x = gravity.current.x;
    world.gravity.y = gravity.current.y;
    world.gravity.z = gravity.current.z;

    const decay = Math.exp(-dt * 7);
    pileBus.jolt.x *= decay;
    pileBus.jolt.y *= decay;
    pileBus.jolt.z *= decay;
    pileBus.jolt.mag *= decay;
    const jmag = pileBus.jolt.mag;
    if (pileBus.orient.active || jmag > 2) {
      for (const body of bodies) {
        if (body !== pileBus.held) body.wakeUp();
      }
    }

    const edge = AREA - 0.7;
    for (const body of bodies) {
      const mass = body.mass();
      if (!Number.isFinite(mass) || mass <= 0 || body === pileBus.held) continue;
      const t = body.translation();
      const dist = Math.hypot(t.x, t.z);
      if (t.y < -0.02) {
        const v = body.linvel();
        body.setTranslation({ x: t.x, y: 0.08, z: t.z }, true);
        body.setLinvel({ x: v.x * 0.9, y: Math.max(2.4, -v.y * 0.72), z: v.z * 0.9 }, true);
        continue;
      }
      if (dist < edge) continue;
      const pull = Math.min(36, Math.max(0, dist - edge) * 6 + Math.max(0, -t.y) * 12);
      const scale = pull * mass * dt;
      const basis = Math.max(dist, 0.2);
      body.applyImpulse({ x: (-t.x / basis) * scale, y: t.y < 0 ? scale : 0, z: (-t.z / basis) * scale }, true);
    }

    if (pileBus.shakeSeq === seen.current) return;
    seen.current = pileBus.shakeSeq;
    const power = pileBus.shakePower;
    const jx = pileBus.jolt.x;
    const jy = pileBus.jolt.y;
    const denom = Math.max(Math.hypot(jx, jy), 0.001);
    const ix = jx / denom;
    const iy = jy / denom;
    for (const body of bodies) {
      const mass = body.mass();
      if (!Number.isFinite(mass) || mass <= 0 || body === pileBus.held) continue;
      body.wakeUp();
      body.applyImpulse(
        {
          x: (right.current.x * ix + screenUp.current.x * iy) * mass * 1.15 * power,
          y: -mass * (1.1 + power * 1.35),
          z: (right.current.z * ix + screenUp.current.z * iy) * mass * 1.15 * power,
        },
        true,
      );
      body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * mass * 0.7 * power,
          y: (Math.random() - 0.5) * mass * 0.45 * power,
          z: (Math.random() - 0.5) * mass * 0.7 * power,
        },
        true,
      );
    }
  });

  return null;
}

function OrbitRig() {
  const ref = useRef<OrbitControlsImpl>(null);
  useFrame(() => {
    if (ref.current) ref.current.enabled = !pileBus.dragging;
  });
  return (
    <OrbitControls
      ref={ref}
      makeDefault
      enablePan
      screenSpacePanning
      panSpeed={1.2}
      rotateSpeed={1.6}
      zoomSpeed={1.15}
      enableDamping
      dampingFactor={0.08}
      minDistance={3.2}
      maxDistance={150}
      minPolarAngle={0.08}
      maxPolarAngle={1.42}
      target={[0, 8.5, 0]}
      touches={{
        ONE: THREE.TOUCH.ROTATE,
        TWO: THREE.TOUCH.DOLLY_PAN,
      }}
    />
  );
}

const PLANE_TILT = Math.PI / 5.4;

function FrameView() {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;

  useEffect(() => {
    const aspect = Math.max(0.35, size.width / Math.max(1, size.height));
    const fov = 52;
    camera.fov = fov;
    const vFov = THREE.MathUtils.degToRad(fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const distH = (AREA * 2 + 2.4) / 2 / Math.tan(hFov / 2);
    const distV = 36 / 2 / Math.tan(vFov / 2);
    const dist = Math.max(distH, distV);
    const look = new THREE.Vector3(0, 8.5, 0);
    camera.position.set(0, look.y + Math.sin(PLANE_TILT) * dist, look.z + Math.cos(PLANE_TILT) * dist);
    camera.near = 0.08;
    camera.far = Math.max(220, dist * 4);
    camera.lookAt(look);
    const fullH = size.height * 1.06;
    camera.setViewOffset(size.width, fullH, 0, 0, size.width, size.height);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(look);
      controls.maxDistance = 150;
      controls.update();
    }
  }, [camera, controls, size.height, size.width]);

  return null;
}

function Stage({ lit, visit }: { lit: boolean; visit: Visit }) {
  return (
    <Physics gravity={[0, -13, 0]} timeStep={1 / 60} maxCcdSubsteps={2}>
      <Backdrop lit={lit} />
      <Lights lit={lit} />
      <Floor lit={lit} />
      <Spawner visit={visit} />
      <WorldForces />
      <OrbitRig />
      <FrameView />
    </Physics>
  );
}

export function PileCanvas({ lit, visit }: { lit: boolean; visit: Visit }) {
  const phone = onPhone();
  return (
    <Canvas
      className="h-full w-full touch-none"
      shadows={false}
      dpr={phone ? 1 : [1, 1.35]}
      camera={{ position: [0, 24, 36], fov: 52, near: 0.08, far: 220 }}
      gl={{ antialias: !phone, alpha: false, powerPreference: "high-performance" }}
      onPointerMissed={() => {
        pileBus.dragging = false;
      }}
    >
      <Suspense fallback={null}>
        <Stage lit={lit} visit={visit} />
      </Suspense>
    </Canvas>
  );
}
