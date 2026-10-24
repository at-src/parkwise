import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
const $ = (s) => document.querySelector(s),
  host = $('#world'),
  app = $('#app');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp = (a, b, t) => a + (b - a) * t,
  smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
const out3 = (t) => 1 - (1 - t) ** 3,
  ease = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
function mulberry(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry(7),
  hash = (n) => {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
const X_URL = '#';
const SLUG = 'parking';

// ======================================================================= renderer (the lens lab's: ACES, PCF shadows, HalfFloat composer) in a showroom at dusk
// Scale: 1 unit is 25 cm (the training ground and the cars are modelled in metres inside a group scaled by 4). The floor is y=0; the slab's top is ROAD_Y.
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d7e6f4');
scene.fog = new THREE.FogExp2('#dfeaf5', 0.0065);
const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 320); // near 12.5 cm: a depth buffer's precision goes as near / z², and at 2.5 cm the road's paint fought the asphalt at the hero's distance
let renderer;
try {
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
} catch (e) {
  $('#loading').textContent =
    'This needs WebGL. Try a browser with hardware acceleration turned on.';
  throw e;
}
const PIX_BUDGET = 2.5e6; // about 2.5 million pixels (1440×900 at 1.39×): with MSAA 4 and SMAA that is ~14 ms of an M1 Pro's GPU; the fill rate is the cost
// 1 is the floor and it is not negotiable: below it the whole frame is drawn small and stretched back
// up, and the first casualties are text, in-scene labels and every thin edge. A wide display reaches
// sqrt(PIX_BUDGET/(w*h)) = 0.82 at 2560×1440 with nothing being slow at all. Buy the time back from
// MSAA, the half-res passes, reflections or the shadow map, never from resolution.
const fitRatio = () => {
  const w = innerWidth || 1440,
    h = innerHeight || 840;
  return clamp(
    Math.min(devicePixelRatio, 2, Math.sqrt(PIX_BUDGET / (w * h))),
    1,
    2,
  );
};
const maxRatio = fitRatio();
renderer.setPixelRatio(maxRatio);
renderer.info.autoReset = false;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.transmissionResolutionScale = 0.6;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);
// a cool room fill, the low sun through the window on the right (warm, long shadows), a cyan rim from the hologram wall, a soft key from the front left
const hemi = new THREE.HemisphereLight(0x8fa6d8, 0x3a3026, 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc98f, 2.1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -11,
  right: 11,
  top: 9,
  bottom: -7,
  near: 1,
  far: 60,
});
sun.shadow.normalBias = 0.03;
sun.shadow.bias = -0.0004;
sun.shadow.radius = 2;
scene.add(sun, sun.target);
const sunDir = new THREE.Vector3(0.62, 0.62, 0.48).normalize();
sun.position.copy(sunDir).multiplyScalar(30);
sun.target.position.set(0, 2, 0);
const rim = new THREE.DirectionalLight(0xf2f6ff, 0.9);
rim.position.set(-6, 9, -14);
scene.add(rim);
const key2 = new THREE.DirectionalLight(0xfff1e0, 0.55);
key2.position.set(-8, 12, 10);
scene.add(key2);
const world = new THREE.Group();
scene.add(world);

// shared shading (Token Town): cheap fake point lights + a saturation tone, patched into every standard material
const NL = 10,
  fake = {
    pos: {
      value: Array.from({ length: NL }, () => new THREE.Vector4(0, -999, 0, 1)),
    },
    col: { value: Array.from({ length: NL }, () => new THREE.Vector3()) },
  };
const FAKE_PARS = `uniform vec4 uFakePos[${NL}];uniform vec3 uFakeCol[${NL}];uniform float uSat;`;
const FAKE_LIGHT = `#include <lights_fragment_end>
{vec3 fp=-vViewPosition;for(int i=0;i<${NL};i++){vec3 d=uFakePos[i].xyz-fp;float dd=dot(d,d);float a=max(0.,1.-dd*uFakePos[i].w);a*=a;float n=dot(normal,d)*inversesqrt(dd+1e-4);reflectedLight.directDiffuse+=uFakeCol[i]*(a*(max(n,0.)*.8+.2))*material.diffuseContribution;}}`;
const FAKE_TONE = `outgoingLight=max(mix(vec3(dot(outgoingLight,vec3(.2126,.7152,.0722))),outgoingLight,uSat),0.);
#include <opaque_fragment>`;
const worldSat = { value: 1.16 };
// three 0.183: a material with no envMap of its own lit by scene.environment gets scene.environmentIntensity in place of
// its envMapIntensity, so every per-material value is silently ignored. uEnvK puts it back: the IBL ends up at
// scene.environmentIntensity × material.envMapIntensity. A material carrying its own envMap already gets its own value: K=1.
const ENVK = `#include <lights_fragment_maps>
#ifdef USE_ENVMAP
 iblIrradiance*=uEnvK;
 #ifdef RE_IndirectSpecular
  radiance*=uEnvK;clearcoatRadiance*=uEnvK;
 #endif
#endif`;
function patch(m, extra) {
  m.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, {
      uFakePos: fake.pos,
      uFakeCol: fake.col,
      uSat: worldSat,
      uEnvK: {
        get value() {
          return m.envMap ? 1 : m.envMapIntensity;
        },
      },
    });
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uEnvK;\n' + FAKE_PARS,
      )
      .replace('#include <lights_fragment_maps>', ENVK)
      .replace('#include <lights_fragment_end>', FAKE_LIGHT)
      .replace('#include <opaque_fragment>', FAKE_TONE);
    extra?.(s);
  };
  m.customProgramCacheKey = () => SLUG + (extra ? extra.key : '');
  return m;
}
const lightPool = [];
function addLight(x, y, z, color, radius, intensity) {
  const L = {
    p: new THREE.Vector3(x, y, z),
    c: new THREE.Color(color),
    r: radius,
    i: intensity,
    i0: intensity,
  };
  lightPool.push(L);
  return L;
}
const _lv = new THREE.Vector3(),
  _picked = [],
  focPt = new THREE.Vector3(0, 3, 0);
function pickLights(ref) {
  _picked.length = 0;
  for (const L of lightPool) {
    if (L.i <= 0.001) continue;
    L.score = (L.i * L.r) / (1 + L.p.distanceToSquared(ref) * 0.01);
    if (_picked.length < NL) {
      _picked.push(L);
      if (_picked.length === NL) _picked.sort((a, b) => a.score - b.score);
    } else if (L.score > _picked[0].score) {
      _picked[0] = L;
      for (
        let j = 0;
        j < NL - 1 && _picked[j].score > _picked[j + 1].score;
        j++
      ) {
        const t = _picked[j];
        _picked[j] = _picked[j + 1];
        _picked[j + 1] = t;
      }
    }
  }
}
// the lights live in view space, so every camera that renders sets them for itself
function updateFakeLights(cam, ref) {
  pickLights(ref);
  for (let i = 0; i < NL; i++) {
    const L = _picked[i];
    if (!L) {
      fake.col.value[i].set(0, 0, 0);
      fake.pos.value[i].set(0, -999, 0, 1);
      continue;
    }
    _lv.copy(L.p).applyMatrix4(cam.matrixWorldInverse);
    fake.pos.value[i].set(_lv.x, _lv.y, _lv.z, 1 / (L.r * L.r));
    fake.col.value[i].set(L.c.r * L.i, L.c.g * L.i, L.c.b * L.i);
  }
}

// ---- environments for everything glossy (cube-graph's trick). show: navy walls, a warm window on the right, cool and amber softboxes (the lens lab's).
// studio: a pale sweep with big white softboxes, for the Studio view.
const ENV = {};
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sky = (frag) =>
    new THREE.Mesh(
      new THREE.SphereGeometry(50, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        vertexShader:
          'varying vec3 d;void main(){d=normalize(position);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
        fragmentShader: frag,
      }),
    );
  const box = (s, w, h, c, x, y, z) => {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, 0.4),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(...c) }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  {
    const s = new THREE.Scene();
    s.add(
      sky(
        'varying vec3 d;void main(){vec3 c=mix(vec3(.30,.30,.28),vec3(.92,.95,1.),smoothstep(-.3,.04,d.y));c=mix(c,vec3(.42,.62,1.),smoothstep(.12,.85,d.y));c+=vec3(2.6,2.5,2.3)*pow(max(dot(d,normalize(vec3(-.38,.9,.42))),0.),48.);gl_FragColor=vec4(c,1.);}',
      ),
    );
    const SOFT = [
      [3.2, 3.3, 3.5],
      [2.6, 2.8, 3.2],
      [3.4, 3.4, 3.3],
      [2.4, 2.6, 3.0],
      [3.0, 3.1, 3.3],
      [2.8, 2.8, 2.8],
    ];
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.4;
      box(
        s,
        12,
        2.4,
        SOFT[k],
        Math.sin(a) * 28,
        12 + (k % 2) * 9,
        Math.cos(a) * 28,
      );
    }
    {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(40, 1.2, 1.2),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.25, 1.3) }),
      );
      m.position.set(0, -6, -30);
      s.add(m);
    }
    ENV.show = pmrem.fromScene(s, 0.03).texture;
  }
  {
    const s = new THREE.Scene();
    s.add(
      sky(
        'varying vec3 d;void main(){vec3 c=mix(vec3(.62,.56,.49),vec3(1.02,.97,.9),smoothstep(-.35,.15,d.y));c=mix(c,vec3(1.1,1.08,1.04),smoothstep(.4,.95,d.y));gl_FragColor=vec4(c,1.);}',
      ),
    );
    box(s, 26, 12, [7, 6.8, 6.4], -14, 22, 12);
    box(s, 18, 9, [4.2, 4.4, 4.8], 24, 12, 6);
    box(s, 30, 6, [3.2, 3.1, 3], 0, 30, -10);
    box(s, 8, 20, [5, 4.8, 4.6], -26, 8, -6);
    ENV.studio = pmrem.fromScene(s, 0.03).texture;
  }
  pmrem.dispose();
}
scene.environment = ENV.show;
scene.environmentIntensity = 0.7;

// ---- the mirror in the polished floor (token-factory's): the camera reflected in the floor plane with an oblique near plane, drawn small and read blurred
const FLOOR_Y = 0,
  reflTarget = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
const reflU = {
  tReflect: { value: reflTarget.texture },
  uReflMatrix: { value: new THREE.Matrix4() },
  uReflStrength: { value: 0.5 },
};
const reflExtra = Object.assign(
  (s) => {
    Object.assign(s.uniforms, reflU);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform mat4 uReflMatrix;varying vec4 vReflCoord;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\n{vec4 wp=modelMatrix*vec4(transformed,1.);vReflCoord=uReflMatrix*wp;}',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D tReflect;uniform float uReflStrength;varying vec4 vReflCoord;',
      )
      .replace(
        'outgoingLight=max(mix(',
        `{float facing=saturate(dot(normal,normalize(vViewPosition)));float gl=1.-roughnessFactor;
   vec3 mir=texture2D(tReflect,vReflCoord.xy/max(vReflCoord.w,1e-4),.5).rgb;outgoingLight=mix(outgoingLight,mir,uReflStrength*gl*(.25+.75*pow(max(1.-facing,0.),2.)));}
  outgoingLight=max(mix(`,
      );
  },
  { key: 'refl' },
);
const reflCam = new THREE.PerspectiveCamera(),
  reflN = new THREE.Vector3(0, 1, 0),
  reflP = new THREE.Vector3(0, FLOOR_Y, 0);
const _rc = new THREE.Vector3(),
  _rl = new THREE.Vector3(),
  _rr = new THREE.Matrix4(),
  _rpl = new THREE.Plane(),
  _clip = new THREE.Vector4(),
  _rq = new THREE.Vector4(),
  hideInMirror = [];
const mirrorOnly = []; // seen only in the floor's mirror (a strip tucked under an overhang): hidden in every other pass
function renderReflection() {
  if (
    !RT.reflect ||
    reflU.uReflStrength.value <= 0 ||
    camera.position.y <= FLOOR_Y ||
    !sun.shadow.map
  )
    return; // no shadow map yet (first frame, or just resized): the shadow samplers would read an empty texture
  _rc.setFromMatrixPosition(camera.matrixWorld);
  _rr.extractRotation(camera.matrixWorld);
  reflCam.position.subVectors(reflP, _rc).reflect(reflN).negate().add(reflP);
  _rl.set(0, 0, -1).applyMatrix4(_rr).add(_rc);
  _rl.subVectors(reflP, _rl).reflect(reflN).negate().add(reflP);
  reflCam.up.set(0, 1, 0).applyMatrix4(_rr).reflect(reflN);
  reflCam.lookAt(_rl);
  reflCam.far = camera.far;
  reflCam.updateMatrixWorld();
  reflCam.projectionMatrix.copy(camera.projectionMatrix);
  reflU.uReflMatrix.value
    .set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
    .multiply(reflCam.projectionMatrix)
    .multiply(reflCam.matrixWorldInverse);
  _rpl
    .setFromNormalAndCoplanarPoint(reflN, reflP)
    .applyMatrix4(reflCam.matrixWorldInverse);
  _clip.set(_rpl.normal.x, _rpl.normal.y, _rpl.normal.z, _rpl.constant);
  const e = reflCam.projectionMatrix.elements;
  _rq.set(
    (Math.sign(_clip.x) + e[8]) / e[0],
    (Math.sign(_clip.y) + e[9]) / e[5],
    -1,
    (1 + e[10]) / e[14],
  );
  _clip.multiplyScalar(2 / _clip.dot(_rq));
  e[2] = _clip.x;
  e[6] = _clip.y;
  e[10] = _clip.z + 1;
  e[14] = _clip.w;
  // things are hidden here, so a pending shadow update must wait for the scene pass (or the sun's map is drawn without them: no shadows at all)
  const vis = hideInMirror.map((o) => o.visible),
    su = renderer.shadowMap.needsUpdate;
  hideInMirror.forEach((o) => (o.visible = false));
  mirrorOnly.forEach((o) => (o.visible = true));
  renderer.shadowMap.needsUpdate = false;
  updateFakeLights(reflCam, focPt);
  LL_U.uRes.value.set(reflTarget.width, reflTarget.height); // light lines keep their width in the mirror's own pixels
  renderer.setRenderTarget(reflTarget);
  renderer.clear();
  reflTarget.texture.generateMipmaps = false;
  renderer.render(scene, reflCam);
  reflBlur();
  renderer.setRenderTarget(null);
  LL_U.uRes.value.copy(OV_U.uRes.value);
  hideInMirror.forEach((o, i) => (o.visible = vis[i]));
  mirrorOnly.forEach((o) => (o.visible = false));
  renderer.shadowMap.needsUpdate = su;
}

// ======================================================================= post (the lens lab's): MSAA scene pass → half-res GTAO → half-res bloom → half-res gather DOF → overlay → output → SMAA
const quadVS =
  'varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
const fsMat = (fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader: quadVS,
    fragmentShader,
    depthTest: false,
    depthWrite: false,
  });
// the mirror is read blurred: a separable Gaussian over the half-size reflection (σ about 1 of its texels), then mipmapped for the floor's grazing
// angles. Reading a coarse mip instead (the old bias of 1.6) is not the same everywhere: a thin bright line comes out wide where it falls between
// that mip's rows and narrow where it falls on one, so a strip's reflection climbed the floor in steps. The mips are built once, after the
// blur: the scene render into the target leaves them off (switched off only once the target is bound, so a resized one is still made with room for them).
const reflTmp = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  }),
  reflBlurU = { t: { value: null }, dir: { value: new THREE.Vector2() } };
const reflBlurQ = new FullScreenQuad(
  fsMat(
    `uniform sampler2D t;uniform vec2 dir;varying vec2 vUv;void main(){
 gl_FragColor=vec4(texture2D(t,vUv).rgb*.294118+(texture2D(t,vUv+dir*1.333333).rgb+texture2D(t,vUv-dir*1.333333).rgb)*.352941,1.);}`,
    reflBlurU,
  ),
);
function reflBlur() {
  const w = reflTarget.width,
    h = reflTarget.height;
  if (reflTmp.width !== w || reflTmp.height !== h) reflTmp.setSize(w, h);
  reflBlurU.t.value = reflTarget.texture;
  reflBlurU.dir.value.set(1 / w, 0);
  renderer.setRenderTarget(reflTmp);
  reflBlurQ.render(renderer);
  reflBlurU.t.value = reflTmp.texture;
  reflBlurU.dir.value.set(0, 1 / h);
  reflTarget.texture.generateMipmaps = true;
  renderer.setRenderTarget(reflTarget);
  reflBlurQ.render(renderer);
}
class ScenePass extends Pass {
  constructor(samples) {
    super();
    this.needsSwap = false;
    this.rt = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: new THREE.DepthTexture(1, 1),
    });
    // one NaN or Inf pixel here would be spread over the whole frame by the bloom (a black flash): replace it; and a sun glint cannot bloom over half the frame
    this.quad = new FullScreenQuad(
      fsMat(
        'uniform sampler2D t;varying vec2 vUv;void main(){vec4 c=texture2D(t,vUv);bvec4 bad=bvec4(isnan(c.r)||isinf(c.r),isnan(c.g)||isinf(c.g),isnan(c.b)||isinf(c.b),false);gl_FragColor=any(bad)?vec4(0.,0.,0.,1.):vec4(min(c.rgb,vec3(6.)),c.a);}',
        { t: { value: this.rt.texture } },
      ),
    );
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
  }
  render(r, write, read) {
    updateFakeLights(camera, focPt);
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(read);
    this.quad.render(r);
  }
}
const DOF_COMMON = `uniform sampler2D tDepth;uniform float near;uniform float far;uniform float focus;uniform float range;uniform vec2 cocScale;uniform float maxCoc;
float cocD(float d){float vd=near*far/((far-near)*d-far)*-1.;
 float z=vd-focus;float c=max(abs(z)-range*(z<0.?1.6:1.),0.)*(z<0.?cocScale.x:cocScale.y);return sign(z)*min(c,maxCoc);}
float coc(vec2 uv){return cocD(texture2D(tDepth,uv).x);}`;
class MacroDOF extends Pass {
  constructor() {
    super();
    const o = { type: THREE.HalfFloatType },
      t = { type: THREE.HalfFloatType, depthBuffer: false };
    this.half = new THREE.WebGLRenderTarget(1, 1, o);
    this.blurRT = new THREE.WebGLRenderTarget(1, 1, o);
    this.fillRT = new THREE.WebGLRenderTarget(1, 1, o);
    this.preRT = new THREE.WebGLRenderTarget(1, 1, o);
    this.tileRT = new THREE.WebGLRenderTarget(1, 1, t);
    this.reachRT = new THREE.WebGLRenderTarget(1, 1, t);
    this.u = {
      tColor: { value: null },
      tDepth: { value: null },
      tHalf: { value: this.half.texture },
      tBlur: { value: this.blurRT.texture },
      tFill: { value: this.fillRT.texture },
      tPre: { value: this.preRT.texture },
      tTile: { value: this.tileRT.texture },
      tReach: { value: this.reachRT.texture },
      reachN: { value: 1 },
      near: { value: camera.near },
      far: { value: camera.far },
      focus: { value: 14 },
      range: { value: 3 },
      cocScale: { value: new THREE.Vector2(1, 0.5) },
      maxCoc: { value: 13 },
      texel: { value: new THREE.Vector2() },
      fullTexel: { value: new THREE.Vector2() },
    };
    this.pre = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tColor;uniform vec2 fullTexel;varying vec2 vUv;${DOF_COMMON}
   void main(){vec2 o=fullTexel*.5;vec3 c=(texture2D(tColor,vUv+vec2(-o.x,-o.y)).rgb+texture2D(tColor,vUv+vec2(o.x,-o.y)).rgb+texture2D(tColor,vUv+vec2(-o.x,o.y)).rgb+texture2D(tColor,vUv+o).rgb)*.25;
   // the nearest of the four depths, so a wire one pixel wide still counts as the wire here and is not gathered into the blur behind it
   float d=min(min(texture2D(tDepth,vUv+vec2(-o.x,-o.y)).x,texture2D(tDepth,vUv+vec2(o.x,-o.y)).x),min(texture2D(tDepth,vUv+vec2(-o.x,o.y)).x,texture2D(tDepth,vUv+o).x));
   gl_FragColor=vec4(min(c,vec3(24.)),cocD(d));}`,
        this.u,
      ),
    );
    // near-CoC dilation first, so near blur spills past a silhouette instead of stopping at it. The spiral starts at a different angle per
    // pixel (else bokeh comes out dotted), and the angle is interleaved gradient noise rather than a hash: white noise clumps into grain you
    // can see at half size, worst at a pixel ratio of 1, while this spreads evenly over every 3×3 block and so cancels in the fill below.
    // The gather reads a copy already smoothed over 3×3 where it is blurred (soften, below), so each of its samples stands for a little patch
    // rather than one texel: a thin bright line out of focus is then caught by most of a pixel's samples or none, not a random few.
    this.soften = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tHalf;uniform vec2 texel;varying vec2 vUv;
   void main(){vec4 c=texture2D(tHalf,vUv);float rad=clamp(abs(c.a)*.12,0.,1.25);if(rad<.3){gl_FragColor=c;return;}
    vec3 acc=c.rgb*4.;float w=4.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){if(i==0&&j==0)continue;vec4 s=texture2D(tHalf,vUv+vec2(float(i),float(j))*texel*rad);
     float k=(i==0||j==0?2.:1.)*smoothstep(.6,1.6,abs(s.a))*step(abs(s.a-c.a),abs(c.a)*.5+1.);acc+=s.rgb*k;w+=k;}
    gl_FragColor=vec4(acc/w,c.a);}`,
        this.u,
      ),
    );
    // where each pixel's spiral can stop. A sample counts only when its blur reaches this pixel (m below is 0 for sc <= r-.8), and sc is at
    // most twice this pixel's own blur for anything behind it, or the largest near blur in reach for anything in front: past that radius every
    // sample weighs exactly nothing, so stopping there gives the same picture as walking the whole spiral. A sharp pixel with nothing blurred in
    // front of it takes no samples at all. tile: the largest near blur in each 16×16 block; reach: that over the blocks a spiral can touch,
    // maxCoc plus a texel and a half for the filtering away (reachN blocks each side: 1 at the default 13 px, 2 at the tuner's largest, 24)
    this.tile = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tHalf;
   void main(){ivec2 e=textureSize(tHalf,0)-1,o=ivec2(gl_FragCoord.xy)*16;float m=0.;
    for(int j=0;j<16;j++)for(int i=0;i<16;i++)m=max(m,-texelFetch(tHalf,min(o+ivec2(i,j),e),0).a);
    gl_FragColor=vec4(m);}`,
        this.u,
      ),
    );
    this.reach = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tTile;uniform int reachN;
   void main(){ivec2 e=textureSize(tTile,0)-1,t=ivec2(gl_FragCoord.xy);float m=0.;
    for(int j=-3;j<=3;j++)for(int i=-3;i<=3;i++)if(abs(i)<=reachN&&abs(j)<=reachN)m=max(m,texelFetch(tTile,clamp(t+ivec2(i,j),ivec2(0),e),0).r);
    gl_FragColor=vec4(m);}`,
        this.u,
      ),
    );
    this.blur = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tHalf;uniform sampler2D tPre;uniform sampler2D tReach;uniform vec2 texel;uniform float maxCoc;varying vec2 vUv;
   void main(){vec4 c0=texture2D(tPre,vUv);float cc=abs(c0.a);vec3 col=c0.rgb;float tot=1.;float near=0.;
   float rEnd=min(maxCoc,max(cc*2.,texelFetch(tReach,ivec2(gl_FragCoord.xy)/16,0).r)+.8);
   float rnd=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));float r=1.2+rnd*.8;float ang=rnd*6.2831853;
   for(int i=0;i<120;i++){if(r>=rEnd)break;vec2 tc=vUv+vec2(cos(ang),sin(ang))*texel*r;vec4 s=texture2D(tPre,tc);float sc=abs(s.a);if(s.a>c0.a)sc=min(sc,cc*2.);
    float m=smoothstep(r-.8,r+.8,sc);col+=mix(col/tot,s.rgb,m);tot+=1.;if(s.a<0.)near=max(near,m*sc);ang+=2.39996;r+=1.3/r;}
   gl_FragColor=vec4(col/tot,near);}`,
        this.u,
      ),
    );
    // the fill: a 3×3 tent over the blur, its reach growing with the blur (about a sixth of the CoC, up to 1.5 texels), taking only
    // neighbours that are blurred themselves, so it smooths what the sparse spiral leaves as grain without pulling a sharp edge into the blur
    this.fill = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tBlur;uniform sampler2D tHalf;uniform vec2 texel;varying vec2 vUv;
   void main(){vec4 c=texture2D(tBlur,vUv);float rad=clamp(abs(texture2D(tHalf,vUv).a)*.17,0.,1.5);if(rad<.3){gl_FragColor=c;return;}
    vec4 acc=c*4.;float w=4.;
    for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){if(i==0&&j==0)continue;vec2 o=vec2(float(i),float(j))*texel*rad;
     float k=(i==0||j==0?2.:1.)*smoothstep(.6,1.6,abs(texture2D(tHalf,vUv+o).a));acc+=texture2D(tBlur,vUv+o)*k;w+=k;}
    gl_FragColor=acc/w;}`,
        this.u,
      ),
    );
    // sharp or blurred is decided per full-size pixel (the least blur of it and its four neighbours, so the anti-aliased rim of a sharp edge stays), plus any near blur spilling over it
    this.comp = new FullScreenQuad(
      fsMat(
        `uniform sampler2D tColor;uniform sampler2D tFill;uniform vec2 fullTexel;varying vec2 vUv;${DOF_COMMON}
   void main(){vec3 s=texture2D(tColor,vUv).rgb;vec4 b=texture2D(tFill,vUv);vec2 o=fullTexel;
   float c=min(abs(coc(vUv)),min(min(abs(coc(vUv+vec2(o.x,0.))),abs(coc(vUv-vec2(o.x,0.)))),min(abs(coc(vUv+vec2(0.,o.y))),abs(coc(vUv-vec2(0.,o.y))))));
   gl_FragColor=vec4(mix(s,b.rgb,smoothstep(.45,1.8,max(c,b.a))),1.);}`,
        this.u,
      ),
    );
  }
  setSize(w, h) {
    const hw = Math.ceil(w / 2),
      hh = Math.ceil(h / 2);
    this.half.setSize(hw, hh);
    this.blurRT.setSize(hw, hh);
    this.fillRT.setSize(hw, hh);
    this.preRT.setSize(hw, hh);
    this.tileRT.setSize(Math.ceil(hw / 16), Math.ceil(hh / 16));
    this.reachRT.setSize(Math.ceil(hw / 16), Math.ceil(hh / 16));
    this.u.texel.value.set(1 / hw, 1 / hh);
    this.u.fullTexel.value.set(1 / w, 1 / h);
  }
  render(r, write, read) {
    this.u.tColor.value = read.texture;
    this.u.reachN.value = Math.min(
      3,
      Math.ceil((this.u.maxCoc.value + 1.5) / 16),
    );
    r.setRenderTarget(this.half);
    this.pre.render(r);
    r.setRenderTarget(this.tileRT);
    this.tile.render(r);
    r.setRenderTarget(this.reachRT);
    this.reach.render(r);
    r.setRenderTarget(this.preRT);
    this.soften.render(r);
    r.setRenderTarget(this.blurRT);
    this.blur.render(r);
    r.setRenderTarget(this.fillRT);
    this.fill.render(r);
    r.setRenderTarget(this.renderToScreen ? null : write);
    this.comp.render(r);
  }
}
// ---- render tuning: one record every pass reads, editable live with ⌘'. The view presets (lab / exploded / studio) multiply the light and bloom rows.
const RT = {
  auto: 1,
  pixelRatio: maxRatio,
  msaa: maxRatio >= 1.5 ? 2 : 4,
  smaa: 1,
  shadow: 2048,
  exposure: 1.0,
  fov: 30,
  sun: 1,
  fill: 1,
  rim: 1,
  fog: 1,
  sat: 1.16,
  env: 1,
  reflect: 1,
  bloom: 1,
  bloomStrength: 1,
  bloomRadius: 0.55,
  bloomThreshold: 1,
  ao: 1,
  aoIntensity: 1,
  aoRadius: 0.9,
  aoSamples: 12,
  dof: 1,
  focalBand: 1,
  aperture: 1.6,
  apertureNear: 0.9,
  maxCoc: 13,
};
const RT0 = { ...RT };
const composer = new EffectComposer(
  renderer,
  new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    depthBuffer: false,
  }),
);
composer.setPixelRatio(maxRatio);
const scenePass = new ScenePass(RT.msaa);
composer.addPass(scenePass);
const gtao = new GTAOPass(scene, camera, 1, 1);
gtao.output = GTAOPass.OUTPUT.Off;
gtao.needsSwap = false;
gtao.updateGtaoMaterial({
  radius: 0.9,
  thickness: 1.1,
  distanceExponent: 1.4,
  distanceFallOff: 1,
  scale: 1.2,
  samples: 12,
});
gtao.updatePdMaterial({
  radius: 6,
  rings: 2,
  samples: 12,
  lumaPhi: 10,
  depthPhi: 2,
  normalPhi: 3,
});
const gtaoSize = gtao.setSize.bind(gtao),
  gtaoRender = gtao.render.bind(gtao);
gtao.setSize = (w, h) => gtaoSize(Math.ceil(w / 2), Math.ceil(h / 2));
// Only glass and additive light sit out the AO prepass (visibility saved and restored). Everything solid stays in: the overlay reads this same depth.
const hideForAO = [],
  _vis = [];
gtao.render = (r, w, read) => {
  hideForAO.forEach((o, i) => {
    _vis[i] = o.visible;
    o.visible = false;
  });
  gtaoRender(r, w, read);
  hideForAO.forEach((o, i) => (o.visible = _vis[i]));
  gtao.blendMaterial.uniforms.intensity.value = RT.ao ? RT.aoIntensity : 0;
  gtao.blendMaterial.uniforms.tDiffuse.value = gtao.pdRenderTarget.texture;
  gtao._renderPass(r, gtao.blendMaterial, read);
};
composer.addPass(gtao);
const bloom = new UnrealBloomPass(
  new THREE.Vector2(256, 256),
  0.42,
  0.55,
  1.05,
);
const bloomSize = bloom.setSize.bind(bloom);
bloom.setSize = (w, h) => bloomSize(Math.ceil(w / 2), Math.ceil(h / 2));
composer.addPass(bloom);
// bloom's bright-pass, per full-size pixel. Stock, it thresholds the half-size picture with a hard knee, so a thin light line that slants
// across the pixel grid is over the threshold where it sits on one texel and under it where it straddles two: its glow beads into blobs
// along the strip (the strip itself stays smooth; lines() sees to that). Here each of the four full-size pixels under a half-size texel
// is thresholded on its own and only the excess over the threshold passes, which is linear, so the glow no longer depends on where a line
// falls between pixels. Only the excess blooms, so the views' bloomS are 2.7–3.6× what the hard knee needed (lab .42 → 1.15, exploded .5 → 1.8;
// the studio's threshold is so high that almost nothing reaches it, so .18 → .33 is a guess that changes nothing measurable).
{
  const m = bloom.materialHighPassFilter;
  m.uniforms.uFull = { value: new THREE.Vector2(1 / 1440, 1 / 900) };
  m.fragmentShader = `uniform sampler2D tDiffuse;uniform float luminosityThreshold;uniform vec2 uFull;varying vec2 vUv;
  vec3 hp(vec2 uv){vec3 c=texture2D(tDiffuse,uv).rgb;float v=dot(c,vec3(.299,.587,.114));return c*(max(v-luminosityThreshold,0.)/max(v,1e-4));}
  void main(){vec2 o=uFull*.5;gl_FragColor=vec4((hp(vUv+vec2(-o.x,-o.y))+hp(vUv+vec2(o.x,-o.y))+hp(vUv+vec2(-o.x,o.y))+hp(vUv+o))*.25,1.);}`;
  m.needsUpdate = true;
}
const dof = new MacroDOF();
dof.u.tDepth.value = scenePass.rt.depthTexture;
composer.addPass(dof);
// the explanation (ribbons, tags, sheets) lives in its own scene, drawn over the finished lens pass so it stays crisp; each of its materials still tests
// itself against the depth the lens reads (half size, so the test is soft), so solid things hide it
const overlay = new THREE.Scene();
const OV_U = {
  tSceneDepth: { value: gtao.depthTexture },
  uRes: { value: new THREE.Vector2(1, 1) },
  uNF: { value: new THREE.Vector2(camera.near, camera.far) },
};
class OverlayPass extends Pass {
  constructor() {
    super();
    this.needsSwap = false;
  }
  render(r, write, read) {
    const ac = r.autoClear;
    r.autoClear = false;
    r.setRenderTarget(read);
    r.render(overlay, camera);
    r.autoClear = ac;
  }
}
composer.addPass(new OverlayPass());
composer.addPass(new OutputPass());
// SMAA on the finished picture: the lens mixes sharp and blurred by a half-size depth, which leaves 2-pixel steps along silhouettes; this smooths those and every other edge
const smaa = new SMAAPass();
composer.addPass(smaa);
const OV_DEPTH = `uniform sampler2D tSceneDepth;uniform vec2 uRes;uniform vec2 uNF;
float ovLin(float d){return uNF.x*uNF.y/((uNF.y-uNF.x)*d-uNF.y)*-1.;}
float ovVis(float soft){float sd=ovLin(texture2D(tSceneDepth,gl_FragCoord.xy/uRes).x),md=ovLin(gl_FragCoord.z);return clamp((sd-md)/soft+1.,0.,1.);}`;

// ======================================================================= build helpers
const rbox = (w, h, d, r = 0.06, seg = 2) =>
  new RoundedBoxGeometry(w, h, d, seg, Math.min(r, Math.min(w, h, d) / 2.02));
const _mats = new Map();
// M: matte. P: coated (clearcoat). MET: machined metal. GLOW: unlit and over 1.0, so the bloom takes it. GLASS: transmission (sits out the AO prepass).
function M(color, o = {}) {
  const k = 'M' + color + JSON.stringify(o);
  if (!_mats.has(k))
    _mats.set(
      k,
      patch(
        new THREE.MeshStandardMaterial({
          color,
          roughness: 0.85,
          envMapIntensity: 0.5,
          ...o,
        }),
      ),
    );
  return _mats.get(k);
}
function P(color, o = {}) {
  const k = 'P' + color + JSON.stringify(o);
  if (!_mats.has(k))
    _mats.set(
      k,
      patch(
        new THREE.MeshPhysicalMaterial({
          color,
          roughness: 0.34,
          clearcoat: 1,
          clearcoatRoughness: 0.16,
          envMapIntensity: 1.1,
          ...o,
        }),
      ),
    );
  return _mats.get(k);
}
function MET(color, o = {}) {
  const k = 'T' + color + JSON.stringify(o);
  if (!_mats.has(k))
    _mats.set(
      k,
      patch(
        new THREE.MeshPhysicalMaterial({
          color,
          metalness: 0.85,
          roughness: 0.32,
          envMapIntensity: 1.25,
          clearcoat: 0.35,
          clearcoatRoughness: 0.3,
          ...o,
        }),
      ),
    );
  return _mats.get(k);
}
const GLOW = (color, k = 1) =>
  new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(k),
    fog: false,
  });
const GLASS = (o = {}) =>
  new THREE.MeshPhysicalMaterial({
    color: '#e6fbff',
    roughness: 0.05,
    metalness: 0,
    transmission: 0.95,
    thickness: 0.12,
    ior: 1.45,
    envMapIntensity: 1.3,
    ...o,
  });
const GUN = MET('#434a55', { roughness: 0.36 }),
  GUN_D = MET('#23272e', { roughness: 0.42, metalness: 0.7 }),
  ANOD = MET('#15171b', { roughness: 0.46, metalness: 0.55 }),
  BRONZE = MET('#c08a3e', { roughness: 0.3, metalness: 1, clearcoat: 0.5 }),
  STEEL = MET('#b9c0cb', { roughness: 0.22, metalness: 1 }),
  RUBBER = M('#121316', { roughness: 0.72, envMapIntensity: 0.35 }),
  SILVER = MET('#8e96a3', { roughness: 0.3, metalness: 0.9 }),
  COPPER = MET('#c46a3a', { roughness: 0.28, metalness: 1, clearcoat: 0.6 });
const _m4 = new THREE.Matrix4(),
  _q = new THREE.Quaternion(),
  _e = new THREE.Euler(0, 0, 0, 'YXZ'),
  _v1 = new THREE.Vector3(1, 1, 1),
  _c = new THREE.Color();
const X = new THREE.Vector3(1, 0, 0),
  Y = new THREE.Vector3(0, 1, 0),
  Z = new THREE.Vector3(0, 0, 1),
  _dir = new THREE.Vector3(),
  _q2 = new THREE.Quaternion();
// static parts merged per material (from Token Town). o: rx ry rz (YXZ), s:[x,y,z], dir:[x,y,z] points the part's +y that way instead
function Build() {
  const bag = new Map();
  const add = (mat, g, x, y, z, o) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv)
      g.setAttribute(
        'uv',
        new THREE.Float32BufferAttribute(
          new Float32Array(g.attributes.position.count * 2),
          2,
        ),
      );
    if (o.dir) {
      _q.setFromUnitVectors(
        Y,
        _dir.set(o.dir[0], o.dir[1], o.dir[2]).normalize(),
      );
      if (o.roll) _q.multiply(_q2.setFromAxisAngle(Y, o.roll));
    } else {
      _e.set(o.rx || 0, o.ry || 0, o.rz || 0);
      _q.setFromEuler(_e);
    }
    g.applyMatrix4(
      _m4.compose(
        { x, y, z },
        _q,
        o.s ? _v1.set(o.s[0], o.s[1], o.s[2]) : _v1.set(1, 1, 1),
      ),
    );
    let e = bag.get(mat);
    if (!e) bag.set(mat, (e = { mat, list: [] }));
    e.list.push(g);
  };
  return {
    box(mat, x, y, z, w, h, d, o = {}) {
      add(
        mat,
        o.r ? rbox(w, h, d, o.r) : new THREE.BoxGeometry(w, h, d),
        x,
        y,
        z,
        o,
      );
      return this;
    },
    cyl(mat, x, y, z, r0, r1, h, o = {}) {
      add(mat, new THREE.CylinderGeometry(r0, r1, h, o.seg || 20), x, y, z, o);
      return this;
    },
    cone(mat, x, y, z, r, h, o = {}) {
      add(
        mat,
        new THREE.ConeGeometry(r, h, o.seg || 6).translate(0, h / 2, 0),
        x,
        y,
        z,
        o,
      );
      return this;
    },
    sph(mat, x, y, z, r, o = {}) {
      add(
        mat,
        new THREE.SphereGeometry(r, o.seg || 14, o.seg2 || 10),
        x,
        y,
        z,
        o,
      );
      return this;
    },
    tor(mat, x, y, z, r, t, o = {}) {
      add(
        mat,
        new THREE.TorusGeometry(r, t, o.seg2 || 8, o.seg || 40),
        x,
        y,
        z,
        o,
      );
      return this;
    },
    geo(mat, g, x = 0, y = 0, z = 0, o = {}) {
      add(mat, g.clone(), x, y, z, o);
      return this;
    },
    flush(parent, cast = true) {
      const made = [];
      for (const { mat, list } of bag.values()) {
        const mesh = new THREE.Mesh(mergeGeometries(list), mat);
        mesh.castShadow = cast;
        mesh.receiveShadow = true;
        parent.add(mesh);
        made.push(mesh);
        list.forEach((g) => g.dispose());
      }
      bag.clear();
      return made;
    },
  };
}
// canvases drawn with the web fonts must be drawn again once the fonts arrive (the first draw may use a fallback face)
const FONT_REDRAW = [];
document.fonts?.ready.then(() => FONT_REDRAW.forEach((f) => f()));
// a text plate: alphaTest, not transparent, so glyphs write depth. k holds it just under (or over) the bloom threshold.
function plate(w, h, cw, ch, draw, k = 0.9, o = {}) {
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: t,
      alphaTest: 0.3,
      fog: false,
      side: THREE.DoubleSide,
      color: new THREE.Color(k, k, k),
      ...o,
    }),
  );
  m.userData = {
    c,
    g,
    t,
    redraw(fn) {
      g.clearRect(0, 0, cw, ch);
      fn(g, cw, ch);
      t.needsUpdate = true;
    },
  };
  if (draw) {
    m.userData.redraw(draw);
    FONT_REDRAW.push(() => m.userData.redraw(draw));
  }
  return m;
}
const rr = (g, x, y, w, h, r) => {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
};
const canvasTex = (w, h, draw, srgb = true) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};
const radialTex = canvasTex(
  128,
  128,
  (x) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, '#fff');
    g.addColorStop(0.35, '#ffffff88');
    g.addColorStop(1, '#fff0');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  },
  false,
);
const additive = (color, opacity, map = radialTex) =>
  new THREE.MeshBasicMaterial({
    map,
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
// ---- light lines: every LED strip, neon tube and line of light. lines().line(a,b,w,colour,k) adds a strip from a to b ([x,y,z] in the
// parent's space), w wide in world units, its colour times k (over 1 blooms); .ring(c,r,w,colour,k) a circle in the parent's x-y plane;
// .flush(parent) makes one mesh of them. Each is drawn as a band that always faces the camera, its edges and ends smoothed in the shader,
// and never narrower than LL_U.uMinPx (1.6 px): thinner than that on screen, it spreads the same light over the wider band (dimmer, as it
// would be) instead of breaking up. A GLOW box that thin turns into dashes as soon as anything moves, and steps along its edges (the MSAA
// resolve averages HDR, so a quarter-covered pixel is already bright), worst of all in the floor's mirror. Never use a box for a strip.
// The band is tested at its centre line's depth, so a line tucked just behind an edge can glint a pixel past it: keep hidden ones well hidden.
const LL_U = {
  uRes: { value: new THREE.Vector2(1, 1) },
  uNear: { value: camera.near },
  uMinPx: { value: 1.6 },
};
const LL_MAT = new THREE.ShaderMaterial({
  uniforms: LL_U,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  side: THREE.DoubleSide,
  vertexShader: `attribute vec3 aB;attribute vec2 aSE;attribute float aW;attribute vec3 aCol;uniform vec2 uRes;uniform float uNear;uniform float uMinPx;
  varying vec3 vCol;varying vec3 vD;varying vec2 vL;
  void main(){vec4 a=modelViewMatrix*vec4(position,1.),b=modelViewMatrix*vec4(aB,1.);
   if(a.z>-uNear&&b.z>-uNear){gl_Position=vec4(0.,0.,2.,1.);return;}                                       // wholly behind the camera
   if(a.z>-uNear)a=mix(a,b,(a.z+uNear)/(a.z-b.z));else if(b.z>-uNear)b=mix(b,a,(b.z+uNear)/(b.z-a.z));     // cut at the near plane, so it never flips through the lens
   vec4 ca=projectionMatrix*a,cb=projectionMatrix*b;vec2 h=uRes*.5,sa=ca.xy/ca.w*h,sb=cb.xy/cb.w*h,d=sb-sa;float L=length(d);d=L>1e-3?d/L:vec2(1.,0.);
   vec4 c=aSE.x<.5?ca:cb;float hw=aW*.5*h.y*projectionMatrix[1][1]/c.w,hd=max(hw,uMinPx*.5),ext=hd+1.;   // its half-width in pixels, true and as drawn
   vCol=aCol*(hw/hd);
   c.xy+=(vec2(-d.y,d.x)*aSE.y*ext+d*(aSE.x<.5?-1.:1.))/h*c.w;
   // the band is a flat shape on screen whatever its depth does, so its pixel coordinates are interpolated linearly on screen (each times w, and w)
   vD=vec3(aSE.y*ext,hd,1.)*c.w;vL=vec2(aSE.x<.5?-1.:L+1.,L)*c.w;gl_Position=c;}`,
  fragmentShader: `varying vec3 vCol;varying vec3 vD;varying vec2 vL;
  void main(){float w=vD.z,d=vD.x/w,hd=vD.y/w,l=vL.x/w,L=vL.y/w;
   gl_FragColor=vec4(vCol*clamp(hd+.5-abs(d),0.,1.)*clamp(l+.5,0.,1.)*clamp(L-l+.5,0.,1.),1.);}`,
});
function lines() {
  const A = [],
    B = [],
    S = [],
    W = [],
    C = [];
  const add = (a, b, w, c) => {
    for (const [e, s] of [
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ]) {
      A.push(a[0], a[1], a[2]);
      B.push(b[0], b[1], b[2]);
      S.push(e, s);
      W.push(w);
      C.push(c.r, c.g, c.b);
    }
  };
  return {
    line(a, b, w, color, k = 1) {
      add(a, b, w, new THREE.Color(color).multiplyScalar(k));
      return this;
    },
    ring(c, r, w, color, k = 1, n = 64) {
      const col = new THREE.Color(color).multiplyScalar(k);
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2,
          a1 = ((i + 1) / n) * Math.PI * 2;
        add(
          [c[0] + Math.cos(a0) * r, c[1] + Math.sin(a0) * r, c[2]],
          [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r, c[2]],
          w,
          col,
        );
      }
      return this;
    },
    flush(parent) {
      const n = A.length / 12,
        idx = [];
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
      }
      const g = new THREE.BufferGeometry(),
        f = (v, k) => new THREE.Float32BufferAttribute(v, k);
      g.setAttribute('position', f(A, 3));
      g.setAttribute('aB', f(B, 3));
      g.setAttribute('aSE', f(S, 2));
      g.setAttribute('aW', f(W, 1));
      g.setAttribute('aCol', f(C, 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, LL_MAT);
      m.frustumCulled = false;
      parent.add(m);
      hideForAO.push(m);
      A.length = B.length = S.length = W.length = C.length = 0;
      return m;
    },
  };
}
// ---- turned parts. A profile is [[x, r], ...] along +x; latheX spins it about +x. phi: [start, length] cuts a sector out
// (phi 0 faces +z, the viewer; pi/2 points down; 3pi/2 up), so [pi/2, pi] is the back half: the cutaway.
function latheX(prof, seg = 64, phi = [0, Math.PI * 2]) {
  const g = new THREE.LatheGeometry(
    prof.map(([x, r]) => new THREE.Vector2(r, x)),
    seg,
    phi[0],
    phi[1],
  );
  g.rotateZ(-Math.PI / 2);
  return g;
}
// a tube wall: outer and inner profiles, both [[x, r]], same x range; closed at both ends
function shellProfile(outer, inner) {
  return [...outer, ...inner.slice().reverse(), outer[0]];
}
// the flat faces left where a half shell is cut: the (x, r) region between the profiles, lying in z=0 at y=+r (top) or y=-r (bottom)
function shellCaps(prof) {
  const shp = new THREE.Shape(prof.map(([x, r]) => new THREE.Vector2(x, r)));
  const top = new THREE.ShapeGeometry(shp, 1);
  const bot = top.clone();
  bot.scale(1, -1, 1);
  const idx = bot.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i];
    idx[i] = idx[i + 2];
    idx[i + 2] = t;
  }
  bot.computeVertexNormals();
  return mergeGeometries([top.toNonIndexed(), bot.toNonIndexed()]);
}
// a knurled (ribbed) ring about +x: n ribs of depth d between two plain lips
function knurlRing(x0, x1, rIn, rOut, n = 60, d = 0.07) {
  const pos = [],
    idx = [],
    nA = n * 6,
    c = 0.035,
    prof = [
      [x0, rIn],
      [x0, rOut - d],
      [x0 + c, rOut],
      [x1 - c, rOut],
      [x1, rOut - d],
      [x1, rIn],
    ];
  for (let i = 0; i < prof.length; i++)
    for (let j = 0; j <= nA; j++) {
      const a = (j / nA) * Math.PI * 2,
        u = (j % 6) / 6,
        rib = u >= 0.17 && u < 0.67 ? 1 : 0,
        r = i === 2 || i === 3 ? (rib ? rOut : rOut - d) : prof[i][1];
      pos.push(prof[i][0], -Math.sin(a) * r, Math.cos(a) * r);
    }
  for (let i = 0; i < prof.length - 1; i++)
    for (let j = 0; j < nA; j++) {
      const a = i * (nA + 1) + j,
        b = a + 1,
        cc = a + nA + 1,
        e = cc + 1;
      idx.push(a, b, cc, b, e, cc);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const ng = g.toNonIndexed();
  ng.computeVertexNormals();
  return ng;
}
// a spur gear ring about +x: teeth on the outside, a bore inside, extruded w along x
function gearRing(rIn, rRoot, h, n, w) {
  const s = new THREE.Shape(),
    k = n * 4;
  for (let i = 0; i <= k; i++) {
    const a = (i / k) * Math.PI * 2,
      ph = i % 4,
      r = ph === 1 || ph === 2 ? rRoot + h : rRoot,
      aa = a + ((ph === 1 ? 0.18 : ph === 2 ? -0.18 : 0) * Math.PI * 2) / n;
    const x = Math.cos(aa) * r,
      y = Math.sin(aa) * r;
    i ? s.lineTo(x, y) : s.moveTo(x, y);
  }
  const hole = new THREE.Path();
  hole.absarc(0, 0, rIn, 0, Math.PI * 2, true);
  s.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: w,
    bevelEnabled: true,
    bevelThickness: 0.012,
    bevelSize: 0.012,
    bevelSegments: 1,
    curveSegments: 64,
  });
  g.translate(0, 0, -w / 2);
  g.rotateY(Math.PI / 2);
  return g;
}
// a faceted blob: an icosahedron pushed about (rocks, bushes, tree clusters). detail 0 or 1; j = jitter
function facetBlob(r, j = 0.3, seed = 1, detail = 0) {
  const g = new THREE.IcosahedronGeometry(r, detail),
    p = g.attributes.position,
    r2 = mulberry(seed),
    key = new Map();
  for (let i = 0; i < p.count; i++) {
    const k =
      p.getX(i).toFixed(3) +
      ',' +
      p.getY(i).toFixed(3) +
      ',' +
      p.getZ(i).toFixed(3);
    if (!key.has(k))
      key.set(k, [
        1 + (r2() - 0.5) * j,
        1 + (r2() - 0.5) * j,
        1 + (r2() - 0.5) * j,
      ]);
    const s = key.get(k);
    p.setXYZ(i, p.getX(i) * s[0], p.getY(i) * s[1], p.getZ(i) * s[2]);
  }
  g.computeVertexNormals();
  return g;
}

// ---- set dressing shared by the room and the sets: low-poly trees, pines, faceted mountains, a mini diorama on a slab
function lowTree(parent, x, y, z, s, hue = 0, o = {}) {
  const g = new THREE.Group(),
    b = Build(),
    r2 = mulberry(Math.floor(x * 31 + z * 17 + 99));
  b.cyl(M('#5a3f2c'), 0, 0.5 * s, 0, 0.07 * s, 0.1 * s, 1 * s, { seg: 6 });
  const shades = ['#4f7a3c', '#5f8c45', '#6f9a4c', '#3f6834'].map((c) =>
    new THREE.Color(c).offsetHSL(hue, 0, 0).getStyle(),
  );
  for (let k = 0; k < (o.n || 5); k++)
    b.geo(
      M(shades[k % 4], { flatShading: true, roughness: 0.8 }),
      facetBlob(0.42 * s * (0.75 + r2() * 0.5), 0.3, k + x * 7 + z * 3),
      (r2() - 0.5) * 0.6 * s,
      (1.15 + r2() * 0.7) * s,
      (r2() - 0.5) * 0.6 * s,
    );
  b.flush(g);
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}
// a pine as stacked faceted cones, added to a Build (so a hundred of them are still a handful of meshes)
const PINE_C = ['#2f5a3a', '#3a6b43', '#44784a'].map((c) =>
    M(c, { flatShading: true, roughness: 0.85 }),
  ),
  BARK = M('#4a3527', { roughness: 0.9 });
function pine(b, x, y, z, s, seed = 1) {
  const r2 = mulberry(seed * 97 + 13);
  b.cyl(BARK, x, y + 0.15 * s, z, 0.05 * s, 0.07 * s, 0.3 * s, { seg: 5 });
  for (let k = 0; k < 3; k++) {
    const w = (0.42 - k * 0.1) * s * (0.9 + r2() * 0.2);
    b.cone(
      PINE_C[(k + seed) % 3],
      x,
      y + (0.22 + k * 0.3) * s,
      z,
      w,
      0.55 * s,
      { seg: 6 + (seed % 2), ry: r2() * 3 },
    );
  }
}
const ROCK = M('#8d8aa0', { flatShading: true, roughness: 0.75 }),
  SNOW = M('#eef1f8', { flatShading: true, roughness: 0.6 });
function peak(b, x, y, z, r, h, seed = 1) {
  const g = new THREE.ConeGeometry(r, h, 7, 3).translate(0, h / 2, 0),
    p = g.attributes.position,
    r2 = mulberry(seed);
  for (let i = 0; i < p.count; i++) {
    const yy = p.getY(i);
    if (yy > 0.01 && yy < h - 0.01) {
      p.setX(i, p.getX(i) * (1 + (r2() - 0.5) * 0.35));
      p.setZ(i, p.getZ(i) * (1 + (r2() - 0.5) * 0.35));
      p.setY(i, yy + (r2() - 0.5) * h * 0.08);
    }
  }
  g.computeVertexNormals();
  b.geo(ROCK, g, x, y, z);
  const cap = new THREE.ConeGeometry(r * 0.36, h * 0.34, 7, 1).translate(
    0,
    h * 0.83 + 0.005,
    0,
  );
  b.geo(SNOW, cap, x, y, z, { ry: seed });
}
function miniDiorama(parent, x, y, z, s = 1, seed = 1) {
  const b = Build(),
    r2 = mulberry(seed * 31);
  b.box(
    M('#5b4636', { roughness: 0.9 }),
    x,
    y + 0.09 * s,
    z,
    1.5 * s,
    0.18 * s,
    1 * s,
    { r: 0.02 * s },
  ).box(
    M('#5f8a4a', { flatShading: true }),
    x,
    y + 0.19 * s,
    z,
    1.46 * s,
    0.04 * s,
    0.96 * s,
  );
  peak(b, x - 0.25 * s, y + 0.2 * s, z - 0.15 * s, 0.42 * s, 0.9 * s, seed);
  peak(b, x + 0.3 * s, y + 0.2 * s, z - 0.2 * s, 0.34 * s, 0.66 * s, seed + 3);
  for (let i = 0; i < 5; i++)
    pine(
      b,
      x + (r2() - 0.5) * 1.2 * s,
      y + 0.2 * s,
      z + 0.1 * s + r2() * 0.3 * s,
      0.5 * s * (0.8 + r2() * 0.4),
      seed + i,
    );
  b.flush(parent);
}
// a soft contact shadow: a dark radial blot just above a surface (studio and lab use it under the subject)
const blotTex = canvasTex(
  128,
  128,
  (x) => {
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.45, 'rgba(0,0,0,.55)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  },
  false,
);
function contactShadow(parent, x, y, z, w, d, a = 0.5) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({
      map: blotTex,
      transparent: true,
      opacity: a,
      depthWrite: false,
      fog: false,
      color: 0x000000,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, y + 0.004, z);
  m.renderOrder = -1;
  parent.add(m);
  hideForAO.push(m);
  return m;
}
// painted daytime landscape for the windows: clear blue sky, green ranges with snow caps, pines (the lens melts it anyway)
const hillsTex = canvasTex(1024, 512, (g, w, h) => {
  const sk = g.createLinearGradient(0, 0, 0, h);
  sk.addColorStop(0, '#5f95e6');
  sk.addColorStop(0.52, '#a9cdf2');
  sk.addColorStop(0.72, '#e4f0fb');
  sk.addColorStop(1, '#7f9a74');
  g.fillStyle = sk;
  g.fillRect(0, 0, w, h);
  const r2 = mulberry(9);
  const ridge = (y0, amp, col, seed) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 16) {
      const t = x / w;
      g.lineTo(
        x,
        y0 -
          amp *
            (Math.abs(Math.sin(t * 5.1 + seed)) * 0.7 +
              Math.abs(Math.sin(t * 13.3 + seed * 2)) * 0.3),
      );
    }
    g.lineTo(w, h);
    g.fill();
  };
  ridge(h * 0.6, h * 0.32, '#8fb08a', 1);
  ridge(h * 0.7, h * 0.2, '#6b8f68', 2.2);
  g.fillStyle = '#f4f7fb';
  for (let i = 0; i < 5; i++) {
    const x = w * (0.12 + i * 0.2),
      y = h * 0.34 + r2() * 20;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x - 30, y + 34);
    g.lineTo(x + 30, y + 34);
    g.fill();
  }
  for (let i = 0; i < 110; i++) {
    const x = r2() * w,
      y = h * (0.72 + r2() * 0.25),
      s = 10 + r2() * 26;
    g.fillStyle = `hsl(${130 + r2() * 20},${25 + r2() * 15}%,${22 + r2() * 12}%)`;
    g.beginPath();
    g.moveTo(x, y - s * 2.2);
    g.lineTo(x - s * 0.6, y);
    g.lineTo(x + s * 0.6, y);
    g.fill();
  }
});
// the maker's mark, lettered like the moodboard's plinth: brass set into a dark surface (a thin engraved shadow under it, a hair of light on its top edge).
// {k:.8}: a brighter brass where the surface is lit amber (the strips' glow hazes that band and washes dark ink out); {pale:true}: graphite with a light lower
// lip on a pale surface out of the glow (a studio sweep, oak). Unlit and held under the bloom threshold, so it reads in any light and never glows; under the
// pointer it lights up gold and marker lettering. w is the lettering's width (cap height ≈ w/14): aim for a 9-12 px cap in the view's hero at 1440×900.
const LINKS = [];
function markInk(g, cw, ch, pale, hot, F = 128) {
  const t = '',
    set = () => {
      g.font = `${pale ? 700 : 600} ${F}px Plus Jakarta Sans, sans-serif`;
      g.letterSpacing = Math.round(F * 0.08) + 'px';
    };
  set();
  const tw = g.measureText(t).width;
  if (tw > cw - 28) {
    F = Math.floor((F * (cw - 28)) / tw);
    set();
  }
  const x = cw / 2 + Math.round(F * 0.04),
    y = ch / 2 + F * 0.35;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  if (pale) {
    g.fillStyle = '#fbf8f2';
    g.fillText(t, x, y + F * 0.05);
    g.fillStyle = hot ? '#e08a24' : '#38332d';
    g.fillText(t, x, y);
    return;
  }
  g.fillStyle = '#040506';
  g.fillText(t, x + F * 0.02, y + F * 0.065);
  g.fillStyle = '#fff0cc';
  g.fillText(t, x, y - F * 0.025);
  const gr = g.createLinearGradient(0, y - F * 0.7, 0, y);
  gr.addColorStop(0, '#f1d08c');
  gr.addColorStop(1, '#b3833d');
  g.fillStyle = gr;
  g.fillText(t, x, y);
}
function makerMark(w, o = {}) {
  const pale = !!o.pale,
    k = o.k ?? (pale ? 0.92 : 0.6);
  let hot = false;
  const draw = (g, cw, ch) => markInk(g, cw, ch, pale, hot);
  const m = plate(w, w * 0.1375, 1280, 176, draw, k, {
    alphaTest: 0.25,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  m.userData.mark = 1;
  m.userData.txt = 1;
  hideInMirror.push(m);
  LINKS.push({
    hit: m,
    over(on) {
      hot = on;
      if (pale) m.userData.redraw(draw);
      else m.material.color.setRGB(on ? 3.4 : k, on ? 2.5 : k, on ? 1.4 : k);
    },
  });
  return m;
}
// ======================================================================= the model: a kinematic bicycle. The car turns about one point on the line of its back axle, R = wheelbase / tan(steer).
// G metres, y up, origin on the asphalt. A pose is the back axle's centre (x, z) and the heading th: forward is (cos th, -sin th), the right side is (sin th, cos th).
// steer runs -1..1 (+1 full lock right). The road wheels' angle is steer × 35°; the steering wheel turns 15.2 times as far (1.48 turns to full lock).
const CARD = {
  L: 2.64,
  ro: 0.78,
  fo: 0.865,
  hw: 0.895,
  tw: 0.765,
  dMax: (35 * Math.PI) / 180,
  ratio: 15.2,
  mir: 2.12,
  eye: 1.02,
};
CARD.fb = CARD.L + CARD.fo;
CARD.len = CARD.fb + CARD.ro;
const R_MIN = CARD.L / Math.tan(CARD.dMax); // 3.77 m from the back axle's centre to the turning point
const LOCK_TURNS = (CARD.dMax * CARD.ratio) / (2 * Math.PI); // 1.48 turns of the steering wheel from centre to full lock
const delta = (st) => -st * CARD.dMax; // the bicycle's front wheel angle (left positive)
const turnR = (st) =>
  Math.abs(st) < 1e-4 ? Infinity : CARD.L / Math.tan(Math.abs(st) * CARD.dMax);
function stepPose(p, ds, st) {
  const k = Math.tan(delta(st)) / CARD.L;
  if (Math.abs(k) < 1e-9) {
    p.x += Math.cos(p.th) * ds;
    p.z -= Math.sin(p.th) * ds;
    return p;
  }
  const th1 = p.th + k * ds;
  p.x += (Math.sin(th1) - Math.sin(p.th)) / k;
  p.z += (Math.cos(th1) - Math.cos(p.th)) / k;
  p.th = th1;
  return p;
}
// a point of the car (a forward of the back axle, b to its right) in G
const toG = (p, a, b) => [
  p.x + Math.cos(p.th) * a + Math.sin(p.th) * b,
  p.z - Math.sin(p.th) * a + Math.cos(p.th) * b,
];
// ---- which side the traffic keeps to. The model always keeps right (the driver on the left, the kerb on the right); keeping left is the
// same ground in a mirror, the slab flipped end to end (G.scale.x < 0), so the kerb's on your left and the seat's on the right. The paths,
// the collisions and every number stay as they are: only what is shown swaps (the words and arrows, the wheel's turn on screen, the keys,
// the camera's side, the panels on the wall).
let LHT = false;
const MS = () => (LHT ? -1 : 1),
  DS = (st) => (LHT ? -st : st);
const LR_SWAP = {
  right: 'left',
  left: 'right',
  Right: 'Left',
  Left: 'Right',
  '→': '←',
  '←': '→',
};
const LR = (s) => {
  if (!LHT || !s) return s;
  return String(s)
    .replace(/right (angle|way)/g, '\u0001$1')
    .replace(/\b(right|left|Right|Left)\b|→|←/g, (m) => LR_SWAP[m])
    .replace(/\u0001/g, 'right ');
};
// each front wheel's own angle (Ackermann: the inside wheel turns more, both square to the line from the turning point); bw its offset to the right
const wheelAng = (st, bw) => {
  const d = delta(st);
  return Math.abs(d) < 1e-6
    ? 0
    : Math.atan(CARD.L / (bw + CARD.L / Math.tan(d)));
};
// the body's plan, from the hatchback's own sections (back-axle frame): boxy at the back, well rounded at the nose
const PLAN = [
  [-0.78, 0.84],
  [-0.72, 0.865],
  [-0.63, 0.885],
  [-0.43, 0.895],
  [3.02, 0.88],
  [3.32, 0.82],
  [3.42, 0.765],
  [3.475, 0.68],
  [3.505, 0.555],
];
const PLAN_P = [
  ...PLAN,
  ...PLAN.slice()
    .reverse()
    .map(([a, b]) => [a, -b]),
];
function carPoly(p, out) {
  out = out || PLAN_P.map(() => [0, 0]);
  for (let i = 0; i < PLAN_P.length; i++) {
    const [a, b] = PLAN_P[i],
      c = Math.cos(p.th),
      s = Math.sin(p.th);
    out[i][0] = p.x + c * a + s * b;
    out[i][1] = p.z - s * a + c * b;
  }
  return out;
}
// the four tyres where they meet a kerb's face (50 cm long at kerb height, 20.5 cm wide), the front two turned
function tyrePolys(p, st) {
  const { L, tw } = CARD,
    out = [];
  for (const [a, side] of [
    [0, -1],
    [0, 1],
    [L, -1],
    [L, 1],
  ]) {
    const bw = side * tw,
      ang = a > 0 ? wheelAng(st, bw) : 0,
      c = Math.cos(ang),
      s = Math.sin(ang),
      hl = 0.25,
      hwid = 0.1025;
    out.push(
      [
        [-hl, -hwid],
        [hl, -hwid],
        [hl, hwid],
        [-hl, hwid],
      ].map(([u, v]) => toG(p, a + u * c + v * s, bw - u * s + v * c)),
    );
  }
  return out;
}
function _proj(P, ax, ay) {
  let lo = 1e9,
    hi = -1e9;
  for (const q of P) {
    const d = q[0] * ax + q[1] * ay;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}
function overlap(A, B) {
  for (const P of [A, B])
    for (let i = 0; i < P.length; i++) {
      const a = P[i],
        b = P[(i + 1) % P.length],
        ax = a[1] - b[1],
        ay = b[0] - a[0];
      const [a0, a1] = _proj(A, ax, ay),
        [b0, b1] = _proj(B, ax, ay);
      if (a1 < b0 || b1 < a0) return false;
    }
  return true;
}
const _segD = (p, a, b) => {
  const ex = b[0] - a[0],
    ez = b[1] - a[1],
    l = ex * ex + ez * ez || 1e-12,
    t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l));
  return Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ez);
};
function polyDist(A, B) {
  if (overlap(A, B)) return 0;
  let d = 1e9;
  for (const [P, Q] of [
    [A, B],
    [B, A],
  ])
    for (const p of P)
      for (let i = 0; i < Q.length; i++)
        d = Math.min(d, _segD(p, Q[i], Q[(i + 1) % Q.length]));
  return d;
}
// the nearest pair of points between two polygons (for the sensors' arcs and the tags): [d, pointOnA, pointOnB]
function nearest(A, B) {
  let best = [1e9, null, null];
  for (const [P, Q, sw] of [
    [A, B, 0],
    [B, A, 1],
  ])
    for (const p of P)
      for (let i = 0; i < Q.length; i++) {
        const a = Q[i],
          b = Q[(i + 1) % Q.length],
          ex = b[0] - a[0],
          ez = b[1] - a[1],
          l = ex * ex + ez * ez || 1e-12,
          t = Math.max(
            0,
            Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / l),
          ),
          q = [a[0] + t * ex, a[1] + t * ez],
          d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < best[0]) best = sw ? [d, q, p] : [d, p, q];
      }
  return best;
}

// ======================================================================= the sets: a street with a kerb, a car park with square bays, and one with bays at 45°
// Each obstacle is a parked car (a pose: its own back axle) or a kerb (tyres may not cross the line z = k from the road side).
// The other cars are the same hatchback in other paints.
const BAY = { w: 2.5, d: 5.0, aisle: 6.5, z: -0.6 }; // bays 2.5 × 5.0 m, a 6.5 m aisle; z: the line across the bays' mouths
const ANG = { a: 45, w: 2.5, d: 5.0, z: -0.9 }; // the 45° bays: 2.5 m wide square to their lines, so 3.54 m along the aisle
ANG.pitch = ANG.w / Math.sin((ANG.a * Math.PI) / 180);
ANG.th = Math.PI - (ANG.a * Math.PI) / 180;
ANG.ax = [Math.cos(ANG.th), -Math.sin(ANG.th)];
const STREET = { kerb: -3.0, gap: 1.5 * CARD.len }; // the kerb's face; a gap one and a half car lengths long (6.43 m)
STREET.pz = STREET.kerb + 0.25 + CARD.hw; // the parked cars' centre line: 25 cm off the kerb
// ParkWise palette: the learner in signal yellow; the parked cars in everyday street colours (pearl white, grey, teal, maroon, silver, slate, blue)
const PAINTS = {
  sage: '#f2b400',
  linen: '#eef0f2',
  graphite: '#6b717b',
  slate: '#1d7f78',
  oak: '#7a2337',
  clay: '#c3c7cc',
  moss: '#33465e',
  navy: '#2f64c8',
};
// a parked car whose body is centred at (cx, cz), facing th: its back axle's pose
const parkedAt = (cx, cz, th) => {
  const m = (CARD.fb - CARD.ro) / 2;
  return { x: cx - Math.cos(th) * m, z: cz + Math.sin(th) * m, th };
};
// bay k's car: nose in (facing the back of the bay) or reversed in, its body centred in the bay a little in from the mouth
const bayCar = (k, rev, paint, dx = 0) => ({
  pose: parkedAt(
    k * BAY.w + dx,
    BAY.z - 0.35 - CARD.len / 2,
    rev ? -Math.PI / 2 : Math.PI / 2,
  ),
  paint,
});
const angCar = (k, paint) => {
  const xc = k * ANG.pitch,
    dd = ANG.d - 0.35 - CARD.len / 2;
  return {
    pose: parkedAt(xc + ANG.ax[0] * dd, ANG.z + ANG.ax[1] * dd, ANG.th),
    paint,
  };
};
const SETS = {
  street: {
    cars: [
      {
        pose: { x: -STREET.gap / 2 - CARD.ro, z: STREET.pz, th: Math.PI },
        paint: PAINTS.linen,
      },
      {
        pose: { x: STREET.gap / 2 + CARD.fb, z: STREET.pz, th: Math.PI },
        paint: PAINTS.slate,
      },
      {
        pose: {
          x: -STREET.gap / 2 - CARD.len - 1.3 - CARD.ro,
          z: STREET.pz,
          th: Math.PI,
        },
        paint: PAINTS.oak,
      },
    ],
    kerbs: [STREET.kerb],
  },
  bays: {
    cars: [
      bayCar(-1, 1, PAINTS.graphite),
      bayCar(1, 0, PAINTS.linen),
      bayCar(-2, 0, PAINTS.clay),
      bayCar(2, 1, PAINTS.navy, 0.1),
      bayCar(3, 0, PAINTS.oak),
    ],
    kerbs: [],
  },
  fbays: {
    cars: [
      bayCar(1, 1, PAINTS.linen),
      bayCar(-2, 0, PAINTS.clay),
      bayCar(2, 0, PAINTS.navy, 0.1),
      bayCar(3, 1, PAINTS.oak),
      bayCar(-3, 1, PAINTS.graphite),
    ],
    kerbs: [],
  },
  angle: {
    cars: [
      angCar(-1, PAINTS.graphite),
      angCar(1, PAINTS.linen),
      angCar(2, PAINTS.clay),
      angCar(-2, PAINTS.navy),
    ],
    kerbs: [],
  },
  // the street again, tilted 1 in 10: up the hill is -x. A car parked up the hill, and one below with room to roll into
  hill: {
    cars: [
      {
        pose: { x: -5.2 - CARD.ro, z: STREET.pz, th: Math.PI },
        paint: PAINTS.navy,
      },
      {
        pose: { x: 8.0 + CARD.fb, z: STREET.pz, th: Math.PI },
        paint: PAINTS.linen,
      },
    ],
    kerbs: [STREET.kerb],
  },
};
const HILL = { grade: 0.1 };
HILL.a = Math.atan(HILL.grade);
HILL.pull = 9.81 * Math.sin(HILL.a); // m/s² down the slope (1.0 m/s²: a tenth of the weight)
HILL.roll = 9.81 * (Math.sin(HILL.a) - 0.012 * Math.cos(HILL.a)); // what is left after the tyres' rolling resistance (a typical 0.012)
for (const k in SETS) SETS[k].polys = SETS[k].cars.map((c) => carPoly(c.pose));
// the end of each bay is a low kerb: the bays' back line (square bays) for the wheels; the angled bays end on a kerb too
SETS.bays.backZ = SETS.fbays.backZ = BAY.z - BAY.d;
SETS.angle.backD = ANG.d;

// ======================================================================= the showroom: navy walls, hologram panels, amber strips, a polished floor, windows onto dusk hills
// Room units are 25 cm. The training ground (a slab of real road, 25 × 15 m) fills the middle of a tall hall; there is no ceiling to see from up here.
let _dt = 0.016,
  _raw = 0.016,
  NOW = 0;
const U = 4; // room units per metre
const room = new THREE.Group();
world.add(room);
const WALL_Z = -38,
  LWALL_X = -64,
  RWALL_X = 60,
  CEIL_Y = 34;
// ---- polished stone floor: big warm-grey tiles, the mirror reads through it
const FLOOR = (() => {
  const tex = canvasTex(1024, 1024, (g, w, h) => {
    const n = 4,
      s = w / n,
      r2 = mulberry(3);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = r2();
        g.fillStyle = `hsl(${205 + v * 10},${4 + v * 3}%,${76 + v * 6}%)`;
        g.fillRect(i * s, j * s, s, s);
        for (let k = 0; k < 70; k++) {
          g.fillStyle = `rgba(${r2() > 0.5 ? 255 : 90},${r2() > 0.5 ? 255 : 92},${r2() > 0.5 ? 255 : 96},${0.03 + r2() * 0.04})`;
          g.beginPath();
          g.ellipse(
            i * s + r2() * s,
            j * s + r2() * s,
            4 + r2() * 40,
            2 + r2() * 12,
            r2() * 3,
            0,
            7,
          );
          g.fill();
        }
      }
    g.strokeStyle = '#9aa3ad';
    g.lineWidth = 4;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(16, 14);
  const fm = patch(
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.82,
      metalness: 0,
      envMapIntensity: 0.4,
    }),
    reflExtra,
  );
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(130, 116), fm);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(-2, 0, 20);
  floor.receiveShadow = true;
  room.add(floor);
  hideInMirror.push(floor);
  return floor;
})();
// ---- the back wall: slate panels with seams, a warm cove at the top, a strip at the floor, two columns with vertical amber light lines, a window on the left
// ParkWise: the yard's building front, cream render with grey seams, white aluminium trim, a blue band under the roofline
const WALL = M('#ece7dc', { roughness: 0.9, envMapIntensity: 0.4 }),
  WALL_D = M('#d3cdc1', { roughness: 0.9 }),
  TRIM = MET('#c9ced6', { roughness: 0.45, metalness: 0.6 }),
  BAND = M('#2453d6', { roughness: 0.6 });
const WIN0 = -60,
  WIN1 = -36; // the window in the back wall, x from .. to
{
  const b = Build(),
    wc = (WIN0 + WIN1) / 2,
    ww = WIN1 - WIN0,
    wy0 = 1.4,
    wy1 = 22;
  b.box(
    WALL,
    (WIN1 + RWALL_X) / 2,
    CEIL_Y / 2,
    WALL_Z - 0.2,
    RWALL_X - WIN1,
    CEIL_Y,
    0.4,
  )
    .box(WALL, wc, (CEIL_Y + wy1) / 2, WALL_Z - 0.2, ww, CEIL_Y - wy1, 0.4)
    .box(WALL, wc, wy0 / 2, WALL_Z - 0.2, ww, wy0, 0.4)
    .box(WALL, WIN0 - 2, CEIL_Y / 2, WALL_Z - 0.2, 4, CEIL_Y, 0.4);
  for (let x = WIN1 + 4.2; x < RWALL_X; x += 4.2)
    b.box(WALL_D, x, CEIL_Y / 2, WALL_Z + 0.01, 0.06, CEIL_Y, 0.04);
  b.box(
    TRIM,
    (WIN1 + RWALL_X) / 2,
    0.12,
    WALL_Z + 0.08,
    RWALL_X - WIN1,
    0.24,
    0.14,
  );
  b.box(TRIM, wc, wy1 + 0.08, WALL_Z + 0.05, ww + 0.3, 0.16, 0.3)
    .box(TRIM, wc, wy0, WALL_Z + 0.05, ww + 0.3, 0.16, 0.3)
    .box(TRIM, WIN0, (wy0 + wy1) / 2, WALL_Z + 0.05, 0.16, wy1 - wy0, 0.3)
    .box(TRIM, WIN1, (wy0 + wy1) / 2, WALL_Z + 0.05, 0.16, wy1 - wy0, 0.3);
  for (let k = 1; k < 5; k++)
    b.box(
      TRIM,
      WIN0 + (ww * k) / 5,
      (wy0 + wy1) / 2,
      WALL_Z + 0.05,
      0.08,
      wy1 - wy0,
      0.16,
    );
  b.box(TRIM, wc, (wy0 + wy1) / 2 + 3, WALL_Z + 0.05, ww, 0.08, 0.16);
  for (const x of [-22, 38])
    b.box(TRIM, x, CEIL_Y / 2, WALL_Z + 0.12, 0.4, CEIL_Y, 0.24); // two slim columns that carry the vertical light lines
  // the left wall, plain slate
  b.box(WALL, LWALL_X - 0.2, CEIL_Y / 2, WALL_Z + 50, 0.4, CEIL_Y, 100);
  // the blue band over the boards, a yellow pinstripe under it, and a dark plinth along the foot of the wall
  b.box(BAND, (WIN1 + RWALL_X) / 2, 16.2, WALL_Z + 0.12, RWALL_X - WIN1, 3.4, 0.2)
    .box(M('#ffbf1f', { roughness: 0.6 }), (WIN1 + RWALL_X) / 2, 14.36, WALL_Z + 0.12, RWALL_X - WIN1, 0.28, 0.2)
    .box(M('#5d646e', { roughness: 0.85 }), (WIN1 + RWALL_X) / 2, 0.6, WALL_Z + 0.1, RWALL_X - WIN1, 1.2, 0.2);
  b.flush(room, false);
  // the school's name on the band, white on blue
  {
    const sg = plate(
      30,
      2.2,
      2048,
      150,
      (g, w, h) => {
        g.fillStyle = '#2453d6';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#ffffff';
        g.font = '800 104px Plus Jakarta Sans, sans-serif';
        g.letterSpacing = '22px';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('PARKWISE  DRIVING  YARD', w / 2, h / 2 + 6);
      },
      0.95,
      { alphaTest: 0 },
    );
    sg.position.set(9, 16.2, WALL_Z + 0.24);
    sg.userData.txt = 1;
    room.add(sg);
    hideForAO.push(sg);
  }
  // soft white downlights over the boards in place of glowing strips
  for (const x of [-22, 38]) addLight(x, 6, WALL_Z + 1.4, '#f4f7ff', 7, 0.25);
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 30),
    new THREE.MeshBasicMaterial({
      map: hillsTex,
      fog: false,
      color: new THREE.Color(0.62, 0.62, 0.66),
    }),
  );
  back.position.set(wc, 11, WALL_Z - 12);
  room.add(back);
  const pb = Build();
  for (let i = 0; i < 26; i++) {
    const x = WIN0 - 3 + hash(i) * (ww + 6),
      z = WALL_Z - 3 - hash(i + 0.5) * 7;
    pine(pb, x, 0, z, 3.2 + hash(i + 0.2) * 3.4, i);
  }
  pb.flush(room);
}
// ---- the right wall: one big window onto the hills and pines, mullions
{
  const back = new THREE.Mesh(
    new THREE.PlaneGeometry(110, 34),
    new THREE.MeshBasicMaterial({
      map: hillsTex,
      fog: false,
      color: new THREE.Color(0.6, 0.6, 0.64),
    }),
  );
  back.rotation.y = -Math.PI / 2;
  back.position.set(RWALL_X + 22, 13, 20);
  room.add(back);
  const b = Build();
  for (const z of [WALL_Z, -26, -14, -2, 10, 22, 34, 46, 58])
    b.box(TRIM, RWALL_X, CEIL_Y / 2, z, 0.2, CEIL_Y, 0.2);
  b.box(TRIM, RWALL_X, 0.15, 10, 0.3, 0.3, 100)
    .box(TRIM, RWALL_X, CEIL_Y - 0.2, 10, 0.3, 0.3, 100)
    .box(TRIM, RWALL_X, 11, 10, 0.16, 0.16, 100);
  b.flush(room, false);
  const pb = Build();
  for (let i = 0; i < 40; i++) {
    const z = WALL_Z - 2 + hash(i + 3) * 96,
      x = RWALL_X + 4 + hash(i + 0.7) * 14;
    pine(pb, x, 0, z, 3 + hash(i + 0.4) * 3.6, i + 40);
  }
  pb.flush(room);
}
// ---- hologram panels on the back wall: line drawings in cyan glass. draw(g,w,h) paints the canvas; call .redraw(fn) to change it later.
function holoPanel(x, y, w, h, draw, parent = room) {
  const p = plate(
    w,
    h,
    768,
    Math.round((768 * h) / w),
    (g, cw, ch) => boardBg(g, cw, ch, draw),
    0.96,
    {
      alphaTest: 0,
    },
  );
  p.position.set(x, y, WALL_Z + 0.3);
  parent.add(p);
  hideForAO.push(p);
  // the board's aluminium frame and two stand-off brackets, so it reads as a sign fixed to the wall, not a light in it
  Build()
    .box(TRIM, x, y + h / 2 + 0.12, WALL_Z + 0.2, w + 0.5, 0.24, 0.3)
    .box(TRIM, x, y - h / 2 - 0.12, WALL_Z + 0.2, w + 0.5, 0.24, 0.3)
    .box(TRIM, x - w / 2 - 0.13, y, WALL_Z + 0.2, 0.24, h + 0.5, 0.3)
    .box(TRIM, x + w / 2 + 0.13, y, WALL_Z + 0.2, 0.24, h + 0.5, 0.3)
    .flush(parent, false);
  return p;
}
// the boards' paper: white, a blue header strip, the drawing inside a margin
function boardBg(g, cw, ch, draw) {
  g.fillStyle = '#fbfcfe';
  g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#2453d6';
  g.fillRect(0, 0, cw, 10);
  g.fillStyle = '#ffbf1f';
  g.fillRect(0, 10, 90, 6);
  g.save();
  g.beginPath();
  g.rect(6, 16, cw - 12, ch - 22);
  g.clip();
  draw(g, cw, ch);
  g.restore();
}
// ---- plants in ceramic pots along the back wall, and a tall one by the window
{
  const b = Build(),
    POT = M('#d9d3c8', { roughness: 0.55 });
  for (const [x, z, s] of [
    [-30, WALL_Z + 3, 2.4],
    [30, WALL_Z + 3, 2.2],
    [54, -8, 2.4],
    [-58, 8, 2.6],
  ])
    b.box(POT, x, 0.8, z, (2 * s) / 2.4, (1.6 * s) / 2.4, (2 * s) / 2.4, {
      r: 0.1,
    });
  b.flush(room);
  lowTree(room, -30, 1.6, WALL_Z + 3, 2.6);
  lowTree(room, 30, 1.5, WALL_Z + 3, 2.4, 0.02);
  lowTree(room, 54, 1.6, -8, 2.6, -0.01, { n: 7 });
  lowTree(room, -58, 1.7, 8, 2.9, -0.02, { n: 7 });
}

// ======================================================================= the training ground: a slab of real road on the showroom floor, laid out three ways
// In metres, in G (scaled by U, its origin on the asphalt's surface). The kerbside street, the car park with square bays and the one at 45° are
// each a group on the same slab; one shows at a time.
const ROAD_H = 0.1,
  ROAD_Y = ROAD_H * U;
const G = new THREE.Group();
G.scale.setScalar(U);
G.position.y = ROAD_Y;
world.add(G);
const SLAB = { x0: -12.5, x1: 12.5, z0: -7.5, z1: 7.5 };
const KERB_H = 0.12;
const PAINT_W = M('#f7f8fa', {
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  }),
  KERB = M('#f2c230', { roughness: 0.7, envMapIntensity: 0.35 }),
  KERB_B = M('#1e2126', { roughness: 0.7, envMapIntensity: 0.35 }),
  PAINT_Y = M('#f5b800', {
    roughness: 0.7,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  }),
  PAVE = M('#9d978c', { roughness: 0.86, envMapIntensity: 0.3 });
const ASPH = (() => {
  const tex = canvasTex(2048, 1024, (g, w, h) => {
    g.fillStyle = '#44474c';
    g.fillRect(0, 0, w, h);
    const r2 = mulberry(41);
    for (let i = 0; i < 90000; i++) {
      const v = r2();
      g.fillStyle =
        v < 0.5
          ? `rgba(20,20,22,${0.25 + r2() * 0.4})`
          : `rgba(${150 + r2() * 60},${150 + r2() * 55},${145 + r2() * 50},${0.12 + r2() * 0.22})`;
      const s = 1 + r2() * 2.4;
      g.fillRect(r2() * w, r2() * h, s, s);
    }
    g.fillStyle = 'rgba(18,18,20,.3)';
    g.fillRect(w * 0.62, h * 0.58, w * 0.08, h * 0.12);
    g.fillRect(w * 0.18, h * 0.12, w * 0.05, h * 0.07);
    g.strokeStyle = 'rgba(16,16,18,.5)';
    g.lineWidth = 2;
    for (let i = 0; i < 9; i++) {
      let x = r2() * w,
        y = r2() * h;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 7; k++) {
        x += (r2() - 0.5) * 60;
        y += (r2() - 0.3) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  });
  tex.anisotropy = 8;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.4, 2.9);
  return patch(
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.88,
      metalness: 0,
      envMapIntensity: 0.25,
    }),
  );
})();
// pavement slabs: 60 cm squares of pale concrete with dark joints
const PAVE_M = (() => {
  const tex = canvasTex(512, 512, (g, w, h) => {
    const r2 = mulberry(77),
      n = 4,
      s = w / n;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const v = r2();
        g.fillStyle = `hsl(${36 + v * 6},${5 + v * 3}%,${52 + v * 8}%)`;
        g.fillRect(i * s, j * s, s, s);
        for (let k = 0; k < 300; k++) {
          g.fillStyle = `rgba(${r2() > 0.5 ? 240 : 60},${r2() > 0.5 ? 235 : 60},230,${0.04 + r2() * 0.05})`;
          g.fillRect(
            i * s + r2() * s,
            j * s + r2() * s,
            1 + r2() * 2,
            1 + r2() * 2,
          );
        }
      }
    g.strokeStyle = '#4d4943';
    g.lineWidth = 4;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, h);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
  });
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return patch(
    new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.85,
      envMapIntensity: 0.3,
    }),
  );
})();
// grass and hedges in the planting strips: short blades in muted greens
const GRASS = (() => {
  const gtex = canvasTex(1024, 256, (g, w, h) => {
    g.fillStyle = '#4a5a40';
    g.fillRect(0, 0, w, h);
    const r3 = mulberry(5);
    for (let i = 0; i < 16000; i++) {
      const x = r3() * w,
        y = r3() * h,
        l = 2 + r3() * 5,
        c = r3();
      g.strokeStyle =
        c < 0.4
          ? '#5d7249'
          : c < 0.75
            ? '#6b8052'
            : c < 0.92
              ? '#3f4f36'
              : '#9a9466';
      g.globalAlpha = 0.55 + r3() * 0.4;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (r3() - 0.5) * 2, y - l);
      g.stroke();
    }
    g.globalAlpha = 1;
  });
  gtex.wrapS = gtex.wrapT = THREE.RepeatWrapping;
  gtex.repeat.set(6, 1);
  return patch(
    new THREE.MeshStandardMaterial({
      map: gtex,
      roughness: 0.95,
      envMapIntensity: 0.2,
    }),
  );
})();
{
  const { x0, x1, z0, z1 } = SLAB;
  // one box, the asphalt on its own top face: no second surface anywhere near the road's for the depth buffer to confuse it with
  const side = M('#5d646e', { roughness: 0.6 }),
    slab = new THREE.Mesh(
      new THREE.BoxGeometry(x1 - x0, ROAD_H - 0.002, z1 - z0),
      [side, side, ASPH, side, side, side],
    );
  slab.position.set((x0 + x1) / 2, -(ROAD_H - 0.002) / 2, (z0 + z1) / 2);
  slab.receiveShadow = slab.castShadow = true;
  G.add(slab);
  // the amber line along the slab's front, just above the floor, and its light on the floor
  lines()
    .line(
      [x0 + 0.02, -ROAD_H + 0.025, z1 + 0.006],
      [x1 - 0.02, -ROAD_H + 0.025, z1 + 0.006],
      0.012,
      '#ffbf1f',
      3.6,
    )
    .flush(G);
  for (const x of [-8, 0, 8])
    addLight(x * U, 0.4, (z1 + 0.4) * U, '#fff6dd', 8, 0.15);
}
// ---- builders for the sets: a run of kerb, a strip of pavement or planting, a painted line, an arrow on the road, a street lamp
function kerbRun(b, x0, x1, z0, z1) {
  const n = Math.max(1, Math.round(Math.abs(x1 - x0)));
  for (let i = 0; i < n; i++) {
    const a = lerp(x0, x1, i / n),
      c = lerp(x0, x1, (i + 1) / n);
    b.box(
      i % 2 ? KERB_B : KERB, // painted kerb stones, yellow and black by turns
      (a + c) / 2,
      KERB_H / 2,
      (z0 + z1) / 2,
      Math.abs(c - a) - 0.01,
      KERB_H,
      Math.abs(z1 - z0),
      { r: 0.015 },
    );
  }
}
function paveStrip(par, x0, x1, z0, z1, mat = PAVE_M, h = KERB_H) {
  const w = x1 - x0,
    d = Math.abs(z1 - z0),
    m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  // the top face's texture in metres (60 cm slabs)
  const uv = m.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * w) / 2.4, (uv.getY(i) * d) / 2.4);
  m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
  m.receiveShadow = true;
  m.castShadow = true;
  par.add(m);
  return m;
}
const paint = (b, ax, az, bx, bz, w = 0.1, mat = PAINT_W) => {
  const L = Math.hypot(bx - ax, bz - az);
  b.box(mat, (ax + bx) / 2, 0.0025, (az + bz) / 2, L, 0.004, w, {
    ry: -Math.atan2(bz - az, bx - ax),
  });
};
const dashes = (b, x0, x1, z, len, gap, w = 0.1, mat = PAINT_W) => {
  for (let x = x0; x + len <= x1; x += len + gap)
    paint(b, x, z, x + len, z, w, mat);
};
// a painted arrow pointing along dir (radians, 0 = +x), its tip at (x,z); arrows point the way the traffic goes
function roadArrow(b, x, z, dir, L = 3) {
  const c = Math.cos(dir),
    s = Math.sin(dir),
    p = (u, v) => [x + c * u - s * v, z + s * u + c * v];
  const [ax, az] = p(-L, 0),
    [bx, bz] = p(-0.9, 0);
  paint(b, ax, az, bx, bz, 0.16);
  const shp = new THREE.Shape(
    [
      [0, 0],
      [-1.0, 0.42],
      [-1.0, -0.42],
    ].map(([u, v]) => new THREE.Vector2(u, v)),
  );
  const g = new THREE.ShapeGeometry(shp).rotateX(-Math.PI / 2);
  b.geo(PAINT_W, g, x, 0.0045, z, { ry: -dir });
}
const LAMP_POST = M('#d5dae1', { roughness: 0.45 }),
  LAMP_HEAD = M('#eef1f5', { roughness: 0.4 });
function streetLamp(par, b, L, x, z, h, face) {
  b.cyl(LAMP_POST, x, h / 2, z, 0.05, 0.07, h, { seg: 10 })
    .box(LAMP_POST, x + face * 0.35, h - 0.05, z, 0.8, 0.06, 0.08, { r: 0.02 })
    .box(LAMP_HEAD, x + face * 0.75, h - 0.12, z, 0.46, 0.1, 0.2, { r: 0.03 });
  L.line(
    [x + face * 0.56, h - 0.175, z],
    [x + face * 0.94, h - 0.175, z],
    0.05,
    '#f7fbff',
    5,
  );
  _setL?.push(
    addLight(
      (x + face * 0.75) * U,
      (h - 0.6) * U + ROAD_Y,
      z * U,
      '#f4f8ff',
      13,
      0.2,
    ),
  );
}
const SETG = {},
  SET_LIGHTS = { street: [], bays: [], angle: [] };
let _setL = null;
// ---- the kerbside street: the pavement and its kerb at the back (the side you park on), the parking lane, two traffic lanes, a kerb at the front
{
  const g = (SETG.street = new THREE.Group());
  G.add(g);
  _setL = SET_LIGHTS.street;
  const b = Build(),
    K = STREET.kerb,
    L = lines();
  kerbRun(b, SLAB.x0, SLAB.x1, K, K - 0.18);
  paveStrip(g, SLAB.x0, SLAB.x1, K - 0.18, SLAB.z0);
  // markings: the parking lane's edge (a long dash), the centre line, the edge of the far lane; the front kerb and its pavement
  dashes(b, SLAB.x0 + 0.4, SLAB.x1, -0.8, 6, 0.6, 0.1);
  dashes(b, SLAB.x0 + 1, SLAB.x1, 2.65, 3, 3, 0.12, PAINT_Y);
  paint(b, SLAB.x0 + 0.1, 5.75, SLAB.x1 - 0.1, 5.75, 0.12);
  kerbRun(b, SLAB.x0, SLAB.x1, 5.95, 6.13);
  paveStrip(g, SLAB.x0, SLAB.x1, 6.13, SLAB.z1);
  roadArrow(b, -6, 4.3, 0, 2.6);
  roadArrow(b, 7, 1.0, Math.PI, 2.6);
  b.flush(g);
  // street lamps on the far pavement, trees in square pits, a parking sign at the gap
  const lb = Build();
  streetLamp(g, lb, L, -10, K - 1.9, 4.4, 1);
  streetLamp(g, lb, L, 10.2, K - 1.9, 4.4, -1);
  lb.flush(g);
  L.flush(g);
  for (const [x, z] of [
    [-8.6, K - 2.9],
    [7.4, K - 2.9],
  ]) {
    const tb = Build();
    tb.box(
      M('#3b3326', { roughness: 0.95 }),
      x,
      KERB_H + 0.0125,
      z,
      1.2,
      0.025,
      1.2,
    ).box(TRIM, x, KERB_H + 0.01, z, 1.28, 0.02, 1.28);
    tb.flush(g);
    lowTree(g, x, KERB_H, z, 1.9, 0, { n: 6 });
  }
}
// ---- the car park: 2.5 × 5.0 m bays along the back, nose to a low kerb and a planted strip; a 6.5 m aisle; arrows the way the traffic flows
{
  const g = (SETG.bays = new THREE.Group());
  G.add(g);
  _setL = SET_LIGHTS.bays;
  const b = Build(),
    Z = BAY.z,
    BK = BAY.z - BAY.d,
    L = lines();
  for (let k = -5; k <= 5; k++) {
    const x = (k - 0.5) * BAY.w;
    if (x < SLAB.x0 + 0.2) continue;
    paint(b, x, Z, x, BK + 0.2, 0.1);
  }
  kerbRun(b, SLAB.x0, SLAB.x1, BK, BK - 0.18);
  paveStrip(g, SLAB.x0, SLAB.x1, BK - 0.18, SLAB.z0, GRASS, 0.1);
  const AE = Z + BAY.aisle;
  kerbRun(b, SLAB.x0, SLAB.x1, AE, AE + 0.18);
  paveStrip(g, SLAB.x0, SLAB.x1, AE + 0.18, SLAB.z1);
  roadArrow(b, -4.5, Z + 3.4, Math.PI, 2.6);
  roadArrow(b, 8.5, Z + 3.4, Math.PI, 2.6);
  b.flush(g);
  const lb = Build();
  streetLamp(g, lb, L, -9.6, BK - 1, 4.4, 1);
  streetLamp(g, lb, L, 9.8, BK - 1, 4.4, -1);
  lb.flush(g);
  L.flush(g);
  for (const [x, s] of [
    [-7, 1],
    [-1.4, 0.9],
    [4.6, 1.1],
  ]) {
    const hb = Build();
    for (let i = 0; i < 6; i++)
      hb.geo(
        M(['#4f7a3c', '#5f8c45', '#3f6834'][i % 3], {
          flatShading: true,
          roughness: 0.8,
        }),
        facetBlob(0.5 * s, 0.3, i + x * 3),
        x + i * 0.55 - 1.4,
        0.5,
        BK - 1.15 + (i % 2) * 0.3,
      );
    hb.flush(g);
  }
}
// ---- the angled bays: 45°, leaning the way the traffic goes; a one-way aisle 4.5 m wide
{
  const g = (SETG.angle = new THREE.Group());
  G.add(g);
  _setL = SET_LIGHTS.angle;
  const b = Build(),
    Z = ANG.z,
    ax = ANG.ax,
    L = lines(),
    BK = Z + ax[1] * ANG.d - 0.3;
  for (let k = -4; k <= 4; k++) {
    const x = (k + 0.5) * ANG.pitch;
    if (x < SLAB.x0 + 0.5) continue;
    const ex = x + ax[0] * ANG.d,
      ez = Z + ax[1] * ANG.d;
    if (ex < SLAB.x0 + 0.1) continue;
    paint(b, x, Z, ex, ez, 0.1);
  }
  kerbRun(b, SLAB.x0, SLAB.x1, BK, BK - 0.18);
  paveStrip(g, SLAB.x0, SLAB.x1, BK - 0.18, SLAB.z0, GRASS, 0.1);
  const AE = Z + 4.5;
  kerbRun(b, SLAB.x0, SLAB.x1, AE, AE + 0.18);
  paveStrip(g, SLAB.x0, SLAB.x1, AE + 0.18, SLAB.z1);
  roadArrow(b, -5, Z + 2.4, Math.PI, 2.6);
  roadArrow(b, 9, Z + 2.4, Math.PI, 2.6);
  b.flush(g);
  const lb = Build();
  streetLamp(g, lb, L, -10.6, BK - 1.1, 4.4, 1);
  streetLamp(g, lb, L, 9.4, BK - 1.1, 4.4, -1);
  lb.flush(g);
  L.flush(g);
  for (const [x, s] of [
    [-6, 1],
    [2.8, 1.1],
  ]) {
    const hb = Build();
    for (let i = 0; i < 6; i++)
      hb.geo(
        M(['#4f7a3c', '#5f8c45', '#3f6834'][i % 3], {
          flatShading: true,
          roughness: 0.8,
        }),
        facetBlob(0.5 * s, 0.3, i + x * 3),
        x + i * 0.55 - 1.4,
        0.5,
        BK - 1.1 + (i % 2) * 0.3,
      );
    hb.flush(g);
  }
}
SETG.fbays = SETG.bays;
// ---- the hill: the same street, the whole slab tilted 1 in 10 about its low end (on the floor, to the right), on a slate plinth
const HILL_BASE = (() => {
  G.rotation.z = -HILL.a;
  G.position.y = SLAB.x1 * U * Math.sin(HILL.a) + ROAD_H * U * Math.cos(HILL.a);
  G.updateMatrixWorld(true);
  const lo = new THREE.Vector3(SLAB.x1, -ROAD_H, 0).applyMatrix4(G.matrixWorld),
    hi = new THREE.Vector3(SLAB.x0, -ROAD_H, 0).applyMatrix4(G.matrixWorld);
  G.rotation.z = 0;
  G.position.y = ROAD_Y;
  G.updateMatrixWorld(true);
  const sh = new THREE.Shape([
    new THREE.Vector2(hi.x, 0),
    new THREE.Vector2(lo.x, 0),
    new THREE.Vector2(lo.x, Math.max(0, lo.y) + 0.001),
    new THREE.Vector2(hi.x, hi.y - 0.02),
  ]);
  const d = (SLAB.z1 - SLAB.z0) * U - 0.1,
    g = new THREE.ExtrudeGeometry(sh, {
      depth: d,
      bevelEnabled: false,
    }).translate(0, 0, -d / 2 + ((SLAB.z0 + SLAB.z1) / 2) * U);
  const m = new THREE.Mesh(
    g,
    M('#5d646e', { roughness: 0.6, envMapIntensity: 0.5 }),
  );
  m.castShadow = m.receiveShadow = true;
  m.visible = false;
  world.add(m);
  // the plinth's front edge: an amber line along the floor, and up its high end
  const L = lines()
    .line(
      [lo.x, 0.03, SLAB.z1 * U + 0.02],
      [hi.x, 0.03, SLAB.z1 * U + 0.02],
      0.05,
      '#ffbf1f',
      3,
    )
    .line(
      [hi.x + 0.02, 0.05, SLAB.z1 * U + 0.02],
      [hi.x + 0.02, hi.y - 0.1, SLAB.z1 * U + 0.02],
      0.05,
      '#ffbf1f',
      3,
    );
  const lm = L.flush(world);
  lm.visible = false;
  return { m, lm };
})();
function tiltG(on) {
  G.rotation.z = on ? -HILL.a * MS() : 0;
  G.position.y = on
    ? SLAB.x1 * U * Math.sin(HILL.a) + ROAD_H * U * Math.cos(HILL.a)
    : ROAD_Y;
  G.updateMatrixWorld(true);
  HILL_BASE.m.visible = HILL_BASE.lm.visible = on;
}
// ---- the parking sign: a blue square with a white P on a slim post, where you park
const PSIGN = (() => {
  const g = new THREE.Group(),
    b = Build();
  b.cyl(LAMP_POST, 0, 1.1, 0, 0.03, 0.03, 2.2, { seg: 8 });
  b.flush(g);
  const t = canvasTex(256, 256, (x, w, h) => {
    // ParkWise's practice-bay marker: a yellow board, a black P in a ring and a down chevron to the spot
    x.fillStyle = '#1e2126';
    rr(x, 0, 0, w, h, 14);
    x.fill();
    x.fillStyle = '#ffbf1f';
    rr(x, 8, 8, w - 16, h - 16, 10);
    x.fill();
    x.strokeStyle = '#1e2126';
    x.lineWidth = 14;
    x.beginPath();
    x.arc(w / 2, h * 0.43, 72, 0, 7);
    x.stroke();
    x.fillStyle = '#1e2126';
    x.font = '800 112px Plus Jakarta Sans, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.fillText('P', w / 2 + 2, h * 0.43 + 6);
    x.beginPath();
    x.moveTo(w / 2 - 34, h * 0.8);
    x.lineTo(w / 2, h * 0.9);
    x.lineTo(w / 2 + 34, h * 0.8);
    x.lineWidth = 12;
    x.stroke();
  });
  const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.02), [
    M('#1e2126'),
    M('#1e2126'),
    M('#1e2126'),
    M('#1e2126'),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 }),
  ]);
  s.position.y = 2.15;
  s.castShadow = true;
  s.userData.txt = 1;
  g.add(s);
  G.add(g);
  return g;
})();

// ======================================================================= the car: an ordinary five-door hatchback, 4.28 m long, 1.79 m wide, 1.46 m tall, on 205/55 R16 tyres (Change a Flat Tyre's).
// Car coordinates, in metres: x forward (the nose at +2.18, the tail at -2.10, the axles at ±1.32), y up from the road at its normal ride height,
// z to the car's right. The body is one closed shell lofted through its creases, as The Flying Roadster's is. makeCar() builds one in any paint;
// the learner's car keeps its wheels live (they steer and roll), the parked ones are baked into a handful of meshes.
const AXF = 1.32,
  AXR = -1.32,
  TRACK = 0.765,
  HUBZ = TRACK + 0.045,
  R_TYRE = 0.316,
  HUB0 = 0.3; // the hub's mounting face is 45 mm outboard of the tyre's centre (the wheel's ET45 offset)
const XN = 2.185,
  XT = -2.1;
function pchip(xs, ys) {
  const n = xs.length,
    d = [],
    m = new Array(n);
  for (let i = 0; i < n - 1; i++)
    d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++)
    m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i],
      b = m[i + 1] / d[i],
      s = a * a + b * b;
    if (s > 9) {
      const q = 3 / Math.sqrt(s);
      m[i] = q * a * d[i];
      m[i + 1] = q * b * d[i];
    }
  }
  return (u) => {
    if (u <= xs[0]) return ys[0];
    if (u >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (u > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i],
      q = (u - xs[i]) / h,
      q2 = q * q,
      q3 = q2 * q;
    return (
      (2 * q3 - 3 * q2 + 1) * ys[i] +
      (q3 - 2 * q2 + q) * h * m[i] +
      (-2 * q3 + 3 * q2) * ys[i + 1] +
      (q3 - q2) * h * m[i + 1]
    );
  };
}
// ---- the body's shape: corner k of the half section as (z, y) at these stations, a monotone cubic between them. K0 the centre line (bonnet, screen,
// roof, rear glass); K1 the roof's and bonnet's edge; K2 the top of the side glass (ahead of the screen, the wing's top); K3 the waistline (the glass's
// foot); K4 the shoulder crease; K5 the widest point; K6 the crease over the black sill; K7 the floor's edge; K8 the floor's centre.
const CX = [
  -2.1, -2.04, -1.95, -1.75, -1.5, -1, -0.5, 0, 0.5, 0.95, 1.3, 1.7, 2, 2.1,
  2.155, 2.185,
];
const CRN = [
  [
    CX.map(() => 0),
    [
      0.93, 1, 1.1, 1.405, 1.44, 1.455, 1.455, 1.43, 1.215, 1.012, 0.935, 0.86,
      0.78, 0.725, 0.64, 0.56,
    ],
  ],
  [
    [
      0.64, 0.65, 0.635, 0.6, 0.61, 0.62, 0.625, 0.63, 0.68, 0.725, 0.755, 0.75,
      0.7, 0.645, 0.56, 0.44,
    ],
    [
      0.91, 0.975, 1.075, 1.385, 1.415, 1.43, 1.43, 1.4, 1.185, 0.99, 0.905,
      0.825, 0.74, 0.69, 0.615, 0.545,
    ],
  ],
  [
    [
      0.7, 0.71, 0.7, 0.66, 0.67, 0.675, 0.68, 0.685, 0.735, 0.79, 0.81, 0.8,
      0.745, 0.69, 0.6, 0.48,
    ],
    [
      0.87, 0.93, 1.02, 1.33, 1.37, 1.385, 1.385, 1.355, 1.145, 0.98, 0.9, 0.82,
      0.735, 0.68, 0.605, 0.538,
    ],
  ],
  [
    [
      0.78, 0.8, 0.81, 0.8, 0.8, 0.8, 0.8, 0.8, 0.8, 0.815, 0.84, 0.835, 0.775,
      0.715, 0.625, 0.5,
    ],
    [
      0.84, 0.9, 0.985, 1.035, 1.03, 1.01, 1, 0.99, 0.985, 0.96, 0.87, 0.8,
      0.715, 0.66, 0.59, 0.53,
    ],
  ],
  [
    [
      0.83, 0.855, 0.87, 0.88, 0.885, 0.885, 0.885, 0.885, 0.885, 0.88, 0.885,
      0.87, 0.805, 0.74, 0.655, 0.53,
    ],
    [
      0.78, 0.83, 0.86, 0.87, 0.87, 0.865, 0.86, 0.855, 0.85, 0.85, 0.82, 0.75,
      0.675, 0.62, 0.565, 0.51,
    ],
  ],
  [
    [
      0.84, 0.865, 0.885, 0.895, 0.895, 0.895, 0.895, 0.895, 0.895, 0.895,
      0.895, 0.88, 0.82, 0.765, 0.68, 0.555,
    ],
    [
      0.58, 0.6, 0.61, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.62, 0.6, 0.57,
      0.53, 0.51, 0.48, 0.45,
    ],
  ],
  [
    [
      0.83, 0.855, 0.875, 0.885, 0.885, 0.885, 0.885, 0.885, 0.885, 0.885,
      0.885, 0.87, 0.81, 0.76, 0.675, 0.55,
    ],
    [
      0.3, 0.3, 0.31, 0.32, 0.33, 0.33, 0.33, 0.33, 0.33, 0.33, 0.33, 0.32,
      0.32, 0.32, 0.32, 0.33,
    ],
  ],
  [
    [
      0.77, 0.8, 0.82, 0.83, 0.835, 0.84, 0.84, 0.84, 0.84, 0.835, 0.83, 0.81,
      0.76, 0.71, 0.63, 0.51,
    ],
    [
      0.27, 0.23, 0.2, 0.19, 0.185, 0.18, 0.18, 0.18, 0.18, 0.185, 0.19, 0.2,
      0.22, 0.24, 0.26, 0.29,
    ],
  ],
];
const CRF = CRN.map(([z, y]) => [pchip(CX, z), pchip(CX, y)]);
// how sharp each corner is (1 a crisp crease, 0 smooth)
const SHARP = [0, 1, 1, 1, 0.9, 0, 0.8, 0.55, 0];
// samples per segment and how much each panel is crowned; the first (roof, bonnet, glass) is a parabola from the centre line
const SEG = [
  [22, 0],
  [5, 0.03],
  [10, 0.012],
  [5, 0],
  [10, 0.02],
  [12, 0.015],
  [5, 0],
  [10, 0],
];
const NSEG = SEG.length,
  HALF = SEG.reduce((a, [n]) => a + n + 1, 0),
  RING = 2 * HALF - 2;
function corner(k, x) {
  if (k === 8) return [0, CRF[7][1](x) - 0.01];
  return [CRF[k][0](x), CRF[k][1](x)];
}
function halfSection(x, P, seg, tt, dA, dB) {
  const C = [];
  for (let k = 0; k <= 8; k++) C.push(corner(k, x));
  let o = 0;
  for (let s = 0; s < NSEG; s++) {
    const [n, cr] = SEG[s],
      [z0, y0] = C[s],
      [z1, y1] = C[s + 1],
      L = Math.hypot(z1 - z0, y1 - y0),
      nz = -(y1 - y0) / (L || 1),
      ny = (z1 - z0) / (L || 1);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      let z, y;
      if (s === 0) {
        z = z1 * t;
        y = y0 + (y1 - y0) * t * t;
      } else {
        const b = cr * L * 4 * t * (1 - t);
        z = z0 + (z1 - z0) * t + nz * b;
        y = y0 + (y1 - y0) * t + ny * b;
      }
      P[2 * o] = z;
      P[2 * o + 1] = y;
      if (seg) {
        seg[o] = s;
        tt[o] = t;
        dA[o] = t * L;
        dB[o] = (1 - t) * L;
      }
      o++;
    }
  }
  return C;
}
const _hs = new Float32Array(HALF * 2);
// the outer side's half-width at height y (for the arch wells, the handles, the lamps' light lines): the K3..K7 part of the section
function sideZ(x, y) {
  halfSection(x, _hs);
  let best = -1,
    i0 = 0;
  for (let s = 0; s < 3; s++) i0 += SEG[s][0] + 1;
  let i1 = i0;
  for (let s = 3; s < 7; s++) i1 += SEG[s][0] + 1;
  for (let i = i0; i < i1 - 1; i++) {
    const ya = _hs[2 * i + 1],
      yb = _hs[2 * i + 3];
    if ((ya - y) * (yb - y) <= 0 && ya !== yb) {
      const z = lerp(_hs[2 * i], _hs[2 * i + 2], (y - ya) / (yb - ya));
      if (z > best) best = z;
    }
  }
  return best < 0 ? corner(4, x)[0] : best;
}
// the outermost surface at height y, anywhere round the half section (the lamps' light lines sit on it); null where the body is lower than y
function surfZ(x, y) {
  halfSection(x, _hs);
  let best = -1;
  for (let i = 0; i < HALF - 1; i++) {
    const ya = _hs[2 * i + 1],
      yb = _hs[2 * i + 3];
    if ((ya - y) * (yb - y) <= 0 && ya !== yb) {
      const z = lerp(_hs[2 * i], _hs[2 * i + 2], (y - ya) / (yb - ya));
      if (z > best) best = z;
    }
  }
  return best < 0 ? null : best;
}
// the top surface's height at (x, z) (on the roof or the bonnet): K0..K1
function topY(x, z) {
  const [z1, y1] = corner(1, x),
    y0 = corner(0, x)[1],
    t = clamp(Math.abs(z) / Math.max(z1, 1e-3), 0, 1);
  return y0 + (y1 - y0) * t * t;
}
const halfW = (x) => Math.max(corner(4, x)[0], corner(5, x)[0]);
const NC = 12;
function buildGrid(NX) {
  const rows = [];
  for (let i = 0; i <= NC; i++) rows.push({ x: XT, cap: -1, s: i / NC });
  for (let i = 0; i < NX; i++)
    rows.push({ x: lerp(XT, XN, i / (NX - 1)), cap: 0, s: 1 });
  for (let i = NC; i >= 0; i--) rows.push({ x: XN, cap: 1, s: i / NC });
  const NR = rows.length,
    N = NR * RING,
    pos = new Float32Array(N * 3),
    seg = new Int8Array(N),
    tt = new Float32Array(N),
    dA = new Float32Array(N),
    dB = new Float32Array(N);
  const P = new Float32Array(HALF * 2),
    hs = new Int8Array(HALF),
    ht = new Float32Array(HALF),
    ha = new Float32Array(HALF),
    hb = new Float32Array(HALF);
  for (let r = 0; r < NR; r++) {
    const R = rows[r];
    halfSection(R.x, P, hs, ht, ha, hb);
    const yc = (P[1] + P[2 * (HALF - 1) + 1]) / 2;
    for (let j = 0; j < RING; j++) {
      const h = j < HALF ? j : RING - j,
        sg = j < HALF ? 1 : -1,
        k = r * RING + j;
      let z = P[2 * h],
        y = P[2 * h + 1];
      if (R.cap) {
        z *= R.s;
        y = yc + (y - yc) * R.s;
      }
      pos[3 * k] = R.x;
      pos[3 * k + 1] = y;
      pos[3 * k + 2] = sg * z;
      seg[k] = R.cap ? (R.cap > 0 ? -1 : -2) : hs[h];
      tt[k] = ht[h];
      dA[k] = ha[h];
      dB[k] = hb[h];
    }
  }
  const I = [];
  for (let r = 0; r < NR - 1; r++)
    for (let j = 0; j < RING; j++) {
      const a = r * RING + j,
        b = r * RING + ((j + 1) % RING),
        c = a + RING,
        d = b + RING;
      I.push(a, b, c, b, d, c);
    }
  return { rows, NR, N, pos, seg, tt, dA, dB, I };
}
function polySD(x, y, Pp) {
  let inside = false,
    d = 1e9;
  for (let i = 0, j = Pp.length - 1; i < Pp.length; j = i++) {
    const [xi, yi] = Pp[i],
      [xj, yj] = Pp[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
      inside = !inside;
    const ex = xj - xi,
      ey = yj - yi,
      l = ex * ex + ey * ey || 1e-9,
      q = clamp(((x - xi) * ex + (y - yi) * ey) / l, 0, 1);
    d = Math.min(d, Math.hypot(x - xi - q * ex, y - yi - q * ey));
  }
  return inside ? d : -d;
}
// the wheel arches: round holes cut through the side where the wheels are (discarded per pixel, so the edge is exact), each with a dark well behind it
const ARCHES = [
  [AXF, 0.315, 0.358, 0.31],
  [AXR, 0.315, 0.358, 0.31],
];
const ARCH_U = {
  value: ARCHES.map(
    ([x, y, r, dp]) => new THREE.Vector4(x, y, r, halfW(x) - dp),
  ),
};
// the side glass, as seen from the side ([x, y]): its front edge follows the screen's pillar, its back the rear pillar; the B-pillar and the
// rear door's frame are dark slivers across it
const DLO = [
    [0.97, 0.9],
    [0.97, 0.95],
    [0.03, 1.43],
    [-1.36, 1.43],
    [-1.72, 0.98],
    [-1.72, 0.9],
  ],
  BPIL = [
    [-0.395, 0.9],
    [-0.355, 1.45],
    [-0.465, 1.45],
    [-0.49, 0.9],
  ],
  CBAR = [
    [-1.255, 0.9],
    [-1.235, 1.45],
    [-1.285, 1.45],
    [-1.305, 0.9],
  ];
// the tailgate: everything behind its hinge line above the bumper, inside its shut lines. It lifts on a hinge at the back of the roof.
const HINGE = [-1.745, 1.433];
// the paint, with every other surface of the shell picked out from it per pixel: the glass, the satin black sill and bumpers, the lamps,
// and the shut lines (worked out from the position itself, so a gap is a crisp hairline at any distance)
function bodyMat(paint, U) {
  const m = patch(
    new THREE.MeshPhysicalMaterial({
      color: paint,
      metalness: 0.32,
      roughness: 0.48,
      clearcoat: 0.7,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.75,
    }),
  );
  const prev = m.onBeforeCompile,
    key = m.customProgramCacheKey();
  m.onBeforeCompile = (s) => {
    prev(s);
    s.uniforms.uArch = ARCH_U;
    Object.assign(s.uniforms, U);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlass;attribute float aLow;attribute float aTrim;attribute float aLamp;attribute float aTailL;varying float vGlass;varying float vLow;varying float vTrim;varying float vLamp;varying float vTailL;varying vec3 vObj;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGlass=aGlass;vLow=aLow;vTrim=aTrim;vLamp=aLamp;vTailL=aTailL;vObj=transformed;',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uArch[2];uniform float uTail;uniform float uSide;uniform float uRoof;varying float vGlass;varying float vLow;varying float vTrim;varying float vLamp;varying float vTailL;varying vec3 vObj;
float seamD(vec3 p){float d=1.,az=abs(p.z);
 if(az>.70&&p.y>.33&&p.y<.99){d=min(d,abs(p.x-.93));d=min(d,abs(p.x+.43));if(p.y>.66)d=min(d,abs(p.x+1.28));else if(p.x>-1.32)d=min(d,abs(length(vec2(p.x+1.32,p.y-.315))-.395));}
 if(az>.6&&p.y>.3&&p.y<.62){d=min(d,abs(p.x-1.985));d=min(d,abs(p.x+1.905));}
 if(p.x>1.05&&p.x<2.085&&p.y>.64)d=min(d,abs(az-.68-.06*smoothstep(1.6,2.08,p.x)*0.));
 if(p.x>1.03&&az<.705&&p.y>.88)d=min(d,abs(p.x-1.05));
 if(p.x>2.03&&p.x<2.15&&az<.62&&p.y>.62)d=min(d,abs(p.x-2.085));
 if(p.y>1.3&&az<.61)d=min(d,abs(p.x+1.745));
 if(p.x<-1.745&&p.y>.6&&p.y<1.42)d=min(d,abs(az-.70));
 if(p.x<-1.98&&az<.70)d=min(d,abs(p.y-.60));
 if(p.z>.8)d=min(d,abs(length(vec2(p.x+1.6,p.y-.87))-.062));
 return d;}`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(uSide>.5&&uSide<1.5&&!gl_FrontFacing)discard;\nfor(int i=0;i<2;i++){vec2 d=vObj.xy-uArch[i].xy;if(dot(d,d)<uArch[i].z*uArch[i].z&&abs(vObj.z)>uArch[i].w)discard;}',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
 float gl=smoothstep(-.0012,.0012,vGlass),lo=smoothstep(-.0015,.0015,vLow),tr=smoothstep(-.0012,.0012,vTrim),lh=smoothstep(-.0012,.0012,vLamp),lt=smoothstep(-.0012,.0012,vTailL);
 float px=length(fwidth(vObj)),sw=max(.0017,px*1.1),sm=(1.-smoothstep(sw*.5,sw*1.3,seamD(vObj)))*(1.-gl);
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.034,.036,.04),lo);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.010,.011,.013),max(gl,tr));
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.05,.055,.065),lh);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.32,.018,.014),lt);diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.012),sm);
 diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.018,.02,.024),smoothstep(1.384,1.392,vObj.y)*uRoof*(1.-gl)); // ParkWise: a gloss-black roof over the paint
 if(!gl_FrontFacing&&uSide<1.5)diffuseColor.rgb=vec3(.03,.032,.036);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,.58,lo);roughnessFactor=mix(roughnessFactor,.3,max(gl,tr*.8));roughnessFactor=mix(roughnessFactor,.1,max(lh,lt));roughnessFactor=mix(roughnessFactor,.8,sm);if(!gl_FrontFacing&&uSide<1.5)roughnessFactor=.85;',
      )
      .replace(
        '#include <metalnessmap_fragment>',
        '#include <metalnessmap_fragment>\nmetalnessFactor=mix(metalnessFactor,0.,max(max(lo,gl),max(tr,lt)));metalnessFactor=mix(metalnessFactor,.2,lh);metalnessFactor*=1.-sm;if(!gl_FrontFacing&&uSide<1.5)metalnessFactor=0.;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance+=vec3(1.,.035,.025)*lt*uTail*(gl_FrontFacing||uSide>1.5?1.:0.);',
      )
      .replace(
        '#include <lights_physical_fragment>',
        '#include <lights_physical_fragment>\nmaterial.clearcoat*=(1.-.85*lo)*(1.-sm)*(1.-gl);material.specularColor*=1.-.55*gl;material.specularF90*=1.-.55*gl;if(!gl_FrontFacing&&uSide<1.5)material.clearcoat=0.;',
      );
  };
  m.customProgramCacheKey = () => key + 'body';
  m.side = THREE.DoubleSide;
  return m;
}
const BLACK_S = M('#0d0e10', { roughness: 0.5 }),
  BLACK_G = P('#07080a', { roughness: 0.12 }),
  UNDER = M('#15171a', { roughness: 0.8 });
const PAINT_M = (paint) => {
  const k = 'paint' + paint;
  if (!_mats.has(k))
    _mats.set(
      k,
      patch(
        new THREE.MeshPhysicalMaterial({
          color: paint,
          metalness: 0.32,
          roughness: 0.48,
          clearcoat: 0.7,
          clearcoatRoughness: 0.4,
          envMapIntensity: 0.75,
        }),
      ),
    );
  return _mats.get(k);
};
// the shell's geometry, once per level of detail (the parked cars share a coarser one): normals softened at the corners that are not creases,
// and the per-vertex signed distances the paint shader picks the glass, the black trim and the lamps out with
const BODY_G = {};
function bodyGeo(NX) {
  if (BODY_G[NX]) return BODY_G[NX];
  const Gd = buildGrid(NX),
    { NR, N, pos, seg, dA, dB, I } = Gd;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(I);
  g.computeVertexNormals();
  let nor = g.attributes.normal.array,
    flip = false;
  const mid = Math.floor(NR / 2) * RING;
  if (nor[3 * mid + 1] < 0) {
    flip = true;
    for (let i = 0; i < I.length; i += 3) {
      const t = I[i + 1];
      I[i + 1] = I[i + 2];
      I[i + 2] = t;
    }
    g.setIndex(I);
    g.computeVertexNormals();
    nor = g.attributes.normal.array;
  }
  // soften the corners that are not creases (the waist), and partly the sill's
  {
    const ends = [];
    let h = -1;
    for (let s = 0; s < NSEG; s++) {
      h += SEG[s][0] + 1;
      ends.push(h);
    }
    for (let r = NC + 1; r < NR - NC - 1; r++) {
      for (let k = 1; k <= 7; k++) {
        const sh = SHARP[k];
        if (sh >= 0.999) continue;
        const he = ends[k - 1];
        for (const [ja, jb] of [
          [he, he + 1],
          [RING - he, RING - he - 1],
        ]) {
          const a = r * RING + ja,
            b = r * RING + jb;
          const ax = nor[3 * a],
            ay = nor[3 * a + 1],
            az = nor[3 * a + 2],
            bx = nor[3 * b],
            by = nor[3 * b + 1],
            bz = nor[3 * b + 2];
          let mx = ax + bx,
            my = ay + by,
            mz = az + bz;
          const ml = Math.hypot(mx, my, mz) || 1;
          mx /= ml;
          my /= ml;
          mz /= ml;
          for (const [q, qx, qy, qz] of [
            [a, ax, ay, az],
            [b, bx, by, bz],
          ]) {
            let nx = lerp(mx, qx, sh),
              ny = lerp(my, qy, sh),
              nz = lerp(mz, qz, sh);
            const l = Math.hypot(nx, ny, nz) || 1;
            nor[3 * q] = nx / l;
            nor[3 * q + 1] = ny / l;
            nor[3 * q + 2] = nz / l;
          }
        }
      }
    }
    g.attributes.normal.needsUpdate = true;
  }
  const glass = new Float32Array(N).fill(-1),
    low = new Float32Array(N).fill(-1),
    trim = new Float32Array(N).fill(-1),
    lamp = new Float32Array(N).fill(-1),
    tail = new Float32Array(N).fill(-1);
  for (let k = 0; k < N; k++) {
    const x = pos[3 * k],
      y = pos[3 * k + 1],
      z = pos[3 * k + 2],
      az = Math.abs(z),
      s = seg[k];
    // the screen and the rear glass: the top surface inside the roof's edge, with a black band round it
    if (s === 0) {
      glass[k] = Math.max(
        Math.min(dB[k] - 0.035, x - 0.01, 0.975 - x),
        Math.min(dB[k] - 0.045, x + 1.99, -1.785 - x),
      );
    }
    // the side glass, between the roof rail (K2) and the waistline (K3), its ends cut by the pillars
    if (s === 2) {
      glass[k] = Math.min(dA[k] - 0.012, dB[k] - 0.008, polySD(x, y, DLO));
      trim[k] = Math.max(polySD(x, y, BPIL), polySD(x, y, CBAR));
    }
    // satin black: the sill and the floor, the bumpers' lower edges, the grille on the nose, the diffuser on the tail
    low[k] =
      s === 6
        ? dA[k] - 0.005
        : s === 7
          ? 0.05
          : s === 5
            ? -(dB[k] - 0.0) - 0.05
            : -1;
    if (s === 5 && (x > 1.99 || x < -1.91)) low[k] = Math.max(low[k], 0.36 - y);
    if (s === -1)
      low[k] = Math.max(Math.min(0.47 - y, y - 0.335, 0.5 - az), 0.3 - y);
    if (s >= 0 && s <= 2 && x > 2.1)
      low[k] = Math.max(low[k], Math.min(0.64 - y, y - 0.555, 0.42 - az));
    if (s === -2)
      low[k] = Math.max(
        0.42 - y,
        Math.min(0.6 - y, 0.012 - Math.abs(y - 0.59)),
      );
    // the headlamps, wrapping round the front corners; the tail lamps, wrapping round the back
    if (s >= 0 && s <= 4)
      lamp[k] = Math.min(
        x - 1.86,
        y - 0.565,
        0.722 - y - (x - 1.86) * 0.05,
        az - 0.36,
      );
    if ((s >= 1 && s <= 5) || s === -2)
      tail[k] = Math.min(-1.97 - x, y - 0.83, 1.0 - y, az - 0.4);
  }
  const at = (a, n) => g.setAttribute(n, new THREE.BufferAttribute(a, 1));
  at(glass, 'aGlass');
  at(low, 'aLow');
  at(trim, 'aTrim');
  at(lamp, 'aLamp');
  at(tail, 'aTailL');
  // split off the tailgate: the triangles behind its hinge, above the bumper and inside its shut lines. Both meshes share one vertex buffer.
  BODY_G[NX] = g;
  return g;
}
// ======================================================================= the wheels. A wheel's own frame: the origin at the centre of its mounting face (where it meets
// the hub), +z out of the car, so mounted it simply sits at the hub's origin. 205/55 R16 on a 16 × 6.5 alloy (ET45: the tyre's centre is 45 mm in from
// the face); the spare is a space-saver, T125/70 R16, on a black steel wheel. Five M12 × 1.5 studs on a 114.3 mm circle.
const RIM_R = 0.2032,
  PCD = 0.05715,
  PITCH = 0.0015,
  SEAT_Z = 0.0205,
  STUD_L = 0.046;
const LUG = (k) => Math.PI / 2 + (k * Math.PI * 2) / 5; // the k-th stud's angle on the hub, the first at the top
const TYRE = {
  full: {
    R: R_TYRE,
    W: 0.205,
    zc: -0.045,
    grooves: [-0.054, -0.018, 0.018, 0.054],
    gw: 0.01,
    gd: 0.008,
    size: '205/55 R16 91V',
  },
  spare: {
    R: 0.2905,
    W: 0.125,
    zc: -0.04,
    grooves: [-0.021, 0.021],
    gw: 0.008,
    gd: 0.006,
    size: 'T125/70 R16 96M',
  },
};
// ---- the tyre (wound so its faces point out of the rubber, its lettering out of the sidewall): a cross-section swept round the axle, its tread cut by circumferential grooves and, on the shoulders, lateral slots.
// It rolls round, so it is not squashed here: the hub stands 1.6 cm below the tyre's radius and the road hides the rest. coarse: the parked cars' version.
function tyreProfile(t, coarse) {
  const { R, W, grooves, gw, gd } = t,
    W2 = W / 2,
    P = [],
    tz = W2 - 0.03;
  const tread = [];
  let z = -tz;
  const edges = [];
  for (const g of grooves) edges.push(g - gw / 2, g + gw / 2);
  // the tread across, with each groove's walls as doubled points so their edges stay crisp
  const marks = [-tz, ...edges, tz].sort((a, b) => a - b);
  for (let i = 0; i < marks.length - 1; i++) {
    const a = marks[i],
      b = marks[i + 1],
      inG = grooves.some((g) => Math.abs((a + b) / 2 - g) < gw / 2 + 1e-6);
    if (inG) {
      P.push([R, a, 0], [R - gd, a, 0], [R - gd, b, 0], [R, b, 0]);
      continue;
    }
    const n = Math.max(1, Math.ceil((b - a) / (coarse ? 0.04 : 0.008)));
    for (let k = 0; k <= n; k++) {
      const zz = lerp(a, b, k / n),
        sh =
          Math.abs(zz) > Math.abs(grooves[grooves.length - 1]) + gw / 2 ? 1 : 0;
      if (k === 0 && P.length && P[P.length - 1][1] === zz) continue;
      P.push([R, zz, sh]);
    }
  }
  // the shoulders and the sidewalls, out to the beads
  const side = (sgn) => {
    const S = [
      [R - 0.004, W2 - 0.014],
      [R - 0.012, W2 - 0.004],
      [R - 0.024, W2 + 0.001],
      [R - 0.04, W2 + 0.003],
    ];
    const sw = [],
      ns = coarse ? 3 : 6;
    for (let i = 1; i <= ns; i++) {
      const u = i / ns;
      sw.push([lerp(R - 0.04, RIM_R + 0.03, u), W2 + 0.003 - 0.005 * u * u]);
    }
    return [
      ...S,
      ...sw,
      [RIM_R + 0.018, W2 - 0.008],
      [RIM_R + 0.01, W2 - 0.01],
      [RIM_R + 0.002, W2 - 0.012],
    ].map(([r, zz]) => [r, sgn * zz, 0]);
  };
  return [...side(-1).reverse(), ...P, ...side(1)];
}
function tyreGeo(t, NA = 200, coarse) {
  const prof = tyreProfile(t, coarse),
    M_ = prof.length,
    pos = new Float32Array((NA + 1) * M_ * 3),
    uv = new Float32Array((NA + 1) * M_ * 2),
    I = [];
  for (let i = 0; i <= NA; i++) {
    const a = (i / NA) * Math.PI * 2,
      ca = Math.cos(a),
      sa = Math.sin(a),
      slot = i % 5 === 0;
    for (let j = 0; j < M_; j++) {
      let [r, z, sh] = prof[j];
      if (sh && slot) r -= t.gd * 0.85;
      const k = i * M_ + j;
      pos[3 * k] = ca * r;
      pos[3 * k + 1] = sa * r;
      pos[3 * k + 2] = z + t.zc;
      uv[2 * k] = i / NA;
      uv[2 * k + 1] = j / (M_ - 1);
    }
  }
  for (let i = 0; i < NA; i++)
    for (let j = 0; j < M_ - 1; j++) {
      const a = i * M_ + j,
        b = a + M_,
        c = a + 1,
        d = b + 1;
      I.push(a, b, c, c, b, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  g.userData.base = pos.slice();
  return g;
}
// the size moulded into the outer sidewall, twice round, as a thin ring just proud of the rubber
function sidewallGeo(t) {
  const NA = 160,
    NR = 4,
    r0 = RIM_R + 0.028,
    r1 = t.R - 0.034,
    pos = [],
    uv = [],
    I = [];
  const zAt = (r) => {
    const u = clamp((t.R - 0.04 - r) / (t.R - 0.04 - RIM_R - 0.03), 0, 1);
    return t.W / 2 + 0.003 - 0.005 * u * u + t.zc + 0.0009;
  };
  for (let i = 0; i <= NA; i++) {
    const a = (i / NA) * Math.PI * 2;
    for (let j = 0; j <= NR; j++) {
      const r = lerp(r0, r1, j / NR);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, zAt(r));
      uv.push(1 - i / NA, j / NR);
    }
  }
  for (let i = 0; i < NA; i++)
    for (let j = 0; j < NR; j++) {
      const a = i * (NR + 1) + j,
        b = a + NR + 1;
      I.push(a, a + 1, b, a + 1, b + 1, b);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(I);
  g.computeVertexNormals();
  g.userData.base = g.attributes.position.array.slice();
  return g;
}
function sidewallTex(t) {
  return canvasTex(4096, 128, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#b9bcc3';
    g.textBaseline = 'middle';
    for (const x0 of [0, w / 2]) {
      g.font = '700 64px Plus Jakarta Sans, sans-serif';
      g.textAlign = 'left';
      g.fillText(t.size, x0 + 120, h / 2 + 2);
      g.font = '600 34px Plus Jakarta Sans, sans-serif';
      g.fillText(
        t === TYRE.spare
          ? 'TEMPORARY USE ONLY · MAX 80 KM/H · 4.2 BAR'
          : 'TUBELESS · RADIAL · MAX PRESS 350 KPA',
        x0 + 760,
        h / 2 + 2,
      );
      g.font = '700 40px Plus Jakarta Sans, sans-serif';
      g.fillText('DOT 3926', x0 + 1650, h / 2 + 2);
    }
  });
}
const TYRE_M = M('#2a2b2f', { roughness: 0.78, envMapIntensity: 0.55 });
const SW_M = (t) =>
  new THREE.MeshStandardMaterial({
    map: sidewallTex(t),
    alphaTest: 0.45,
    roughness: 0.7,
    color: '#ffffff',
  });
// squash a tyre: spin (rad), hub height above the road h (m), sag the radius a flat tyre slumps to, on: in contact with nothing at all when 0
// ---- the alloy wheel (ParkWise): a lathed barrel and a ten-spoke face in dark gunmetal, dished out towards its rim, the five lug holes and a centre cap
const ALLOY = MET('#3a3f47', {
  roughness: 0.42,
  metalness: 0.85,
  clearcoat: 0,
  envMapIntensity: 1,
});
function rimBarrel(w, z0, z1, mat, seg = 72) {
  const r = RIM_R,
    o = [
      [r + 0.014, z1],
      [r + 0.016, z1 - 0.005],
      [r + 0.003, z1 - 0.009],
      [r, z1 - 0.017],
      [r, z1 - 0.026],
      [r - 0.018, z1 - 0.044],
      [r - 0.018, z0 + 0.044],
      [r, z0 + 0.028],
      [r, z0 + 0.012],
      [r + 0.016, z0 + 0.005],
      [r + 0.014, z0],
    ];
  const pts = [
    ...o,
    ...o
      .slice()
      .reverse()
      .map(([rr, zz]) => [rr - 0.0055, zz]),
  ];
  pts.push(o[0]);
  pts.reverse();
  const g = new THREE.LatheGeometry(
    pts.map(([rr, zz]) => new THREE.Vector2(rr, zz)),
    seg,
  );
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat);
  m.castShadow = m.receiveShadow = true;
  return m;
}
function alloyFace(cs = 48, n = 12) {
  const s = new THREE.Shape();
  s.absarc(0, 0, RIM_R - 0.002, 0, Math.PI * 2, false);
  const NW = 10; // ten slim spokes, so ten windows between them
  for (let k = 0; k < NW; k++) {
    const ac = LUG(0) + ((k + 0.5) * Math.PI * 2) / NW,
      h = new THREE.Path(),
      wr = (r) => 0.0095 + (0.004 * (r - 0.086)) / 0.092;
    const edge = (r, sgn) => ac + sgn * (Math.PI / NW - Math.asin(wr(r) / r));
    h.moveTo(
      Math.cos(edge(0.086, -1)) * 0.086,
      Math.sin(edge(0.086, -1)) * 0.086,
    );
    for (let i = 0; i <= n; i++) {
      const r = lerp(0.086, 0.178, i / n),
        a = edge(r, -1);
      h.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = 1; i <= n; i++) {
      const a = lerp(edge(0.178, -1), edge(0.178, 1), i / n);
      h.lineTo(Math.cos(a) * 0.178, Math.sin(a) * 0.178);
    }
    for (let i = 1; i <= n; i++) {
      const r = lerp(0.178, 0.086, i / n),
        a = edge(r, 1);
      h.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    for (let i = 1; i < n; i++) {
      const a = lerp(edge(0.086, 1), edge(0.086, -1), i / n);
      h.lineTo(Math.cos(a) * 0.086, Math.sin(a) * 0.086);
    }
    s.holes.push(h);
    if (k >= 5) continue; // five studs, whatever the spoke count
    const lh = new THREE.Path();
    lh.absarc(
      Math.cos(LUG(k)) * PCD,
      Math.sin(LUG(k)) * PCD,
      0.0108,
      0,
      Math.PI * 2,
      true,
    );
    s.holes.push(lh);
  }
  const bore = new THREE.Path();
  bore.absarc(0, 0, 0.0336, 0, Math.PI * 2, true);
  s.holes.push(bore);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: SEAT_Z - 0.005,
    bevelEnabled: true,
    bevelThickness: 0.0025,
    bevelSize: 0.0022,
    bevelSegments: cs > 20 ? 2 : 1,
    curveSegments: cs,
  });
  g.translate(0, 0, 0.0025);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getY(i));
    p.setZ(i, p.getZ(i) + 0.016 * smooth(0.075, 0.19, r));
  }
  g.computeVertexNormals();
  return g;
}
function makeAlloy() {
  const w = new THREE.Group();
  w.add(rimBarrel(0.165, -0.1275, 0.0375, ALLOY));
  const f = new THREE.Mesh(alloyFace(), ALLOY);
  f.castShadow = f.receiveShadow = true;
  w.add(f);
  const b = Build();
  b.cyl(
    MET('#2f3338', { roughness: 0.3 }),
    0,
    0,
    SEAT_Z + 0.003,
    0.031,
    0.031,
    0.006,
    { rx: Math.PI / 2, seg: 32 },
  ).cyl(
    MET('#c4c9d0', { roughness: 0.2 }),
    0,
    0,
    SEAT_Z + 0.0062,
    0.024,
    0.024,
    0.001,
    { rx: Math.PI / 2, seg: 32 },
  );
  b.flush(w);
  return w;
}
// ---- the hub: brake disc, hub flange and spigot, the five studs (all turn with the wheel); the caliper and the strut's knuckle (they do not)
const DISC = MET('#8d9198', { roughness: 0.42, metalness: 1, clearcoat: 0 }),
  CALIP = M('#2c3036', { roughness: 0.5 }),
  STUD = MET('#aeb4bd', { roughness: 0.3, metalness: 1 });
function makeHub(parentFixed, calipA) {
  const spin = new THREE.Group();
  parentFixed.add(spin);
  const b = Build();
  b.geo(
    DISC,
    latheZ([
      [0.078, -0.03],
      [0.14, -0.03],
      [0.14, -0.006],
      [0.078, -0.006],
    ]),
    0,
    0,
    0,
  )
    .cyl(DISC, 0, 0, -0.004, 0.078, 0.078, 0.008, { rx: Math.PI / 2, seg: 40 })
    .cyl(DISC, 0, 0, 0.0045, 0.034, 0.034, 0.009, { rx: Math.PI / 2, seg: 32 });
  b.tor(M('#3a3e45', { roughness: 0.6 }), 0, 0, -0.018, 0.1398, 0.0032, {
    seg: 64,
    seg2: 4,
  });
  for (let k = 0; k < 5; k++) {
    const a = LUG(k);
    b.cyl(
      STUD,
      Math.cos(a) * PCD,
      Math.sin(a) * PCD,
      STUD_L / 2,
      0.006,
      0.006,
      STUD_L,
      { rx: Math.PI / 2, seg: 12 },
    );
  }
  b.flush(spin);
  const c = Build(),
    ca = calipA,
    cx = Math.cos(ca) * 0.118,
    cy = Math.sin(ca) * 0.118;
  c.box(CALIP, cx, cy, -0.03, 0.055, 0.12, 0.056, { r: 0.012, rz: ca }).box(
    CALIP,
    cx,
    cy,
    -0.07,
    0.07,
    0.13,
    0.035,
    { r: 0.01, rz: ca },
  );
  c.box(M('#1d2024', { roughness: 0.7 }), 0, 0, -0.075, 0.09, 0.09, 0.05, {
    r: 0.015,
  });
  c.flush(parentFixed);
  return spin;
}
function latheZ(prof, seg = 64) {
  const pts = [...prof, prof[0]].map(([r, z]) => new THREE.Vector2(r, z));
  const g = new THREE.LatheGeometry(pts, seg);
  g.rotateX(Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
// ---- a lug nut: a 60° cone that seats in the wheel's hole, a 21 mm hex, a closed chrome dome. Its origin is where the cone meets the hex (on the face).
const NUT_G = (() => {
  const parts = [
    latheZ(
      [
        [0, -0.0085],
        [0.0065, -0.0085],
        [0.0106, -0.0002],
        [0, -0.0002],
      ],
      24,
    ),
    new THREE.CylinderGeometry(0.01212, 0.01212, 0.0185, 6)
      .rotateX(Math.PI / 2)
      .translate(0, 0, 0.0092),
    latheZ(
      [
        [0, 0.018],
        [0.0099, 0.018],
        [0.0099, 0.026],
        [0.0078, 0.0305],
        [0.0045, 0.0328],
        [0, 0.0335],
      ],
      24,
    ),
  ];
  return mergeGeometries(
    parts.map((g) => {
      g = g.index ? g.toNonIndexed() : g;
      for (const k of Object.keys(g.attributes))
        if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
      return g;
    }),
  );
})();
NUT_G.computeVertexNormals();
const NUT_M = MET('#d9dde3', { roughness: 0.16, metalness: 1, clearcoat: 0.4 });
// ---- the arch wells: a dark roof that follows each arch's edge in from the body's side, and a back wall. One geometry, shared by every car.
const WELL = M('#08090b', { roughness: 0.85, side: THREE.DoubleSide });
const WELL_G = (() => {
  const parts = [];
  for (const [ax, ay, ra, dp] of ARCHES)
    for (const s of [-1, 1]) {
      const zIn = halfW(ax) - dp,
        pos = [],
        idx = [],
        n = 44,
        f0 = Math.asin(clamp((0.12 - ay) / ra, -1, 1)),
        sh = new THREE.Shape();
      for (let i = 0; i <= n; i++) {
        const f = lerp(f0, Math.PI - f0, i / n),
          x = ax + Math.cos(f) * ra,
          y = ay + Math.sin(f) * ra;
        let zo = sideZ(x, clamp(y, 0.2, 0.84));
        if (zo < zIn) zo = zIn + 0.02;
        pos.push(x, y, s * zIn, x, y, s * (zo + 0.004));
        if (i) sh.lineTo(x, y);
        else sh.moveTo(x, y);
      }
      for (let i = 0; i < n; i++) {
        const a = i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      parts.push(g.toNonIndexed());
      const back = new THREE.ShapeGeometry(sh, 1).translate(0, 0, s * zIn);
      back.deleteAttribute('uv');
      parts.push(back.toNonIndexed());
    }
  return mergeGeometries(parts);
})();
// ---- number plates: white with the blue band, the same lettering front and back
// ---- Indian private-vehicle number plate: white ground, black border and lettering, HSRP style
const plateTex = (t) =>
  canvasTex(512, 116, (g, w, h) => {
    g.fillStyle = '#f4f3ee';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = '#16181c';
    g.lineWidth = 7;
    g.strokeRect(5, 5, w - 10, h - 10);
    g.fillStyle = '#16181c';
    g.font = '700 70px JetBrains Mono, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(t, w / 2, h / 2 + 3);
  });
// ---- L plates: a red L on white, the learner's mark, on the bonnet's nose and the tailgate
const LPLATE_M = new THREE.MeshStandardMaterial({
  roughness: 0.45,
  map: canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#f6f4ef';
    rr(g, 6, 6, w - 12, h - 12, 22);
    g.fill();
    g.fillStyle = '#d42a24';
    g.fillRect(78, 44, 40, 168);
    g.fillRect(78, 172, 104, 40);
  }),
});
function carLamps(car, o) {
  const LL = lines(),
    LT = lines(),
    LIL = lines(),
    LIR = lines(),
    LR = lines();
  for (const s of [-1, 1]) {
    const LI = s > 0 ? LIR : LIL;
    const path = (x0, x1, yf, n, w, c, k, L) => {
      let prev = null;
      for (let i = 0; i <= n; i++) {
        const x = lerp(x0, x1, i / n),
          y = yf(x),
          z = surfZ(x, y);
        if (z === null || z < 0.4) {
          prev = null;
          continue;
        }
        const p = [x, y, s * (z + 0.003)];
        if (prev) L.line(prev, p, w, c, k);
        prev = p;
      }
    };
    if (o.lights) {
      path(
        2.16,
        1.88,
        (x) => 0.705 - (x - 1.86) * 0.05,
        16,
        0.008,
        '#f2f7ff',
        1.8,
        LL,
      );
      {
        const x = 1.89;
        let prev = null;
        for (let i = 0; i <= 4; i++) {
          const y = lerp(0.7, 0.6, i / 4),
            z = surfZ(x, y);
          if (z === null) continue;
          const p = [x, y, s * (z + 0.003)];
          if (prev) LL.line(prev, p, 0.008, '#f2f7ff', 1.8);
          prev = p;
        }
      }
      path(-2.06, -1.995, (x) => 0.965, 5, 0.008, '#ff2a1c', 3.2, LT);
      LT.line(
        [XT - 0.003, 0.965, s * 0.45],
        [XT - 0.003, 0.965, s * 0.62],
        0.008,
        '#ff2a1c',
        3.2,
      );
    }
    // indicators: the outer foot of each headlamp, the mirror's leading edge, and a bar in each tail lamp
    path(2.17, 2.0, (x) => 0.618, 8, 0.01, '#ffa53a', 5, LI);
    const zm = sideZ(0.84, 0.99);
    LI.line(
      [0.85, 0.966, s * (zm + 0.03)],
      [0.82, 0.966, s * (zm + 0.185)],
      0.008,
      '#ffa53a',
      5,
    );
    LI.line(
      [XT - 0.003, 0.885, s * 0.47],
      [XT - 0.003, 0.885, s * 0.6],
      0.012,
      '#ffa53a',
      5,
    );
    // reversing lamps: a short white bar low in each tail lamp
    LR.line(
      [XT - 0.004, 0.86, s * 0.49],
      [XT - 0.004, 0.86, s * 0.58],
      0.012,
      '#f4f8ff',
      3.4,
    );
  }
  const g = (k) => {
    const grp = new THREE.Group();
    car.add(grp);
    return grp;
  };
  const out = { l: g(), r: g(), rev: g() };
  if (o.lights) {
    LL.flush(car);
    LT.flush(car);
  }
  LIL.flush(out.l);
  LIR.flush(out.r);
  LR.flush(out.rev);
  out.l.visible = out.r.visible = out.rev.visible = false;
  return out;
}
// ---- the wheels: shared geometries (the tyre, its lettering, the alloy, the brake disc, the nuts), one set of meshes per wheel
const WG = {};
function wheelGeos(detail) {
  if (WG[detail]) return WG[detail];
  const hi = detail === 'hi';
  const tyre = hi ? tyreGeo(TYRE.full, 150) : tyreGeo(TYRE.full, 40, true),
    side = sidewallGeo(TYRE.full),
    barrel = rimBarrel(0.165, -0.1275, 0.0375, ALLOY, hi ? 72 : 24).geometry,
    face = hi ? alloyFace() : alloyFace(12, 4);
  const strip = (g) => {
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    return g;
  };
  const cap = mergeGeometries(
    [
      new THREE.CylinderGeometry(0.031, 0.031, 0.006, 32)
        .rotateX(Math.PI / 2)
        .translate(0, 0, SEAT_Z + 0.003),
      new THREE.CylinderGeometry(0.024, 0.024, 0.001, 32)
        .rotateX(Math.PI / 2)
        .translate(0, 0, SEAT_Z + 0.0062),
    ].map(strip),
  );
  const disc = mergeGeometries(
    [
      latheZ(
        [
          [0.078, -0.03],
          [0.14, -0.03],
          [0.14, -0.006],
          [0.078, -0.006],
        ],
        hi ? 64 : 20,
      ),
      new THREE.CylinderGeometry(0.078, 0.078, 0.008, 40)
        .rotateX(Math.PI / 2)
        .translate(0, 0, -0.004),
      new THREE.CylinderGeometry(0.034, 0.034, 0.009, 32)
        .rotateX(Math.PI / 2)
        .translate(0, 0, 0.0045),
    ].map(strip),
  );
  const nuts = mergeGeometries(
    [0, 1, 2, 3, 4].map((k) => {
      const a = LUG(k);
      return strip(NUT_G.clone()).translate(
        Math.cos(a) * PCD,
        Math.sin(a) * PCD,
        SEAT_Z,
      );
    }),
  );
  const calip = (ca) => {
    const cx = Math.cos(ca) * 0.118,
      cy = Math.sin(ca) * 0.118;
    return mergeGeometries([
      strip(
        rbox(0.055, 0.12, 0.056, 0.012).rotateZ(ca).translate(cx, cy, -0.03),
      ),
      strip(rbox(0.07, 0.13, 0.035, 0.01).rotateZ(ca).translate(cx, cy, -0.07)),
      strip(rbox(0.09, 0.09, 0.05, 0.015).translate(0, 0, -0.075)),
    ]);
  };
  return (WG[detail] = {
    tyre,
    side,
    barrel,
    face,
    cap,
    disc,
    nuts,
    calipF: calip(Math.PI * 0.86),
    calipB: calip(Math.PI * 0.14),
  });
}
const CAP_M = MET('#ffbf1f', { roughness: 0.3, metalness: 0.4 }),
  SIDE_M = SW_M(TYRE.full);
// one wheel: pivot (steers about the tyre's centre line) > fixed (the mounting face, +z out of the car) > spin (turns as it rolls)
function makeWheel(car, x, side, detail) {
  const W = WG[detail] || wheelGeos(detail),
    pivot = new THREE.Group(),
    fixed = new THREE.Group(),
    spin = new THREE.Group();
  pivot.position.set(x, HUB0, side * TRACK);
  fixed.position.z = side * (HUBZ - TRACK);
  if (side < 0) fixed.rotation.y = Math.PI;
  car.add(pivot);
  pivot.add(fixed);
  fixed.add(spin);
  const add = (par, g, m, cast = true) => {
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    par.add(mesh);
    return mesh;
  };
  add(spin, W.tyre, TYRE_M);
  if (detail === 'hi') add(spin, W.side, SIDE_M, false);
  add(spin, W.barrel, ALLOY);
  add(spin, W.face, ALLOY);
  add(spin, W.cap, CAP_M, false);
  add(spin, W.disc, DISC);
  if (detail === 'hi') {
    add(spin, W.nuts, NUT_M, false);
    add(fixed, side > 0 ? W.calipF : W.calipB, CALIP);
  }
  return { pivot, fixed, spin, side, x };
}
// ---- a car. o: {paint, nx (the shell's rows), detail 'hi'|'lo', plate, learner, lights}. Returns its group (origin between the axles, on the road)
function makeCar(o) {
  const car = new THREE.Group(),
    U = {
      uTail: { value: o.lights ? 0.22 : 0 },
      uSide: { value: 0 },
      uRoof: { value: (o.roof ?? o.learner) ? 1 : 0 },
    };
  const body = new THREE.Mesh(bodyGeo(o.nx || 320), bodyMat(o.paint, U));
  body.castShadow = body.receiveShadow = true;
  car.add(body);
  const wells = new THREE.Mesh(WELL_G, WELL);
  car.add(wells);
  const PAINT = PAINT_M(o.paint),
    b = Build();
  for (const s of [-1, 1]) {
    const zm = sideZ(0.84, 0.99);
    // the door mirror: a body-coloured shell on a black foot, its glass facing back
    b.box(PAINT, 0.8, 1.02, s * (zm + 0.105), 0.13, 0.125, 0.2, {
      r: 0.045,
    }).box(BLACK_S, 0.86, 0.985, s * (zm + 0.02), 0.12, 0.05, 0.06, {
      r: 0.015,
    });
    b.box(
      MET('#3c4048', { roughness: 0.06, metalness: 1 }),
      0.733,
      1.02,
      s * (zm + 0.105),
      0.006,
      0.1,
      0.17,
      { r: 0.004 },
    );
    // door handles, body colour, a black recess behind each
    for (const x of [0.33, -0.86]) {
      const zh = sideZ(x, 0.925);
      b.box(PAINT, x, 0.925, s * (zh + 0.012), 0.15, 0.026, 0.022, {
        r: 0.011,
      }).box(BLACK_S, x, 0.925, s * (zh + 0.002), 0.17, 0.04, 0.004, {
        r: 0.004,
      });
    }
  }
  // the wipers, parked along the screen's foot; the shark fin aerial; a small roof spoiler over the rear glass
  for (const [z0, z1] of [
    [-0.6, 0.02],
    [0.04, 0.6],
  ]) {
    const x = 1.0,
      y = topY(1.0, 0) + 0.012;
    b.box(BLACK_S, x + 0.02, y, (z0 + z1) / 2, 0.018, 0.012, z1 - z0, {
      r: 0.004,
      ry: -0.04,
    });
  }
  b.geo(
    BLACK_G,
    new THREE.SphereGeometry(
      0.05,
      14,
      10,
      0,
      Math.PI * 2,
      0,
      Math.PI / 2,
    ).scale(1.7, 0.9, 0.36),
    -1.52,
    topY(-1.52, 0) - 0.003,
    0,
  );
  b.box(BLACK_G, -1.8, 1.428, 0, 0.16, 0.022, 1.1, { r: 0.008, rz: 0.06 });

  b.box(UNDER, 0, 0.172, 0, 2.0, 0.012, 1.5);
  b.flush(car);
  const pt = plateTex(o.plate || 'DL 01 CA 0001'),
    pm = new THREE.MeshStandardMaterial({ map: pt, roughness: 0.4 });
  const fp = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.115), pm);
  fp.rotation.y = Math.PI / 2;
  fp.position.set(XN + 0.004, 0.42, 0);
  fp.userData.txt = 1;
  car.add(fp);
  const rp = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.115), pm);
  rp.rotation.y = -Math.PI / 2;
  rp.position.set(XT - 0.004, 0.7, 0);
  rp.userData.txt = 1;
  car.add(rp);
  if (o.learner) {
    // on the bonnet's nose, lying back with it, and on the tailgate glass's lower edge
    const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), LPLATE_M);
    lf.position.set(1.93, topY(1.93, -0.32) + 0.006, -0.32);
    lf.rotation.order = 'YXZ';
    lf.rotation.set(-Math.PI / 2 + 0.26, Math.PI / 2, 0);
    lf.userData.txt = 1;
    car.add(lf);
    const lr = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.17), LPLATE_M);
    lr.position.set(XT - 0.005, 0.86, -0.28);
    lr.rotation.y = -Math.PI / 2;
    lr.userData.txt = 1;
    car.add(lr);
    // the driving school's roof sign: a slim fin on a black foot, lettered on both sides (visual only, above the body's own box)
    const sx = -0.25,
      sy = topY(sx, 0);
    Build()
      .box(BLACK_S, sx, sy + 0.018, 0, 0.66, 0.036, 0.16, { r: 0.012 })
      .box(PAINT_M('#ffffff'), sx, sy + 0.135, 0, 0.6, 0.2, 0.05, { r: 0.02 })
      .flush(car);
    const fin = (g, w, h) => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#2453d6';
      g.fillRect(0, 0, w, h * 0.2);
      g.fillStyle = '#e5484d';
      rr(g, 14, h * 0.28, h * 0.62, h * 0.62, 10);
      g.fill();
      g.fillStyle = '#ffffff';
      g.font = `800 ${Math.round(h * 0.52)}px Plus Jakarta Sans, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('L', 14 + h * 0.31, h * 0.6);
      g.fillStyle = '#0f1a2e';
      g.font = `800 ${Math.round(h * 0.34)}px Plus Jakarta Sans, sans-serif`;
      g.textAlign = 'left';
      g.fillText('LEARNER', 30 + h * 0.62, h * 0.61);
    };
    for (const s of [-1, 1]) {
      const p = plate(0.56, 0.17, 512, 156, fin, 1, { alphaTest: 0 });
      p.position.set(sx, sy + 0.135, s * 0.0262);
      p.rotation.y = s > 0 ? 0 : Math.PI;
      p.userData.txt = 1;
      car.add(p);
    }
  }
  const lamps = carLamps(car, o);
  const wheels = [
    makeWheel(car, AXR, -1, o.detail),
    makeWheel(car, AXR, 1, o.detail),
    makeWheel(car, AXF, -1, o.detail),
    makeWheel(car, AXF, 1, o.detail),
  ]; // RL RR FL FR
  return { car, body, U, lamps, wheels, o };
}
// a parked car never moves: every mesh is baked into one per material, in the car's own frame
function bakeCar(C) {
  const car = C.car,
    bag = new Map();
  car.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(car.matrixWorld).invert(),
    m4 = new THREE.Matrix4();
  const keep = [];
  car.traverse((m) => {
    if (!m.isMesh) return;
    let vis = true;
    for (let q = m; q && q !== car; q = q.parent) if (!q.visible) vis = false;
    if (!vis) return;
    if (m === C.body || m.material === LL_MAT || m.material.map) {
      keep.push(m);
      return;
    }
    m4.multiplyMatrices(inv, m.matrixWorld);
    let g = m.geometry.clone();
    g = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(g.attributes))
      if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(m4);
    let e = bag.get(m.material);
    if (!e) bag.set(m.material, (e = []));
    e.push(g);
  });
  for (const m of keep) {
    m4.multiplyMatrices(inv, m.matrixWorld);
    m.removeFromParent();
    m.matrix.copy(m4);
    m.matrix.decompose(m.position, m.quaternion, m.scale);
    car.add(m);
  }
  for (const ch of [...car.children]) if (!keep.includes(ch)) car.remove(ch);
  for (const [mat, list] of bag) {
    const mesh = new THREE.Mesh(mergeGeometries(list), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    car.add(mesh);
    list.forEach((g) => g.dispose());
  }
  C.wheels = [];
  return C;
}

// ======================================================================= the cars on the ground: the learner's (its wheels steer and roll), and a pool of parked ones each set dresses
const LEARNER = makeCar({
  paint: PAINTS.sage,
  nx: 240,
  detail: 'hi',
  plate: 'DL 01 CA 0001',
  learner: true,
  lights: true,
});
G.add(LEARNER.car);
// ---- the cabin, drawn only from the driver's seat: the shell itself turned inside out with its glass cut away (so the pillars, the roof and
// the windows are the body's own), a dashboard, the steering wheel (turned as you turn it), the seats and the mirror. The driver sits on the
// left (traffic keeps right), the eye 1.2 m up, level with the back of the front door.
const SEAT_EYE = { a: CARD.L - 1.62, b: -0.37, y: 1.2 },
  WHEEL_AT = { x: 0.2, y: 0.9, z: -0.37, tilt: (25 * Math.PI) / 180 };
// the eye in the car's own frame (x forward from between the axles, z to the right), and how each mirror is set from it: a mirror's glass
// faces halfway between the eye and the way it should look, so the eye sees along that way in it
const EYE_L = new THREE.Vector3(AXR + SEAT_EYE.a, SEAT_EYE.y, SEAT_EYE.b);
const mirrorNormal = (c, look, out = new THREE.Vector3()) =>
    out
      .copy(EYE_L)
      .sub(c)
      .normalize()
      .add(_mn.copy(look).normalize())
      .normalize(),
  _mn = new THREE.Vector3();
const IMIR_ROOF = topY(0.25, 0),
  IMIR_C = new THREE.Vector3(0.25, Math.min(1.29, IMIR_ROOF - 0.045), 0),
  IMIR_LOOK = new THREE.Vector3(-1, -0.05, 0),
  IMIR_N = mirrorNormal(IMIR_C, IMIR_LOOK),
  IMIR_RY = Math.atan2(IMIR_N.z, -IMIR_N.x);
LEARNER.cabin = (() => {
  const C = LEARNER,
    cab = new THREE.Group();
  cab.visible = false;
  C.car.add(cab);
  // the shell's inside: the same surface, wound the other way, every triangle wholly inside a window dropped; the shader cuts the rest crisply
  const src = C.body.geometry,
    I = src.index.array,
    gA = src.attributes.aGlass.array,
    idx = [];
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i],
      b = I[i + 1],
      c = I[i + 2];
    if (gA[a] > 0 && gA[b] > 0 && gA[c] > 0) continue;
    idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry(),
    n = src.attributes.normal.array,
    nn = new Float32Array(n.length);
  for (let i = 0; i < n.length; i++) nn[i] = -n[i];
  g.setAttribute('position', src.attributes.position);
  g.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
  g.setAttribute('aGlass', src.attributes.aGlass);
  g.setIndex(idx);
  const im = patch(
      new THREE.MeshStandardMaterial({
        color: '#25282e',
        roughness: 0.88,
        envMapIntensity: 0.5,
        emissive: '#0b0c0e',
      }),
    ),
    prev = im.onBeforeCompile,
    key = im.customProgramCacheKey();
  im.onBeforeCompile = (s) => {
    prev(s);
    s.vertexShader = s.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlass;varying float vGlass;varying float vY;',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvGlass=aGlass;vY=transformed.y;',
      );
    s.fragmentShader = s.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vGlass;varying float vY;',
      )
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif(vGlass>0.)discard;',
      )
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\ndiffuseColor.rgb=mix(diffuseColor.rgb,vec3(.25,.25,.24),smoothstep(1.26,1.34,vY));',
      );
  }; // the headliner is pale
  im.customProgramCacheKey = () => key + 'cabin';
  cab.add(new THREE.Mesh(g, im));
  const TRIM_C = M('#2a2d33', { roughness: 0.8, emissive: '#0a0b0d' }),
    SEAT_C = M('#3b3f47', { roughness: 0.95, emissive: '#0c0d10' }),
    WHEEL_C = M('#16181c', { roughness: 0.55 }),
    b = Build();
  // the dashboard, low enough to leave the bonnet's back edge in view; the hood over the dials in front of the driver
  b.box(TRIM_C, 0.72, 0.84, 0, 0.52, 0.16, 1.3, { r: 0.05 }).box(
    TRIM_C,
    0.52,
    0.97,
    -0.37,
    0.17,
    0.06,
    0.36,
    { r: 0.03 },
  );
  // the seats: the passenger's beside you, the back seat behind (no headrests, so the view out of the back stays clear)
  b.box(SEAT_C, -0.53, 0.86, 0.37, 0.11, 0.64, 0.48, { r: 0.05, rz: 0.26 })
    .box(SEAT_C, -0.64, 1.22, 0.4, 0.09, 0.15, 0.24, { r: 0.04, rz: 0.26 })
    .box(SEAT_C, -0.5, 0.52, 0.37, 0.5, 0.13, 0.5, { r: 0.05 });
  b.box(SEAT_C, -1.38, 0.72, 0, 0.13, 0.46, 1.26, { r: 0.05, rz: 0.22 }).box(
    SEAT_C,
    -1.12,
    0.5,
    0,
    0.5,
    0.13,
    1.26,
    { r: 0.05 },
  );
  // the rear-view mirror, hung from the top of the screen and turned to face the driver
  b.box(WHEEL_C, IMIR_C.x, IMIR_C.y, 0, 0.025, 0.066, 0.24, {
    r: 0.012,
    ry: IMIR_RY,
  }).box(
    WHEEL_C,
    IMIR_C.x + 0.012,
    (IMIR_C.y + 0.03 + IMIR_ROOF) / 2,
    0,
    0.02,
    IMIR_ROOF - IMIR_C.y - 0.02,
    0.02,
    { r: 0.006 },
  );
  b.flush(cab, false);
  // the steering wheel: on its column, tilted 25°; the rim turns about the column, an amber mark at its top
  const sw = new THREE.Group(),
    t = WHEEL_AT.tilt;
  sw.position.set(WHEEL_AT.x, WHEEL_AT.y, WHEEL_AT.z);
  sw.matrixAutoUpdate = false;
  sw.matrix
    .makeBasis(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(Math.sin(t), Math.cos(t), 0),
      new THREE.Vector3(-Math.cos(t), Math.sin(t), 0),
    )
    .setPosition(sw.position);
  cab.add(sw);
  const rim = new THREE.Group();
  sw.add(rim);
  const wb = Build();
  wb.tor(WHEEL_C, 0, 0, 0, 0.185, 0.017, { seg: 56, seg2: 10 }).cyl(
    WHEEL_C,
    0,
    0,
    0.005,
    0.042,
    0.048,
    0.05,
    { rx: Math.PI / 2, seg: 24 },
  );
  wb.box(WHEEL_C, -0.12, -0.012, 0, 0.13, 0.034, 0.014, { r: 0.008 })
    .box(WHEEL_C, 0.12, -0.012, 0, 0.13, 0.034, 0.014, { r: 0.008 })
    .box(WHEEL_C, 0, -0.12, 0, 0.034, 0.13, 0.014, { r: 0.008 });
  wb.flush(rim, false);
  const mark = new THREE.Mesh(
    rbox(0.04, 0.02, 0.04, 0.008),
    GLOW('#4f86ff', 1.05),
  );
  mark.position.y = 0.185;
  rim.add(mark);
  // the two dials under the hood, faintly lit
  for (const z of [-0.45, -0.29]) {
    const d = new THREE.Mesh(
      new THREE.TorusGeometry(0.03, 0.0026, 6, 40),
      GLOW('#7fd6ff', 0.42),
    );
    d.rotation.y = Math.PI / 2;
    d.position.set(0.45, 0.9, z);
    cab.add(d);
  }
  const col = new THREE.Mesh(
    new THREE.CylinderGeometry(0.028, 0.034, 0.34, 14)
      .rotateX(Math.PI / 2)
      .translate(0, 0, -0.2),
    WHEEL_C,
  );
  sw.add(col);
  cab.traverse((m) => {
    if (m.isMesh) {
      m.castShadow = false;
      m.receiveShadow = false;
    }
  });
  // from inside, the head and tail lamps' light lines would show through the glass: they hide while you sit there (the indicators stay, on the mirrors)
  const outside = C.car.children.filter((m) => m.material === LL_MAT);
  return { cab, rim, outside };
})();
// ---- the mirrors, live from the seat. Each is a window onto the world as seen from the eye's reflection in the mirror's plane: an off-axis
// frustum through the glass's four corners with its near plane on the glass (so nothing behind the glass gets in), drawn into a small
// target and laid on the glass flipped left to right. The door mirrors are set as a driver sets them, the car's flank just in at the inner
// edge, and convex like real ones (they see three times as wide as flat glass would, about 29° across); the kerb side's dips in reverse to show the kerb by the back wheel.
// They draw only from the seat, and only while in view.
const MIRRORS = (() => {
  const C = LEARNER,
    zm = sideZ(0.84, 0.99) + 0.105,
    list = [];
  const defs = [
    {
      c: [0.7285, 1.02, -zm],
      face: [-1, 0, 0],
      w: 0.188,
      h: 0.108,
      look: [-1, -0.1, -0.21],
      k: 3,
      res: [256, 148],
      door: 1,
    },
    {
      c: [0.7285, 1.02, zm],
      face: [-1, 0, 0],
      w: 0.188,
      h: 0.108,
      look: [-1, -0.1, 0.21],
      dip: [-1, -0.3, 0.3],
      k: 3,
      res: [256, 148],
      door: 1,
    },
    {
      c: [
        IMIR_C.x - 0.0135 * Math.cos(IMIR_RY),
        IMIR_C.y,
        0.0135 * Math.sin(IMIR_RY),
      ],
      face: [IMIR_N.x, 0, IMIR_N.z],
      w: 0.22,
      h: 0.054,
      look: IMIR_LOOK.toArray(),
      k: 1,
      res: [400, 100],
    },
  ];
  for (const d of defs) {
    const rt = new THREE.WebGLRenderTarget(d.res[0], d.res[1], {
      type: THREE.HalfFloatType,
      depthBuffer: true,
    });
    rt.texture.repeat.x = -1;
    rt.texture.offset.x = 1; // a mirror shows the world the other way round
    const q = new THREE.Mesh(
      new THREE.PlaneGeometry(d.w, d.h),
      new THREE.MeshBasicMaterial({
        map: rt.texture,
        color: new THREE.Color(0.86, 0.88, 0.9),
        fog: false,
      }),
    );
    q.position.fromArray(d.c);
    q.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 0, 1),
      new THREE.Vector3(...d.face).normalize(),
    );
    C.cabin.cab.add(q);
    const cam = new THREE.PerspectiveCamera();
    cam.matrixAutoUpdate = false;
    cam.matrixWorldAutoUpdate = false;
    list.push({
      ...d,
      c: new THREE.Vector3(...d.c),
      look: new THREE.Vector3(...d.look),
      dipV: d.dip ? new THREE.Vector3(...d.dip) : null,
      rt,
      q,
      cam,
      dipT: 0,
    });
  }
  return list;
})();
const _mv = {
  n: new THREE.Vector3(),
  u: new THREE.Vector3(),
  r: new THREE.Vector3(),
  l: new THREE.Vector3(),
  pa: new THREE.Vector3(),
  pb: new THREE.Vector3(),
  pc: new THREE.Vector3(),
  pe: new THREE.Vector3(),
  va: new THREE.Vector3(),
  vb: new THREE.Vector3(),
  vc: new THREE.Vector3(),
  vr: new THREE.Vector3(),
  vu: new THREE.Vector3(),
  vn: new THREE.Vector3(),
  sph: new THREE.Sphere(),
  fr: new THREE.Frustum(),
  pv: new THREE.Matrix4(),
};
function renderMirrors() {
  if (VW !== 'seat') return;
  const V = _mv,
    M = LEARNER.car.matrixWorld,
    e = camera.position;
  V.pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  V.fr.setFromProjectionMatrix(V.pv);
  const rt0 = renderer.getRenderTarget(),
    su = renderer.shadowMap.needsUpdate;
  MIRRORS.forEach((m) => (m.q.visible = false));
  for (const m of MIRRORS) {
    // the kerb-side mirror tips down while reverse is selected
    if (m.dipV)
      m.dipT += ((LIVE.rev ? 1 : 0) - m.dipT) * (1 - Math.exp(-_dt * 3));
    V.l.copy(m.look);
    if (m.dipV) V.l.lerp(m.dipV, ease(m.dipT));
    mirrorNormal(m.c, V.l, V.n);
    V.u.set(0, 1, 0).addScaledVector(V.n, -V.n.y).normalize();
    // corners as seen from behind the glass (from the reflected eye): right = up × (towards the reflected eye)
    V.vn.copy(V.n).negate();
    V.r.crossVectors(V.u, V.vn);
    if (LHT) V.r.negate();
    const hw = (m.w * m.k) / 2,
      hh = (m.h * m.k) / 2;
    V.pa
      .copy(m.c)
      .addScaledVector(V.r, -hw)
      .addScaledVector(V.u, -hh)
      .applyMatrix4(M);
    V.pb
      .copy(m.c)
      .addScaledVector(V.r, hw)
      .addScaledVector(V.u, -hh)
      .applyMatrix4(M);
    V.pc
      .copy(m.c)
      .addScaledVector(V.r, -hw)
      .addScaledVector(V.u, hh)
      .applyMatrix4(M);
    V.sph.center.copy(V.pa).add(V.pb).multiplyScalar(0.5);
    V.sph.radius = V.pa.distanceTo(V.pc) + V.pa.distanceTo(V.pb);
    if (!V.fr.intersectsSphere(V.sph)) continue;
    V.vr.subVectors(V.pb, V.pa).normalize();
    V.vu.subVectors(V.pc, V.pa).normalize();
    V.vn.crossVectors(V.vr, V.vu);
    const s = V.va.subVectors(e, V.pa).dot(V.vn);
    if (s > -1e-3) continue; // the eye is behind this glass
    V.pe.copy(e).addScaledVector(V.vn, -2 * s); // the eye, reflected in the glass
    V.va.subVectors(V.pa, V.pe);
    V.vb.subVectors(V.pb, V.pe);
    V.vc.subVectors(V.pc, V.pe);
    const dn = -V.va.dot(V.vn);
    // the near plane 6 cm past the glass: the housing is square to the car and the glass angled, so the housing's inner edge stands in
    // front of the glass; this keeps it out of its own mirror
    const nr = dn + 0.06 * U,
      kk = nr / dn,
      cam = m.cam;
    cam.projectionMatrix.makePerspective(
      V.vr.dot(V.va) * kk,
      V.vr.dot(V.vb) * kk,
      V.vu.dot(V.vc) * kk,
      V.vu.dot(V.va) * kk,
      nr,
      camera.far,
    );
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.matrixWorld.makeBasis(V.vr, V.vu, V.vn).setPosition(V.pe);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    if (m.door) {
      LEARNER.U.uSide.value = 2;
      LEARNER.cabin.cab.visible = false;
    }
    renderer.setRenderTarget(m.rt);
    renderer.render(scene, cam);
    renderer.shadowMap.needsUpdate = false;
    if (m.door) {
      LEARNER.U.uSide.value = 1;
      LEARNER.cabin.cab.visible = true;
    }
  }
  MIRRORS.forEach((m) => (m.q.visible = true));
  renderer.setRenderTarget(rt0);
  renderer.shadowMap.needsUpdate = su && renderer.shadowMap.needsUpdate;
}
const POOL_PLATES = [
  'MH 12 AB 1234',
  'KA 05 MN 4321',
  'DL 03 CF 0789',
  'TN 09 BK 5566',
  'UP 16 AZ 2470',
  'GJ 01 HK 8008',
];
const POOL = POOL_PLATES.map((p, i) => {
  const C = bakeCar(
    makeCar({
      paint: '#888888',
      nx: 64,
      detail: 'lo',
      plate: p,
      lights: false,
      roof: i % 3 === 1, // every third parked car two-tone
    }),
  );
  G.add(C.car);
  return C;
});
// place a car (its group's origin is between the axles) from a back-axle pose
function poseCar(car, p, y = 0) {
  car.position.set(p.x + Math.cos(p.th) * -AXR, y, p.z - Math.sin(p.th) * -AXR);
  car.rotation.set(0, p.th, 0);
}
let SET_NOW = '';
function setSet(name) {
  SET_NOW = name;
  const vis = name === 'fbays' ? 'bays' : name === 'hill' ? 'street' : name;
  tiltG(name === 'hill');
  for (const k of ['street', 'bays', 'angle']) SETG[k].visible = k === vis;
  for (const k in SET_LIGHTS)
    for (const L of SET_LIGHTS[k]) L.i = k === vis ? L.i0 : 0;
  const S = SETS[name];
  POOL.forEach((C, i) => {
    const c = S.cars[i];
    C.car.visible = !!c;
    if (!c) return;
    poseCar(C.car, c.pose);
    C.body.material.color.set(c.paint);
  });
  // the sign stands where you park: on the pavement by the gap, or on the planted strip behind the bay
  if (name === 'street' || name === 'hill')
    PSIGN.position.set(-0.6, KERB_H, STREET.kerb - 0.55);
  else if (name === 'angle') {
    const e = ANG.z + ANG.ax[1] * ANG.d - 0.3;
    PSIGN.position.set(-1.9, 0.1, e - 0.55);
  } else PSIGN.position.set(-1.25, 0.1, BAY.z - BAY.d - 0.55);
  renderer.shadowMap.needsUpdate = true;
}

// ======================================================================= the learner's car, posed: where it is, its front wheels turned to their own angles, each wheel rolled by its own travel,
// the brake lamps bright while it slows or stands, the reversing lamps on while it goes backwards, the indicator flashing while you signal
const LIVE = {
  x: 0,
  z: 0,
  th: 0,
  st: 0,
  dir: 0,
  v: 0,
  wt: [0, 0, 0, 0],
  sig: 0,
  brake: 0,
  rev: 0,
};
const CUR = { x: 0, z: 0, th: 0, st: 0, dir: 0, v: 0 }; // the car as it is drawn this frame: the clock's pose, or yours in practice
function applyCar(p) {
  const C = LEARNER;
  poseCar(C.car, p);
  C.wheels.forEach((W, j) => {
    W.pivot.rotation.y = j >= 2 ? wheelAng(p.st, W.side * CARD.tw) : 0;
    W.spin.rotation.z = ((W.side > 0 ? -1 : 1) * p.wt[j]) / R_TYRE;
  });
  const blink = LIVE.sig && (NOW * 1.5) % 1 < 0.5;
  C.lamps.r.visible = LIVE.sig > 0 && blink;
  C.lamps.l.visible = LIVE.sig < 0 && blink;
  C.lamps.rev.visible = !!LIVE.rev;
  C.U.uTail.value = LIVE.brake ? 1.1 : 0.22;
}

// ======================================================================= practice: you drive. Hold forwards or reverse to creep; turn the wheel and it stays where you leave it, as a real one does.
// The same model moves the car (stepped in 2 cm pieces); a touch stops it where it touched, and the coach watches each step.
const DRV = {
  x: 0,
  z: 0,
  th: 0,
  st: 0,
  v: 0,
  dir: 0,
  wt: [0, 0, 0, 0],
  touches: 0,
  moves: 0,
  lastDir: 0,
  bump: null,
  bumpAt: -9,
  parked: null,
  step: 1,
  stepAt: 0,
  start: null,
  stillT: 0,
};
const INP = { fwd: 0, rev: 0, left: 0, right: 0, steerTo: null, pullV: null };
const DRIVE = {
  vf: 0.9,
  vr: 0.7,
  acc: 1.1,
  dec: 2.2,
  steerRate: 1.1 / LOCK_TURNS,
}; // m/s forwards and back, m/s², lock a second while a key is held (1.1 turns a second)
function driveReset() {
  const m = man(),
    s = m.start;
  Object.assign(DRV, {
    x: s.x,
    z: s.z,
    th: s.th,
    st: 0,
    v: 0,
    dir: 0,
    wt: [0, 0, 0, 0],
    touches: 0,
    touchAt: null,
    rest: null,
    moves: 0,
    lastDir: 0,
    bump: null,
    bumpAt: -9,
    parked: null,
    step: 1,
    stepAt: NOW,
    start: { ...s },
    stillT: 0,
  });
  INP.steerTo = null;
  coachSync(true);
}
const _poly = PLAN_P.map(() => [0, 0]);
// a touch: the body against a parked car, a tyre against a kerb, or the car off the edge of the slab
function touchAt(p, st) {
  const s = SETS[SET_NOW],
    poly = carPoly(p, _poly);
  for (let j = 0; j < s.polys.length; j++)
    if (overlap(poly, s.polys[j])) {
      const [d, a, b] = nearest(poly, s.polys[j]);
      return { kind: 'car', at: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
    }
  for (const kz of s.kerbs) {
    const T = tyrePolys(p, st);
    for (let w = 0; w < 4; w++)
      for (const [x, z] of T[w])
        if (z < kz) return { kind: 'kerb', w, at: [x, kz] };
  }
  const bz0 =
    s.backZ !== undefined
      ? s.backZ
      : SET_NOW === 'angle'
        ? ANG.z + ANG.ax[1] * ANG.d - 0.3
        : -99;
  for (const q of poly) {
    if (q[1] < bz0 + 0.02 && SET_NOW !== 'street') {
      const T = tyrePolys(p, st);
      for (const t of T)
        for (const [x, z] of t)
          if (z < bz0) return { kind: 'kerb', at: [x, bz0] };
    }
    if (
      q[0] < SLAB.x0 + 0.1 ||
      q[0] > SLAB.x1 - 0.1 ||
      q[1] < SLAB.z0 + 0.1 ||
      q[1] > SLAB.z1 - 0.1
    )
      return {
        kind: 'edge',
        at: [clamp(q[0], SLAB.x0, SLAB.x1), clamp(q[1], SLAB.z0, SLAB.z1)],
      };
  }
  return null;
}
const _dp = { x: 0, z: 0, th: 0 };
function driveStep(dt) {
  // the wheel: held keys turn it at a steady rate; dragging the wheel sets where it goes
  if (INP.steerTo !== null) {
    const d = INP.steerTo - DRV.st;
    DRV.st += clamp(d, -DRIVE.steerRate * 2.5 * dt, DRIVE.steerRate * 2.5 * dt);
  }
  const sk = (INP.right ? 1 : 0) - (INP.left ? 1 : 0);
  if (sk) {
    INP.steerTo = null;
    DRV.st = clamp(DRV.st + sk * DRIVE.steerRate * dt, -1, 1);
  }
  // the pedals: creep towards walking pace, brake to a stop when let go; a pedal the other way brakes first
  const want =
    INP.pullV != null
      ? INP.pullV
      : INP.fwd && !INP.rev
        ? DRIVE.vf
        : INP.rev && !INP.fwd
          ? -DRIVE.vr
          : 0;
  const a =
    (Math.sign(want) !== Math.sign(DRV.v) && DRV.v !== 0) || want === 0
      ? DRIVE.dec
      : DRIVE.acc;
  DRV.v += clamp(want - DRV.v, -a * dt, a * dt);
  if (Math.abs(DRV.v) < 1e-3 && !want) DRV.v = 0;
  const dir = Math.sign(DRV.v);
  if (dir && dir !== DRV.lastDir) {
    if (DRV.lastDir) DRV.moves++;
    DRV.lastDir = dir;
  }
  if (dir) DRV.dir = dir;
  // move in pieces of at most 2 cm; a piece that would touch something is not taken, and the car stops there
  let ds = DRV.v * dt;
  const n = Math.max(1, Math.ceil(Math.abs(ds) / 0.02));
  for (let i = 0; i < n; i++) {
    const h = ds / n;
    _dp.x = DRV.x;
    _dp.z = DRV.z;
    _dp.th = DRV.th;
    stepPose(_dp, h, DRV.st);
    const hit = touchAt(_dp, DRV.st);
    if (
      hit &&
      MK === 'hill' &&
      hit.kind === 'kerb' &&
      hit.w === 3 &&
      h < 0 &&
      DRV.st < -0.5
    ) {
      DRV.rest = hit;
      DRV.v = 0;
      break;
    }
    if (hit) {
      // one touch per contact: pushing on against the same thing does not count again until the car has moved away from it
      if (
        !DRV.bump &&
        (!DRV.touchAt ||
          Math.hypot(DRV.x - DRV.touchAt[0], DRV.z - DRV.touchAt[1]) > 0.05)
      ) {
        DRV.touches++;
        sfx('bump');
        ERR.jolt = NOW;
      }
      DRV.touchAt = [DRV.x, DRV.z];
      DRV.bumpAt = NOW;
      DRV.bump = hit;
      DRV.v = 0;
      break;
    }
    const w0 = WPOS.map(([a, b]) => toG(DRV, a, b));
    DRV.x = _dp.x;
    DRV.z = _dp.z;
    DRV.th = _dp.th;
    WPOS.forEach(([a, b], j) => {
      const q = toG(DRV, a, b);
      DRV.wt[j] += Math.hypot(q[0] - w0[j][0], q[1] - w0[j][1]) * Math.sign(h);
    });
  }
  if (DRV.bump && NOW - DRV.bumpAt > 1.6) DRV.bump = null;
  if (DRV.rest && DRV.v > 0.01) DRV.rest = null;
  if (
    DRV.touchAt &&
    Math.hypot(DRV.x - DRV.touchAt[0], DRV.z - DRV.touchAt[1]) > 0.05
  )
    DRV.touchAt = null;
  DRV.stillT = Math.abs(DRV.v) < 0.01 ? DRV.stillT + dt : 0;
  coachStep();
}
const WPOS = [
  [0, -CARD.tw],
  [0, CARD.tw],
  [CARD.L, -CARD.tw],
  [CARD.L, CARD.tw],
];
// ======================================================================= the light: the showroom at dusk, with dusk showroom render tuning
Object.assign(RT, {
  pixelRatio: clamp(1.6, 1, Math.max(1, devicePixelRatio)),
  msaa: 4,
  smaa: 1,
  shadow: 2048,
  exposure: 1,
  fov: 30,
  sun: 1.8,
  fill: 0.8,
  rim: 0.25,
  fog: 1,
  sat: 1.16,
  env: 0.9,
  reflect: 0.3,
  bloom: 1,
  bloomStrength: 1,
  bloomRadius: 0.5,
  bloomThreshold: 1,
  ao: 1,
  aoIntensity: 1,
  aoRadius: 0.9,
  aoSamples: 12,
  dof: 1,
  focalBand: 1,
  aperture: 1.2,
  apertureNear: 0.9,
  maxCoc: 16,
});
Object.assign(RT0, RT);
// ParkWise daylight: a high, slightly cool noon sun from the front left, a bright sky fill, almost no bloom, the floor matte
const VIEW = {
  bg: '#d7e6f4',
  fog: '#dfeaf5',
  fogD: 0.0011,
  tone: THREE.ACESFilmicToneMapping,
  exp: 1.12,
  envI: 1.0,
  bloomT: 2.4,
  bloomS: 0.18,
  refl: 0.06,
  hemi: [0xe4eefa, 0x8d8a80, 0.95],
  sun: [0xfffaf0, 2.2],
  sunDir: [-0.38, 0.9, 0.42],
  rim: 0.15,
  key2: 0.35,
  satK: 0.96,
};
// the sun's shadow covers the whole slab
Object.assign(sun.shadow.camera, {
  left: -56,
  right: 56,
  top: 44,
  bottom: -44,
  near: 1,
  far: 200,
});
sun.shadow.camera.updateProjectionMatrix();
sun.target.position.set(0, 1, 0);
sun.shadow.normalBias = 0.05;
function applyView() {
  const V = VIEW;
  scene.background.set(V.bg);
  scene.fog.color.set(V.fog);
  scene.fog.density = V.fogD * RT.fog;
  renderer.toneMapping = V.tone;
  renderer.toneMappingExposure = RT.exposure * V.exp;
  scene.environment = ENV.show;
  scene.environmentIntensity = RT.env * V.envI;
  bloom.threshold = RT.bloomThreshold * V.bloomT;
  bloom.strength = RT.bloomStrength * V.bloomS;
  reflU.uReflStrength.value = RT.reflect * V.refl;
  hemi.color.set(V.hemi[0]);
  hemi.groundColor.set(V.hemi[1]);
  hemi.intensity = V.hemi[2] * RT.fill;
  sun.color.set(V.sun[0]);
  sun.intensity = V.sun[1] * RT.sun;
  sun.position
    .set(...V.sunDir)
    .normalize()
    .multiplyScalar(80)
    .add(sun.target.position);
  rim.intensity = V.rim * RT.rim;
  key2.intensity = V.key2 * RT.fill;
  worldSat.value = RT.sat * V.satK;
}

// ======================================================================= the camera. Each step of each manoeuvre has a shot (target in metres on the ground, yaw, pitch, distance in room units);
// the camera eases to it. From above, it follows the car looking straight down; behind, it rides behind the car. A drag hands it to you until R.
// each manoeuvre is filmed from one side (yaw, pitch); each step's shot is fitted to what the step covers: the car over the whole step, and the
// space it is going into. Step 0 takes in the whole manoeuvre.
const CAM_SIDE = {
  parallel: {
    yaw: -0.22,
    pitch: 0.6,
    key: [
      [-STREET.gap / 2, STREET.pz],
      [STREET.gap / 2, STREET.pz],
      [0, STREET.kerb - 0.5],
    ],
  },
  rbay: {
    yaw: 0.32,
    pitch: 0.66,
    key: [
      [-1.25, BAY.z],
      [1.25, BAY.z],
      [-1.25, BAY.z - BAY.d],
      [1.25, BAY.z - BAY.d],
    ],
  },
  fbay: {
    yaw: -0.32,
    pitch: 0.66,
    key: [
      [-1.25, BAY.z],
      [1.25, BAY.z],
      [-1.25, BAY.z - BAY.d],
      [1.25, BAY.z - BAY.d],
    ],
  },
  hill: {
    yaw: -0.12,
    pitch: 0.34,
    key: [
      [-6, STREET.pz],
      [6, STREET.pz],
      [0, STREET.kerb - 0.8],
    ],
  },
  angle: {
    yaw: -0.3,
    pitch: 0.66,
    key: [
      [-ANG.pitch / 2, ANG.z],
      [ANG.pitch / 2, ANG.z],
      [ANG.ax[0] * ANG.d, ANG.z + ANG.ax[1] * ANG.d],
    ],
  },
};
const CAMS = {};
for (const key of MAN_KEYS) {
  const P = PATHS[key].norm,
    C = CAM_SIDE[key],
    out = (CAMS[key] = []);
  for (let k = 0; k < P.ends.length; k++) {
    const pts = [...C.key],
      i0 = k ? P.ends[k - 1] : 0,
      i1 = k ? P.ends[k] : P.n - 1;
    for (let i = i0; i <= i1; i += Math.max(1, ((i1 - i0) / 12) | 0))
      for (const q of carPoly(P.S[i])) pts.push(q);
    for (const q of carPoly(P.S[i1])) pts.push(q);
    let x0 = 1e9,
      x1 = -1e9,
      z0 = 1e9,
      z1 = -1e9;
    for (const [x, z] of pts) {
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    const cx = (x0 + x1) / 2,
      cz = (z0 + z1) / 2,
      rho = Math.max(
        5,
        Math.max(...pts.map(([x, z]) => Math.hypot((x - cx) * 0.75, z - cz))),
      );
    out.push({
      t: [cx, 0.4, cz],
      yaw: C.yaw,
      pitch: C.pitch,
      dist: ((rho * U) / Math.tan(15 * D2R)) * 1.1,
    });
  }
}
const VIEWS = ['3d', 'top', 'behind', 'seat'],
  VIEW_NAME = {
    '3d': '3D view',
    top: 'From above',
    behind: 'Behind the car',
    seat: 'From the driver’s seat',
  };
let VW = '3d';
// the driver's head: a look of your own (a drag, or Q and E) on top of facing a little right of ahead
const SEAT = { ly: 0, lp: 0 },
  SEAT_YAW = 0.26,
  _seatT = new THREE.Vector3();
const cam = { t: new THREE.Vector3(0, 3, 0), yaw: 0, pitch: 0.2, dist: 15 },
  goal = { t: new THREE.Vector3(), yaw: 0, pitch: 0.2, dist: 15 };
let zoom = 1,
  fitScale = 1,
  MOB = false,
  manual = false;
const canvas = renderer.domElement,
  pointers = new Map();
let pinch = 0,
  mid = null,
  downAt = null,
  downHit = null,
  grab = null;
const ray = new THREE.Raycaster(),
  ndc = new THREE.Vector2();
function camGoal() {
  const c = toG(CUR, CARD.L / 2, 0);
  if (VW === 'top') {
    const P = CAMS[MK][0];
    gw(goal.t, lerp(c[0], P.t[0], 0.35), 0, lerp(c[1], -1.6, 0.45));
    goal.yaw = 0;
    goal.pitch = 1.42;
    goal.dist = MOB ? 96 : 78;
  } else if (VW === 'behind') {
    const f = [Math.cos(CUR.th), -Math.sin(CUR.th)];
    gw(goal.t, c[0] + f[0] * 1.2, 0.6, c[1] + f[1] * 1.2);
    goal.yaw = Math.atan2(-f[0] * MS(), -f[1]);
    goal.pitch = 0.42;
    goal.dist = 34;
  } else {
    const s = MODE === 'drive' ? clamp(DRV.step, 1, NSTEP()) : stepNow(),
      C = CAMS[MK][Math.min(s, CAMS[MK].length - 1)];
    gw(goal.t, ...C.t);
    goal.yaw = C.yaw * MS();
    goal.pitch = C.pitch;
    goal.dist = C.dist;
    if (MODE === 'drive') {
      gw(goal.t, lerp(C.t[0], c[0], 0.5), C.t[1], lerp(C.t[2], c[1], 0.5));
    }
  }
  if (MOB && camera.aspect < 0.8 && VW !== 'top') {
    goal.dist *= 1.35;
    goal.pitch = Math.min(goal.pitch + 0.12, 1.3);
  }
}
function snapCam() {
  camGoal();
  cam.t.copy(goal.t);
  cam.yaw = goal.yaw;
  cam.pitch = goal.pitch;
  cam.dist = goal.dist;
}
function easeCam(dt) {
  camGoal();
  if (manual) return;
  const k = 1 - Math.exp(-dt * (VW === 'behind' ? 3.5 : 1.8));
  cam.t.lerp(goal.t, k);
  let dy = goal.yaw - cam.yaw;
  dy = Math.atan2(Math.sin(dy), Math.cos(dy));
  cam.yaw += dy * k;
  cam.pitch += (goal.pitch - cam.pitch) * k;
  cam.dist += (goal.dist - cam.dist) * k;
  zoom += (1 - zoom) * k;
}
// what can be touched: the learner's car (drag it: watching, it runs the step's clock; driving, it pulls the car along its own length), the marks
const HITS = [];
const addHit = (obj, kind, data = {}) => {
  obj.userData.hk = { kind, ...data };
  HITS.push(obj);
};
LEARNER.car.traverse((m) => {
  if (m.isMesh && m.material !== LL_MAT) addHit(m, 'car');
});
POOL.forEach((C) =>
  C.car.traverse((m) => {
    if (m.isMesh && m.material !== LL_MAT) addHit(m, 'parked');
  }),
);
LINKS.forEach((L) => addHit(L.hit, 'link', { L }));
const liveUp = (o) => {
  let p = o;
  for (; p.parent; p = p.parent) if (!p.visible) return false;
  return p === scene && p.visible;
};
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -(((e.clientY - r.top) / r.height) * 2 - 1),
  );
  ray.setFromCamera(ndc, camera);
  const h = ray.intersectObjects(
    HITS.filter(
      (o) => liveUp(o) && !(VW === 'seat' && o.userData.hk.kind === 'car'),
    ),
    false,
  )[0];
  return h ? { ...h.object.userData.hk, point: h.point } : null;
}
// the ground (G metres) under the pointer
const _gpl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -ROAD_Y),
  _gpt = new THREE.Vector3();
const _ginv = new THREE.Matrix4(),
  _gray = new THREE.Ray();
function groundAt(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(
    ((e.clientX - r.left) / r.width) * 2 - 1,
    -(((e.clientY - r.top) / r.height) * 2 - 1),
  );
  ray.setFromCamera(ndc, camera);
  _gray.copy(ray.ray).applyMatrix4(_ginv.copy(G.matrixWorld).invert());
  const d = _gray.direction,
    o = _gray.origin;
  if (Math.abs(d.y) < 1e-6) return null;
  const t = -o.y / d.y;
  if (t < 0) return null;
  return [o.x + d.x * t, o.z + d.z * t];
}
function click(hit) {
  if (!hit) return;
  switch (hit.kind) {
    case 'link':
      window.open(hit.L.url || X_URL, '_blank', 'noopener');
      break;
    case 'car':
      if (MODE === 'watch') {
        const s = stepNow();
        if (s < NSTEP()) playStep(s + 1);
      }
      break;
  }
}
function pan(dx, dy) {
  const k =
      (camera.position.distanceTo(cam.t) *
        2 *
        Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) /
      Math.max(host.clientHeight, 1),
    cy = Math.cos(cam.yaw),
    sy = Math.sin(cam.yaw);
  manual = true;
  cam.t.x = clamp(cam.t.x - cy * dx * k, -52, 52);
  cam.t.z = clamp(cam.t.z + sy * dx * k, -34, 34);
  cam.t.y = clamp(cam.t.y + dy * k, 0.3, 16);
}
const TIPS = {
  car: () =>
    MODE === 'drive'
      ? 'Your car · drag it to creep forwards or back'
      : 'Your car · drag it to run this step',
  parked: () => 'A parked car',
  link: (h) => '',
};
const tipEl = $('#tip');
let overL = null;
function hover(e) {
  const h = pick(e);
  const L = h?.kind === 'link' ? h.L : null;
  if (L !== overL) {
    overL?.over(false);
    L?.over(true);
    overL = L;
  }
  canvas.style.cursor = h
    ? h.kind === 'car'
      ? 'grab'
      : h.kind === 'link'
        ? 'pointer'
        : ''
    : '';
  const tx = h && TIPS[h.kind] ? TIPS[h.kind](h) : '';
  if (tx) {
    tipEl.textContent = tx;
    tipEl.style.left = e.clientX + 'px';
    tipEl.style.top = e.clientY + 'px';
    tipEl.classList.add('on');
  } else tipEl.classList.remove('on');
}
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerleave', () => {
  overL?.over(false);
  overL = null;
  tipEl.classList.remove('on');
  canvas.style.cursor = '';
});
let PULL = null; // driving by dragging the car: where along the car the grab was, and where the pointer is now
canvas.addEventListener('pointerdown', (e) => {
  try {
    canvas.setPointerCapture(e.pointerId);
  } catch {}
  tipEl.classList.remove('on');
  pointers.set(e.pointerId, [
    e.clientX,
    e.clientY,
    e.button === 2 || e.shiftKey,
  ]);
  mid = null;
  downHit =
    e.button === 0 && !e.shiftKey && pointers.size === 1 ? pick(e) : null;
  downAt =
    e.button === 0 && !e.shiftKey
      ? [e.clientX, e.clientY, performance.now()]
      : null;
  grab = null;
  PULL = null;
  if (downHit?.kind === 'car') {
    if (MODE === 'watch') {
      const s = Math.max(1, stepNow());
      grab = { s, T0: TT, moved: 0 };
    } else {
      const g = groundAt(e);
      if (g) {
        const f = [Math.cos(DRV.th), -Math.sin(DRV.th)];
        PULL = {
          a0: (g[0] - DRV.x) * f[0] + (g[1] - DRV.z) * f[1],
          g,
          moved: 0,
        };
      }
    }
  }
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p) {
    hover(e);
    return;
  }
  const dx = e.clientX - p[0],
    dy = e.clientY - p[1];
  p[0] = e.clientX;
  p[1] = e.clientY;
  if (grab) {
    grab.moved += Math.abs(dx) + Math.abs(dy);
    if (grab.moved > 4) {
      touchedSoft();
      ANIM = null;
      const s = grab.s,
        P = path();
      // the drag runs the step's clock: along the car's own direction of travel in this step, on screen
      const k = Math.min(s, P.ends.length - 1),
        a = P.S[P.ends[k - 1]],
        b = P.S[Math.min(P.ends[k], P.n - 1)];
      gw(_a, a.x, 0, a.z).project(camera);
      gw(_b, b.x, 0, b.z).project(camera);
      const sx = ((_b.x - _a.x) * host.clientWidth) / 2,
        sy = (-(_b.y - _a.y) * host.clientHeight) / 2,
        L2 = sx * sx + sy * sy;
      TT = clamp(
        TT + (L2 > 400 ? (dx * sx + dy * sy) / L2 : (dx + dy) / 300),
        s - 1,
        s,
      );
      canvas.style.cursor = 'grabbing';
    }
    return;
  }
  if (PULL) {
    PULL.moved += Math.abs(dx) + Math.abs(dy);
    const g = groundAt(e);
    if (g) PULL.g = g;
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6)
    downAt = null;
  if (downAt) return;
  touched();
  manual = true;
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()],
      d = Math.hypot(a[0] - b[0], a[1] - b[1]),
      m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (pinch) zoom = clamp((zoom * pinch) / d, 0.3, 2.4);
    pinch = d;
    if (mid) pan(m[0] - mid[0], m[1] - mid[1]);
    mid = m;
    return;
  }
  if (VW === 'seat') {
    const ly = SEAT.ly + dx * 0.005 * MS();
    SEAT.ly = Math.atan2(Math.sin(ly), Math.cos(ly));
    SEAT.lp = clamp(SEAT.lp - dy * 0.004, -0.8, 0.6);
    return;
  }
  if (p[2]) pan(dx, dy);
  else {
    cam.yaw -= dx * 0.004;
    cam.pitch = clamp(cam.pitch + dy * 0.003, 0.05, 1.5);
  }
});
const rel = (e) => {
  if ((grab && grab.moved > 4) || (PULL && PULL.moved > 4)) {
    grab = null;
    PULL = null;
    downAt = null;
    downHit = null;
    pointers.delete(e.pointerId);
    return;
  }
  if (downAt && pointers.size === 1 && performance.now() - downAt[2] < 450)
    click(downHit);
  grab = null;
  PULL = null;
  downAt = null;
  downHit = null;
  pointers.delete(e.pointerId);
  pinch = 0;
  mid = null;
};
canvas.addEventListener('pointerup', rel);
canvas.addEventListener('pointercancel', (e) => {
  downAt = null;
  grab = null;
  PULL = null;
  rel(e);
});
canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    touched();
    manual = true;
    zoom = clamp(
      zoom * Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)),
      0.3,
      2.4,
    );
  },
  { passive: false },
);
const held = new Set();
addEventListener('keyup', (e) => {
  held.delete(e.key.toLowerCase());
  driveKeys();
});
addEventListener('blur', () => {
  held.clear();
  driveKeys();
});
// driving keys: ↑/W forwards, ↓/S reverse, ←/A and →/D turn the wheel (the camera keeps Q, E, + and −)
function driveKeys() {
  const h = (k) => held.has(k);
  INP.fwd = (MODE === 'drive' && (h('w') || h('arrowup'))) || PED.fwd;
  INP.rev = (MODE === 'drive' && (h('s') || h('arrowdown'))) || PED.rev;
  const kl = h('a') || h('arrowleft'),
    kr = h('d') || h('arrowright');
  INP.left = MODE === 'drive' && (LHT ? kr : kl);
  INP.right = MODE === 'drive' && (LHT ? kl : kr);
}
const PED = { fwd: false, rev: false };
const _fw = new THREE.Vector3();
function keyCam() {
  if (!held.size) return;
  const f = (held.has('shift') ? 2.4 : 1) * _dt,
    has = (...k) => k.some((x) => held.has(x));
  let dx = 0,
    dy = 0;
  if (MODE !== 'drive') {
    if (has('a', 'arrowleft')) dx += 1;
    if (has('d', 'arrowright')) dx -= 1;
    if (has('w', 'arrowup')) dy += 1;
    if (has('s', 'arrowdown')) dy -= 1;
    if (dx || dy) {
      pan(dx * f * 420, 0);
      cam.t.addScaledVector(
        _fw.set(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw)),
        dy * f * 12,
      );
    }
  }
  if (has('q')) {
    cam.yaw += f * 1.1;
    SEAT.ly -= f * 1.4 * MS();
  }
  if (has('e')) {
    cam.yaw -= f * 1.1;
    SEAT.ly += f * 1.4 * MS();
  }
  if (has('=', '+')) zoom = clamp(zoom * Math.exp(-f * 1.3), 0.3, 2.4);
  if (has('-', '_')) zoom = clamp(zoom * Math.exp(f * 1.3), 0.3, 2.4);
  if (
    has('q', 'e', '=', '+', '-', '_') ||
    (MODE !== 'drive' &&
      has(
        'w',
        's',
        'a',
        'd',
        'arrowleft',
        'arrowright',
        'arrowup',
        'arrowdown',
      ))
  )
    manual = true;
}
function setFov(f) {
  if (Math.abs(camera.fov - f) > 0.01) {
    camera.fov = f;
    camera.updateProjectionMatrix();
  }
}
function seatMode(on) {
  const C = LEARNER;
  C.cabin.cab.visible = on;
  C.cabin.outside.forEach((m) => (m.visible = !on));
  if (on) C.lamps.rev.visible = false;
  C.U.uSide.value = on ? 1 : 0;
}
function seatCam() {
  const p = CUR;
  // the head faces a little right of straight ahead, and the view is wide enough (98° across) to hold both door mirrors and the rear-view
  // one at once: you reverse on the mirrors, as in a real car. A drag (or Q, E) looks round, over your shoulder included.
  const yaw = SEAT_YAW + SEAT.ly,
    pitch = clamp(-0.07 + SEAT.lp, -0.9, 0.6),
    a = SEAT_EYE.a,
    b = SEAT_EYE.b,
    y = SEAT_EYE.y;
  const e = toG(p, a, b),
    f = toG(p, a + Math.cos(yaw) * 10, b + Math.sin(yaw) * 10);
  gw(camera.position, e[0], y, e[1]);
  gw(_seatT, f[0], y + Math.tan(pitch) * 10, f[1]);
  camera.up.set(0, 1, 0).applyQuaternion(G.quaternion);
  camera.lookAt(_seatT);
  const vf =
    camera.aspect > 1
      ? clamp((2 * Math.atan(Math.tan(49 * D2R) / camera.aspect)) / D2R, 52, 82)
      : 74;
  setFov(clamp(vf * clamp(zoom, 0.55, 1.3), 34, 96));
  // the wheel in the cabin turns as the car's does (clockwise, seen from the seat, is right)
  LEARNER.cabin.rim.rotation.z = -p.st * LOCK_TURNS * Math.PI * 2;
  // nothing in the cabin is blurred: the lens focuses far and wide
  dof.u.focus.value = 40;
  dof.u.range.value = 1e4;
  focPt.copy(_seatT);
}
function applyCam(t) {
  seatMode(VW === 'seat');
  if (VW === 'seat') {
    seatCam();
    return;
  }
  setFov(RT.fov + (MOB ? 8 : 0));
  const sway = manual || VW !== '3d' ? 0 : Math.sin(t / 7) * 0.02,
    d = cam.dist * zoom * fitScale,
    yaw = cam.yaw + sway;
  const minP = Math.asin(clamp((0.45 - cam.t.y) / Math.max(d, 0.1), -1, 1));
  const pitch = Math.max(cam.pitch, minP),
    cp = Math.cos(pitch); // never below the floor
  camera.position.set(
    cam.t.x + Math.sin(yaw) * cp * d,
    cam.t.y + Math.sin(pitch) * d,
    cam.t.z + Math.cos(yaw) * cp * d,
  );
  camera.position.z = clamp(camera.position.z, WALL_Z + 1, 120);
  camera.position.x = clamp(camera.position.x, LWALL_X + 1, RWALL_X - 1);
  camera.position.y = clamp(camera.position.y, 0.3, 140);
  if (pitch > 1.35) {
    camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw));
  } else camera.up.set(0, 1, 0);
  camera.lookAt(cam.t);
  // autofocus is set exactly on the target: the camera is what moves smoothly, so the focus never lags it. The band is wide (labels stay sharp)
  const fd = camera.position.distanceTo(cam.t),
    band = Math.max(6, fd * 0.42) * RT.focalBand;
  dof.u.focus.value = fd;
  dof.u.range.value = band;
  dof.u.cocScale.value.set(RT.apertureNear, RT.aperture);
  focPt.copy(cam.t);
}

// ======================================================================= frame
function layout() {
  const w = host.clientWidth,
    h = host.clientHeight;
  MOB = w < 900;
  const fov = RT.fov + (MOB ? 8 : 0);
  if (camera.fov !== fov) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  // ParkWise layout: a phone's dock sits at the bottom, so the scene rides up; on a wide screen the lesson column is on the right, so the
  // scene shifts a little left of centre, and the top bar and the bottom dock roughly balance vertically
  camera.setViewOffset(
    w,
    h,
    MOB ? 0 : w * 0.045,
    MOB ? h * 0.12 : -h * 0.015,
    w,
    h,
  );
  fitScale =
    camera.aspect < 0.8
      ? clamp(0.95 / Math.max(camera.aspect, 0.4), 1, 2.1)
      : clamp(1.6 / camera.aspect, 1, 1.6);
}
function resize() {
  const w = host.clientWidth,
    h = host.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  const v = renderer.getDrawingBufferSize(new THREE.Vector2());
  reflTarget.setSize(Math.round(v.x * 0.5), Math.round(v.y * 0.5));
  OV_U.uRes.value.copy(v);
  LL_U.uRes.value.copy(v);
  bloom.materialHighPassFilter.uniforms.uFull.value.set(1 / v.x, 1 / v.y);
  layout();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
let tPrev = performance.now(),
  fpsA = 0,
  fpsN = 0,
  tuneAt = 0;
function tick(now) {
  _raw = clamp((now - tPrev) / 1000, 0, 1.5);
  _dt = Math.min(0.1, _raw);
  tPrev = now;
  const t = now / 1000;
  NOW = t;
  runDirector();
  stepClock();
  keyCam();
  veilTick();
  if (MODE === 'drive') {
    if (PULL) {
      const f = [Math.cos(DRV.th), -Math.sin(DRV.th)],
        a = (PULL.g[0] - DRV.x) * f[0] + (PULL.g[1] - DRV.z) * f[1] - PULL.a0;
      INP.pullV = clamp(a * 2.2, -DRIVE.vr, DRIVE.vf);
    } else INP.pullV = null;
    // the model steps at 120 Hz whatever the display does
    let left = _dt;
    while (left > 1e-6) {
      const h = Math.min(left, 1 / 120);
      driveStep(h);
      left -= h;
    }
  }
  frame();
  easeCam(_dt);
  applyCam(t);
  errJolt();
  camera.updateMatrixWorld();
  renderer.shadowMap.needsUpdate = true;
  updateExplain();
  redrawHolo();
  syncDom();
  soundTick(Math.abs(CUR.v) > 0.02, Math.sign(CUR.v));
  if (hint.classList.contains('on') && NOW - hintAt > 2.2)
    hint.classList.remove('on');
  fpsA += _raw;
  fpsN++;
  if (now - tuneAt > 1600) {
    const f = fpsN / Math.max(fpsA, 0.001);
    fpsA = 0;
    fpsN = 0;
    tuneAt = now;
    fpsNow = f;
    fpsTicks++;
    if (fpsTicks > 2) fpsBest = Math.max(fpsBest, f);
    fpsBad = fpsTicks > 3 && f < fpsBest * 0.74 ? fpsBad + 1 : 0;
    // resolution is bought back a step at a time while frames are fast, never below 1 (text and labels are the first to suffer)
    if (RT._ceil === undefined) {
      RT._ceil = Math.min(2, Math.max(1, devicePixelRatio));
      RT._good = 0;
      RT._probe = 0;
    }
    if (!document.hidden && RT.auto && fpsTicks > 3) {
      if (RT._probe && f < 55) {
        RT._probe = 0;
        RT._good = 0;
        RT._ceil = Math.max(1, +(RT.pixelRatio - 0.25).toFixed(2));
        RT.pixelRatio = RT._ceil;
        applyTune();
      } else {
        RT._probe = 0;
        RT._good = f >= 58 ? Math.min(9, RT._good + 1) : 0;
        if (RT._good >= 3 && RT.pixelRatio < RT._ceil) {
          RT._good = 0;
          RT._probe = 1;
          RT.pixelRatio = Math.min(
            RT._ceil,
            +(RT.pixelRatio + 0.25).toFixed(2),
          );
          applyTune();
        }
      }
    }
    if (!document.hidden && RT.auto && fpsBad >= 2 && f < 50) {
      fpsBad = 0;
      if (RT.pixelRatio > 1) {
        RT.pixelRatio = RT._ceil = Math.max(
          1,
          +(RT.pixelRatio - 0.25).toFixed(2),
        );
        applyTune();
      } else if (RT.reflect) {
        RT.reflect = 0;
        applyTune();
      } else if (RT.msaa > 0) {
        RT.msaa = 0;
        applyTune();
      } else if (RT.ao) {
        RT.ao = 0;
        applyTune();
      }
    }
  }
  if (NORENDER) return;
  renderReflection();
  renderMirrors();
  renderer.info.reset();
  composer.render();
  drawTags();
  TAG_SNAP = 0;
}
let LOOP = true,
  NORENDER = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (LOOP) tick(now);
}

// ======================================================================= boot: the first frame is the hero, parallel parking, the car swinging in at full lock with its turning point on the pavement
const HERO_T = 1.85;
{
  const q = new URLSearchParams(location.search).get('drive');
  let sd = q === 'left' ? 'l' : q === 'right' ? 'r' : null;
  if (!sd)
    try {
      sd = localStorage.getItem('parking-side');
    } catch {}
  // (not under automation: the card's loop and stills are always recorded keeping right, whatever the recording machine's language)
  if (!sd && !navigator.webdriver) {
    const LEFT = new Set(
      'GB IE IM JE GG MT CY AU NZ IN PK BD LK NP BT JP HK MO SG MY BN TH ID TL ZA KE UG TZ ZM ZW MW MZ BW NA LS SZ MU SC JM TT BB BS GY SR FJ PG WS TO KI NR TV SB CK'.split(
        ' ',
      ),
    );
    const r = (navigator.languages || [navigator.language])
      .map((l) => (l || '').split('-')[1])
      .find(Boolean);
    sd = r && LEFT.has(r.toUpperCase()) ? 'l' : 'r';
  }
  setSide(sd === 'l');
}
applyTune();
setSound(SND);
setSet('street');
buildCard();
setCine(true, true);
TT = HERO_T;
DIR.phase = 'run';
DIR.wait = performance.now() / 1000 + 2.6;
NOW = performance.now() / 1000;
frame(true);
snapCam();
{
  const h = location.hash.slice(1),
    m = /^(parallel|rbay|fbay|angle|hill)(?:-(\d))?$/.exec(h);
  if (m) {
    setCine(false);
    setManoeuvre(m[1]);
    TT = m[2] ? clamp(+m[2], 0, NSTEP()) : 0;
    frame(true);
    snapCam();
  }
  if (/practi[cs]e/.test(h)) setMode('drive');
}
$('#loading').remove();
syncDom(true);
requestAnimationFrame(loop);
// ---- hooks for review renders and films: drive frames yourself, read the canvas in the same task
window.__step = (t) => tick(t);
// __sim(n, dt): run the clock, the director and the model for n frames of dt seconds without drawing (logic checks)
window.__sim = (n, dt = 0.25) => {
  NORENDER = 1;
  let t = tPrev;
  for (let i = 0; i < n; i++) tick((t += dt * 1000));
  NORENDER = 0;
  return window.__dbg();
};
window.__loop = (v) => {
  LOOP = v;
};
window.__composite = (w = renderer.domElement.width) => {
  const src = renderer.domElement,
    c = document.createElement('canvas');
  c.width = w;
  c.height = Math.round((w * src.height) / src.width);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0, c.width, c.height);
  g.drawImage(tagCv, 0, 0, c.width, c.height);
  return c;
};
window.__capture = (w = 1200, q = 0.85) =>
  window.__composite(w).toDataURL('image/webp', q);
window.__shot = async (name, w = 1600, t) => {
  tick(t ?? performance.now());
  const d = window.__capture(w, 0.9);
  return (
    await fetch(
      'http://localhost:8792/shot?name=' + SLUG + '/_shots/' + name + '.webp',
      { method: 'POST', body: d },
    )
  ).text();
};
// __lab: set things deterministically. man(k) picks a manoeuvre; at(T) sets the clock (snaps the camera); wrong(on); view(v); drive(on); pose({x,z,th,st}) puts the practice car somewhere
window.__lab = {
  man: (k) => {
    setCine(false);
    setManoeuvre(k);
    VIEW_OUT = -99;
  },
  at: (T, snap = true) => {
    setCine(false);
    ANIM = null;
    TT = clamp(T, 0, nSteps());
    frame(true);
    if (snap) {
      manual = false;
      snapCam();
    }
    syncDom(true);
    TAG_SNAP = 1;
    holoKey = '';
  },
  play: (k) => goStep(k),
  cine: (v, tour) => setCine(!!v, tour),
  script: (S) => {
    setCine(false);
    manual = !!S;
    if (S) {
      gw(cam.t, ...S.t);
      cam.yaw = S.yaw;
      cam.pitch = S.pitch;
      cam.dist = S.dist;
      zoom = 1;
    }
  },
  wrong: (v) => {
    setCine(false);
    WRONG = v ? 1 : 0;
    ANIM = null;
  },
  view: (v) => {
    setView(v);
    snapCam();
  },
  side: (v) => {
    setSide(v === 'left');
    frame(true);
    snapCam();
  },
  drive: (v) => setMode(v ? 'drive' : 'watch'),
  pose: (o) => {
    Object.assign(DRV, o);
    frame(true);
  },
  input: (o) => Object.assign(INP, o),
  tags: (v) => {
    showTags = !!v;
  },
  tune: (o) => {
    Object.assign(RT, o);
    applyTune();
    return { ...RT };
  },
  get T() {
    return TT;
  },
  MAN,
  PATHS,
  FACT,
  DRV,
  SENS,
  CAMS,
  cam,
  CUR,
};
window.__x = {
  scenePass,
  sun,
  lightPool,
  dof,
  gtao,
  bloom,
  renderer,
  camera,
  scene,
  composer,
  cam,
  RT,
  overlay,
  rays,
  G,
  LEARNER,
  POOL,
  SETG,
  MIRRORS,
};
window.__dbg = () => ({
  man: MK,
  T: +TT.toFixed(3),
  step: stepNow(),
  mode: MODE,
  cine: CINE,
  wrong: WRONG,
  x: +CUR.x.toFixed(3),
  z: +CUR.z.toFixed(3),
  th: +(CUR.th / D2R).toFixed(1),
  st: +CUR.st.toFixed(3),
  drv:
    MODE === 'drive'
      ? { step: DRV.step, touches: DRV.touches, parked: !!DRV.parked }
      : undefined,
  sens: [+SENS.front.toFixed(2), +SENS.back.toFixed(2)],
  focus: +dof.u.focus.value.toFixed(2),
  calls: renderer.info.render.calls,
  tris: renderer.info.render.triangles,
});
