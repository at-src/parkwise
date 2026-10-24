---
doc: checklist
status: approved
---

# Build Checklist

Build mode: fast — chosen for focused execution; still pausing for hands-on feedback at the planned checkpoints.

## Slices

- [x] **1. The scene renders — you open it and see the parking world**
  Becomes usable: Running the local server and opening the page shows the 3D world — road/car park, curb, line markings, a few parked cars, and the learner's car sitting in place. Nothing drives yet.
  Why now: Proves the whole setup end to end on the first step — vanilla JS + CSS wired to Three.js through the local server, scene rendering, camera looking at it — so every later slice has somewhere to land. Bootstrapping lives here, not as its own step.
  PRD ref: `prd.md > The Core Journey` (arrival), `prd.md > Look and Feel`
  Spec ref: `spec.md > Components` (Scene & rendering), `spec.md > File Structure`, `spec.md > Stack`
  Build: Set up the project per the spec's file structure (`index.html`, `app.js`, `style.css`, `server.js`, `lib/`), wire Three.js, build the scene — ground, curb, markings, parked cars, the learner's car — with lighting and a render loop. Keep it plain to start; we'll see where anything needs to get more involved.
  Verify (mechanical): Run `npm start`, open `http://localhost:3000`, confirm the page loads with no console errors and the 3D scene is visible.
  Learner check: Open it and say whether the scene looks like the parking setting you pictured.
  Commit: `Set up project and render the 3D parking scene`

- [x] **2. You can drive the car**
  Becomes usable: Keyboard control (arrow keys / WASD) drives the car — forward, reverse, steering — and it moves like a real car rather than sliding or spinning.
  Why now: Driving is the heart of the tool, so it comes early, not last. This is also where we check the trickiest part first: that reversing curves the car the correct way before we build anything on top of it. If a simple movement approach feels off, we try a more faithful steering model — decide by testing, not upfront.
  PRD ref: `prd.md > Features and Behavior > Driving the car (interactive, physics-based)`
  Spec ref: `spec.md > Components` (Car model, Input handler), `spec.md > Data Model`
  Build: Add keyboard input and the car's movement so steering + throttle move it believably; bind the visible car to its state each frame. Verify reverse-steering behavior early.
  Verify (mechanical): Drive forward, reverse, and steer; confirm the car turns while moving and reverses in the expected direction without sliding sideways.
  Learner check: Take the wheel and confirm driving — especially reversing — feels like a real car.
  Commit: `Add car driving and steering dynamics`

- [x] **3. You can attempt a park and get a verdict**
  Becomes usable: The first real parking situation (parallel) with its layout, and a check that tells you when you've parked correctly — within the markings, straight, not touching the cars/curb.
  Why now: This closes the core loop for the first time — drive, park, get told if it's right — so there's a complete, demonstrable experience as early as possible.
  PRD ref: `prd.md > Features and Behavior > Parking check (pass/fail)`, `prd.md > The Core Journey`
  Spec ref: `spec.md > Components` (Parking check, Scenario & reset)
  Build: Lay out the parallel-parking scenario (start pose, obstacles, bay) and add the geometric check for a correct park, with a clear success verdict and a reset to retry.
  Verify (mechanical): Park within the bay and confirm the success verdict triggers; park badly (crossing a line / touching a car) and confirm it does not.
  Learner check: Try to park and confirm the verdict matches what you'd judge as a clean park.
  Commit: `Add parallel parking scenario and pass/fail check`

- [x] **4. More parking situations to practice**
  Becomes usable: Additional common maneuvers — reverse bay and angle parking — selectable, each with its own layout and the same drive-and-check loop. Switching scenarios rebuilds the scene.
  Why now: Covers the common situations a learner actually faces. Each scenario is a data entry, so this is additive — room to add more from experience later if time permits, without reworking anything.
  PRD ref: `prd.md > Features and Behavior > Reset and scenario switching`, `prd.md > What We're Building`
  Spec ref: `spec.md > Components` (Scenario & reset)
  Build: Define reverse-bay and angle-parking scenarios and a switcher to move between them; reuse the driving and check from earlier slices.
  Verify (mechanical): Switch to each scenario and confirm its layout loads and its parking check works independently.
  Learner check: Switch between the maneuvers and confirm each one practices the situation you intended.
  Commit: `Add reverse bay and angle parking scenarios`

- [ ] **5. The coach — shows you how, then guides you**
  Becomes usable: On landing, the coach demonstrates the maneuver (the car runs through a correct park while you watch), then a Practice action hands control over. During your own attempt, guidance near the car shows distances and how much to adjust, with reference lines. Camera views (top-down, in-car, chase, free 3D) help judge the spot. Proximity sensor beeps if they fit.
  Why now: The coach is the other half of the kernel — the thing that makes this a trainer, not just a driving toy. It builds on a working drive-and-park loop so there's something real to guide.
  PRD ref: `prd.md > Features and Behavior > The coach — demonstrate, then guide`, `prd.md > Camera views`, `prd.md > Features and Behavior > Sensor sound (if it fits)`
  Spec ref: `spec.md > Components` (Coach, Camera system, Sound), `spec.md > Decisions and Open Issues`
  Build: Add the guidance (distances + reference lines) and the demonstrate-the-maneuver mode. The demo path can be computed in code or a pre-recorded/scripted replay — try both and keep whichever reads better. Add the camera views. Add Web Audio proximity beeps if they fit cleanly.
  Verify (mechanical): Confirm the demo runs a correct park on landing, Practice hands over control, guidance updates live as the car moves, and each camera view switches without disturbing the car.
  Learner check: Watch the demo, then practice, and say whether the guidance actually helps you place the car.
  Commit: `Add coach guidance, demonstration mode, and camera views`

- [ ] **6. (If time permits) "What not to do" demonstration**
  Becomes usable: An optional mode that shows a common mistake and its consequence, so the learner sees what goes wrong, not just what goes right.
  Why now: A nice teaching addition once the core trainer works. Explicitly optional — only if time allows; not required to prove the idea.
  PRD ref: `prd.md > Possible Later Enhancements`
  Spec ref: `spec.md > Components` (Coach)
  Build: Add a "try it the wrong way" demonstration that runs a flawed maneuver and explains the mistake. Skip if time is short.
  Verify (mechanical): Trigger the mode and confirm it shows the mistake clearly and returns cleanly to normal practice.
  Learner check: Watch the wrong-way demo and confirm the mistake it shows is one worth warning about.
  Commit: `Add common-mistake demonstration`

## Hands-on Checkpoints

- [x] Early usable behavior explored — after slice 3 (first complete drive → park → verdict loop), try it and give feedback while there's still room to shape the rest.
- [ ] Final kick-the-tires exploration and feedback completed — after the coach slice, explore the whole thing freely.

## Final Review

- [ ] Final review complete — feedback resolved and learner confirms ready to ship

## Code Tour and App Map

- [ ] Learning activity complete — guided route, focused alternative, prior practice connected, or brief recap
- [ ] Optional edit and transfer reflection addressed — offered/declined/already covered/not applicable as appropriate
- [ ] `devpost/app-map.html` generated from finished code, checked, and shown, including a project-grounded practice to reuse

Activity and evidence: [to fill during the wrap-up]
Route and stops: [to fill]
Edit outcome: [to fill]
Reflection: [to fill]
Activity mode: [to fill]

## Revisions

