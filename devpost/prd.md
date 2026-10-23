---
doc: prd
status: approved
---

# ParkWise — Product Requirements

One line: A browser-based, interactive 3D parking simulator where a learner driver drives a physics-based car to practice real parking maneuvers, with a coach that first demonstrates the maneuver and then guides her through her own attempt.
Source: `scope.md > The Unique Kernel`, `scope.md > The Core Loop`.

## The Core Journey
Source: `scope.md > The Core Loop`, `scope.md > What "Working" Looks Like`.

1. She opens the link in a browser. Nothing to install. She lands **directly inside a parking scenario** (one of the common maneuvers active to start — e.g. parallel parking), the 3D scene already set up: her car, the target spot, the parked cars/curb around it, and the line markings.
2. **Demo first.** On landing, the coach automatically **demonstrates** the maneuver — the car drives itself through the perfect park while she watches, with the coach's guidance showing near the car.
3. When she's ready, she clicks **Practice**. Control hands over to her.
4. She **drives the car herself**: forward, reverse, and steering, using the keyboard (arrow keys / WASD).
5. As she maneuvers, the **coach** shows live guidance near the car — distances to the car ahead/behind and how much to adjust.
6. She can switch **camera views** at any time: top-down (overhead, 2D-like), in-car (driver's seat / first-person), chase (behind the car), and a free isometric 3D view.
7. When the car comes to rest, the system checks the park: **parked correctly** = within the line markings, roughly straight, and not touching the parked cars or curb. She sees a clear success verdict; otherwise she keeps adjusting.
8. She can **reset / try again** and repeat until the maneuver feels natural. She can **switch between scenarios** — parallel, reverse bay, and angle parking as the core set, with room to add more maneuvers from my own driving experience if time permits.

## Screens and Layout
Single screen: the 3D scene fills the view. Overlaid UI, minimal:
- **Coach guidance** rendered near the car (distances + adjustment prompts). Exact visual form (numbers, arrows) finalized once it's running — see Open Questions.
- **Practice button** (shown after/while the demo plays) to take control.
- **Camera toggle** to switch between the four views.
- **Reset / try again** control.
- **Scenario switcher** to move between the parking situations (parallel, reverse bay, angle, and any added later).
- **Success verdict** message on a clean park.

## Look and Feel
Source: `scope.md > Inspiration & Identity`.
Realistic over arcade — should feel like a genuine practice tool, not a game. 3D via Three.js for visual appeal. Clean, readable, calm: clear line markings and legible guidance cues, closer to a driving instructor + parking sensors than a flashy game. Fine visual details (palette, exact HUD styling) are open and will be settled during the build; nothing cartoonish or arcade-styled.

## Features and Behavior

### Driving the car (interactive, physics-based)
- As the learner, I want to drive the car myself so that practicing feels like real parking, not watching.
  - [ ] Arrow keys / WASD control forward, reverse, and steering.
  - [ ] The car moves like a real car: it turns based on steering + motion (not strafing or teleporting), and reverses believably.
  - [ ] The car responds immediately and continuously while a key is held.

### Camera views
- As the learner, I want multiple views so that I can judge the spot and my position the way I would in a real car.
  - [ ] Four switchable views: top-down (overhead), in-car (first-person), chase (behind), free isometric 3D.
  - [ ] Switching views does not interrupt driving or reset the car.

### The coach — demonstrate, then guide
- As the learner, I want the coach to show me how it's done first and then guide my own attempt so that I learn the maneuver before trying it.
  - [ ] On landing, the coach automatically demonstrates the maneuver: the car drives itself through a correct park while the learner watches.
  - [ ] A **Practice** action hands control to the learner.
  - [ ] During her attempt, guidance appears near the car: distance to the car ahead and behind, and how much to adjust (e.g. reverse more / straighten).
  - [ ] Guidance updates live as the car moves.

### Parking check (pass/fail)
- As the learner, I want a clear verdict so that I know when I've parked correctly.
  - [ ] "Parked correctly" requires: car within the line markings, roughly straight, and not touching the parked cars or curb.
  - [ ] On a correct park, she sees a clear success verdict.
  - [ ] If not correct, no success is shown and she can keep adjusting.

### Reset and scenario switching
- As the learner, I want to retry and switch scenarios so that I can practice repeatedly and cover the common maneuvers.
  - [ ] A reset control returns the car to the start of the current scenario.
  - [ ] A switcher moves between the parking situations — parallel, reverse bay, and angle parking as the core set, with room for more maneuvers if time permits.

### Sensor sound (if it fits)
- As the learner, I want audible proximity cues so that it feels like a real car's parking sensors.
  - [ ] Beeps that speed up as the car nears an obstacle (likely Web Audio API).
  - [ ] Included if it fits within the proof of concept; approach decided at build.

## States and Boundaries
- **First use / arrival** — she lands directly in a scenario; the coach demo plays automatically.
- **Demo playing** — the car drives itself; her driving input is not required (Practice takes over).
- **Practicing** — she has control; coach guidance is live.
- **Success** — a correct park shows the success verdict.
- **Reset** — car returns to the scenario start.
- **Persistence** — nothing is stored between sessions; reopening starts fresh. (No accounts, no saved progress.)

## Product Decisions
- **Land directly in a scenario, switch between them on demand** — avoids a menu wall; fastest to the practice itself. (Her choice.)
- **Demo-first onboarding** — coach demonstrates automatically, then "Practice" hands over control — mirrors how real instruction works.
- **Four camera views including a free isometric 3D** — her idea; top-down especially helps judge the spot.
- **Pass/fail = parked perfectly** — within markings, straight, not touching obstacles. Clean binary, no partial scoring.
- **Keyboard driving (arrow keys / WASD)**; possible mouse support decided at build.
- **Coach guidance lives near the car**; exact visual form finalized once running.

## What We're Building
- A single-screen interactive 3D scene (Three.js) that loads straight into a parking scenario.
- A physics-based, keyboard-driven car (forward/reverse/steer).
- Four switchable camera views.
- A coach that auto-demonstrates the maneuver, then guides the learner's attempt with live distances/adjustment prompts near the car.
- A pass/fail parking check against the line markings and obstacles.
- Reset / try again, and a switcher across the core parking scenarios (parallel, reverse bay, angle).
- Proximity sensor sound (if it fits).

## Deferred From the POC
- **Saved progress / accounts** — nothing persists; not needed to prove the idea.
- **Scenarios beyond the core set** — parallel, reverse bay, and angle cover the common maneuvers; more are optional additions from the learner's own experience if time permits, not committed for the PoC.
- **Deployment to a public URL** — optional for the hackathon (submission needs repo + demo video).
- **Mouse steering** — keyboard first; revisit if time allows.

## Possible Later Enhancements
- Further scenarios beyond the core set (tight spaces, hill parking, different vehicle sizes), drawn from the learner's own experience as time allows.
- Scoring, progress tracking, lessons/levels.
- Difficulty settings or timed challenges.

## Non-Goals
Source: `scope.md > Explicitly Cut`.
- **Open world / free driving** — the point is the maneuvers, not driving around.
- **AI or moving traffic** — significant scope increase not needed to prove the kernel; static parked cars as obstacles are enough.
- **Partial/arcade scoring** — pass/fail only; this is a practice tool, not a game.

## Open Questions
- How the coach demo is produced — a pre-recorded/scripted path the car replays, vs. a programmed solver that computes the maneuver — **can wait**, decide while coding; either is acceptable.
- Exact on-screen form of the coach guidance (live numbers vs. arrows/indicators) — **can wait**, decide once the scene renders.
- Whether mouse controls are added alongside keyboard — **can wait**, build-time call.
- Whether sensor sound makes the PoC cut — **can wait**, add if it fits.
