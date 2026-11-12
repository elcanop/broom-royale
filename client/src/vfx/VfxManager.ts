import * as THREE from 'three';
import { SPELLS, type SpellId } from '../../../shared/config';
import { radialSprite } from '../engine/textures';

interface ActiveProj {
  id: number;
  spell: SpellId;
  group: THREE.Group;
  vel: THREE.Vector3;
  age: number;
}

interface ActiveBeam {
  mesh: THREE.Line;
  glow: THREE.Line;
  life: number;
  maxLife: number;
}

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  g: number;
  b: number;
  size: number;
  life: number;
  maxLife: number;
}

const MAX_PARTICLES = 1800;

export class VfxManager {
  readonly group = new THREE.Group();
  private projs = new Map<number, ActiveProj>();
  private beams: ActiveBeam[] = [];
  private particles: Particle[] = [];
  private pPositions = new Float32Array(MAX_PARTICLES * 3);
  private pColors = new Float32Array(MAX_PARTICLES * 3);
  private pSizes = new Float32Array(MAX_PARTICLES);
  private pointsGeo = new THREE.BufferGeometry();
  private pointsMat: THREE.ShaderMaterial;
  private pointsMesh: THREE.Points;

  private fireCoreGeo = new THREE.SphereGeometry(0.56, 14, 14);
  private iceLanceGeo = new THREE.ConeGeometry(0.3, 1.95, 8);
  private spellLights: THREE.PointLight[] = [];

  constructor() {
    this.iceLanceGeo.rotateX(Math.PI / 2);

    // Pool of 4 dynamic point lights that track active spell projectiles/impacts
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight(0xff7722, 0, 38, 1.6);
      this.group.add(pl);
      this.spellLights.push(pl);
    }

    this.pointsGeo.setAttribute('position', new THREE.BufferAttribute(this.pPositions, 3));
    this.pointsGeo.setAttribute('color', new THREE.BufferAttribute(this.pColors, 3));
    this.pointsGeo.setAttribute('size', new THREE.BufferAttribute(this.pSizes, 1));

    const sprite = radialSprite();
    this.pointsMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTex: { value: sprite },
        uScale: { value: 600 },
      },
      vertexShader: `
        attribute float size;
        attribute vec3 color;
        varying vec3 vColor;
        uniform float uScale;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = clamp(size * (uScale / max(1.0, -mv.z)), 2.0, 96.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec3 vColor;
        void main() {
          vec4 tex = texture2D(uTex, gl_PointCoord);
          if (tex.a < 0.02) discard;
          gl_FragColor = vec4(vColor * tex.rgb, tex.a);
        }
      `,
    });

    this.pointsMesh = new THREE.Points(this.pointsGeo, this.pointsMat);
    this.pointsMesh.frustumCulled = false;
    this.group.add(this.pointsMesh);
  }

  spawnProjectile(
    id: number,
    spell: SpellId,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
  ): void {
    this.removeProjectile(id);
    const col = SPELLS[spell].color;
    const g = new THREE.Group();
    g.position.set(x, y, z);

    const mesh = new THREE.Mesh(
      spell === 'ice' ? this.iceLanceGeo : this.fireCoreGeo,
      new THREE.MeshBasicMaterial({ color: col }),
    );
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(spell === 'ice' ? 0.55 : 0.95, 10, 10),
      new THREE.MeshBasicMaterial({
        color: col,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    g.add(mesh, halo);

    const vel = new THREE.Vector3(vx, vy, vz);
    const target = new THREE.Vector3(x + vx, y + vy, z + vz);
    g.lookAt(target);
    this.group.add(g);
    this.projs.set(id, { id, spell, group: g, vel, age: 0 });

    // Muzzle burst
    this.burst(x, y, z, col, 14, 10, 0.32, 2.2);
  }

  endProjectile(id: number, spell: SpellId, x: number, y: number, z: number, hitEntity: boolean): void {
    this.removeProjectile(id);
    const col = SPELLS[spell].color;
    this.burst(x, y, z, col, hitEntity ? 48 : 30, hitEntity ? 26 : 18, 0.65, hitEntity ? 4.2 : 3.2);
  }

  private removeProjectile(id: number): void {
    const p = this.projs.get(id);
    if (!p) return;
    this.group.remove(p.group);
    this.projs.delete(id);
  }

  /** Spawn a jagged 3D lightning bolt (`Fulgur`) from (x0,y0,z0) to (x1,y1,z1). */
  spawnLightningBeam(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
    const start = new THREE.Vector3(x0, y0, z0);
    const end = new THREE.Vector3(x1, y1, z1);
    const dist = start.distanceTo(end);
    const segs = Math.max(8, Math.min(40, Math.floor(dist / 6)));

    const buildJagged = (jitter: number): THREE.BufferGeometry => {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const p = new THREE.Vector3().lerpVectors(start, end, t);
        if (i > 0 && i < segs) {
          const j = Math.sin(t * Math.PI) * jitter;
          p.x += (Math.random() - 0.5) * j;
          p.y += (Math.random() - 0.5) * j;
          p.z += (Math.random() - 0.5) * j;
        }
        pts.push(p);
      }
      return new THREE.BufferGeometry().setFromPoints(pts);
    };

    const matCore = new THREE.LineBasicMaterial({
      color: 0xf4e8ff,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
    });
    const matGlow = new THREE.LineBasicMaterial({
      color: SPELLS.lightning.color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Line(buildJagged(2.2), matCore);
    const glow = new THREE.Line(buildJagged(3.8), matGlow);
    this.group.add(mesh, glow);
    this.beams.push({ mesh, glow, life: 0.38, maxLife: 0.38 });

    this.burst(x1, y1, z1, SPELLS.lightning.color, 44, 24, 0.55, 3.8);
  }

  burst(
    x: number,
    y: number,
    z: number,
    hexColor: number,
    count: number,
    speed: number,
    life: number,
    size: number,
  ): void {
    const c = new THREE.Color(hexColor);
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const u = Math.random() * 2 - 1;
      const theta = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = speed * (0.3 + Math.random() * 0.9);
      this.particles.push({
        x,
        y,
        z,
        vx: r * Math.cos(theta) * sp,
        vy: u * sp,
        vz: r * Math.sin(theta) * sp,
        r: Math.min(1, c.r + (Math.random() - 0.3) * 0.2),
        g: Math.min(1, c.g + (Math.random() - 0.3) * 0.2),
        b: Math.min(1, c.b + (Math.random() - 0.3) * 0.2),
        size: size * (0.7 + Math.random() * 0.6),
        life: life * (0.6 + Math.random() * 0.5),
        maxLife: life,
      });
    }
  }

  update(dt: number, pointScale: number): void {
    this.pointsMat.uniforms.uScale.value = pointScale;

    // Advance projectiles, assign dynamic lights & emit trails
    let lightIdx = 0;
    for (const [id, p] of this.projs) {
      p.age += dt;
      p.group.position.addScaledVector(p.vel, dt);
      if (p.age > 5) {
        this.removeProjectile(id);
        continue;
      }
      const col = SPELLS[p.spell].color;
      if (lightIdx < this.spellLights.length) {
        const pl = this.spellLights[lightIdx++];
        pl.color.setHex(col);
        pl.intensity = 55;
        pl.position.copy(p.group.position);
      }
      this.burst(p.group.position.x, p.group.position.y, p.group.position.z, col, 2, 3.8, 0.26, 2.4);
    }
    for (let i = lightIdx; i < this.spellLights.length; i++) {
      this.spellLights[i].intensity = 0;
    }

    // Fade lightning beams
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i];
      b.life -= dt;
      if (b.life <= 0) {
        this.group.remove(b.mesh, b.glow);
        b.mesh.geometry.dispose();
        b.glow.geometry.dispose();
        this.beams.splice(i, 1);
      } else {
        const k = b.life / b.maxLife;
        (b.mesh.material as THREE.LineBasicMaterial).opacity = k;
        (b.glow.material as THREE.LineBasicMaterial).opacity = k * 0.75;
      }
    }

    // Update particles
    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const pt = this.particles[i];
      pt.life -= dt;
      if (pt.life <= 0) continue;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.z += pt.vz * dt;
      pt.vx *= 0.96;
      pt.vy *= 0.96;
      pt.vz *= 0.96;

      const fade = Math.max(0, pt.life / pt.maxLife);
      this.pPositions[n * 3] = pt.x;
      this.pPositions[n * 3 + 1] = pt.y;
      this.pPositions[n * 3 + 2] = pt.z;
      this.pColors[n * 3] = pt.r * fade;
      this.pColors[n * 3 + 1] = pt.g * fade;
      this.pColors[n * 3 + 2] = pt.b * fade;
      this.pSizes[n] = pt.size * (0.5 + 0.5 * fade);

      this.particles[n] = pt;
      n++;
    }
    this.particles.length = n;

    this.pointsGeo.setDrawRange(0, n);
    (this.pointsGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.pointsGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    (this.pointsGeo.attributes.size as THREE.BufferAttribute).needsUpdate = true;
  }
}
