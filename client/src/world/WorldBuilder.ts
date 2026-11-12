import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { HOUSES, WORLD } from '../../../shared/config';
import { buildLayout, type TowerDef } from '../../../shared/layout';
import { mulberry32, range } from '../../../shared/rng';
import { TERRAIN_SEGMENTS, TERRAIN_SIZE, heightAt, heightGrid, isLake, normalAt } from '../../../shared/terrain';
import type { ZoneState } from '../../../shared/zone';
import type { Engine } from '../engine/Engine';
import { cloudSprite, loadAllPbr, waterNormals, type PbrSet, type TexName } from '../engine/textures';
import { buildVoxelStructures, type VoxelStructures } from './VoxelBuilder';

export type AtmospherePreset = 'sunset' | 'night' | 'storm';

export class World {
  readonly root = new THREE.Group();
  sun!: THREE.DirectionalLight;
  readonly sunDir = new THREE.Vector3();
  readonly sunColor = new THREE.Color(0xffb070);
  godRayStrength = 0.45;
  atmosphere: AtmospherePreset = 'sunset';

  private sky!: Sky;
  private hemi!: THREE.HemisphereLight;
  private starField!: THREE.Points;
  private auroraMesh!: THREE.Mesh;
  private auroraMat!: THREE.ShaderMaterial;
  private winMat!: THREE.MeshStandardMaterial;
  private floatingLanterns!: THREE.InstancedMesh;
  private lanternBasePos: { x: number; y: number; z: number; phase: number }[] = [];
  private water: Water | THREE.Mesh | null = null;
  private waterNormalTex!: THREE.Texture;
  private clouds: { sprite: THREE.Sprite; speed: number; baseY: number }[] = [];
  private zoneWall!: THREE.Mesh;
  private zoneMat!: THREE.ShaderMaterial;
  private nextZoneRing!: THREE.Mesh;
  private waypointBeam!: THREE.Mesh;
  private waypointPos: THREE.Vector3 | null = null;
  private voxels!: VoxelStructures;
  private lightningFlash = 0;

  private constructor(private readonly engine: Engine) {
    this.root.name = 'BroomRoyaleWorld';
    this.engine.scene.add(this.root);
  }

  static async create(engine: Engine, initialAtmo: AtmospherePreset = 'sunset'): Promise<World> {
    const w = new World(engine);
    const pbr = await loadAllPbr(engine.renderer);
    w.buildSkyAndLighting();
    w.buildStarsAndAurora();
    w.buildTerrain(pbr);
    w.buildWater();
    w.buildArchitecture(pbr);
    w.buildEnchantedLanterns();
    w.voxels = buildVoxelStructures(pbr);
    w.root.add(w.voxels.group);
    w.buildForestAndRocks(pbr);
    w.buildClouds();
    w.buildStormZone();
    w.setAtmosphere(initialAtmo);
    return w;
  }

  // ---------------------------------------------------------------- Sky, Fog, Stars & Dynamic Atmosphere

  private buildSkyAndLighting(): void {
    const { scene, preset } = this.engine;
    scene.fog = new THREE.FogExp2(0x282133, 0.00046);

    this.sky = new Sky();
    this.sky.scale.setScalar(8000);
    this.root.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffb88c, 0x26293d, 0.68);
    this.root.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffb070, 3.1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(preset.shadowSize, preset.shadowSize);
    this.sun.shadow.bias = -0.00035;
    this.sun.shadow.normalBias = 0.035;
    const cam = this.sun.shadow.camera;
    const d = 270;
    cam.left = -d;
    cam.right = d;
    cam.top = d;
    cam.bottom = -d;
    cam.near = 20;
    cam.far = 950;
    this.root.add(this.sun);
    this.root.add(this.sun.target);

    // Warm point lights inside the castle courtyard, Great Hall, Viaduct & Stadium
    const warmSpots: [number, number, number, number][] = [
      [-10, WORLD.plateauHeight + 24, -42, 0xff9442],
      [60, WORLD.plateauHeight + 82, -50, 0xffaa55],
      [0, WORLD.plateauHeight + 20, -135, 0xff8c3b],
      [-195, WORLD.plateauHeight + 20, -142, 0xffa855],
      [WORLD.stadiumCenter.x, 40, WORLD.stadiumCenter.z, 0xffb858],
      [WORLD.stonesCenter.x, 48, WORLD.stonesCenter.z, 0x58d8ff],
    ];
    for (let i = 0; i < Math.min(preset.pointLights, warmSpots.length); i++) {
      const [x, y, z, col] = warmSpots[i];
      const pl = new THREE.PointLight(col, 360, 155, 1.45);
      pl.position.set(x, y, z);
      this.root.add(pl);
    }
  }

  private buildStarsAndAurora(): void {
    // 3,200 twinkling stars on a celestial dome (visible in Night & Storm modes)
    const rng = mulberry32(777);
    const starCount = 3200;
    const pos = new Float32Array(starCount * 3);
    const cols = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const theta = rng() * Math.PI * 2;
      const phi = Math.acos(range(rng, 0.06, 1.0));
      const R = 4200;
      pos[i * 3] = R * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = R * Math.cos(phi);
      pos[i * 3 + 2] = R * Math.sin(phi) * Math.sin(theta);
      const c = new THREE.Color().setHSL(range(rng, 0.52, 0.68), range(rng, 0.2, 0.7), range(rng, 0.75, 1.0));
      cols[i * 3] = c.r;
      cols[i * 3 + 1] = c.g;
      cols[i * 3 + 2] = c.b;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    sGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const sMat = new THREE.PointsMaterial({
      size: 16,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.starField = new THREE.Points(sGeo, sMat);
    this.starField.visible = false;
    this.root.add(this.starField);

    // Aurora Borealis ribbon curtain high in the northern sky
    const aGeo = new THREE.CylinderGeometry(2400, 2600, 750, 96, 1, true);
    aGeo.translate(0, 1150, 0);
    this.auroraMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          vUv = uv;
          vec3 p = position;
          p.x += sin(uv.x * 18.85 + uTime * 0.4) * 95.0;
          p.z += cos(uv.x * 12.56 - uTime * 0.3) * 95.0;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform float uTime;
        void main() {
          float wave = sin(vUv.x * 42.0 + uTime * 0.8) * 0.5 + 0.5;
          float wave2 = sin(vUv.x * 23.0 - uTime * 0.5) * 0.5 + 0.5;
          float curtain = pow(wave * wave2, 1.6);
          float vFade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.45, 1.0, vUv.y));
          vec3 col = mix(vec3(0.12, 0.92, 0.62), vec3(0.48, 0.22, 0.98), vUv.y + wave * 0.25);
          gl_FragColor = vec4(col, curtain * vFade * 0.34);
        }
      `,
    });
    this.auroraMesh = new THREE.Mesh(aGeo, this.auroraMat);
    this.auroraMesh.visible = false;
    this.root.add(this.auroraMesh);
  }

  setAtmosphere(preset: AtmospherePreset): void {
    this.atmosphere = preset;
    const u = this.sky.material.uniforms;
    const fog = this.engine.scene.fog as THREE.FogExp2;

    if (preset === 'sunset') {
      u['turbidity'].value = 4.6;
      u['rayleigh'].value = 1.65;
      u['mieCoefficient'].value = 0.0018;
      u['mieDirectionalG'].value = 0.72;
      const phi = THREE.MathUtils.degToRad(90 - 26);
      const theta = THREE.MathUtils.degToRad(138);
      this.sunDir.setFromSphericalCoords(1, phi, theta);
      u['sunPosition'].value.copy(this.sunDir);

      this.sunColor.setHex(0xffb87e);
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 2.85;
      this.hemi.color.setHex(0xffd0ac);
      this.hemi.groundColor.setHex(0x2d3246);
      this.hemi.intensity = 0.85;
      fog.color.setHex(0x241e32);
      fog.density = 0.00028;
      this.godRayStrength = 0.18;
      this.starField.visible = false;
      this.auroraMesh.visible = false;
      if (this.winMat) this.winMat.emissiveIntensity = 2.8;
    } else if (preset === 'night') {
      u['turbidity'].value = 1.6;
      u['rayleigh'].value = 0.22;
      u['mieCoefficient'].value = 0.002;
      u['mieDirectionalG'].value = 0.92;
      // High silver moon angle
      const phi = THREE.MathUtils.degToRad(90 - 26);
      const theta = THREE.MathUtils.degToRad(132);
      this.sunDir.setFromSphericalCoords(1, phi, theta);
      u['sunPosition'].value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(96), theta);

      this.sunColor.setHex(0x78aaff);
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 1.95;
      this.hemi.color.setHex(0x4b6ba8);
      this.hemi.groundColor.setHex(0x101322);
      this.hemi.intensity = 0.52;
      fog.color.setHex(0x0b1020);
      fog.density = 0.00042;
      this.godRayStrength = 0.24;
      this.starField.visible = true;
      this.auroraMesh.visible = true;
      if (this.winMat) this.winMat.emissiveIntensity = 4.2;
    } else {
      // 'storm' — Epic Arcane Storm
      u['turbidity'].value = 16;
      u['rayleigh'].value = 3.6;
      u['mieCoefficient'].value = 0.02;
      u['mieDirectionalG'].value = 0.72;
      const phi = THREE.MathUtils.degToRad(90 - 4.5);
      const theta = THREE.MathUtils.degToRad(160);
      this.sunDir.setFromSphericalCoords(1, phi, theta);
      u['sunPosition'].value.copy(this.sunDir);

      this.sunColor.setHex(0xa88cff);
      this.sun.color.copy(this.sunColor);
      this.sun.intensity = 2.2;
      this.hemi.color.setHex(0x6c5c99);
      this.hemi.groundColor.setHex(0x141221);
      this.hemi.intensity = 0.58;
      fog.color.setHex(0x191528);
      fog.density = 0.00062;
      this.godRayStrength = 0.35;
      this.starField.visible = true;
      this.auroraMesh.visible = false;
      if (this.winMat) this.winMat.emissiveIntensity = 3.6;
    }

    if (this.water && 'material' in this.water) {
      const mat = this.water.material as THREE.ShaderMaterial & {
        uniforms?: Record<string, { value: THREE.Color | THREE.Vector3 }>;
      };
      if (mat.uniforms?.['sunColor']) {
        (mat.uniforms['sunColor'].value as THREE.Color).copy(this.sunColor);
        (mat.uniforms['sunDirection'].value as THREE.Vector3).copy(this.sunDir).normalize();
      }
    }
  }

  // ---------------------------------------------------------------- Multi-Biome Pro Terrain

  private buildTerrain(pbr: Record<TexName, PbrSet>): void {
    const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position as THREE.BufferAttribute;
    const grid = heightGrid();
    for (let i = 0; i < pos.count; i++) {
      pos.setY(i, grid[i]);
    }
    geo.computeVertexNormals();

    const mat = new THREE.MeshStandardMaterial({
      map: pbr.grass.map,
      normalMap: pbr.grass.normal,
      roughnessMap: pbr.grass.roughnessMap,
      normalScale: new THREE.Vector2(1.35, 1.35),
      roughness: 0.86,
      metalness: 0.03,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uRockMap = { value: pbr.rock.map };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           varying vec3 vWorldPos;
           varying vec3 vWorldNormal;`,
        )
        .replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
           vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
           vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform sampler2D uRockMap;
           varying vec3 vWorldPos;
           varying vec3 vWorldNormal;`,
        )
        .replace(
          '#include <map_fragment>',
          `vec2 uvGrass = vWorldPos.xz * 0.05;
           vec2 uvMacro = vWorldPos.xz * 0.0042;
           // Tri-planar rock projection so vertical cliffs have zero UV stretching
           vec3 blendW = abs(vWorldNormal);
           blendW = max(blendW - 0.2, 0.001);
           blendW /= (blendW.x + blendW.y + blendW.z);
           vec3 rockX = texture2D(uRockMap, vWorldPos.zy * 0.036).rgb;
           vec3 rockY = texture2D(uRockMap, vWorldPos.xz * 0.036).rgb;
           vec3 rockZ = texture2D(uRockMap, vWorldPos.xy * 0.036).rgb;
           vec3 rockCol = (rockX * blendW.x + rockY * blendW.y + rockZ * blendW.z) * 0.9;

           vec3 grassCol = texture2D(map, uvGrass).rgb;
           vec3 macroVar = texture2D(map, uvMacro).rgb;
           grassCol = mix(grassCol, grassCol * (0.65 + macroVar * 0.7), 0.58);

           float flatNess = clamp(vWorldNormal.y, 0.0, 1.0);
           float rockMask = 1.0 - smoothstep(0.55, 0.81, flatNess);

           float shoreMask = 1.0 - smoothstep(-2.0, 5.8, vWorldPos.y);
           vec3 shoreCol = mix(vec3(0.16, 0.14, 0.12), rockCol * 0.62, 0.5);

           float snowMask = smoothstep(162.0, 232.0, vWorldPos.y + flatNess * 28.0) * smoothstep(0.44, 0.72, flatNess);
           vec3 snowCol = vec3(0.94, 0.96, 1.0);

           vec3 finalAlbedo = mix(grassCol, rockCol, rockMask);
           finalAlbedo = mix(finalAlbedo, shoreCol, shoreMask * 0.88);
           finalAlbedo = mix(finalAlbedo, snowCol, snowMask);
           diffuseColor.rgb = finalAlbedo;`,
        );
    };

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    this.root.add(mesh);
  }

  // ---------------------------------------------------------------- Lake Water

  private buildWater(): void {
    const waterGeo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, 1, 1);
    this.waterNormalTex = waterNormals();

    if (this.engine.preset.reflectiveWater) {
      const w = new Water(waterGeo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: this.waterNormalTex,
        sunDirection: this.sunDir.clone().normalize(),
        sunColor: 0xffb878,
        waterColor: 0x091c2b,
        distortionScale: 3.1,
        fog: true,
      });
      w.rotation.x = -Math.PI / 2;
      w.position.y = WORLD.waterLevel;
      this.water = w;
      this.root.add(w);
    } else {
      this.waterNormalTex.repeat.set(48, 48);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x0f2d42,
        normalMap: this.waterNormalTex,
        normalScale: new THREE.Vector2(0.6, 0.6),
        roughness: 0.38,
        metalness: 0.35,
      });
      const m = new THREE.Mesh(waterGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = WORLD.waterLevel;
      this.water = m;
      this.root.add(m);
    }
  }

  // ---------------------------------------------------------------- Gothic Castle & Landmarks

  private buildArchitecture(pbr: Record<TexName, PbrSet>): void {
    const layout = buildLayout();

    const makeWorldUvMat = (tex: PbrSet, scale: number, rough: number, tint = 0xffffff): THREE.MeshStandardMaterial => {
      const m = new THREE.MeshStandardMaterial({
        map: tex.map,
        normalMap: tex.normal,
        roughnessMap: tex.roughnessMap,
        normalScale: new THREE.Vector2(1.4, 1.4),
        color: tint,
        roughness: rough,
        metalness: 0.08,
      });
      m.onBeforeCompile = (sh) => {
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
          .replace(
            '#include <worldpos_vertex>',
            '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed,1.0)).xyz;\nvWNorm = normalize(mat3(modelMatrix)*objectNormal);',
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNorm;')
          .replace(
            '#include <map_fragment>',
            `vec3 bw = abs(vWNorm);
             bw = max(bw - 0.2, 0.001);
             bw /= (bw.x + bw.y + bw.z);
             vec2 uvX = vWPos.zy * ${scale.toFixed(4)};
             vec2 uvY = vWPos.xz * ${scale.toFixed(4)};
             vec2 uvZ = vWPos.xy * ${scale.toFixed(4)};
             vec3 cX = texture2D(map, uvX).rgb;
             vec3 cY = texture2D(map, uvY).rgb;
             vec3 cZ = texture2D(map, uvZ).rgb;
             // Subtle vertical weathering gradient near tower bases
             float weather = clamp(0.75 + 0.25 * smoothstep(65.0, 115.0, vWPos.y), 0.72, 1.05);
             diffuseColor.rgb *= (cX * bw.x + cY * bw.y + cZ * bw.z) * weather;`,
          );
      };
      return m;
    };

    const stoneMat = makeWorldUvMat(pbr.stone, 0.115, 0.82, 0xdad5cc);
    const roofMat = makeWorldUvMat(pbr.roof, 0.17, 0.54, 0x46526b);
    const woodMat = makeWorldUvMat(pbr.wood, 0.15, 0.65, 0x8e6442);
    const rockMat = makeWorldUvMat(pbr.rock, 0.12, 0.86, 0x7b7874);
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xffd25e,
      emissive: 0x6b4708,
      emissiveIntensity: 0.48,
      roughness: 0.18,
      metalness: 0.92,
    });

    const stoneGeos: THREE.BufferGeometry[] = [];
    const roofGeos: THREE.BufferGeometry[] = [];
    const woodGeos: THREE.BufferGeometry[] = [];
    const rockGeos: THREE.BufferGeometry[] = [];
    const goldGeos: THREE.BufferGeometry[] = [];
    const windowMatrices: THREE.Matrix4[] = [];

    const pickBucket = (mat: TowerDef['material']): THREE.BufferGeometry[] =>
      mat === 'wood' ? woodGeos : mat === 'rock' ? rockGeos : stoneGeos;

    const pushGeo = (bucket: THREE.BufferGeometry[], g: THREE.BufferGeometry, m: THREE.Matrix4): void => {
      const cloned = g.index ? g.toNonIndexed() : g.clone();
      cloned.applyMatrix4(m);
      bucket.push(cloned);
    };

    const cylUnit = new THREE.CylinderGeometry(1, 1.04, 1, 20);
    const coneUnit = new THREE.ConeGeometry(1.14, 1, 20);
    const pyrUnit = new THREE.ConeGeometry(1.3, 1, 4);
    const boxUnit = new THREE.BoxGeometry(1, 1, 1);

    const gableGeo = (() => {
      const shape = new THREE.Shape();
      shape.moveTo(-0.54, 0);
      shape.lineTo(0.54, 0);
      shape.lineTo(0, 1);
      shape.closePath();
      const g = new THREE.ExtrudeGeometry(shape, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      g.rotateY(Math.PI / 2);
      g.computeVertexNormals();
      return g;
    })();

    const m4 = new THREE.Matrix4();
    const q4 = new THREE.Quaternion();
    const s4 = new THREE.Vector3();
    const p4 = new THREE.Vector3();

    // ---- Towers ----
    for (const t of layout.towers) {
      const bucket = pickBucket(t.material);
      p4.set(t.x, t.base + t.h * 0.5, t.z);
      q4.identity();
      s4.set(t.r, t.h, t.r);
      pushGeo(bucket, cylUnit, m4.compose(p4, q4, s4));

      // Molded stone belt courses & top corbel ring
      if (t.r >= 4.5 && t.material === 'stone') {
        p4.set(t.x, t.base + t.h - 1.2, t.z);
        s4.set(t.r * 1.09, 2.5, t.r * 1.09);
        pushGeo(bucket, cylUnit, m4.compose(p4, q4, s4));

        p4.set(t.x, t.base + t.h * 0.52, t.z);
        s4.set(t.r * 1.04, 1.2, t.r * 1.04);
        pushGeo(bucket, cylUnit, m4.compose(p4, q4, s4));
      }

      if (t.roof === 'cone' && t.roofH > 0) {
        p4.set(t.x, t.base + t.h + t.roofH * 0.5, t.z);
        s4.set(t.r, t.roofH, t.r);
        pushGeo(roofGeos, coneUnit, m4.compose(p4, q4, s4));

        // Golden Gothic Spire Finial Crown at the peak of every conical roof
        p4.set(t.x, t.base + t.h + t.roofH + 2.2, t.z);
        s4.set(0.35, 4.8, 0.35);
        pushGeo(goldGeos, coneUnit, m4.compose(p4, q4, s4));
      } else if (t.crenel) {
        const crenelCount = Math.max(8, Math.round(t.r * 1.8));
        for (let i = 0; i < crenelCount; i++) {
          const a = (i / crenelCount) * Math.PI * 2;
          p4.set(t.x + Math.cos(a) * (t.r - 0.5), t.base + t.h + 1.1, t.z + Math.sin(a) * (t.r - 0.5));
          q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a);
          s4.set(1.2, 2.2, 1.6);
          pushGeo(bucket, boxUnit, m4.compose(p4, q4, s4));
        }
      }

      // Warm gothic windows around tower shaft
      if (t.windows && t.r >= 5) {
        const tiers = Math.max(1, Math.floor((t.h - 18) / 14));
        const perRing = Math.max(4, Math.round(t.r * 0.75));
        for (let ty = 0; ty < tiers; ty++) {
          const wy = t.base + 14 + ty * 13;
          for (let wi = 0; wi < perRing; wi++) {
            const a = (wi / perRing) * Math.PI * 2 + (ty % 2) * 0.3;
            p4.set(t.x + Math.cos(a) * (t.r + 0.08), wy, t.z + Math.sin(a) * (t.r + 0.08));
            q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a + Math.PI / 2);
            s4.set(1.15, 2.9, 0.26);
            windowMatrices.push(new THREE.Matrix4().compose(p4, q4, s4));
          }
        }
      }
    }

    // ---- Rectangular Halls, Curtain Walls, Bridge & Stands ----
    for (const b of layout.blocks) {
      const bucket = pickBucket(b.material);
      p4.set(b.x, b.base + b.h * 0.5, b.z);
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
      s4.set(b.w, b.h, b.d);
      pushGeo(bucket, boxUnit, m4.compose(p4, q4, s4));

      if (b.roof === 'gable' && b.roofH > 0) {
        p4.set(b.x, b.base + b.h, b.z);
        s4.set(b.w * 1.02, b.roofH, b.d * 1.06);
        pushGeo(roofGeos, gableGeo, m4.compose(p4, q4, s4));

        // Roof ridge cresting in gold
        p4.set(b.x, b.base + b.h + b.roofH + 0.3, b.z);
        s4.set(b.w * 1.01, 0.65, 0.55);
        pushGeo(goldGeos, boxUnit, m4.compose(p4, q4, s4));
      } else if (b.roof === 'pyramid' && b.roofH > 0) {
        p4.set(b.x, b.base + b.h + b.roofH * 0.5, b.z);
        q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot + Math.PI / 4);
        s4.set(b.w * 0.65, b.roofH, b.d * 0.65);
        pushGeo(roofGeos, pyrUnit, m4.compose(p4, q4, s4));
      }

      if (b.crenel) {
        const steps = Math.max(2, Math.floor(b.w / 4.5));
        const cos = Math.cos(b.rot);
        const sin = Math.sin(b.rot);
        for (let i = 0; i <= steps; i++) {
          const lx = -b.w * 0.46 + (i / steps) * b.w * 0.92;
          for (const side of [-1, 1]) {
            const lz = side * (b.d * 0.5 - 0.5);
            p4.set(b.x + lx * cos + lz * sin, b.base + b.h + 1.1, b.z - lx * sin + lz * cos);
            q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
            s4.set(1.8, 2.2, 1.1);
            pushGeo(bucket, boxUnit, m4.compose(p4, q4, s4));
          }
        }
      }

      if (b.windows && b.w >= 24) {
        const cols = Math.max(3, Math.floor(b.w / 7.5));
        const cos = Math.cos(b.rot);
        const sin = Math.sin(b.rot);
        for (let i = 1; i < cols; i++) {
          const lx = -b.w * 0.5 + (i / cols) * b.w;
          for (const side of [-1, 1]) {
            const lz = side * (b.d * 0.5 + 0.12);
            p4.set(b.x + lx * cos + lz * sin, b.base + b.h * 0.62, b.z - lx * sin + lz * cos);
            q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot + (side < 0 ? Math.PI : 0));
            s4.set(2.05, Math.min(9.8, b.h * 0.38), 0.3);
            windowMatrices.push(new THREE.Matrix4().compose(p4, q4, s4));

            const blz = side * (b.d * 0.5 + 0.8);
            const blx = lx + (b.w / cols) * 0.5;
            if (blx < b.w * 0.48) {
              p4.set(b.x + blx * cos + blz * sin, b.base + b.h * 0.46, b.z - blx * sin + blz * cos);
              q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
              s4.set(1.4, b.h * 0.88, 2.0);
              pushGeo(bucket, boxUnit, m4.compose(p4, q4, s4));
            }
          }
        }
      }
    }

    const addMerged = (geos: THREE.BufferGeometry[], mat: THREE.Material): void => {
      if (!geos.length) return;
      const merged = mergeGeometries(geos, false);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.root.add(mesh);
    };

    addMerged(stoneGeos, stoneMat);
    addMerged(roofGeos, roofMat);
    addMerged(woodGeos, woodMat);
    addMerged(rockGeos, rockMat);
    addMerged(goldGeos, goldMat);

    // Instanced glowing Gothic Stained-Glass Windows
    this.winMat = new THREE.MeshStandardMaterial({
      color: 0xffd692,
      emissive: 0xff9a38,
      emissiveIntensity: 2.6,
      roughness: 0.18,
    });
    if (windowMatrices.length) {
      const winGeo = new THREE.BoxGeometry(1, 1, 1);
      const inst = new THREE.InstancedMesh(winGeo, this.winMat, windowMatrices.length);
      windowMatrices.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      this.root.add(inst);
    }

    // Grand Glowing Rose Window on the Great Hall facade facing the Lake
    const roseWindow = new THREE.Mesh(new THREE.CircleGeometry(6.8, 24), this.winMat);
    roseWindow.position.set(-10, WORLD.plateauHeight + 25, -26.8);
    this.root.add(roseWindow);
    const roseRim = new THREE.Mesh(new THREE.TorusGeometry(6.9, 0.55, 10, 28), goldMat);
    roseRim.position.copy(roseWindow.position);
    this.root.add(roseRim);

    // Golden Stadium Hoops + House Banners
    const torusGeo = new THREE.TorusGeometry(4.2, 0.35, 12, 32);
    for (const h of layout.hoops) {
      const m = new THREE.Mesh(torusGeo, goldMat);
      m.position.set(h.x, h.y, h.z);
      m.rotation.y = h.rot;
      m.castShadow = true;
      this.root.add(m);
    }

    const bannerGeo = new THREE.PlaneGeometry(5.5, 16, 1, 6);
    const S = WORLD.stadiumCenter;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const house = HOUSES[i % HOUSES.length];
      const bMat = new THREE.MeshStandardMaterial({
        color: house.color,
        emissive: house.color,
        emissiveIntensity: 0.28,
        roughness: 0.65,
        side: THREE.DoubleSide,
      });
      const bm = new THREE.Mesh(bannerGeo, bMat);
      bm.position.set(S.x + Math.cos(a) * 126, 32, S.z + Math.sin(a) * 74);
      bm.lookAt(S.x, 32, S.z);
      this.root.add(bm);
    }
  }

  // ---------------------------------------------------------------- Enchanted Floating Lanterns

  private buildEnchantedLanterns(): void {
    const rng = mulberry32(WORLD.seed + 303);
    const count = 120;
    const geo = new THREE.CylinderGeometry(0.28, 0.22, 0.9, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffe49e,
      emissive: 0xffa630,
      emissiveIntensity: 3.2,
      roughness: 0.2,
    });
    this.floatingLanterns = new THREE.InstancedMesh(geo, mat, count);
    for (let i = 0; i < count; i++) {
      const x = WORLD.castleCenter.x + range(rng, -135, 135);
      const z = WORLD.castleCenter.z + range(rng, -110, 120);
      const y = WORLD.plateauHeight + range(rng, 10, 88);
      this.lanternBasePos.push({ x, y, z, phase: rng() * Math.PI * 2 });
    }
    this.root.add(this.floatingLanterns);
  }

  // ---------------------------------------------------------------- Instanced Highland Pine Forests & Boulders

  private buildForestAndRocks(pbr: Record<TexName, PbrSet>): void {
    const rng = mulberry32(WORLD.seed + 999);
    const maxTrees = this.engine.preset.trees;

    const trunkGeo = new THREE.CylinderGeometry(0.28, 0.52, 4.2, 7);
    trunkGeo.translate(0, 2.1, 0);
    const cone1 = new THREE.ConeGeometry(2.6, 6.5, 7);
    cone1.translate(0, 6.2, 0);
    const cone2 = new THREE.ConeGeometry(1.9, 5.4, 7);
    cone2.translate(0, 9.6, 0);
    const foliageGeo = mergeGeometries([cone1.toNonIndexed(), cone2.toNonIndexed()], false);

    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x3b281a, roughness: 0.92 });
    const foliageMat = new THREE.MeshStandardMaterial({
      map: pbr.grass.map,
      normalMap: pbr.grass.normal,
      color: 0x244228,
      roughness: 0.84,
    });

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, maxTrees);
    const foliage = new THREE.InstancedMesh(foliageGeo, foliageMat, maxTrees);
    trunks.castShadow = true;
    foliage.castShadow = true;
    foliage.receiveShadow = true;

    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const col = new THREE.Color();

    let placed = 0;
    let attempts = 0;
    while (placed < maxTrees && attempts < maxTrees * 5) {
      attempts++;
      const x = range(rng, -WORLD.half * 0.88, WORLD.half * 0.88);
      const z = range(rng, -WORLD.half * 0.88, WORLD.half * 0.88);
      if (Math.hypot(x - WORLD.castleCenter.x, z - WORLD.castleCenter.z) < 225) continue;
      if (Math.hypot(x - WORLD.stadiumCenter.x, z - WORLD.stadiumCenter.z) < 165) continue;
      if (Math.hypot(x - WORLD.stonesCenter.x, z - WORLD.stonesCenter.z) < 55) continue;
      if (isLake(x, z)) continue;

      const y = heightAt(x, z);
      if (y < WORLD.waterLevel + 3 || y > 145) continue;
      const n = normalAt(x, z);
      if (n.y < 0.76) continue;

      const s = range(rng, 0.85, 1.95);
      pos.set(x, y - 0.3, z);
      quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng() * Math.PI * 2);
      scl.set(s, s * range(rng, 0.9, 1.25), s);
      m.compose(pos, quat, scl);
      trunks.setMatrixAt(placed, m);
      foliage.setMatrixAt(placed, m);
      col.setHSL(0.33 + range(rng, -0.03, 0.03), 0.38, range(rng, 0.16, 0.28));
      foliage.setColorAt(placed, col);
      placed++;
    }
    trunks.count = placed;
    foliage.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    foliage.instanceMatrix.needsUpdate = true;
    if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
    this.root.add(trunks, foliage);

    const rockCount = Math.floor(maxTrees * 0.22);
    const boulderGeo = new THREE.DodecahedronGeometry(1.8, 1);
    const boulderMat = new THREE.MeshStandardMaterial({
      map: pbr.rock.map,
      normalMap: pbr.rock.normal,
      roughnessMap: pbr.rock.roughnessMap,
      roughness: 0.86,
    });
    const boulders = new THREE.InstancedMesh(boulderGeo, boulderMat, rockCount);
    boulders.castShadow = true;
    boulders.receiveShadow = true;
    let rPlaced = 0;
    for (let i = 0; i < rockCount * 3 && rPlaced < rockCount; i++) {
      const x = range(rng, -WORLD.half * 0.85, WORLD.half * 0.85);
      const z = range(rng, -WORLD.half * 0.85, WORLD.half * 0.85);
      const y = heightAt(x, z);
      if (y < WORLD.waterLevel - 1) continue;
      pos.set(x, y + 0.2, z);
      quat.setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, rng() * 3));
      scl.set(range(rng, 0.8, 3.2), range(rng, 0.6, 2.1), range(rng, 0.8, 3.2));
      m.compose(pos, quat, scl);
      boulders.setMatrixAt(rPlaced++, m);
    }
    boulders.count = rPlaced;
    boulders.instanceMatrix.needsUpdate = true;
    this.root.add(boulders);
  }

  // ---------------------------------------------------------------- Volumetric-Style Clouds

  private buildClouds(): void {
    const rng = mulberry32(WORLD.seed + 555);
    const tex = cloudSprite(19);
    const count = this.engine.preset.clouds;
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({
        map: tex,
        color: new THREE.Color().setHSL(0.06, 0.35, range(rng, 0.62, 0.88)),
        transparent: true,
        opacity: range(rng, 0.22, 0.48),
        depthWrite: false,
      });
      const sp = new THREE.Sprite(mat);
      const baseY = range(rng, 250, 410);
      sp.position.set(range(rng, -WORLD.half, WORLD.half), baseY, range(rng, -WORLD.half, WORLD.half));
      const w = range(rng, 190, 380);
      sp.scale.set(w, w * 0.42, 1);
      this.root.add(sp);
      this.clouds.push({ sprite: sp, speed: range(rng, 2.5, 6.5), baseY });
    }
  }

  // ---------------------------------------------------------------- Arcane Storm Zone

  private buildStormZone(): void {
    const cylGeo = new THREE.CylinderGeometry(1, 1, 520, 72, 1, true);
    cylGeo.translate(0, 240, 0);

    this.zoneMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        varying float vH;
        void main() {
          vUv = uv;
          vH = position.y;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vH;
        void main() {
          float bands = sin(vUv.x * 62.8318 + uTime * 1.8) * 0.5 + 0.5;
          float pulse = sin(vUv.y * 28.0 - uTime * 3.4 + bands * 3.14) * 0.5 + 0.5;
          float verticalFade = (1.0 - smoothstep(0.0, 0.95, vUv.y));
          float bottomEdge = smoothstep(0.0, 0.08, vUv.y);
          float alpha = (0.08 + pulse * 0.14) * verticalFade * bottomEdge;
          vec3 col = mix(vec3(0.55, 0.18, 0.95), vec3(0.95, 0.42, 0.85), pulse);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });

    this.zoneWall = new THREE.Mesh(cylGeo, this.zoneMat);
    this.root.add(this.zoneWall);

    const ringGeo = new THREE.RingGeometry(0.992, 1.0, 72);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xffe08a,
      transparent: true,
      opacity: 0.42,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.nextZoneRing = new THREE.Mesh(ringGeo, ringMat);
    this.nextZoneRing.position.y = WORLD.waterLevel + 1.5;
    this.root.add(this.nextZoneRing);

    // 3D Sky Beacon Waypoint Pillar for Map Navigation
    const wpGeo = new THREE.CylinderGeometry(2.2, 2.2, 420, 20, 1, true);
    wpGeo.translate(0, 210, 0);
    const wpMat = new THREE.MeshBasicMaterial({
      color: 0x52ffaa,
      transparent: true,
      opacity: 0.36,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.waypointBeam = new THREE.Mesh(wpGeo, wpMat);
    this.waypointBeam.visible = false;
    this.root.add(this.waypointBeam);
  }

  setWaypoint(x: number, z: number): void {
    const y = Math.max(heightAt(x, z), WORLD.waterLevel);
    this.waypointPos = new THREE.Vector3(x, y, z);
    this.waypointBeam.position.copy(this.waypointPos);
    this.waypointBeam.visible = true;
  }

  clearWaypoint(): void {
    this.waypointPos = null;
    this.waypointBeam.visible = false;
  }

  getWaypoint(): THREE.Vector3 | null {
    return this.waypointPos;
  }

  // ---------------------------------------------------------------- Per-frame Update

  update(time: number, dt: number, playerPos: THREE.Vector3, zone: ZoneState): void {
    this.sun.target.position.set(playerPos.x, Math.max(0, playerPos.y * 0.4), playerPos.z);
    this.sun.position.copy(this.sun.target.position).addScaledVector(this.sunDir, 420);
    this.sun.target.updateMatrixWorld();

    // Storm mode dynamic sheet lightning flashes
    if (this.atmosphere === 'storm') {
      if (Math.random() < dt * 0.25) this.lightningFlash = 1.0;
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 4.5);
      this.sun.intensity = 2.2 + this.lightningFlash * 5.5;
    }

    if (this.auroraMesh.visible) {
      this.auroraMat.uniforms.uTime.value = time;
    }

    // Animate Enchanted Floating Lanterns around the Castle
    const dummy = new THREE.Matrix4();
    for (let i = 0; i < this.lanternBasePos.length; i++) {
      const lp = this.lanternBasePos[i];
      dummy.makeTranslation(lp.x, lp.y + Math.sin(time * 1.4 + lp.phase) * 1.6, lp.z);
      this.floatingLanterns.setMatrixAt(i, dummy);
    }
    this.floatingLanterns.instanceMatrix.needsUpdate = true;

    if (this.water && 'material' in this.water) {
      const mat = this.water.material as THREE.ShaderMaterial & { uniforms?: Record<string, { value: number }> };
      if (mat.uniforms?.['time']) {
        mat.uniforms['time'].value = time * 0.65;
      } else {
        this.waterNormalTex.offset.x = time * 0.02;
        this.waterNormalTex.offset.y = time * 0.015;
      }
    }

    for (const c of this.clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > WORLD.half) c.sprite.position.x = -WORLD.half;
    }

    this.voxels.update(time);

    const r = Math.max(0.5, zone.r);
    this.zoneWall.position.set(zone.cx, -10, zone.cz);
    this.zoneWall.scale.set(r, 1, r);
    this.zoneMat.uniforms.uTime.value = time;

    const nr = Math.max(0.5, zone.nextR);
    this.nextZoneRing.position.set(zone.nextCx, WORLD.waterLevel + 1.5, zone.nextCz);
    this.nextZoneRing.scale.set(nr, 1, nr);
    this.nextZoneRing.visible = nr > 1;
  }
}
