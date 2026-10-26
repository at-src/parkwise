# 🚗 ParkWise

> An interactive browser-based 3D parking simulator and visual spatial tutor designed for learner drivers and driving test candidates.

![ParkWise Preview](https://img.shields.io/badge/WebGL-Three.js_0.183-blue?style=for-the-badge)
![Physics](https://img.shields.io/badge/Physics-Bicycle_Kinematics-orange?style=for-the-badge)
![Audio](https://img.shields.io/badge/Audio-Web_Audio_API-green?style=for-the-badge)
![Offline First](https://img.shields.io/badge/Assets-100%25_Self_Contained-purple?style=for-the-badge)

---

## 🎯 The Problem & Vision
Novice drivers consistently report parallel and reverse-bay parking as their greatest source of test anxiety. Traditional driving test manuals rely on static 2D diagrams that fail to communicate a fundamental physical truth: **cars do not rotate like bicycles; they pivot around the center of the rear axle.**

**ParkWise** solves this by projecting dynamic turning points, trajectory arcs, and steering lock angles directly onto the road in real-time 3D, accompanied by a realistic bicycle-kinematics physics engine.

---

## ✨ Key Features

1. **5 Interactive Maneuver Sequences:**
   * **Parallel Parking (5 steps):** Reverse into a curbside gap with live 45° angle guidance.
   * **Reverse Bay Parking (4 steps):** Swing out and back smoothly between two parked cars.
   * **Forward Bay Parking (4 steps):** Arc wide into a parking stall.
   * **45° Angle Parking (4 steps):** Smooth entry into diagonal parking bays.
   * **Hill Parking:** Interactive demonstration of wheel-locking orientation into curbs to prevent rollaway.

2. **Dynamic Ground Guidance Overlays:**
   * Real-time **"Turning Point Pivot"** anchored to the pavement ($3.8\text{ m}$ out at full lock).
   * Live steering wheel reticle showing exact wheel rotations and lock angles.
   * Dynamic trajectory arcs showing front bumper swing and rear cut.

3. **"See the Classic Mistake" Demonstration:**
   * One-click simulation demonstrating the physics of common mistakes (e.g. holding full lock too long and grinding tyres into the curb).

4. **Interactive Practice Drive Mode:**
   * Take the wheel with keyboard controls (`W/A/S/D` or Arrow Keys).
   * Dual front and rear raycasting distance sensors with audible proximity beepers.
   * Real-time collision detection against curbs and neighboring vehicles.

5. **Multi-Camera Viewport:**
   * **Orbit:** Full orbit, zoom, and pan around the yard.
   * **Top:** Bird's-eye view for spatial awareness.
   * **Chase:** Third-person camera riding behind the car.
   * **Driver:** Cockpit view with working rear-view and wing mirrors.

7. **Driving-School Yard Look:**
   * A daylight yard with a terracotta school building, polished floor reflections, black-and-yellow kerbs and a learner car with a roof sign.
   * A light paper-style HUD: top bar for manoeuvres and cameras, a lesson card on the right, a steering gauge and a player dock at the bottom.
   * Left- or right-hand traffic, auto-detected from your browser region.

6. **100% Procedural & Self-Contained:**
   * Zero external image, audio, or model asset downloads.
   * Procedural Web Audio API sound synthesis (engine combustion strokes, tyre squeal, indicator clicks).
   * Fully functional offline.

---

## 🚀 Quick Start

### Prerequisites
* [Node.js](https://nodejs.org/) (v18+)

### Installation & Launch
```bash
# From the project folder
cd parkwise

# Start the local server
npm start
```

Open your browser to:
👉 **`http://localhost:3000`**

---

## 📋 Devpost Learn Project Documentation
This project was designed and built following the official **Devpost Learn** engineering specification workflow:

* 📄 [**Learner Profile**](devpost/learner-profile.md) : Background, motivations, and learning objectives.
* 📄 [**Scope Document**](devpost/scope.md) : The core kernel, loop, and proof-of-concept boundaries.
* 📄 [**Product Requirements Document (PRD)**](devpost/prd.md) : Complete user journey and functional specifications.
* 📄 [**Technical Specification**](devpost/spec.md) : Kinematics math, WebGL shaders, and audio architecture.
* 📄 [**Build Checklist**](devpost/checklist.md) : Verified incremental build log.
* 🗺️ [**App Map**](devpost/app-map.html) : Where each part of the code lives and how a frame flows through it.

---

## 🛠️ Tech Stack
* **Graphics:** [Three.js](https://threejs.org/) (WebGL) with custom GTAO, Bloom, and SMAA post-processing.
* **Physics:** Custom discrete bicycle kinematic model ($R = L / \tan(\delta)$).
* **Audio:** Web Audio API procedural synthesis.
* **Styling:** Vanilla CSS, paper-style HUD (Plus Jakarta Sans + JetBrains Mono, bundled locally).

---

## 📜 License
MIT License.
