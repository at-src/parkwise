---
doc: spec
status: approved
---

# ParkWise — Technical Spec

## How This Works, In Plain Language
ParkWise is a single web page that runs entirely in the browser — no server logic, no database, no accounts. When you open it, a small Node static server hands over `index.html`, which loads Three.js and our one main script. From there everything happens on the page.

The page has three jobs working together:

1. **The scene** — Three.js draws a 3D world: a stretch of street (or a car park), parked cars, curb, painted line markings, and the learner's car. A camera shows it, and the learner can switch between four camera views.
2. **The car "brain" (physics)** — a small math model decides where the car is and which way it's pointing. It's a *kinematic bicycle model*: the car has a position, a heading, a speed, and a steering angle, and it moves the way a real car does — pivoting around its rear axle, the front wheels set at their steering (Ackermann) angle. Every frame, we read the keys the learner is holding, update the steering/speed, step the model forward a tiny amount, and move the 3D car to match.
3. **The coach** — watches the car's position relative to the target spot and the parked cars, works out distances (how far to the car ahead/behind, how far off the line), and shows guidance near the car. It can also run a *demonstration*: instead of reading the learner's keys, it feeds the model a correct sequence so the car parks itself while the learner watches, then hands control back when they press **Practice**.

We chose this shape because it's the smallest thing that proves the idea honestly. A full physics engine would add a big dependency and more accuracy than slow parking needs; the bicycle model is light, understandable, and actually *more* faithful for walking-pace maneuvers. No build tools because a single page of ES modules is faster to run, record, and reason about.

## The Core Journey Through the System
PRD ref: `prd.md > The Core Journey`.

1. Learner opens `http://localhost:3000` → the static server returns `index.html` → it loads Three.js and `app.js`.
2. `app.js` builds the scene (ground, markings, parked cars, learner car) and starts the animation loop → she **lands directly in a scenario**.
3. The **coach demo** runs automatically: the car-brain is driven by a correct control sequence, the 3D car replays it, guidance shows near the car. (PRD ref: `prd.md > The coach — demonstrate, then guide`.)
4. She presses **Practice** → the loop switches to reading her keyboard input instead of the demo sequence. (PRD ref: same.)
5. Each frame: read keys → update steering + speed → step the bicycle model → move the 3D car → run collision/position checks → update coach guidance → (optionally) update sensor beeps → render. (PRD ref: `prd.md > Driving the car`.)
6. She presses a view button → the active camera changes; the car and its state are untouched. (PRD ref: `prd.md > Camera views`.)
7. When the car rests, the parking check runs: is it within the markings, roughly straight, and not touching cars/curb? If yes → success verdict. (PRD ref: `prd.md > Parking check`.)
8. She presses reset → car returns to the scenario start; or switches scenario → the scene rebuilds for the chosen maneuver (parallel, reverse bay, angle). (PRD ref: `prd.md > Reset and scenario switching`.)

## Stack
- **Language:** vanilla JavaScript (ES modules), HTML, CSS. No framework, no bundler.
  - Rationale (learner choice): leanest possible setup; nothing to install or compile, trivial to run and record. Tradeoff accepted: we hand-wire DOM/UI updates ourselves instead of a framework doing it.
- **3D:** [Three.js](https://threejs.org/docs/) r0.183, loaded locally from `lib/` (no CDN dependency at runtime).
  - Rationale: the standard, well-documented way to do 3D in the browser; matches the learning goal.
- **Physics:** hand-written **kinematic bicycle model** (no engine).
  - Rationale (learner choice): light, understandable, and accurate for low-speed parking; directly serves the "code based on real-world physics" learning goal. Tradeoff accepted: no general rigid-body collisions — we use geometric overlap checks instead, which is enough for parking.
  - Reference for the model: kinematic bicycle / Ackermann steering geometry (standard vehicle-kinematics material).
- **Collision / parking check:** 2D geometric overlap of the car's footprint rectangle against parked-car rectangles, the curb line, and the bay's line markings.
- **Sound (if it fits):** [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) for proximity beeps generated in code (no audio files needed).
- **Local server:** Node's built-in `http` module (`server.js`) serving static files — no external dependencies.
  - Rationale: ES modules need to be served over `http://`, not opened as a `file://`. A tiny zero-dependency Node server does exactly that.

Nothing above requires an account, key, or paid service.

## Where It Runs and How Someone Tries It
- **Runtime:** the browser (desktop). Served locally by Node.
- **Environment:** Node.js (any recent LTS) to run the static server. No API keys, no env vars.
- **Start command:** `npm start` (runs `node server.js`), then open `http://localhost:3000`.
- **For the required demo recording:** start the server, open the page, and screen-record: land in a scenario → watch the coach demo → press Practice → drive and reverse into the spot with the coach's distance guidance → get the success verdict → reset / switch scenario. (PRD ref: `prd.md > The Core Journey`.)
- **Submission:** a short demo video **and** a public GitHub repository are both required. **Deployment is optional** and not planned for the PoC — a local recording is sufficient. (Revisit in `6-ship` if hosting is wanted.)

## Look and Feel
PRD ref: `prd.md > Look and Feel`; scope ref: `scope.md > Inspiration & Identity`.
Realistic and calm, not arcade. A clean 3D scene at a pleasant, legible scale; clear white line markings; readable guidance text/indicators near the car rather than a busy HUD. Neutral, instructional tone in the copy (like a driving instructor). Interface chrome minimal so the scene is the focus. Styling is plain CSS; Three.js handles the 3D look (lighting, materials). Nothing cartoonish; no game-style scoreboards or flashy effects.

## Components
Organized as plain-JS modules/sections the main script wires together. Each is a home `5-build` can point at.

### Scene & rendering
Builds the Three.js scene: ground/street, curb, painted markings, parked cars, the learner's car, lighting, and the renderer + animation loop.
Talks to: the camera system (what to render), the car model (where to place the learner's car each frame).
PRD ref: `prd.md > The Core Journey` (arrival), `prd.md > Look and Feel`.

### Car model (kinematic bicycle physics)
Holds the car's state (position, heading, speed, steering angle) and advances it each frame from the current inputs using bicycle-model geometry. Exposes the car's footprint for collision/parking checks.
Talks to: input handler (gets steering/throttle), scene (reports pose), collision check, coach.
PRD ref: `prd.md > Driving the car — interactive, physics-based`.

### Input handler
Reads keyboard state (arrow keys / WASD) and turns it into throttle (forward/reverse) and steering intent. (Possible mouse support decided at build.)
Talks to: car model.
PRD ref: `prd.md > Driving the car`.

### Camera system
Manages the four views (top-down, in-car/seat, chase, free isometric) and switches between them without disturbing the car or its state.
Talks to: scene/renderer, UI (view buttons).
PRD ref: `prd.md > Camera views`.

### Coach (demonstrate + guide)
Two behaviors sharing one brain:
- **Guide:** computes distances (to car ahead/behind, offset from the line) and renders guidance near the car, updating live.
- **Demonstrate:** feeds the car model a correct control sequence so it parks itself; yields control when the learner presses Practice.
Talks to: car model (reads pose, and in demo mode supplies inputs), scene/UI (renders guidance), parking check.
PRD ref: `prd.md > The coach — demonstrate, then guide`.

### Parking check
When the car is at rest, tests the footprint against the bay markings and obstacles: within the lines, roughly straight, not touching → success. Otherwise no success.
Talks to: car model (footprint), scene (markings/obstacle rectangles), UI (verdict).
PRD ref: `prd.md > Parking check — pass/fail`.

### Scenario & reset
Defines a set of common parking scenarios (parallel, reverse bay, angle as the core set): where the car starts, where the obstacles and bay are, for each. Reset returns the car to the scenario start; switching scenarios rebuilds the relevant scene pieces. Each scenario is its own data entry, so adding more maneuvers later (from the learner's own experience, if time permits) is a matter of defining another entry rather than reworking the system.
Talks to: scene, car model.
PRD ref: `prd.md > Reset and scenario switching`.

### Sound (optional)
Generates parking-sensor beeps with the Web Audio API, rate increasing as the nearest obstacle gets closer. Included if it fits.
Talks to: collision/distance info from the coach/parking check.
PRD ref: `prd.md > Sensor sound`.

### UI overlay
The on-screen controls: Practice button, camera toggle, reset, scenario switcher, and the success verdict. Plain DOM over the canvas, styled with CSS.
Talks to: all of the above (buttons call into them; verdict reads parking check).
PRD ref: `prd.md > Screens and Layout`.

## Data Model
There is no persistent data and no database. All state is in-memory, in the page, and resets when the tab closes.

- **Car state** — `{ x, z, heading, speed, steerAngle }`. Origin: physics each frame. Lives: a plain object in memory. Updated: every animation frame from inputs. On leave/return: gone; a fresh load starts the scenario from its defined start pose.
- **Scenario definition** — start pose, obstacle rectangles, bay markings, defined per scenario (parallel, reverse bay, angle). Origin: defined in code as a data entry per maneuver. Lives: in memory. Updated: only when switching scenarios.
- **Mode flags** — demo vs. practice, current camera view, current scenario, sound on/off. In memory; reset on reload.

Because nothing persists, there's no storage, no migration, and no "what happens when they come back" beyond "it starts fresh."

## File Structure
```
parkwise/
├── index.html          # Page shell: loads Three.js + app.js, holds the UI overlay
├── app.js              # Main script: scene, car model, input, cameras, coach, checks, loop
├── style.css           # Styling for the page and UI overlay
├── server.js           # Tiny zero-dependency Node static server (serves over http://)
├── package.json        # "start": node server.js
├── lib/
│   ├── three-0.183.2.js  # Vendored Three.js (no runtime CDN)
│   └── fonts.css         # Local fonts
└── devpost/            # Devpost learning workspace (planning docs — not app code)
    ├── learner-profile.md
    ├── scope.md
    ├── prd.md
    └── spec.md
```
Note: if `app.js` grows large, the components above can be split into separate ES modules (e.g. `car.js`, `coach.js`, `scene.js`) imported by `app.js`. Start in one file; split only if it helps.

## External Services and Dependencies
None. No external APIs, no database, no hosting, no keys. Three.js is vendored locally; the Web Audio API and the Node `http` module ship with the browser and Node respectively. This keeps the build offline-capable and free.

## Important Failure Modes
- **Reverse steering feels wrong** → the maneuver becomes impossible and the demo looks broken. Fallback/plan: verify reverse geometry *first* (see Decisions) before building anything on top of it.
- **The car tunnels through a parked car at speed** → collision missed between frames. Fallback: cap speed to walking pace (realistic anyway) and check overlap every frame; if needed, sample a couple of sub-steps per frame.
- **ES modules fail when opening the file directly** (`file://`) → blank page. Fallback: always run via `npm start` and open `http://localhost:3000`; document this clearly in the README and spec.

## What Was Simplified and Why
- **Kinematic bicycle model** instead of a full rigid-body physics engine — slow parking doesn't need tire slip or collision impulses, and the model is lighter and more educational. The fuller version would add a physics-engine dependency, more setup, and debugging whose payoff the demo wouldn't show.
- **Geometric overlap checks** instead of engine collisions — a rectangle-overlap test against obstacles and markings is enough to judge a park and detect a bump.
- **A small set of defined scenarios** (parallel, reverse bay, angle) instead of a full scenario editor/level system — these cover the common maneuvers and prove the idea. Each is a data entry, so more can be added from experience if time permits; a general authoring system is deferred.
- **No persistence** instead of saved progress/accounts — nothing about the idea needs memory between sessions.

## Decisions and Open Issues
**Decisions made (with tradeoffs):**
- Vanilla JS + Three.js + CSS, no bundler (learner choice) — leanest setup; we hand-wire UI updates.
- Kinematic bicycle model, no physics engine (learner choice) — light + accurate for parking; collisions via geometry.
- Coach demo produced in code (computed/scripted control sequence the car replays), leaning in-code but keeping a pre-recorded path as a fallback option — decided finally at build.
- Local run + screen recording for the submission; deployment deferred (optional).

**The one useful unknown (learning goal):**
- **Reversing in the bicycle model.** The learner's stated learning goal is real-world-physics code, and the genuinely tricky part is reverse steering: at negative speed the car curves opposite to the intuitive direction, and parallel parking is mostly a reverse maneuver. Plan: verify this *first* in the build — drive the car in reverse and confirm it curves correctly before layering the coach, checks, or scenarios on top. Evidence it's resolved: reversing with the wheel turned one way consistently swings the rear the correct way into the bay.

**Still open (none block the build; all resolvable while coding):**
- Exact on-screen form of the coach guidance (live numbers vs. arrows) — decide once the scene renders. Carried from `prd.md > Open Questions`.
- Whether mouse controls are added alongside keyboard — build-time call.
- Whether sensor sound makes the PoC cut — add if it fits.
