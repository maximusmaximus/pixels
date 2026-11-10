# PIXELS

A physics pile of every model in the [Pixel Art Atlas](https://huggingface.co/datasets/codepawl/pixel-atlas-glb). Each visit gets its own rain.

PIXELS is a fork of [SimReady Pile](https://github.com/maximusmaximus/simready-pile), the stuff.grok.me floor where product models drop, bounce, and pile up when you tilt the phone. The membrane floor, the ring, the tilt gravity, and the More Stuff waves are that idea. The catalog is not. SimReady’s decimated props are replaced by all **6,194** Pixel Art Atlas meshes from [codepawl/pixel-atlas-glb](https://huggingface.co/datasets/codepawl/pixel-atlas-glb).

The circled **i** on the canvas opens this page in a new window.

## What you can do

- A new shuffle and a new wave size every visit, from 2× to 10× the original pile.
- Each model lands at a random size from small to XL.
- The landing circle is twice as wide as the original, and models fall from high above it.
- Drag one to move it. Hold still and it bursts into pixel blocks that knock the pile around.
- While you hold it, its name flashes above More Stuff in the average color of its pixels.
- Tilt the phone, or shake it, and the pile slides.

## Stack

React, Three.js, React Three Fiber, and Rapier. Models stream from the Hugging Face dataset as meshopt GLBs. No account, no saved pile. The shuffle for a visit lives in the browser for that session only.
