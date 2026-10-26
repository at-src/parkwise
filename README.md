# ParkWise

> An interactive, browser-based 3D parking simulator that helps learner drivers practise the common exam maneuvers and build real spatial confidence — with physics-based car movement and a coach that guides each step.

ParkWise runs instantly in any modern browser. No install, no plugins, no account.

---

## Inspiration

Last week my younger cousin told me how anxious she was about her upcoming driving road exam. Like a lot of new drivers, her biggest stress was parking: how to approach a space, when to turn the wheel, and how not to clip the curb.

The driver handbooks we looked at used flat 2D overhead diagrams that never really explain how a real car pivots around its rear wheels, and video tutorials gave her nothing to actually practise on. She's non-technical, so installing a game engine or heavy software was out. I wanted something she could open from a link and start using straight away — a safe visual sandbox to build spatial awareness before she's in a real car.

## What it does

ParkWise is an interactive 3D spatial trainer for learner drivers:

- **The common exam maneuvers** — guided practice for parallel, reverse bay, and angle parking, with more situations I can add from my own driving experience as time allows.
- **Realistic steering, not arcade rotation** — the car moves on a kinematic bicycle model, so it pivots around the rear axle like a real car rather than spinning on its center.
- **A coach that demonstrates, then guides** — the coach first drives the maneuver itself so you can watch it, then you take the wheel and it tells you the distance to the car ahead/behind and how much to adjust, with reference lines on the road.
- **Multiple camera views** — overhead, chase, and a driver's-seat view with working mirrors, so you can judge your alignment from any angle.
- **Proximity cues** — parking-sensor-style beeps that speed up as you near a curb or another car.
- **A "what not to do" demo** — shows a common mistake and why it goes wrong, so you learn the failure as well as the success.

## How I built it

I built ParkWise with the **Devpost Learn** plan-first, flipped-interaction workflow — scoping the idea, writing the requirements and a technical spec, then building it in verifiable steps, before and during the code.

- **Planning first:** the agent interviewed me and I made the decisions; each planning doc guided the next.
- **3D in the browser:** the scene, lighting, and car are built with Three.js, with everything bundled locally so it works fully offline.
- **Car physics:** the steering and turning geometry are a hand-written kinematic bicycle model in vanilla JavaScript — no physics engine — which is light and accurate for low-speed parking.
- **Audio:** proximity cues are generated with the native Web Audio API, so there are no audio files to download.
- **UI:** a clean HUD in plain HTML and CSS, with locally bundled fonts.

## Challenges

- **Getting reverse steering right.** Reversing is the counterintuitive part of the bicycle model and most of what parallel parking is, so I verified that behavior early before building the coach and scenarios on top of it.
- **Keeping it smooth in the browser.** Real-time 3D with shadows had to stay responsive on an ordinary laptop, which meant keeping the scene and draw calls in check.
- **A readable HUD.** Showing useful steering cues and distances without covering the parking view took some back-and-forth on the camera and overlay.

## What I learned

- How vehicle turning mechanics translate into interactive 3D code — writing movement grounded in real physics.
- How to work with an AI coding agent through structured planning instead of unstructured prompting, and the value of keeping some decisions deliberately open until build time.
- Practical techniques for 3D performance in the browser.

## What's next

- Different vehicle sizes, to show how wheelbase affects the turning point.
- More scenarios drawn from my own driving experience.
- Printable one-page maneuver summaries for quick review before test day.

---

## Run it locally

Requires [Node.js](https://nodejs.org/) (v18+).

```bash
cd parkwise
npm start
```

Then open **http://localhost:3000**.

---

## Planning documents

Built following the Devpost Learn plan-first workflow. The planning artifacts live in `devpost/`:

- [Scope](devpost/scope.md) — the core idea, kernel, and proof-of-concept boundary.
- [Product Requirements (PRD)](devpost/prd.md) — the user journey and behaviors.
- [Technical Spec](devpost/spec.md) — stack, architecture, and data flow.
- [Build Checklist](devpost/checklist.md) — the ordered build slices.
- [App Map](devpost/app-map.html) — where each part of the code lives and how a frame flows through it.

## Tech stack

- **3D:** [Three.js](https://threejs.org/) (WebGL)
- **Physics:** hand-written kinematic bicycle model
- **Audio:** Web Audio API (procedural)
- **UI:** vanilla HTML and CSS, locally bundled fonts
- **Server:** zero-dependency Node static server

## License

[MIT](LICENSE)
