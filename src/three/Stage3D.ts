import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect } from 'postprocessing';
import { World, GROUND_ROW, Enemy } from '../sim/World';
import { TILE } from '../sim/tiles';
import { Settings } from '../core/Settings';
import { CHARACTERS, buildToy, type Toy } from './characters';

// Sim is in pixels, y-down. 3D is in tiles (1 unit = 32px), y-up, ground surface at y = 0, gameplay plane z = 0.
const U = 1 / TILE;
const X = (px: number) => px * U;
const Y = (py: number) => (GROUND_ROW * TILE - py) * U;
const DEPTH = 5; // how far terrain extends back from the gameplay plane

type ModelKey = 'soldier' | 'robot' | 'hazmat' | 'drone' | 'turret' | 'dragon' | 'palm' | 'plant' | 'plant_big1' | 'plant_big2';
// Target heights in tiles (sim sizes: hero 46px ≈ 1.45, boss 200px ≈ 6.25).
const HEIGHT: Record<ModelKey, number> = {
  soldier: 1.5, robot: 1.4, hazmat: 1.45, drone: 0.95, turret: 1.1, dragon: 6.2,
  palm: 7, plant: 0.9, plant_big1: 1.6, plant_big2: 1.4,
};

type View = {
  root: THREE.Object3D; mixer?: THREE.AnimationMixer; actions: Record<string, THREE.AnimationAction>;
  clip: string; mats: THREE.MeshStandardMaterial[]; torso?: THREE.Object3D; seen: boolean; toy?: Toy; pool?: string;
  guns?: Map<string, THREE.Object3D>; gun?: THREE.Object3D; hand?: THREE.Object3D;
  barrel?: { axis: THREE.Vector3; tip: THREE.Vector3 }; // in hand space; axis measured once from the AK
  arms?: THREE.Object3D[]; // UpperArmR, UpperArmL: take most of the aim so the body stays upright
  head?: THREE.Object3D;
  armL?: THREE.Object3D[]; // [UpperArmL, LowerArmL, effector (MiddleL knuckle)] for the support-hand IK
  yaw?: number; elev?: number; lie?: number; kick?: number; // smoothed pose state (hero); elev = aim above/below facing
};
// Which hand-held model shows for each weapon (Quaternius rigs carry a whole arsenal on the right hand).
const GUN_MODEL: Record<string, string> = { R: 'AK', A: 'AK', F: 'RocketLauncher', P: 'Sniper' };
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export class Stage3D {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 16 / 9, 0.5, 400);
  private composer: EffectComposer;
  private sun!: THREE.DirectionalLight;
  private models = {} as Record<ModelKey, GLTF>;
  private views = new Map<number, View>();
  private pool = new Map<string, View[]>();                      // hidden enemy views, reused instead of re-cloned
  private fit = new Map<ModelKey, { s: number; y: number }>();   // per-model scale, measured once
  private hero!: View;
  private bridgeMesh!: THREE.InstancedMesh;
  private bridgeCells: { cx: number; cy: number }[] = [];
  private bullets!: THREE.InstancedMesh;
  private ebullets!: THREE.InstancedMesh;
  private particles!: THREE.InstancedMesh;
  private pickupMat = new Map<string, THREE.SpriteMaterial>();
  private barrier!: THREE.Mesh;
  private flash!: THREE.PointLight;
  private foam: THREE.Mesh[] = []; // bobbing surface lines on the rivers
  private blastMesh!: THREE.InstancedMesh;
  private blastLight!: THREE.PointLight;
  private q1 = new THREE.Quaternion(); private q2 = new THREE.Quaternion();
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3();
  heroTip: { x: number; y: number } | null = null; // barrel tip in sim px, for bullet visuals
  closeup = false; // dev: follow-cam close to the hero, for inspecting poses
  private bossHead: { x: number; y: number } | null = null; // dragon's mouth, where its fireballs appear from
  private bulletFrom = new WeakMap<object, { dx: number; dy: number }>();
  private tmp = new THREE.Object3D();
  private col = new THREE.Color();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(1.5, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new EffectPass(this.camera,
      new BloomEffect({ luminanceThreshold: 0.8, luminanceSmoothing: 0.2, intensity: 1.4, mipmapBlur: true, resolutionScale: 0.5 }),
      new VignetteEffect({ darkness: 0.45, offset: 0.3 })));
  }

  async load(onProgress: (f: number) => void) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const keys = Object.keys(HEIGHT) as ModelKey[];
    let done = 0;
    await Promise.all(keys.map(async (k) => {
      this.models[k] = await loader.loadAsync(`models/${k}.glb`);
      onProgress(++done / keys.length);
    }));
  }

  // Sim px -> CSS fraction of the canvas (0..1), for DOM overlays like score popups.
  private pv = new THREE.Vector3();
  project(x: number, y: number) {
    this.pv.set(X(x), Y(y), 0).project(this.camera);
    return { fx: (this.pv.x + 1) / 2, fy: (1 - this.pv.y) / 2 };
  }

  resize(w: number, h: number) {
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Scale a fresh copy of a model to its target height, feet at y = 0.
  private instance(key: ModelKey, castShadow = true): THREE.Object3D {
    const src = this.models[key].scene;
    const obj = this.models[key].animations.length ? cloneSkinned(src) : src.clone();
    let f = this.fit.get(key);
    if (!f) { // precise box walks every skinned vertex (~10 ms), so do it once per model
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj, true);
      const s = HEIGHT[key] / (box.max.y - box.min.y);
      f = { s, y: -box.min.y * s };
      this.fit.set(key, f);
    }
    obj.scale.setScalar(f.s);
    obj.position.y = f.y;
    const wrap = new THREE.Group();
    wrap.add(obj);
    obj.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = castShadow; o.receiveShadow = castShadow; } });
    return wrap;
  }

  private makeView(key: ModelKey): View {
    const root = this.instance(key);
    const mats: THREE.MeshStandardMaterial[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      // Own materials per view so hit-flash tints don't leak to every enemy.
      const list = (Array.isArray(m.material) ? m.material : [m.material]).map((x) => (x as THREE.MeshStandardMaterial).clone());
      m.material = Array.isArray(m.material) ? list : list[0];
      mats.push(...list);
    });
    const gltf = this.models[key];
    const view: View = { root, actions: {}, clip: '', mats, seen: true };
    if (gltf.animations.length) {
      view.mixer = new THREE.AnimationMixer(root);
      for (const c of gltf.animations) view.actions[c.name.split('|').pop()!] = view.mixer.clipAction(c);
    }
    root.traverse((o) => { if (o.name === 'Torso') view.torso = o; if (o.name === 'Head' && !view.head) view.head = o; });
    const bone = (n: string) => { let b: THREE.Object3D | undefined; root.traverse((o) => { if (o.name === n) b = o; }); return b; };
    const ua = bone('UpperArmL'), la = bone('LowerArmL'), fx = bone('Middle1L');
    if (ua && la && fx) view.armL = [ua, la, fx];
    const arms: THREE.Object3D[] = [];
    root.traverse((o) => { if (o.name === 'UpperArmR' || o.name === 'UpperArmL') arms.push(o); });
    if (arms.length === 2) view.arms = arms.sort((a) => (a.name.endsWith('R') ? -1 : 1));
    // Hand weapons: keep them all addressable, show one.
    let hand: THREE.Object3D | undefined;
    root.traverse((o) => { if (o.name === 'Index1R') hand = o; });
    if (hand) {
      view.guns = new Map();
      for (const c of hand.children) if (!(c as THREE.Bone).isBone) view.guns.set(c.name, c);
      if (view.guns.size) { view.hand = hand; this.equip(view, 'AK'); } else view.guns = undefined; // e.g. the dragon's claw has no weapons
    }
    this.scene.add(root);
    return view;
  }

  // The playable character chosen on the title screen (rigged model or procedural toy).
  private makeHeroView(): View {
    const def = CHARACTERS[Settings.get().hero3d] ?? CHARACTERS[0];
    if (def.kind === 'toy') {
      const toy = buildToy(def.toy);
      this.scene.add(toy.root);
      return { root: toy.root, actions: {}, clip: '', mats: toy.mats, seen: true, toy };
    }
    const v = this.makeView(def.model);
    for (const m of v.mats) { const c = def.recolor?.[m.name]; if (c !== undefined) { m.color.setHex(c); m.roughness = 0.35; m.metalness = 0.15; } }
    return v;
  }

  private equip(v: View, name: string) {
    if (!v.guns || !v.hand || v.gun?.name === name) return;
    const pick = v.guns.get(name) ?? [...v.guns.values()][0];
    for (const g of v.guns.values()) g.visible = g === pick;
    v.gun = pick;
    // Every gun is held the same way, so the barrel direction comes from the AK (a long, straight model
    // whose barrel runs along one of its own axes); chunky guns like the rocket launcher can't be measured alone.
    const axis = v.barrel?.axis ?? this.akAxis(v.hand, v.guns.get('AK') ?? pick);
    v.barrel = { axis, tip: this.muzzleAlong(v.hand, pick, axis) };
  }

  // Walk every vertex of `gun` in `space`'s coordinates.
  private eachVertex(space: THREE.Object3D, gun: THREE.Object3D, fn: (p: THREE.Vector3) => void) {
    space.updateMatrixWorld(true);
    const inv = space.matrixWorld.clone().invert(), m = new THREE.Matrix4();
    gun.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      m.multiplyMatrices(inv, mesh.matrixWorld);
      const pos = mesh.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) fn(this.v1.fromBufferAttribute(pos, i).applyMatrix4(m));
    });
  }

  // Barrel direction in hand space: the AK's longest extent in its OWN space (it's modelled straight),
  // pointing to the end farther from the grip, then rotated into hand space.
  private akAxis(hand: THREE.Object3D, ak: THREE.Object3D) {
    const box = new THREE.Box3();
    this.eachVertex(ak, ak, (p) => box.expandByPoint(p));
    const size = box.getSize(new THREE.Vector3());
    const k = size.x >= size.y && size.x >= size.z ? 'x' : size.y >= size.z ? 'y' : 'z';
    const local = new THREE.Vector3(); local[k] = Math.abs(box.max[k]) >= Math.abs(box.min[k]) ? 1 : -1;
    ak.updateMatrixWorld(true); hand.updateMatrixWorld(true);
    const qAk = ak.getWorldQuaternion(new THREE.Quaternion()), qHand = hand.getWorldQuaternion(new THREE.Quaternion());
    return local.applyQuaternion(qAk).applyQuaternion(qHand.invert()).normalize();
  }

  // Muzzle point (hand space): on the gun's centre line, at its farthest extent along the barrel axis.
  private muzzleAlong(hand: THREE.Object3D, gun: THREE.Object3D, axis: THREE.Vector3) {
    const c = new THREE.Vector3(); let n = 0, maxD = -Infinity;
    this.eachVertex(hand, gun, (p) => { c.add(p); n++; maxD = Math.max(maxD, p.dot(axis)); });
    c.divideScalar(n || 1);
    return c.addScaledVector(axis, maxD - c.dot(axis));
  }

  // Point the barrel along `angle` (screen plane): the torso takes a little, the arms take the rest.
  private alignGun(v: View, angle: number, useTorso = true, torsoMax = 0.45) {
    if (!v.torso || !v.hand || !v.barrel) return;
    const turn = (bone: THREE.Object3D, delta: number) => {
      bone.parent!.getWorldQuaternion(this.q1);
      this.q2.setFromAxisAngle(Z_AXIS, delta);
      bone.quaternion.premultiply(this.q1.clone().invert().multiply(this.q2).multiply(this.q1));
    };
    const error = () => {
      v.root.updateMatrixWorld(true);
      v.hand!.getWorldQuaternion(this.q1);
      const d = this.v1.copy(v.barrel!.axis).applyQuaternion(this.q1);
      return wrapAngle(angle - Math.atan2(d.y, d.x));
    };
    if (useTorso) turn(v.torso, THREE.MathUtils.clamp(error() * 0.35, -torsoMax, torsoMax));
    for (let pass = 0; pass < 2; pass++) {
      const e = THREE.MathUtils.clamp(error(), -1.3, 1.3); // never contort, even on a bad reading
      if (v.arms) for (const a of useTorso ? v.arms : v.arms.slice(0, 1)) turn(a, e); else turn(v.torso, e); // prone: gun arm only
    }
    v.root.updateMatrixWorld(true);
  }

  private turnBone(bone: THREE.Object3D, delta: number) {
    bone.parent!.updateMatrixWorld(true);
    bone.parent!.getWorldQuaternion(this.q1);
    this.q2.setFromAxisAngle(Z_AXIS, delta);
    bone.quaternion.premultiply(this.q1.clone().invert().multiply(this.q2).multiply(this.q1));
  }

  // Two-bone CCD IK: bend the left arm so its hand lands on the gun's fore-grip (45% toward the muzzle).
  private gripLeftHand(v: View) {
    if (!v.armL || !v.hand || !v.barrel) return;
    const [upper, lower, eff] = v.armL;
    v.root.updateMatrixWorld(true);
    const target = v.hand.localToWorld(this.v2.copy(v.barrel.tip).multiplyScalar(0.45));
    const e = new THREE.Vector3(), b = new THREE.Vector3(), toE = new THREE.Vector3(), toT = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
    for (let iter = 0; iter < 4; iter++) {
      for (const joint of [lower, upper]) {
        joint.updateMatrixWorld(true);
        eff.updateMatrixWorld(true);
        joint.getWorldPosition(b); eff.getWorldPosition(e);
        toE.subVectors(e, b).normalize(); toT.subVectors(target, b).normalize();
        q.setFromUnitVectors(toE, toT);
        joint.parent!.getWorldQuaternion(pq);
        joint.quaternion.premultiply(pq.clone().invert().multiply(q).multiply(pq));
      }
      eff.updateMatrixWorld(true); eff.getWorldPosition(e);
      if (e.distanceTo(target) < 0.01) break;
    }
  }

  setHero() {
    if (this.hero) this.scene.remove(this.hero.root);
    this.hero = this.makeHeroView();
  }

  private play(v: View, name: string, once = false) {
    if (v.clip === name || !v.actions[name]) return;
    const next = v.actions[name].reset().play();
    if (once) { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    if (v.clip && v.actions[v.clip]) v.actions[v.clip].crossFadeTo(next, 0.12, false);
    v.clip = name;
  }

  private tint(v: View, hex: number, amount: number) {
    for (const m of v.mats) { m.emissive.setHex(hex); m.emissiveIntensity = amount; }
  }

  // ---------- Static level ----------
  build() {
    const w = World.get(), map = w.map, th = Settings.get().themeDef;
    const night = th.stars, dusk = th.name === 'DUSK';
    for (const v of this.views.values()) this.scene.remove(v.root);
    this.views.clear();
    this.scene.clear();

    // Sky + fog for depth.
    this.scene.background = new THREE.Color(th.sky[1]);
    this.scene.fog = new THREE.Fog(th.sky[1], 28, night ? 90 : 120);
    const skyGeo = new THREE.SphereGeometry(300, 24, 12);
    const top = new THREE.Color(th.sky[0]), bot = new THREE.Color(th.sky[1]);
    const cols: number[] = [];
    const pos = skyGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) { const t = THREE.MathUtils.clamp(pos.getY(i) / 300 + 0.25, 0, 1); const c = bot.clone().lerp(top, t); cols.push(c.r, c.g, c.b); }
    skyGeo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    this.scene.add(new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false })));

    // Lights.
    this.scene.add(new THREE.HemisphereLight(night ? 0x5a70a8 : dusk ? 0xffb89a : 0xcfe8ff, night ? 0x10141c : 0x3a4a2a, night ? 0.9 : 1.6));
    this.sun = new THREE.DirectionalLight(night ? 0x9fb4ff : dusk ? 0xffa070 : 0xfff1d6, night ? 1.2 : 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -8, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0005;
    this.scene.add(this.sun, this.sun.target);
    this.flash = new THREE.PointLight(0xffd27a, 0, 6, 2);
    this.scene.add(this.flash);

    // Terrain: dirt blocks + grass caps, instanced.
    const solid = (cx: number, cy: number) => map.at(cx, cy) === '#';
    const cells: [number, number][] = [], caps: [number, number][] = [], ledges: [number, number][] = [];
    this.bridgeCells = [];
    map.rows.forEach((r, cy) => [...r].forEach((c, cx) => {
      if (c === '#') { cells.push([cx, cy]); if (!solid(cx, cy - 1)) caps.push([cx, cy]); }
      else if (c === '=') ledges.push([cx, cy]);
      else if (c === 'b') this.bridgeCells.push({ cx, cy });
    }));
    const std = (color: number, rough = 0.95) => new THREE.MeshStandardMaterial({ color, roughness: rough, flatShading: true });
    const blocks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, DEPTH), std(night ? 0x4a3a30 : 0x6b4a33), cells.length);
    cells.forEach(([cx, cy], i) => {
      this.tmp.position.set(cx + 0.5, Y(cy * TILE) - 0.5, -DEPTH / 2 + 0.6); this.tmp.updateMatrix();
      blocks.setMatrixAt(i, this.tmp.matrix);
      blocks.setColorAt(i, this.col.setHSL(0.07, 0.35, 0.28 + ((cx * 7 + cy * 13) % 5) * 0.02));
    });
    blocks.receiveShadow = true;
    const grass = new THREE.InstancedMesh(new THREE.BoxGeometry(1.02, 0.28, DEPTH + 0.1), std(0x5fae3e, 0.8), caps.length);
    caps.forEach(([cx, cy], i) => {
      this.tmp.position.set(cx + 0.5, Y(cy * TILE) - 0.12, -DEPTH / 2 + 0.6); this.tmp.updateMatrix();
      grass.setMatrixAt(i, this.tmp.matrix);
      grass.setColorAt(i, this.col.setHSL(0.28 + ((cx * 5) % 7) * 0.006, 0.55, night ? 0.3 : 0.42 + ((cx * 3) % 4) * 0.02));
    });
    grass.receiveShadow = true; grass.castShadow = true;
    const ledge = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.3, 1.8), std(0x8a6242, 0.7), ledges.length);
    ledges.forEach(([cx, cy], i) => { this.tmp.position.set(cx + 0.5, Y(cy * TILE) - 0.15, 0); this.tmp.updateMatrix(); ledge.setMatrixAt(i, this.tmp.matrix); });
    ledge.castShadow = ledge.receiveShadow = true;
    this.bridgeMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.92, 0.16, 1.6), std(0x9a6a3c, 0.8), this.bridgeCells.length);
    this.bridgeMesh.castShadow = this.bridgeMesh.receiveShadow = true;
    this.scene.add(blocks, grass, ledge, this.bridgeMesh);

    // Water: a box filling each river pit ('~' columns).
    const waterMat = new THREE.MeshStandardMaterial({ color: night ? 0x1f5a8a : 0x2a9ad8, emissive: night ? 0x0a2440 : 0x0b4a70, emissiveIntensity: 0.6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 });
    const foamMat = new THREE.MeshBasicMaterial({ color: 0xdff6ff, transparent: true, opacity: 0.7 });
    this.foam = [];
    for (let cx = 0; cx < map.cols; cx++) {
      if (map.at(cx, GROUND_ROW + 1) !== '~' || map.at(cx - 1, GROUND_ROW + 1) === '~') continue;
      let len = 0; while (map.at(cx + len, GROUND_ROW + 1) === '~') len++;
      const water = new THREE.Mesh(new THREE.BoxGeometry(len, 2.4, DEPTH), waterMat);
      water.position.set(cx + len / 2, -1.55, -DEPTH / 2 + 0.6); // surface ~0.35 below the banks
      const foam = new THREE.Mesh(new THREE.BoxGeometry(len, 0.06, 0.25), foamMat);
      foam.position.set(cx + len / 2, -0.33, 1.05);
      this.scene.add(foam); this.foam.push(foam);
      this.scene.add(water);
    }

    // Far background: ground plane, mountains, and scattered jungle.
    const bgGround = new THREE.Mesh(new THREE.PlaneGeometry(map.cols + 200, 120), std(night ? 0x1f3222 : 0x3f6a36));
    bgGround.rotation.x = -Math.PI / 2; bgGround.position.set(map.cols / 2, -0.3, -60); bgGround.receiveShadow = true;
    this.scene.add(bgGround);
    const rnd = mulberry(7);
    const mount = new THREE.MeshStandardMaterial({ color: night ? 0x1c2638 : dusk ? 0x6a4a6a : 0x6c8fa0, flatShading: true, roughness: 1 });
    for (let x = -40; x < map.cols + 60; x += 14 + rnd() * 10) {
      const h = 18 + rnd() * 26, m = new THREE.Mesh(new THREE.ConeGeometry(12 + rnd() * 10, h, 5 + Math.floor(rnd() * 3)), mount);
      m.position.set(x, h / 2 - 2, -95 - rnd() * 30); m.rotation.y = rnd() * 3;
      this.scene.add(m);
    }
    const scatter = (key: ModelKey, count: number, zMin: number, zMax: number, scaleVar = 0.35) => {
      for (let i = 0; i < count; i++) {
        const o = this.instance(key, key === 'palm' && zMax > -16); // only near palms cast shadows onto the lane
        const s = 1 - scaleVar / 2 + rnd() * scaleVar;
        o.scale.multiplyScalar(s);
        o.position.set(rnd() * (map.cols + 20) - 10, key === 'palm' || key.startsWith('tree') ? -0.1 : 0, zMin + rnd() * (zMax - zMin));
        o.rotation.y = rnd() * Math.PI * 2;
        this.scene.add(o);
      }
    };
    scatter('palm', 40, -14, -4);
    scatter('palm', 50, -40, -16, 0.6);
    scatter('plant_big1', 30, -16, -6, 0.6); // reads as mossy rocks: keep it off the play lane
    scatter('plant_big2', 40, -9, -3, 0.6);
    // Foreground foliage in front of the gameplay plane (only on solid ground).
    for (let i = 0; i < 70; i++) {
      const cx = Math.floor(rnd() * map.cols);
      if (!solid(cx, GROUND_ROW) || cx < 9) continue; // keep the spawn (title close-up) clear
      const o = this.instance(i % 2 ? 'plant' : 'plant_big2', false);
      o.scale.multiplyScalar(0.4 + rnd() * 0.2); // knee-high: frames the lane without hiding the action
      o.position.set(cx + rnd(), 0, 1.6 + rnd() * 0.8);
      o.rotation.y = rnd() * 6;
      this.scene.add(o);
    }

    // Dynamic pools: bullets, enemy bullets, particles.
    this.bullets = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.07, 0.3, 2, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.2, 1.2), toneMapped: false }), 256);
    this.ebullets = new THREE.InstancedMesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.6, 3.6), toneMapped: false }), 256);
    this.particles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ toneMapped: false }), 1024);
    this.particles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(1024 * 3), 3);
    for (const m of [this.bullets, this.ebullets, this.particles]) { m.frustumCulled = false; m.count = 0; this.scene.add(m); }
    this.barrier = new THREE.Mesh(new THREE.SphereGeometry(1.05, 20, 14), new THREE.MeshBasicMaterial({ color: 0x7fe8ff, transparent: true, opacity: 0.18, depthWrite: false }));
    this.scene.add(this.barrier);

    this.blastMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.6, 0.5), toneMapped: false, transparent: true, opacity: 0.55, depthWrite: false }), 64);
    this.blastMesh.frustumCulled = false; this.blastMesh.count = 0;
    this.blastLight = new THREE.PointLight(0xff9a40, 0, 14, 1.6);
    this.scene.add(this.blastMesh, this.blastLight);
    this.hero = this.makeHeroView();
    // Pre-build a few enemy views and compile every shader now, so the first spawn doesn't hitch.
    this.pool.clear();
    const warm: View[] = [];
    for (const [key, n] of [['robot', 5], ['hazmat', 2], ['drone', 6], ['turret', 3], ['dragon', 1]] as [ModelKey, number][])
      for (let i = 0; i < n; i++) { const v = this.makeView(key); v.pool = key; warm.push(v); }
    for (let i = 0; i < 2; i++) { const v = this.makeView('drone'); v.pool = 'carrier'; for (const m of v.mats) m.color.setHex(0xff4a3a); warm.push(v); } // red capsule carriers
    // Effects start empty, so give each one instance (and one pickup sprite) while compiling.
    const fxMeshes = [this.bullets, this.ebullets, this.particles, this.blastMesh];
    for (const m of fxMeshes) m.count = 1;
    const sprites = ['A', 'F', 'P', 'B'].map((l) => { const sp = new THREE.Sprite(this.pickupMaterial(l)); this.scene.add(sp); return sp; });
    // Render one real frame through the composer (bloom target, shadows) so every shader variant
    // is built now; renderer.compile() alone targets the screen and misses the composer variants.
    const cam = this.camera.position.clone();
    for (const v of warm) v.root.position.set(this.camera.position.x, 0, 0);
    this.camera.position.set(cam.x, 3, 20); this.camera.lookAt(cam.x, 1, 0);
    this.composer.render(0);
    this.camera.position.copy(cam);
    for (const m of fxMeshes) m.count = 0;
    for (const sp of sprites) this.scene.remove(sp);
    for (const v of warm) this.release(v);
  }

  private release(v: View) {
    v.root.visible = false;
    v.mixer?.stopAllAction(); v.clip = '';
    this.tint(v, 0, 0);
    v.root.rotation.set(0, 0, 0);
    const list = this.pool.get(v.pool!) ?? [];
    list.push(v); this.pool.set(v.pool!, list);
  }

  private acquire(key: ModelKey, poolKey: string = key): View {
    const v = this.pool.get(poolKey)?.pop() ?? Object.assign(this.makeView(key), { pool: poolKey });
    v.root.visible = true;
    return v;
  }

  // ---------- Per frame ----------
  render(alpha: number, dt: number, trauma: number, prev: Map<number, { x: number; y: number }>, focusHero = false) {
    const w = World.get(), p = w.player, t = performance.now() / 1000;
    const lerp = (a: number, b: number) => a + (b - a) * alpha;

    // Camera: frames the sim's 640x360 view; shake from trauma².
    const camX = X(lerp(w.camPrevX, w.camX) + w.viewW / 2);
    const s = trauma * trauma;
    const n = (k: number) => Math.sin(t * 37 + k) * 0.6 + Math.sin(t * 59 + k * 3) * 0.4;
    const dist = 5.625 / Math.tan(THREE.MathUtils.degToRad(15));
    if (focusHero || this.closeup) { // title screen (or dev close-up): showcase of the hero
      const hx = X(p.x + p.w / 2), fy = Y(p.y + p.h);
      if (this.closeup) { this.camera.position.set(hx + 0.3, fy + 0.95, 4.5); this.camera.lookAt(hx + 0.3, fy + 0.95, 0); } // pure side view
      else { this.camera.position.set(hx + 1.2, 1.4, 5.2); this.camera.lookAt(hx - 0.6, 0.9, 0); }
    } else {
      this.camera.position.set(camX + s * 0.5 * n(1), 3.2 + s * 0.5 * n(2), dist);
      this.camera.lookAt(camX, 2.35, 0);
    }
    this.camera.rotation.z += s * 0.03 * n(3);
    this.sun.position.set(camX - 10, 22, 16);
    this.sun.target.position.set(camX, 0, 0);

    for (const [i, f] of this.foam.entries()) f.position.y = -0.33 + Math.sin(t * 2.2 + i) * 0.04;
    // Bridges that blew up / were rebuilt.
    this.bridgeCells.forEach(({ cx, cy }, i) => {
      const up = w.map.at(cx, cy) === 'b';
      this.tmp.position.set(cx + 0.5, Y(cy * TILE) - 0.08, 0); this.tmp.scale.setScalar(up ? 1 : 0); this.tmp.updateMatrix();
      this.bridgeMesh.setMatrixAt(i, this.tmp.matrix);
    });
    this.tmp.scale.setScalar(1);
    this.bridgeMesh.instanceMatrix.needsUpdate = true;

    this.renderHero(alpha, dt, focusHero);
    this.renderEnemies(dt, prev, alpha);
    this.renderFx(alpha);
    this.composer.render(dt);
  }

  private renderHero(alpha: number, dt: number, title = false) {
    const w = World.get(), p = w.player, v = this.hero, t = performance.now() / 1000;
    const visible = p.dead === 0 && !w.gameOver && !(p.iframes > 0 && (p.iframes >> 2) % 2 === 1 && !w.cleared && !title);
    v.root.visible = visible;
    this.barrier.visible = visible && p.barrier > 0;
    this.heroTip = null;
    if (!visible) { v.mixer?.update(dt); this.flash.intensity = 0; return; }
    const x = p.px + (p.x - p.px) * alpha, y = p.py + (p.y - p.py) * alpha, f = p.facing;
    const ease = (cur: number | undefined, target: number, rate: number) => (cur === undefined ? target : cur + wrapAngle(target - cur) * Math.min(1, dt * rate));
    // Smoothed pose: turn toward facing in ~0.1 s, swing aim, ease in/out of lying down, recoil kick.
    const turn = v.toy ? 0.5 : 0.2;
    v.yaw = ease(v.yaw, f > 0 ? Math.PI / 2 - turn : -Math.PI / 2 + turn, 22);
    // Aim is smoothed as elevation relative to facing, so turning around mirrors the gun instead of
    // sweeping it overhead; on a firing frame it snaps so the bullet always leaves along the barrel.
    const elevTarget = p.prone ? 0 : Math.atan2(-p.aimY, Math.abs(p.aimX));
    v.elev = p.flash > 0 || v.elev === undefined ? elevTarget : v.elev + (elevTarget - v.elev) * Math.min(1, dt * 40);
    const aimAngle = f > 0 ? v.elev : Math.PI - v.elev;
    v.lie = (v.lie ?? 0) + ((p.prone ? 1 : 0) - (v.lie ?? 0)) * Math.min(1, dt * 16);
    v.kick = p.flash > 0 ? 1 : Math.max(0, (v.kick ?? 0) - dt * 14);
    v.root.position.set(X(x + p.w / 2) - Math.cos(aimAngle) * 0.05 * v.kick, Y(y + p.h), 0);
    v.root.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, v.yaw);

    if (title) { // title screen: stand alert, glance left, right and up
      if (v.toy) v.toy.pose({ run: false, air: false, prone: false, aim: 0, t, side: -1 });
      else { this.play(v, 'Idle'); v.mixer?.update(dt); }
      v.root.quaternion.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.PI / 2 - 0.7 + Math.sin(t * 0.5) * 0.35);
      if (v.head) {
        v.head.rotateY(Math.sin(t * 0.9) * 0.6);                       // look left / right
        v.head.rotateX(-Math.max(0, Math.sin(t * 0.37 + 1)) * 0.35);   // now and then, look up
      }
      this.flash.intensity = 0;
      return;
    }

    if (v.toy) {
      v.toy.pose({ run: p.onGround && p.vx !== 0, air: !p.onGround, prone: p.prone, aim: v.elev, t, side: f > 0 ? -1 : 1 });
      // Pitch the gun arm (about the screen's depth axis) until shoulder->muzzle points along the aim.
      const arm = v.toy.gunArm, tip = v.toy.muzzle, a = new THREE.Vector3(), m = new THREE.Vector3();
      for (let pass = 0; pass < 3; pass++) {
        v.root.updateMatrixWorld(true);
        arm.getWorldPosition(a); tip.getWorldPosition(m);
        const err = wrapAngle(aimAngle - Math.atan2(m.y - a.y, m.x - a.x));
        if (Math.abs(err) < 0.01) break;
        this.turnBone(arm, err);
      }
      v.root.updateMatrixWorld(true);
      tip.getWorldPosition(m);
      this.heroTip = { x: m.x * TILE, y: GROUND_ROW * TILE - m.y * TILE };
    } else {
      this.equip(v, GUN_MODEL[p.weapon] ?? 'AK');
      if (v.lie > 0.01) {
        // Lie flat on the belly, body stretched back from the feet (eased, not snapped).
        this.q2.setFromAxisAngle(Z_AXIS, -f * Math.PI * 0.47 * v.lie);
        v.root.quaternion.premultiply(this.q2);
        v.root.position.x -= f * 0.75 * v.lie; v.root.position.y += 0.18 * v.lie;
      } else if (!p.onGround) {
        this.q2.setFromAxisAngle(Z_AXIS, f * (p.vy < 0 ? 0.1 : -0.12)); // lean back rising, forward falling
        v.root.quaternion.premultiply(this.q2);
      }
      this.play(v, p.prone ? 'Idle_Shoot' : !p.onGround ? 'Jump_Idle' : p.vx !== 0 ? 'Run_Gun' : p.lastShot < 40 || p.aimY !== 0 ? 'Idle_Shoot' : 'Idle');
      if (v.clip === 'Run_Gun') v.actions.Run_Gun.timeScale = Math.abs(p.vx) / 150; // feet match ground speed
      v.mixer?.update(dt);
      this.alignGun(v, aimAngle + f * v.kick * 0.08, !p.prone, v.elev < -0.1 ? 0.2 : 0.45); // aiming down: back stays straight, arms lower the gun
      if (!p.prone) {
        this.gripLeftHand(v);                                   // support hand stays on the gun
        if (v.head) this.turnBone(v.head, f * v.elev * (v.elev > 0 ? 0.55 : 0.2)); // look where you aim (only a glance down)
        v.root.updateMatrixWorld(true);
      } // barrel follows the (smoothed) aim; prone keeps the body flat
      if (v.hand && v.barrel) {
        const tip = v.hand!.localToWorld(this.v2.copy(v.barrel.tip));
        this.heroTip = { x: tip.x * TILE, y: GROUND_ROW * TILE - tip.y * TILE };
      }
    }
    this.barrier.position.set(X(x + p.w / 2) - f * 0.4 * (v.lie ?? 0), Y(y + p.h) + 0.75 - 0.45 * (v.lie ?? 0), 0); // hugs the body, standing or prone
    this.tint(v, 0x66e0ff, p.barrier > 0 && (p.barrier > 120 || (p.barrier >> 2) % 2) ? 0.35 : 0);
    // Muzzle flash light at the real barrel tip.
    if (p.flash > 0) {
      const m = this.heroTip ?? w.muzzle();
      this.flash.position.set(X(m.x), Y(m.y), 0.6); this.flash.intensity = 30;
    } else this.flash.intensity = 0;
  }

  private viewFor(e: Enemy): View {
    let v = this.views.get(e.id);
    if (v) return v;
    const key: ModelKey = e.kind === 'soldier' ? 'robot' : e.kind === 'sniper' ? 'hazmat' : e.kind === 'drone' ? 'drone' : e.kind === 'boss' ? 'dragon' : e.kind === 'carrier' ? 'drone' : 'turret';
    v = this.acquire(key, e.kind === 'carrier' ? 'carrier' : key);
    if (e.kind === 'carrier') for (const m of v.mats) m.color.setHex(0xff4a3a); // red capsule carrier (own pool)
    this.views.set(e.id, v);
    return v;
  }

  private renderEnemies(dt: number, prev: Map<number, { x: number; y: number }>, alpha: number) {
    const w = World.get();
    for (const v of this.views.values()) v.seen = false;
    for (const e of w.enemies) {
      const v = this.viewFor(e);
      v.seen = true;
      const pp = prev.get(e.id) ?? e;
      const ex = pp.x + (e.x - pp.x) * alpha, ey = pp.y + (e.y - pp.y) * alpha;
      const fly = e.kind === 'drone' || e.kind === 'carrier';
      v.root.position.set(X(ex + e.w / 2), fly ? Y(ey + e.h) : Y(ey + e.h), e.kind === 'boss' ? -0.6 : 0);
      const face = e.dir > 0 ? Math.PI / 2 - 0.3 : -Math.PI / 2 + 0.3;
      v.root.rotation.set(0, face, 0);
      switch (e.kind) {
        case 'soldier': this.play(v, e.tell > 0 ? 'Shoot' : 'Run'); break;
        case 'sniper': this.play(v, e.tell > 0 || e.burst > 0 ? 'Idle_Shoot' : 'Idle'); break;
        case 'drone': case 'carrier': this.play(v, 'Fast_Flying'); if (e.kind === 'carrier') v.root.rotation.z = Math.sin(e.t * 0.2) * 0.3; break;
        case 'boss': {
          // Winged dragon: hovers and bobs; rears back to warn, lunges to breathe fire, swoops on the leap.
          const dying = w.bossDead > 0;
          this.play(v, dying ? 'Death' : e.state === 'jump' ? 'Fast_Flying' : e.state === 'fire' ? 'Punch' : e.state === 'tell' ? 'Headbutt' : 'Flying_Idle', dying);
          if (!dying) v.root.position.y += 0.6 + Math.sin(w.frame * 0.06) * 0.25;
          v.root.rotation.y = e.dir > 0 ? Math.PI / 2 - 0.55 : -Math.PI / 2 + 0.55; // three-quarter view: face + wings
          if (v.head) { v.root.updateMatrixWorld(true); const hp = v.head.getWorldPosition(this.v1); this.bossHead = { x: hp.x * TILE, y: GROUND_ROW * TILE - hp.y * TILE }; }
          break;
        }
        default: v.root.rotation.y = e.dir > 0 ? Math.PI / 2 : -Math.PI / 2; // turrets turn to face you
      }
      v.mixer?.update(dt);
      const telling = e.tell > 0 && (e.tell >> 2) % 2 === 0;
      if (e.flash > 0) this.tint(v, 0xffffff, 1.6);
      else if (telling) this.tint(v, 0xff3020, 1.2);
      else if (e.kind === 'boss' && w.bossShielded() && e.state !== 'intro') this.tint(v, 0x3ad7ff, 0.12 + 0.1 * Math.sin(w.frame * 0.2));
      else if (e.kind === 'boss' && e.hp < e.maxHp * 0.25 && (w.frame >> 3) % 2) this.tint(v, 0xff2020, 0.5);
      else if (e.kind === 'carrier') this.tint(v, 0xff2010, 0.4);
      else this.tint(v, 0, 0);
    }
    // Pickups and corpses reuse views keyed by their ids.
    for (const k of w.pickups) {
      let v = this.views.get(k.id);
      if (!v) {
        const spr = new THREE.Sprite(this.pickupMaterial(k.letter)); spr.scale.set(0.9, 0.9, 1);
        v = { root: spr, actions: {}, clip: '', mats: [], seen: true }; this.scene.add(spr); this.views.set(k.id, v);
      }
      v.seen = true;
      v.root.position.set(X(k.x + k.w / 2), Y(k.y + k.h / 2), 0.4);
    }
    for (const c of w.corpses) {
      let v = this.views.get(c.id);
      if (!v) { v = c.frame.startsWith('hero') || c.frame.startsWith('muse') ? this.makeHeroView() : this.acquire('robot'); this.play(v, 'Death', true); this.views.set(c.id, v); }
      v.seen = true;
      v.root.position.set(X(c.x - (c.vx * (1 - alpha)) / 60), Y(c.y - (c.vy * (1 - alpha)) / 60), 0);
      v.root.rotation.set(0, c.flip ? -Math.PI / 2 : Math.PI / 2, v.toy ? c.t * 0.25 : 0); // toys tumble
      v.mixer?.update(dt);
      this.tint(v, 0xffffff, (c.t >> 2) % 2 ? 1.2 : 0);
    }
    for (const [id, v] of this.views) if (!v.seen) { if (v.pool) this.release(v); else this.scene.remove(v.root); this.views.delete(id); }
  }

  private pickupMaterial(letter: string) {
    let m = this.pickupMat.get(letter);
    if (m) return m;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!;
    g.fillStyle = '#1a0a0a'; g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ff3b3b'; g.beginPath(); g.arc(32, 32, 26, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = 'bold 36px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(letter, 32, 34);
    m = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), toneMapped: false });
    m.color.setScalar(1.6);
    this.pickupMat.set(letter, m);
    return m;
  }

  private renderFx(alpha: number) {
    const w = World.get(), back = (1 - alpha) / 60; // step back along velocity to the interpolated moment
    let i = 0, j = 0;
    for (const b of w.bullets) {
      const mesh = b.enemy ? this.ebullets : this.bullets;
      const k = b.enemy ? j++ : i++;
      if (k >= 256) continue;
      let ox = 0, oy = 0;
      if (b.enemy && b.w >= 9) { // boss fireballs (9px): draw them leaving the dragon's mouth
        let o = this.bulletFrom.get(b);
        if (!o) { o = this.bossHead && b.life > 294 ? { dx: this.bossHead.x - (b.x + b.w / 2), dy: this.bossHead.y - (b.y + b.h / 2) } : { dx: 0, dy: 0 }; this.bulletFrom.set(b, o); }
        const fade = Math.max(0, 1 - (300 - b.life + alpha) / 10);
        ox = o.dx * fade; oy = o.dy * fade;
      }
      if (!b.enemy) {
        let o = this.bulletFrom.get(b);
        if (!o) { o = this.heroTip && b.life > 86 ? { dx: this.heroTip.x - (b.x + b.w / 2), dy: this.heroTip.y - (b.y + b.h / 2) } : { dx: 0, dy: 0 }; this.bulletFrom.set(b, o); }
        const fade = Math.max(0, 1 - (90 - b.life + alpha) / 8);
        ox = o.dx * fade; oy = o.dy * fade;
      }
      this.tmp.position.set(X(b.x + b.w / 2 - b.vx * back + ox), Y(b.y + b.h / 2 - b.vy * back + oy), 0.3);
      this.tmp.rotation.set(0, 0, Math.atan2(-b.vy, b.vx) - Math.PI / 2);
      this.tmp.scale.setScalar(b.enemy ? (b.w >= 9 ? 2.2 : 1) : b.weapon === 'P' ? 2 : b.weapon === 'F' ? 1.5 : 1);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(k, this.tmp.matrix);
    }
    this.bullets.count = Math.min(i, 256); this.ebullets.count = Math.min(j, 256);
    this.bullets.instanceMatrix.needsUpdate = this.ebullets.instanceMatrix.needsUpdate = true;
    this.tmp.rotation.set(0, 0, 0);
    let n = 0;
    for (const q of w.particles) {
      if (n >= 1024) break;
      const life = Math.min(1, q.life / (q.max * 0.5));
      this.tmp.position.set(X(q.x - q.vx * back), Y(q.y - q.vy * back), 0.5);
      this.tmp.scale.setScalar(X(q.size) * 1.6 * life);
      this.tmp.updateMatrix();
      this.particles.setMatrixAt(n, this.tmp.matrix);
      this.col.setHex(q.color).multiplyScalar(q.color === 0x444444 ? 1 : 2.2); // hot sparks bloom, smoke doesn't
      this.particles.setColorAt(n++, this.col);
    }
    this.particles.count = n;
    let bi = 0, strongest = 0;
    for (const b of w.blasts) {
      if (bi >= 64) break;
      const k = (b.t + alpha) / b.max;
      this.tmp.position.set(X(b.x), Y(b.y), 0.4);
      this.tmp.scale.setScalar(X(b.r) * (0.4 + k * 1.4) * (1 - k * k));
      this.tmp.updateMatrix();
      this.blastMesh.setMatrixAt(bi++, this.tmp.matrix);
      const power = (1 - k) * b.r;
      if (power > strongest) { strongest = power; this.blastLight.position.set(X(b.x), Y(b.y), 1.5); }
    }
    this.blastMesh.count = bi;
    this.blastMesh.instanceMatrix.needsUpdate = true;
    this.blastLight.intensity = Math.min(120, strongest * 2.5);
    this.particles.instanceMatrix.needsUpdate = true;
    if (this.particles.instanceColor) this.particles.instanceColor.needsUpdate = true;
  }
}

function mulberry(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
