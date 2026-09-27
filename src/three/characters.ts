import * as THREE from 'three';

// Playable characters for the 2.5D renderer.
// 'model' = a rigged Quaternius model, optionally recoloured by material name.
// 'toy'   = built from primitives here, animated procedurally (chibi proportions suit this).
export type CharDef =
  | { name: string; kind: 'model'; model: 'soldier' | 'hazmat'; recolor?: Record<string, number> }
  | { name: string; kind: 'toy'; toy: 'shin' | 'muse' };

const suit = (name: string, color: number): CharDef => ({ name, kind: 'model', model: 'hazmat', recolor: { Hazmat_Main: color } });

export const CHARACTERS: CharDef[] = [
  { name: 'COMMANDO', kind: 'model', model: 'soldier' },
  suit('RED SUIT', 0xd01818),
  suit('BLUE SUIT', 0x1f55e0),
  suit('YELLOW SUIT', 0xf2c20c),
  suit('PINK SUIT', 0xf05aa8),
  suit('GREEN SUIT', 0x1faa3a),
  { name: 'KIDDO', kind: 'toy', toy: 'shin' },
  { name: 'PLUSH', kind: 'toy', toy: 'muse' },
];

export type ToyPose = { run: boolean; air: boolean; prone: boolean; aim: number; t: number; side: number }; // side: which side the gun hand sits (camera side)
// gunArm pivots at the shoulder; muzzle marks the blaster tip (the renderer aims the arm so muzzle points along the aim).
export type Toy = { root: THREE.Group; mats: THREE.MeshStandardMaterial[]; pose: (p: ToyPose) => void; gunArm: THREE.Object3D; muzzle: THREE.Object3D };

const mat = (color: number, rough = 0.75) => new THREE.MeshStandardMaterial({ color, roughness: rough });

function faceTexture(draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Toys face +Z like the Quaternius models; height ~1.3 units, feet at y = 0.
export function buildToy(kind: 'shin' | 'muse'): Toy {
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const mats: THREE.MeshStandardMaterial[] = [];
  const add = (geo: THREE.BufferGeometry, m: THREE.MeshStandardMaterial, x: number, y: number, z: number, parent: THREE.Object3D = body) => {
    const mesh = new THREE.Mesh(geo, m); mesh.position.set(x, y, z); mesh.castShadow = true; parent.add(mesh); mats.push(m); return mesh;
  };
  const limb = (x: number, y: number) => { const g = new THREE.Group(); g.position.set(x, y, 0); body.add(g); return g; };
  const legL = limb(-0.12, 0.3), legR = limb(0.12, 0.3), armL = limb(-0.34, 0.66), armR = limb(0.34, 0.66);
  const gun = new THREE.Group(); armR.add(gun);
  const muzzle = new THREE.Object3D(); gun.add(muzzle);

  if (kind === 'muse') {
    // Plush: cream capsule with a hood-framed face, mitten arms, stumpy legs.
    const fur = mat(0xefe2c8, 0.95), shade = mat(0xd9c7a6, 0.95);
    add(new THREE.CapsuleGeometry(0.4, 0.42, 6, 16), fur, 0, 0.78, 0);
    const face = new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), new THREE.MeshStandardMaterial({
      roughness: 0.9, map: faceTexture((g) => {
        g.fillStyle = '#f8efe0'; g.fillRect(0, 0, 128, 128);
        g.fillStyle = '#1a1416'; g.beginPath(); g.arc(44, 58, 7, 0, 7); g.arc(84, 58, 7, 0, 7); g.fill();
        g.fillStyle = '#f39fa0'; g.beginPath(); g.ellipse(30, 78, 10, 6, 0, 0, 7); g.ellipse(98, 78, 10, 6, 0, 0, 7); g.fill();
        g.strokeStyle = '#1a1416'; g.lineWidth = 4; g.beginPath(); g.arc(64, 72, 9, 0.2, Math.PI - 0.2); g.stroke();
      }),
    }));
    face.position.set(0, 0.95, 0.395); body.add(face);
    add(new THREE.TorusGeometry(0.27, 0.035, 8, 24), shade, 0, 0.95, 0.38); // hood rim
    add(new THREE.CapsuleGeometry(0.1, 0.12, 4, 8), shade, 0, -0.18, 0, legL);
    add(new THREE.CapsuleGeometry(0.1, 0.12, 4, 8), shade, 0, -0.18, 0, legR);
    add(new THREE.SphereGeometry(0.11, 10, 8), fur, 0, -0.12, 0, armL);
    add(new THREE.SphereGeometry(0.11, 10, 8), fur, 0, -0.12, 0.05, armR);
    add(new THREE.BoxGeometry(0.11, 0.44, 0.12), mat(0x3f78e8, 0.4), 0, -0.3, 0.02, gun); // blue blaster, along the arm
    muzzle.position.set(0, -0.52, 0.02);
  } else {
    // Kiddo: big head, black hair, thick brows, red shirt, yellow shorts.
    const skin = mat(0xf6c9a0), shirt = mat(0xd8231c), shorts = mat(0xf2c418), black = mat(0x141414, 0.5), white = mat(0xf4f4f4);
    add(new THREE.SphereGeometry(0.36, 20, 16), skin, 0, 1.02, 0).scale.set(1.05, 0.95, 1);
    const hair = add(new THREE.SphereGeometry(0.37, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), black, 0, 1.05, -0.03);
    hair.rotation.x = -0.35;
    for (const x of [-0.13, 0.13]) {
      add(new THREE.BoxGeometry(0.15, 0.06, 0.05), black, x, 1.14, 0.32).rotation.z = x < 0 ? 0.12 : -0.12; // thick brows
      add(new THREE.SphereGeometry(0.04, 8, 6), black, x * 0.9, 1.04, 0.33);                                  // eyes
      add(new THREE.SphereGeometry(0.05, 8, 6), mat(0xf29a8a), x * 1.5, 0.93, 0.28);                           // cheeks
    }
    add(new THREE.BoxGeometry(0.1, 0.025, 0.03), mat(0x8a2a2a), 0, 0.88, 0.34);                               // mouth
    add(new THREE.CylinderGeometry(0.2, 0.24, 0.34, 14), shirt, 0, 0.56, 0);
    add(new THREE.CylinderGeometry(0.245, 0.24, 0.14, 14), shorts, 0, 0.36, 0);
    for (const leg of [legL, legR]) {
      add(new THREE.CapsuleGeometry(0.065, 0.14, 4, 8), skin, 0, -0.13, 0, leg);
      add(new THREE.BoxGeometry(0.13, 0.08, 0.2), white, 0, -0.28, 0.03, leg);
    }
    for (const arm of [armL, armR]) {
      add(new THREE.CapsuleGeometry(0.065, 0.12, 4, 8), shirt, 0, -0.06, 0, arm);
      add(new THREE.SphereGeometry(0.06, 8, 6), skin, 0, -0.18, 0, arm);
    }
    armL.position.y = armR.position.y = 0.66;
    add(new THREE.BoxGeometry(0.09, 0.38, 0.1), mat(0x30c050, 0.4), 0, -0.3, 0.02, gun); // toy water-blaster, along the arm
    muzzle.position.set(0, -0.49, 0.02);
  }

  const pose = ({ run, air, prone, aim, t, side }: ToyPose) => {
    armR.position.x = 0.34 * side; armL.position.x = -0.34 * side; // gun hand on the camera side
    const swing = run ? Math.sin(t * 14) * 0.8 : 0;
    legL.rotation.x = air ? -0.9 : swing;
    legR.rotation.x = air ? -0.5 : -swing;
    armL.rotation.x = -swing * 0.6;
    armR.rotation.set(-Math.PI / 2, 0, 0); // gun arm forward; the renderer then pitches it onto the exact aim
    void aim;
    body.position.y = run ? Math.abs(Math.sin(t * 14)) * 0.06 : Math.sin(t * 2.5) * 0.01;
    // Prone for a plush: squash low and lean in, face still visible (a face-plant hides the character).
    body.scale.set(1, prone ? 0.55 : 1, 1);
    body.rotation.x = prone ? 0.35 : 0;
    if (prone) { legL.rotation.x = legR.rotation.x = -1.2; }
  };
  return { root, mats, pose, gunArm: armR, muzzle };
}
