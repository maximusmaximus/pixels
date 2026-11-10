import ids from "@/data/atlas-ids.json";

const BASE = "https://huggingface.co/datasets/codepawl/pixel-atlas-glb/resolve/main/objects";

export type PropAsset = {
  id: string;
  label: string;
  url: string;
};

// All 6,194 Pixel Art Atlas meshes. Web tier is meshopt + WebP, ~1 unit wide.
export const ATLAS: PropAsset[] = (ids as string[]).map((id) => ({
  id,
  label: id.replaceAll("_", " "),
  url: `${BASE}/${id}/${id}.glb`,
}));

// stuff.grok.me drops round(1% of 2,402 SimReady + 7,953 ABO) = 104 per wave.
export const BASE_WAVE = 104;
