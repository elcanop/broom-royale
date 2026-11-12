import * as THREE from 'three';
import { HOUSES, LOOT, PLAYER, SPELLS, type LootType, type SpellId } from '../../../shared/config';

// ---------------------------------------------------------------------------
// Procedural Canvas Textures (shared across all 20 wizards for 0 FPS cost)
// ---------------------------------------------------------------------------

const createFabricTexture = (): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#c8c8cc';
  ctx.fillRect(0, 0, 128, 128);
  // Diagonal wool/velvet twill weave
  for (let y = 0; y < 128; y += 2) {
    for (let x = 0; x < 128; x += 2) {
      const n = ((x + y) % 8 < 4 ? 14 : -14) + Math.sin(x * 0.4) * 6;
      const v = Math.max(150, Math.min(230, 195 + n));
      ctx.fillStyle = `rgb(${v},${v},${v + 4})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
};

const createFaceTexture = (skinHex: string, irisHex: string): THREE.CanvasTexture => {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;

  // Base warm skin gradient
  ctx.fillStyle = skinHex;
  ctx.fillRect(0, 0, 256, 256);

  // Soft cheek & nose shading
  const shade = ctx.createRadialGradient(128, 134, 14, 128, 128, 110);
  shade.addColorStop(0, 'rgba(255, 224, 200, 0.25)');
  shade.addColorStop(0.6, 'rgba(180, 110, 80, 0.12)');
  shade.addColorStop(1, 'rgba(70, 35, 25, 0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, 256, 256);

  // Expressive eyebrows
  ctx.strokeStyle = '#241812';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(76, 108);
  ctx.quadraticCurveTo(96, 98, 114, 108);
  ctx.moveTo(180, 108);
  ctx.quadraticCurveTo(160, 98, 142, 108);
  ctx.stroke();

  // Sclera & Luminous Arcanist Iris (oriented on front -Z UV center u=0.5, v=0.5)
  for (const ex of [96, 160]) {
    ctx.fillStyle = '#f5f2eb';
    ctx.beginPath();
    ctx.ellipse(ex, 124, 13, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = irisHex;
    ctx.beginPath();
    ctx.arc(ex, 124, 6.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#0c0d14';
    ctx.beginPath();
    ctx.arc(ex, 124, 3.1, 0, Math.PI * 2);
    ctx.fill();

    // Specular catchlight
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ex - 2, 121.5, 1.8, 0, Math.PI * 2);
    ctx.fill();
  }

  // Subtle nose bridge & resolute mouth
  ctx.strokeStyle = 'rgba(110, 62, 46, 0.55)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(128, 124);
  ctx.lineTo(125, 147);
  ctx.lineTo(132, 149);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(128, 58, 52, 0.72)';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(114, 169);
  ctx.quadraticCurveTo(128, 173, 142, 169);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

const fabricTex = createFabricTexture();

const goldMat = new THREE.MeshStandardMaterial({
  color: 0xf0c250,
  roughness: 0.22,
  metalness: 0.9,
});

const silverMat = new THREE.MeshStandardMaterial({
  color: 0xd0d8e2,
  roughness: 0.28,
  metalness: 0.85,
});

const woodMat = new THREE.MeshPhysicalMaterial({
  color: 0x4d2711,
  roughness: 0.24,
  metalness: 0.08,
  clearcoat: 0.96,
  clearcoatRoughness: 0.1,
});

const leatherMat = new THREE.MeshStandardMaterial({
  color: 0x2c1910,
  roughness: 0.58,
  metalness: 0.06,
});

const saddleLeatherMat = new THREE.MeshStandardMaterial({
  color: 0x4a2414,
  roughness: 0.5,
  metalness: 0.05,
});

const twigMat = new THREE.MeshStandardMaterial({
  color: 0x331d0e,
  roughness: 0.86,
  metalness: 0.02,
});

const twigHighlightMat = new THREE.MeshStandardMaterial({
  color: 0x4a2c17,
  roughness: 0.82,
  metalness: 0.02,
});

const darkClothMat = new THREE.MeshStandardMaterial({
  color: 0x16161d,
  map: fabricTex,
  roughness: 0.82,
  metalness: 0.05,
});

const hairColors = [0x1c1411, 0x4d2a16, 0x8c5a2b, 0xc8a464, 0x8b281c, 0xd8dce4];
const skinHexes = ['#e2b99b', '#d4a382', '#c28a66', '#8d5b42', '#ecc7ae'];

const createLimb = (
  rTop: number,
  rBot: number,
  len: number,
  mat: THREE.Material,
  segs = 10,
): THREE.Mesh => {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, len, segs), mat);
  m.castShadow = true;
  return m;
};

// ---------------------------------------------------------------------------
// Racing Broomstick (Nimbus / Firebolt Aesthetic)
// ---------------------------------------------------------------------------

/** Build an ornate racing broomstick mesh (oriented along -Z forward). */
export const buildBroomMesh = (
  accentColor = 0xf0c250,
): { group: THREE.Group; boostCore: THREE.Mesh; tail: THREE.Group } => {
  const group = new THREE.Group();
  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.28,
    metalness: 0.82,
  });

  // Sculpted S-curve mahogany shaft from z = -1.85 (prow) to z = +0.92 (tail ferrule)
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0.14, -1.85),
    new THREE.Vector3(0, 0.08, -1.05),
    new THREE.Vector3(0, -0.05, -0.15),
    new THREE.Vector3(0, -0.03, 0.88),
  ]);
  const shaftGeo = new THREE.TubeGeometry(curve, 24, 0.052, 12, false);
  const shaft = new THREE.Mesh(shaftGeo, woodMat);
  shaft.castShadow = true;
  group.add(shaft);

  // Carved golden prow tip & enchanted aero-crest on nose
  const prowCone = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.24, 12), goldMat);
  prowCone.rotation.x = -Math.PI / 2;
  prowCone.position.set(0, 0.145, -1.94);
  group.add(prowCone);

  const prowGem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.038, 0),
    new THREE.MeshBasicMaterial({ color: accentColor }),
  );
  prowGem.position.set(0, 0.19, -1.72);
  group.add(prowGem);

  // Quilted leather racing saddle
  const saddle = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.42, 6, 12), saddleLeatherMat);
  saddle.rotation.x = Math.PI / 2;
  saddle.scale.set(1.15, 0.72, 1.0);
  saddle.position.set(0, 0.01, -0.02);
  saddle.castShadow = true;
  group.add(saddle);

  // Brass ferrule bands & inlaid runes along shaft
  for (const [z, y, r] of [
    [-1.45, 0.11, 0.058],
    [-0.75, 0.04, 0.062],
    [0.52, -0.04, 0.064],
    [0.86, -0.03, 0.072],
    [0.98, -0.03, 0.095],
  ]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.015, 8, 18), goldMat);
    ring.position.set(0, y, z);
    group.add(ring);
  }

  // Dual articulated brass stirrup struts & footrest pedals
  for (const side of [-1, 1]) {
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.44, 8), goldMat);
    strut.position.set(side * 0.14, -0.21, 0.08);
    strut.rotation.z = side * 0.42;
    group.add(strut);

    const pedal = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.024, 0.16), accentMat);
    pedal.position.set(side * 0.24, -0.4, 0.08);
    group.add(pedal);
  }

  // Layered aerodynamic willow-twig racing tail
  const tail = new THREE.Group();
  tail.position.set(0, -0.03, 0.9);

  // Tapered teardrop lathe tail profile for realistic bundled birch/willow twigs
  const tailPts = [
    new THREE.Vector2(0.06, 0.0),
    new THREE.Vector2(0.24, 0.25),
    new THREE.Vector2(0.27, 0.55),
    new THREE.Vector2(0.18, 0.98),
    new THREE.Vector2(0.04, 1.28),
  ];
  const tailLathe = new THREE.LatheGeometry(tailPts, 16);
  tailLathe.rotateX(Math.PI / 2);
  const tailBody = new THREE.Mesh(tailLathe, twigMat);
  tailBody.castShadow = true;
  tail.add(tailBody);

  // Outer sculpted twig strakes for crisp silhouette ridges
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const sprig = new THREE.Mesh(new THREE.ConeGeometry(0.065, 1.15, 6), i % 2 === 0 ? twigHighlightMat : twigMat);
    sprig.rotation.x = Math.PI / 2 + Math.sin(a) * 0.11;
    sprig.rotation.y = Math.cos(a) * 0.11;
    sprig.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, 0.62);
    tail.add(sprig);
  }

  // Arcane plasma thruster plume inside broom tail when boosting
  const boostMat = new THREE.MeshBasicMaterial({
    color: 0xff8c2b,
    transparent: true,
    opacity: 0.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const boostCore = new THREE.Mesh(new THREE.ConeGeometry(0.24, 1.65, 14), boostMat);
  boostCore.rotation.x = Math.PI / 2;
  boostCore.position.z = 1.38;
  tail.add(boostCore);

  group.add(tail);
  return { group, boostCore, tail };
};

// ---------------------------------------------------------------------------
// Carved Magic Wand
// ---------------------------------------------------------------------------

/** Build an ornate 3D magic wand with a glowing spell crystal at the tip (-Z forward). */
export const buildWandMesh = (): { group: THREE.Group; tipCrystal: THREE.Mesh; tipLight: THREE.PointLight } => {
  const group = new THREE.Group();
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 10), goldMat);
  pommel.position.z = 0.035;
  group.add(pommel);

  const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.025, 0.16, 10), goldMat);
  handle.rotation.x = Math.PI / 2;
  handle.position.z = -0.05;
  group.add(handle);

  const guardRing = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.006, 8, 14), silverMat);
  guardRing.position.z = -0.13;
  group.add(guardRing);

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.016, 0.36, 10), woodMat);
  shaft.rotation.x = Math.PI / 2;
  shaft.position.z = -0.31;
  group.add(shaft);

  const tipMat = new THREE.MeshBasicMaterial({ color: SPELLS.fire.color });
  const tipCrystal = new THREE.Mesh(new THREE.OctahedronGeometry(0.032, 1), tipMat);
  tipCrystal.position.set(0, 0, -0.5);
  group.add(tipCrystal);

  const tipLight = new THREE.PointLight(SPELLS.fire.color, 1.5, 4.5);
  tipLight.position.copy(tipCrystal.position);
  group.add(tipLight);

  return { group, tipCrystal, tipLight };
};

// ---------------------------------------------------------------------------
// Nameplate
// ---------------------------------------------------------------------------

/** Create a floating canvas nameplate + HP bar sprite for remote wizards/bots. */
const createNameplate = (name: string, houseIdx: number): { sprite: THREE.Sprite; updateHp(hp: number): void } => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(3.6, 0.9, 1);
  sprite.position.set(0, 1.95, 0);

  const house = HOUSES[houseIdx % HOUSES.length] ?? HOUSES[0];
  const hex = '#' + house.color.toString(16).padStart(6, '0');
  let lastHp = -1;

  const updateHp = (hp: number): void => {
    if (hp === lastHp) return;
    lastHp = hp;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(10, 10, 18, 0.78)';
    ctx.beginPath();
    ctx.roundRect(14, 6, 228, 50, 10);
    ctx.fill();

    ctx.strokeStyle = 'rgba(245, 205, 121, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.font = 'bold 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f8f3e6';
    ctx.fillText(name.slice(0, 18), 132, 28);

    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(32, 37, 192, 9);

    const pct = Math.max(0, Math.min(1, hp / PLAYER.maxHp));
    ctx.fillStyle = pct > 0.45 ? '#3fe075' : pct > 0.22 ? '#ffb838' : '#ff3d4d';
    ctx.fillRect(32, 37, 192 * pct, 9);

    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(28, 21, 7, 0, Math.PI * 2);
    ctx.fill();

    tex.needsUpdate = true;
  };
  updateHp(PLAYER.maxHp);
  return { sprite, updateHp };
};

// ---------------------------------------------------------------------------
// Anatomically Sculpted & Animated Wizard Character
// ---------------------------------------------------------------------------

export class WizardAvatar {
  readonly root = new THREE.Group();
  readonly bodyGroup = new THREE.Group();

  private riderGroup = new THREE.Group();
  private headGroup = new THREE.Group();
  private wandArm = new THREE.Group();
  private wandCrystal: THREE.Mesh;

  private capeMesh: THREE.Mesh;
  private capeGeo: THREE.PlaneGeometry;
  private capeBaseZ: Float32Array;
  private capeBaseY: Float32Array;
  private scarfLeft: THREE.Mesh;
  private scarfRight: THREE.Mesh;

  private boostCore: THREE.Mesh;
  private tail: THREE.Group;
  private shieldMesh: THREE.Mesh;
  private overchargeRing: THREE.Mesh;

  private trailPoints: THREE.Vector3[] = [];
  private trailGeo = new THREE.BufferGeometry();
  private trailLine: THREE.Line;
  private nameplate: { sprite: THREE.Sprite; updateHp(hp: number): void };
  private castAnim = 0;

  constructor(
    readonly id: number,
    readonly name: string,
    readonly houseIdx: number,
    readonly isLocal: boolean,
  ) {
    const house = HOUSES[houseIdx % HOUSES.length] ?? HOUSES[0];
    const houseMat = new THREE.MeshStandardMaterial({
      color: house.color,
      map: fabricTex,
      roughness: 0.65,
      metalness: 0.12,
    });
    const accentTrimMat = new THREE.MeshStandardMaterial({
      color: house.accent,
      roughness: 0.35,
      metalness: 0.62,
    });
    const innerLiningMat = new THREE.MeshStandardMaterial({
      color: house.accent,
      roughness: 0.72,
      metalness: 0.15,
      side: THREE.DoubleSide,
    });
    const cloakMat = new THREE.MeshStandardMaterial({
      color: house.color,
      map: fabricTex,
      roughness: 0.7,
      metalness: 0.1,
      side: THREE.DoubleSide,
    });

    // 1. Racing Broomstick
    const broom = buildBroomMesh(house.accent);
    this.boostCore = broom.boostCore;
    this.tail = broom.tail;
    this.bodyGroup.add(broom.group);

    // 2. Sculpted Wizard Rider perched ergonomically on the saddle
    const rider = this.riderGroup;
    rider.position.set(0, 0.04, -0.02);

    // --- Pelvic seat, articulated legs, knees, & leather riding boots ---
    const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 10), darkClothMat);
    pelvis.scale.set(1.1, 0.8, 1.0);
    pelvis.position.set(0, 0.08, 0.06);
    rider.add(pelvis);

    for (const side of [-1, 1]) {
      const legHip = new THREE.Group();
      legHip.position.set(side * 0.13, 0.08, 0.05);
      // Angled straddling thigh
      const thigh = createLimb(0.078, 0.064, 0.36, darkClothMat);
      thigh.position.set(side * 0.05, -0.14, -0.05);
      thigh.rotation.x = -0.45;
      thigh.rotation.z = side * 0.32;
      legHip.add(thigh);

      // Knee joint
      const knee = new THREE.Mesh(new THREE.SphereGeometry(0.064, 8, 8), darkClothMat);
      knee.position.set(side * 0.1, -0.28, -0.14);
      legHip.add(knee);

      // Lower shin tucked back toward stirrup pedal
      const shin = createLimb(0.06, 0.048, 0.32, darkClothMat);
      shin.position.set(side * 0.11, -0.42, -0.02);
      shin.rotation.x = 0.65;
      legHip.add(shin);

      // Cuffed Leather Riding Boot + Brass Buckle
      const bootCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.056, 0.11, 10), leatherMat);
      bootCuff.position.set(side * 0.11, -0.46, 0.04);
      bootCuff.rotation.x = 0.45;
      legHip.add(bootCuff);

      const bootFoot = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.14, 6, 8), leatherMat);
      bootFoot.rotation.x = Math.PI / 2 - 0.1;
      bootFoot.position.set(side * 0.11, -0.52, 0.03);
      legHip.add(bootFoot);

      const buckle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, 0.04), goldMat);
      buckle.position.set(side * 0.145, -0.48, 0.06);
      legHip.add(buckle);

      rider.add(legHip);
    }

    // --- Tailored Upper Body, Tunic Flaps, Chest Vest, & Belted Waist ---
    const torsoGroup = new THREE.Group();
    torsoGroup.position.set(0, 0.12, 0.03);
    torsoGroup.rotation.x = -0.42; // Aerodynamic forward racing lean

    // Lower robe tails draping behind saddle
    const coatTail = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.3, 0.46, 12, 1, true, Math.PI * 0.18, Math.PI * 1.64),
      darkClothMat,
    );
    coatTail.material = darkClothMat.clone();
    coatTail.material.side = THREE.DoubleSide;
    coatTail.position.set(0, -0.08, 0.06);
    coatTail.rotation.x = 0.28;
    torsoGroup.add(coatTail);

    // Sculpted Chest & Waist Tunic (Hourglass heroic silhouette)
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.165, 0.56, 14), houseMat);
    chest.position.set(0, 0.32, 0);
    chest.scale.set(1.12, 1.0, 0.82);
    chest.castShadow = true;
    torsoGroup.add(chest);

    // Inner quilted dark vest lapel in front
    const vestFront = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.155, 0.5, 10, 1, false, -0.55, 1.1), darkClothMat);
    vestFront.position.set(0, 0.31, -0.025);
    vestFront.rotation.y = Math.PI; // Faces -Z
    torsoGroup.add(vestFront);

    // Leather utility belt + gold house buckle + side potion flask
    const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.178, 0.185, 0.09, 14), leatherMat);
    belt.position.set(0, 0.09, 0);
    belt.scale.set(1.12, 1, 0.85);
    torsoGroup.add(belt);

    const beltBuckle = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.075, 0.035), goldMat);
    beltBuckle.position.set(0, 0.09, -0.155);
    torsoGroup.add(beltBuckle);

    const pouch = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.11, 0.07), saddleLeatherMat);
    pouch.position.set(-0.21, 0.06, 0.02);
    torsoGroup.add(pouch);

    const chestCrest = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), accentTrimMat);
    chestCrest.scale.set(1, 1.35, 0.45);
    chestCrest.position.set(-0.1, 0.42, -0.175);
    torsoGroup.add(chestCrest);

    // Broad sculpted shoulder pauldrons / mage mantle with gold trim
    const shoulderMantle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.17, 0.32, 0.16, 14),
      houseMat,
    );
    shoulderMantle.position.set(0, 0.56, 0);
    shoulderMantle.scale.set(1.18, 1, 0.78);
    torsoGroup.add(shoulderMantle);

    for (const side of [-1, 1]) {
      const pauldron = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), accentTrimMat);
      pauldron.scale.set(1.0, 0.75, 1.1);
      pauldron.position.set(side * 0.26, 0.55, 0);
      torsoGroup.add(pauldron);
    }

    // Tall Aristocratic High Collar
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.19, 0.15, 0.18, 12, 1, true, -Math.PI * 0.7, Math.PI * 1.4),
      innerLiningMat,
    );
    collar.position.set(0, 0.64, 0.01);
    torsoGroup.add(collar);

    // Academy Striped Scarf Collar & Twin Streaming Tails
    const scarfCollar = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.055, 10, 18), houseMat);
    scarfCollar.rotation.x = Math.PI / 2;
    scarfCollar.position.set(0, 0.62, -0.01);
    torsoGroup.add(scarfCollar);

    const scarfBand = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 18), accentTrimMat);
    scarfBand.rotation.x = Math.PI / 2;
    scarfBand.position.set(0, 0.635, -0.02);
    torsoGroup.add(scarfBand);

    const scarfTailGeo = new THREE.BoxGeometry(0.11, 0.025, 0.68);
    scarfTailGeo.translate(0, 0, 0.34);
    this.scarfLeft = new THREE.Mesh(scarfTailGeo, houseMat);
    this.scarfLeft.position.set(-0.12, 0.61, 0.08);
    torsoGroup.add(this.scarfLeft);

    this.scarfRight = new THREE.Mesh(scarfTailGeo, accentTrimMat);
    this.scarfRight.position.set(-0.07, 0.58, 0.1);
    torsoGroup.add(this.scarfRight);

    // --- Sculpted Head, Face Texture, Hair, Flight Goggles & Iconic Wizard Hat/Hood ---
    const head = this.headGroup;
    head.position.set(0, 0.73, -0.02);
    head.rotation.x = 0.34; // Tilts head back up to look straight ahead!

    const skinColor = skinHexes[id % skinHexes.length];
    const irisColor = '#' + (SPELLS.ice.color).toString(16).padStart(6, '0');
    const faceTex = createFaceTexture(skinColor, id % 3 === 0 ? '#ffb83b' : irisColor);
    const faceMat = new THREE.MeshStandardMaterial({
      map: faceTex,
      roughness: 0.58,
      metalness: 0.04,
    });

    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.145, 16, 14), faceMat);
    skull.scale.set(0.92, 1.08, 0.98);
    skull.rotation.y = Math.PI; // Put UV seam at back so face centers directly on -Z
    skull.castShadow = true;
    head.add(skull);

    // Sculpted hair cap & swept hair locks framing face
    const hairMat = new THREE.MeshStandardMaterial({
      color: hairColors[id % hairColors.length],
      roughness: 0.72,
    });
    const hairCrown = new THREE.Mesh(
      new THREE.SphereGeometry(0.152, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
      hairMat,
    );
    hairCrown.position.set(0, 0.02, 0.02);
    hairCrown.rotation.x = -0.25;
    head.add(hairCrown);

    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.14, 6), hairMat);
      lock.position.set(side * 0.125, -0.02, -0.04);
      lock.rotation.x = 0.35;
      lock.rotation.z = side * -0.18;
      head.add(lock);
    }

    // Brass Aerial Aviator Flight Goggles on brow
    const goggles = new THREE.Group();
    goggles.position.set(0, 0.075, -0.115);
    goggles.rotation.x = -0.25;
    const goggleGlassMat = new THREE.MeshPhysicalMaterial({
      color: house.accent,
      emissive: house.accent,
      emissiveIntensity: 0.25,
      roughness: 0.08,
      metalness: 0.4,
      clearcoat: 1.0,
    });
    for (const side of [-1, 1]) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.008, 8, 16), goldMat);
      rim.position.set(side * 0.046, 0, 0);
      goggles.add(rim);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 14), goggleGlassMat);
      lens.position.set(side * 0.046, 0, -0.003);
      lens.rotation.y = Math.PI;
      goggles.add(lens);
    }
    const strap = new THREE.Mesh(new THREE.CylinderGeometry(0.148, 0.148, 0.028, 16, 1, true), leatherMat);
    strap.position.set(0, -0.01, 0.115);
    goggles.add(strap);
    head.add(goggles);

    // Classic Archetype Headgear: Curved Pointed Wizard Hat with Wide Brim & Gold Band
    // (Alternates subtle folded Hat vs Battlemage Hooded Brim by wizard ID for rich variety!)
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, 0.11, 0.01);
    hatGroup.rotation.x = -0.22; // Swept dynamically back by wind!

    if (id % 2 === 0 || isLocal) {
      // Wide-brimmed Wizard Battle Hat
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.34, 0.018, 20), houseMat);
      brim.castShadow = true;
      hatGroup.add(brim);

      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.175, 0.05, 16), accentTrimMat);
      band.position.y = 0.03;
      hatGroup.add(band);

      // Swept, organically bent wizard hat crown
      const hatCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.02, 0),
        new THREE.Vector3(0, 0.18, 0.03),
        new THREE.Vector3(0.02, 0.34, 0.11),
        new THREE.Vector3(0.04, 0.45, 0.24),
      ]);
      const crownPts = hatCurve.getPoints(12);
      for (let i = 0; i < crownPts.length - 1; i++) {
        const t0 = i / (crownPts.length - 1);
        const t1 = (i + 1) / (crownPts.length - 1);
        const r0 = 0.16 * (1 - t0 * 0.92);
        const r1 = 0.16 * (1 - t1 * 0.92);
        const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, crownPts[i].distanceTo(crownPts[i + 1]) + 0.02, 12), houseMat);
        seg.position.copy(crownPts[i]).lerp(crownPts[i + 1], 0.5);
        seg.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          crownPts[i + 1].clone().sub(crownPts[i]).normalize(),
        );
        seg.castShadow = true;
        hatGroup.add(seg);
      }
    } else {
      // Sleek Assasin/Auror Cowl-Hood draping around skull & trailing backward
      const cowl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.52, 14), houseMat);
      cowl.position.set(0, 0.14, 0.1);
      cowl.rotation.x = -0.68;
      cowl.castShadow = true;
      hatGroup.add(cowl);
    }
    head.add(hatGroup);
    torsoGroup.add(head);

    // --- Left Arm reaching forward onto broom neck ---
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.26, 0.52, -0.03);
    const lUpper = createLimb(0.058, 0.05, 0.3, darkClothMat);
    lUpper.position.set(0.02, -0.12, -0.09);
    lUpper.rotation.x = 0.72;
    lUpper.rotation.z = -0.18;
    leftArm.add(lUpper);

    const lFore = createLimb(0.05, 0.042, 0.28, darkClothMat);
    lFore.position.set(0.14, -0.22, -0.28);
    lFore.rotation.x = 1.05;
    lFore.rotation.z = 0.55;
    leftArm.add(lFore);

    const lGlove = new THREE.Mesh(new THREE.SphereGeometry(0.054, 10, 10), leatherMat);
    lGlove.position.set(0.25, -0.26, -0.4);
    leftArm.add(lGlove);
    torsoGroup.add(leftArm);

    // --- Right Arm with flowing sleeve cuff + gloved hand + ornate wand ---
    this.wandArm.position.set(0.26, 0.52, -0.03);
    const rUpper = createLimb(0.06, 0.054, 0.3, houseMat);
    rUpper.position.set(0.02, -0.1, -0.12);
    rUpper.rotation.x = 0.88;
    this.wandArm.add(rUpper);

    // Bell-shaped wizard sleeve cuff
    const rSleeve = createLimb(0.052, 0.092, 0.28, houseMat);
    rSleeve.position.set(0.0, -0.16, -0.35);
    rSleeve.rotation.x = Math.PI / 2 - 0.1;
    this.wandArm.add(rSleeve);

    const rGlove = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 10), leatherMat);
    rGlove.position.set(0.0, -0.16, -0.49);
    this.wandArm.add(rGlove);

    const wand = buildWandMesh();
    wand.tipLight.intensity = 0; // Keep dynamic lights pooled in VfxManager
    wand.group.position.set(0.0, -0.16, -0.5);
    this.wandCrystal = wand.tipCrystal;
    this.wandArm.add(wand.group);
    torsoGroup.add(this.wandArm);

    // --- Dynamic Billowing Vertex-Animated Cloth Cloak ---
    this.capeGeo = new THREE.PlaneGeometry(0.76, 1.38, 6, 8);
    this.capeGeo.translate(0, -0.68, 0);
    const capePosAttr = this.capeGeo.attributes.position;
    this.capeBaseZ = new Float32Array(capePosAttr.count);
    this.capeBaseY = new Float32Array(capePosAttr.count);
    for (let i = 0; i < capePosAttr.count; i++) {
      // Taper cape wider toward the bottom hem & record rest coords for wind waves
      const py = capePosAttr.getY(i); // 0 down to -1.38
      const frac = -py / 1.38;
      capePosAttr.setX(i, capePosAttr.getX(i) * (0.62 + frac * 0.65));
      this.capeBaseY[i] = py;
      this.capeBaseZ[i] = capePosAttr.getZ(i);
    }
    this.capeMesh = new THREE.Mesh(this.capeGeo, cloakMat);
    this.capeMesh.position.set(0, 0.56, 0.16);
    this.capeMesh.rotation.x = 1.08;
    this.capeMesh.castShadow = true;
    torsoGroup.add(this.capeMesh);

    rider.add(torsoGroup);
    this.bodyGroup.add(rider);
    this.root.add(this.bodyGroup);

    // 3. Scutum Arcane Shield Sphere + Runic Equatorial Band
    const shieldGeo = new THREE.IcosahedronGeometry(1.85, 2);
    const shieldMat = new THREE.MeshStandardMaterial({
      color: 0xffd56b,
      emissive: 0xffaa22,
      emissiveIntensity: 1.4,
      transparent: true,
      opacity: 0.32,
      roughness: 0.15,
      metalness: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
    this.shieldMesh.visible = false;
    this.root.add(this.shieldMesh);

    // 4. Overcharge Orbiting Arcane Halo
    const ocGeo = new THREE.TorusGeometry(1.22, 0.04, 8, 28);
    ocGeo.rotateX(Math.PI / 2);
    this.overchargeRing = new THREE.Mesh(
      ocGeo,
      new THREE.MeshBasicMaterial({ color: 0xffc83b, transparent: true, opacity: 0.85 }),
    );
    this.overchargeRing.visible = false;
    this.root.add(this.overchargeRing);

    // 5. Slipstream Glowing Wind Trail
    for (let i = 0; i < 22; i++) this.trailPoints.push(new THREE.Vector3());
    this.trailGeo.setFromPoints(this.trailPoints);
    this.trailLine = new THREE.Line(
      this.trailGeo,
      new THREE.LineBasicMaterial({
        color: isLocal ? house.accent : house.color,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.trailLine.frustumCulled = false;
    this.root.add(this.trailLine);

    this.nameplate = createNameplate(name, houseIdx);
    if (!isLocal) this.root.add(this.nameplate.sprite);
  }

  /** Trigger third-person wand cast flourish & spell color update. */
  triggerCast(spell: SpellId): void {
    this.castAnim = 1.0;
    (this.wandCrystal.material as THREE.MeshBasicMaterial).color.setHex(SPELLS[spell].color);
  }

  update(
    time: number,
    pos: { x: number; y: number; z: number },
    yaw: number,
    pitch: number,
    roll: number,
    hp: number,
    flags: number,
    firstPersonLocal: boolean,
    activeSpell: SpellId = 'fire',
  ): void {
    const alive = (flags & 1) !== 0;
    const shielding = (flags & 2) !== 0;
    const boosting = (flags & 4) !== 0;
    const overcharge = (flags & 16) !== 0;

    this.root.visible = alive;
    if (!alive) return;

    this.root.position.set(pos.x, pos.y, pos.z);
    this.bodyGroup.rotation.order = 'YXZ';
    this.bodyGroup.rotation.set(pitch, yaw, roll);
    this.bodyGroup.visible = !firstPersonLocal;

    // Wand crystal reflects active spell
    (this.wandCrystal.material as THREE.MeshBasicMaterial).color.setHex(SPELLS[activeSpell].color);

    // Rider breathing, wind lean & wand cast animation
    this.castAnim = Math.max(0, this.castAnim - 0.06);
    this.riderGroup.position.y = 0.04 + Math.sin(time * 4.5 + this.id) * 0.015;
    this.headGroup.rotation.z = roll * -0.35; // Counter-tilt head smoothly on sharp banks
    this.wandArm.rotation.x = -this.castAnim * 0.45 + Math.sin(time * 3.2 + this.id) * 0.03;

    // Animated billowing cape vertices (authentic high-speed fabric wave!)
    const posAttr = this.capeGeo.attributes.position;
    const amp = boosting ? 0.24 : 0.11;
    const freq = boosting ? 20 : 10;
    for (let i = 0; i < posAttr.count; i++) {
      const restY = this.capeBaseY[i];
      const frac = Math.min(1, -restY / 1.38);
      const px = posAttr.getX(i);
      const wave = Math.sin(time * freq + restY * 5.2 + px * 3.1 + this.id) * amp * frac * frac;
      posAttr.setZ(i, this.capeBaseZ[i] + wave);
    }
    posAttr.needsUpdate = true;
    this.capeGeo.computeVertexNormals();
    this.capeMesh.rotation.x = 1.05 + (boosting ? 0.36 : 0.12);

    // Streaming scarf tails
    this.scarfLeft.rotation.x = 0.22 + (boosting ? 0.15 : 0) + Math.sin(time * (boosting ? 22 : 11) + this.id) * 0.12;
    this.scarfLeft.rotation.y = Math.cos(time * 9 + this.id) * 0.14;
    this.scarfRight.rotation.x = 0.25 + (boosting ? 0.15 : 0) + Math.cos(time * (boosting ? 20 : 10) + this.id) * 0.14;
    this.scarfRight.rotation.y = Math.sin(time * 8 + this.id) * 0.16;

    // Broom tail flutter & boost flame
    this.tail.rotation.y = Math.sin(time * (boosting ? 24 : 8) + this.id) * 0.055;
    (this.boostCore.material as THREE.MeshBasicMaterial).opacity = boosting ? 0.8 + Math.sin(time * 32) * 0.18 : 0;

    this.shieldMesh.visible = shielding;
    if (shielding) {
      this.shieldMesh.rotation.y = time * 1.4;
      this.shieldMesh.rotation.z = time * 0.7;
    }

    this.overchargeRing.visible = overcharge;
    if (overcharge) {
      this.overchargeRing.rotation.z = time * 2.5;
    }

    // Slipstream trail
    const tailDir = new THREE.Vector3(0, -0.05, 1.45).applyEuler(this.bodyGroup.rotation);
    for (let i = this.trailPoints.length - 1; i > 0; i--) {
      this.trailPoints[i].copy(this.trailPoints[i - 1]).addScaledVector(tailDir, 0.32);
      this.trailPoints[i].y += Math.sin(time * 12 + i * 0.5) * 0.02;
    }
    this.trailPoints[0].copy(tailDir);
    this.trailGeo.setFromPoints(this.trailPoints);
    (this.trailLine.material as THREE.LineBasicMaterial).opacity = boosting ? 0.85 : 0.38;

    if (!this.isLocal) {
      this.nameplate.updateHp(hp);
    }
  }
}

// ---------------------------------------------------------------------------
// First-Person & WebXR VR Cockpit
// ---------------------------------------------------------------------------

/**
 * First-Person & WebXR VR Cockpit attached to the player rig:
 * Includes the carved front broomstick, 3D diegetic arcane instrument cluster,
 * and the player's ornate 3D magic wand (which tracks the right VR controller in WebXR).
 */
export class FirstPersonCockpit {
  readonly group = new THREE.Group();
  readonly broomHandle = new THREE.Group();
  readonly wandGroup: THREE.Group;
  private wandCrystal: THREE.Mesh;
  private wandLight: THREE.PointLight;
  private hpBar: THREE.Mesh;
  private manaBar: THREE.Mesh;
  private stamBar: THREE.Mesh;
  private zoneArrow: THREE.Group;
  private castRecoil = 0;

  constructor() {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, -0.45, -0.15),
      new THREE.Vector3(0, -0.34, -0.65),
      new THREE.Vector3(0, -0.22, -1.25),
    ]);
    const shaft = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.044, 10, false), woodMat);
    this.broomHandle.add(shaft);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.013, 8, 18), goldMat);
    ring.position.set(0, -0.3, -0.82);
    this.broomHandle.add(ring);

    const consoleGroup = new THREE.Group();
    consoleGroup.position.set(0, -0.24, -0.78);
    consoleGroup.rotation.x = -0.55;

    const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.018, 20), goldMat);
    plate.rotation.x = Math.PI / 2;
    consoleGroup.add(plate);

    const dialFace = new THREE.Mesh(
      new THREE.CylinderGeometry(0.115, 0.115, 0.02, 20),
      new THREE.MeshBasicMaterial({ color: 0x0d0e17 }),
    );
    dialFace.rotation.x = Math.PI / 2;
    consoleGroup.add(dialFace);

    const makeBar = (yOff: number, color: number): THREE.Mesh => {
      const g = new THREE.BoxGeometry(0.14, 0.018, 0.008);
      g.translate(0.07, 0, 0);
      const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color }));
      m.position.set(-0.07, yOff, 0.014);
      consoleGroup.add(m);
      return m;
    };
    this.hpBar = makeBar(0.032, 0xff3b56);
    this.manaBar = makeBar(0.0, 0x3b9eff);
    this.stamBar = makeBar(-0.032, 0xffc23b);

    this.zoneArrow = new THREE.Group();
    this.zoneArrow.position.set(0, 0.075, 0.018);
    const arrowCone = new THREE.Mesh(
      new THREE.ConeGeometry(0.018, 0.055, 6),
      new THREE.MeshBasicMaterial({ color: 0x6dffb3 }),
    );
    arrowCone.position.y = 0.015;
    this.zoneArrow.add(arrowCone);
    consoleGroup.add(this.zoneArrow);

    this.broomHandle.add(consoleGroup);
    this.group.add(this.broomHandle);

    const w = buildWandMesh();
    this.wandGroup = w.group;
    this.wandCrystal = w.tipCrystal;
    this.wandLight = w.tipLight;
    this.group.add(this.wandGroup);
  }

  triggerCastRecoil(): void {
    this.castRecoil = 1.0;
  }

  getWandTipWorld(out = new THREE.Vector3()): THREE.Vector3 {
    this.wandCrystal.getWorldPosition(out);
    return out;
  }

  update(
    dt: number,
    time: number,
    activeSpell: SpellId,
    hp: number,
    mana: number,
    stamina: number,
    zoneAngleRel: number,
    roll: number,
    isXR: boolean,
    xrWandPose: { pos: THREE.Vector3; quat: THREE.Quaternion } | null,
    camera: THREE.Camera,
  ): void {
    this.castRecoil = Math.max(0, this.castRecoil - dt * 6);

    const spellColor = SPELLS[activeSpell].color;
    (this.wandCrystal.material as THREE.MeshBasicMaterial).color.setHex(spellColor);
    this.wandLight.color.setHex(spellColor);

    this.hpBar.scale.x = Math.max(0.01, hp / PLAYER.maxHp);
    this.manaBar.scale.x = Math.max(0.01, mana / PLAYER.maxMana);
    this.stamBar.scale.x = Math.max(0.01, stamina / PLAYER.maxStamina);
    this.zoneArrow.rotation.z = -zoneAngleRel;

    this.broomHandle.rotation.z = roll * 0.45;
    this.broomHandle.position.y = Math.sin(time * 4.2) * 0.012;

    if (isXR && xrWandPose) {
      this.wandGroup.position.copy(xrWandPose.pos);
      this.wandGroup.quaternion.copy(xrWandPose.quat);
      this.wandGroup.translateZ(this.castRecoil * 0.08);
    } else {
      this.wandGroup.position.set(0.28, -0.22 + Math.sin(time * 3.1) * 0.008, -0.38 + this.castRecoil * 0.09);
      this.wandGroup.quaternion.copy(camera.quaternion);
      this.wandGroup.rotateX(0.12 + this.castRecoil * 0.25);
      this.wandGroup.rotateY(-0.08);
    }
  }
}

// ---------------------------------------------------------------------------
// Loot Pickups
// ---------------------------------------------------------------------------

/** Floating 3D Potion / Arcane Crystal pickups in the world. */
export class LootVisuals {
  readonly group = new THREE.Group();
  private items = new Map<number, { mesh: THREE.Group; baseY: number }>();

  setLoot(list: { id: number; type: LootType; x: number; y: number; z: number }[]): void {
    for (const v of this.items.values()) this.group.remove(v.mesh);
    this.items.clear();

    const octGeo = new THREE.OctahedronGeometry(1.15, 0);
    const ringGeo = new THREE.TorusGeometry(1.75, 0.08, 8, 24);

    for (const item of list) {
      const col = LOOT[item.type].color;
      const g = new THREE.Group();
      const core = new THREE.Mesh(
        octGeo,
        new THREE.MeshStandardMaterial({
          color: col,
          emissive: col,
          emissiveIntensity: 1.5,
          roughness: 0.15,
          metalness: 0.4,
        }),
      );
      const ring = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.65 }),
      );
      g.add(core, ring);
      g.position.set(item.x, item.y, item.z);
      this.group.add(g);
      this.items.set(item.id, { mesh: g, baseY: item.y });
    }
  }

  remove(id: number): void {
    const it = this.items.get(id);
    if (!it) return;
    this.group.remove(it.mesh);
    this.items.delete(id);
  }

  update(time: number): void {
    for (const [id, it] of this.items) {
      it.mesh.position.y = it.baseY + Math.sin(time * 2.4 + id) * 0.85;
      it.mesh.rotation.y = time * 1.4 + id;
      it.mesh.children[1].rotation.x = time * 2.1 + id;
    }
  }
}
