---
doc: scope
status: approved
---

# ParkWise

One line: A browser-based, interactive 3D parking simulator where a learner driver actually drives the car to practice real parking maneuvers, with physics-based movement and a coach that gives real spatial guidance.

## The Unique Kernel
It's **realistic, not arcade**. Unlike the many pay-store arcade parking games, ParkWise models the car with real physics (not random or faked motion) and includes a **coach** that gives the learner genuine spatial guidance — how far the car ahead is, how much room is left behind, how far to reverse and adjust — alongside proper reference lines. Real physics + a real coach is the thing a learner would miss if it were gone.

## Who It's For
The learner's cousin: a learner driver preparing for her driving test who is anxious about parking and doesn't yet have a good grip on the maneuvers. Today she can only practice in a real car (stressful, limited chances) or play arcade parking games that don't behave like a real car. She wants a low-pressure place to practice the actual maneuvers until they feel natural. Broader learner drivers are a welcome bonus if it helps them too.

## The Core Loop
She opens the link in a browser — nothing to install — and is in a parking scenario straight away. She **drives the car herself** with the controls (steer, forward, reverse), working through the maneuver. The coach gives live spatial guidance (distance to the car ahead/behind, how much to reverse, when to straighten) and can also **demonstrate the maneuver itself** — a "watch how it's done" tutorial mode — so she can see the whole thing happen before trying. She sees whether she parked cleanly within the lines, then resets and tries again until it feels natural. She comes back because each attempt builds real confidence for the test.

## Inspiration & Identity
Realistic over arcade — should feel like a genuine driving/parking practice tool, not a game. Three.js in 3D for the visual appeal (the learner is drawn to how visually striking Three.js can be). Clean, readable, calm — reference lines and clear distance/guidance cues, like a mix of a driving instructor and parking sensors.

## Why This Matters to the Learner
"Last week I met my cousin who has her driving test and she was anxious that she didn't have good grip on parking situations." The learner overcame the same difficulty through a lot of practice and wants to give her a place to build that confidence. It's also a chance to get better at Three.js and at writing code grounded in real-world physics.

## What "Working" Looks Like
She opens the link, lands directly in a parking scenario, and drives the car with the controls. The physics make the car move like a real car (steering geometry, reversing). The coach reports real distances and tells her how much to adjust. She completes a maneuver, gets a clear "parked correctly / hit the curb/line" verdict, and can reset to retry. **The "oh, that's cool" beat:** reversing into a parallel spot in 3D while the coach counts down the distance to the car behind — and nailing it.

## The POC Boundary
In, stated tightly:
- Interactive 3D scene in the browser (Three.js), drivable car.
- Physics-based car movement (steering, forward/reverse) that behaves believably.
- A set of common parking scenarios a learner faces — parallel parking, reverse bay parking, and angle parking as the core set. If time permits, I'd like to add more situations drawn from my own driving experience, since I genuinely want this to help her; those stay optional, not promised.
- A coach that both gives live spatial guidance (distances, how much to adjust) with reference lines, and can demonstrate the maneuver itself (tutorial / "watch how it's done" mode).
- A clear success/fail check against the parking lines.
- Reset / try again.
- Proximity sensor sound cues (parking-sensor-style beeps that speed up as the car nears an obstacle), likely via the Web Audio API — included if it fits; exact approach decided at build.

## Later
- Further parking scenarios beyond the core set, added from the learner's own experience as time allows.
- Deployment to a public URL (optional for the hackathon).
- Scoring, progress tracking, or lessons/levels.

## Explicitly Cut
- **Open world / free driving** — expands scope well beyond parking practice; the point is the maneuvers.
- **AI or moving traffic** — significant scope increase (behavior, pathfinding) that isn't needed to prove the kernel; parked cars as static obstacles are enough.
