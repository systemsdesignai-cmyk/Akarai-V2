import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { probeWebGLCapability } from './launchState';

export type PillarId = 'properties' | 'tenants' | 'payments';

export interface ProjectedAnchor {
  x: number; // percentage 0..100
  y: number; // percentage 0..100
  visible: boolean;
}

export type ProjectedAnchorsMap = Record<PillarId, ProjectedAnchor>;

export interface AkaraiDioramaSceneProps {
  isDark: boolean;
  skipToSettled: boolean;
  replayNonce: number;
  activePillar: PillarId | null;
  onProgress?: (elapsedSec: number, settled: boolean) => void;
  onProjectAnchors?: (anchors: ProjectedAnchorsMap) => void;
  onWebGLError?: () => void;
}

const INTRO_DURATION_SEC = 4.8;

// Module-scope reusable math objects — zero GC inside render loop
const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _projVec = new THREE.Vector3();
const _tmpPosA = new THREE.Vector3();
const _tmpPosB = new THREE.Vector3();
const _tmpLookA = new THREE.Vector3();
const _tmpLookB = new THREE.Vector3();
const _dummyMatrix = new THREE.Object3D();

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smootherstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function createContactShadowTexture(isDark: boolean): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.48
  );
  if (isDark) {
    grad.addColorStop(0, 'rgba(1, 69, 242, 0.36)');
    grad.addColorStop(0.55, 'rgba(1, 69, 242, 0.14)');
    grad.addColorStop(1, 'rgba(1, 69, 242, 0)');
  } else {
    grad.addColorStop(0, 'rgba(1, 69, 242, 0.24)');
    grad.addColorStop(0.55, 'rgba(30, 107, 255, 0.09)');
    grad.addColorStop(1, 'rgba(1, 69, 242, 0)');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFlowingPathTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Base glowing blue river gradient across width
  const vGrad = ctx.createLinearGradient(0, 0, 0, h);
  vGrad.addColorStop(0, '#0145F2');
  vGrad.addColorStop(0.28, '#2C82FF');
  vGrad.addColorStop(0.5, '#C8E6FF');
  vGrad.addColorStop(0.72, '#2C82FF');
  vGrad.addColorStop(1, '#0145F2');
  ctx.fillStyle = vGrad;
  ctx.fillRect(0, 0, w, h);

  // Subtle luminous pulse streaks along length
  for (let i = 0; i < 3; i++) {
    const cx = (i * w) / 3 + 38;
    const pulse = ctx.createRadialGradient(cx, h / 2, 2, cx, h / 2, 46);
    pulse.addColorStop(0, 'rgba(255, 255, 255, 0.92)');
    pulse.addColorStop(0.45, 'rgba(130, 206, 255, 0.45)');
    pulse.addColorStop(1, 'rgba(1, 69, 242, 0)');
    ctx.fillStyle = pulse;
    ctx.fillRect(0, 0, w, h);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.repeat.set(3, 1);
  tex.anisotropy = Math.min(8, maxAnisotropy);
  return tex;
}

function createRoundedRectShape(width: number, depth: number, radius: number): THREE.Shape {
  const x = -width / 2;
  const y = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + depth - radius);
  shape.quadraticCurveTo(x + width, y + depth, x + width - radius, y + depth);
  shape.lineTo(x + radius, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}

interface BuildingPair {
  solid: THREE.Group;
  wireframe: THREE.Group;
  delay: number; // phase offset 0..0.45
}

interface ScenePalette {
  wallMat: THREE.MeshStandardMaterial;
  plinthMat: THREE.MeshStandardMaterial;
  roofMat: THREE.MeshStandardMaterial;
  trimMat: THREE.MeshStandardMaterial;
  windowMat: THREE.MeshStandardMaterial;
  doorMat: THREE.MeshStandardMaterial;
  trunkMat: THREE.MeshStandardMaterial;
  foliageMats: THREE.MeshStandardMaterial[];
  wireMat: THREE.LineBasicMaterial;
  balconyGlassMat: THREE.MeshStandardMaterial;
}

function addWireEdges(
  targetGroup: THREE.Group,
  geometry: THREE.BufferGeometry,
  wireMat: THREE.LineBasicMaterial,
  pos: [number, number, number],
  rot?: [number, number, number]
) {
  const edges = new THREE.EdgesGeometry(geometry, 24);
  const line = new THREE.LineSegments(edges, wireMat);
  line.position.set(pos[0], pos[1], pos[2]);
  if (rot) line.rotation.set(rot[0], rot[1], rot[2]);
  targetGroup.add(line);
}

/**
 * Composite 9-part gabled miniature house matching A1 + A5 hybrid aesthetics:
 * grounded plinth, matte-white walls, gable ends, electric-blue pitched roof,
 * ridge cap, chimney, recessed navy doorway, glowing warm windows, and courtyard shrub planter.
 */
function createGabledHouse(
  palette: ScenePalette,
  opts: {
    x: number;
    z: number;
    rotY?: number;
    scale?: number;
    width?: number;
    depth?: number;
    wallH?: number;
    delay?: number;
    hasChimney?: boolean;
  }
): BuildingPair {
  const w = opts.width ?? 1.55;
  const d = opts.depth ?? 1.32;
  const h = opts.wallH ?? 0.92;
  const roofH = 0.62;
  const plinthH = 0.1;

  const solid = new THREE.Group();
  const wireframe = new THREE.Group();

  // 1. Foundation plinth (grounded at y = 0)
  const plinthGeo = new THREE.BoxGeometry(w + 0.14, plinthH, d + 0.14);
  const plinth = new THREE.Mesh(plinthGeo, palette.plinthMat);
  plinth.position.set(0, plinthH / 2, 0);
  plinth.receiveShadow = true;
  plinth.castShadow = true;
  solid.add(plinth);
  addWireEdges(wireframe, plinthGeo, palette.wireMat, [0, plinthH / 2, 0]);

  // 2. Main house walls
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const body = new THREE.Mesh(bodyGeo, palette.wallMat);
  body.position.set(0, plinthH + h / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  solid.add(body);
  addWireEdges(wireframe, bodyGeo, palette.wireMat, [0, plinthH + h / 2, 0]);

  // 3. Gable triangular end walls (extruded along Z)
  const gableShape = new THREE.Shape();
  gableShape.moveTo(-w / 2, 0);
  gableShape.lineTo(w / 2, 0);
  gableShape.lineTo(0, roofH);
  gableShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, {
    depth: d,
    bevelEnabled: false,
  });
  gableGeo.translate(0, 0, -d / 2);
  const gableMesh = new THREE.Mesh(gableGeo, palette.wallMat);
  gableMesh.position.set(0, plinthH + h, 0);
  gableMesh.castShadow = true;
  gableMesh.receiveShadow = true;
  solid.add(gableMesh);
  addWireEdges(wireframe, gableGeo, palette.wireMat, [0, plinthH + h, 0]);

  // 4. Overhanging electric-blue pitched roof planes (left & right slopes)
  const slopeLen = Math.hypot(w / 2 + 0.14, roofH + 0.08);
  const slopeAngle = Math.atan2(roofH, w / 2);
  const roofThick = 0.095;
  const roofPanelGeo = new THREE.BoxGeometry(slopeLen, roofThick, d + 0.24);

  const leftSlope = new THREE.Mesh(roofPanelGeo, palette.roofMat);
  leftSlope.position.set(-w / 4 - 0.02, plinthH + h + roofH / 2 + 0.02, 0);
  leftSlope.rotation.z = slopeAngle;
  leftSlope.castShadow = true;
  leftSlope.receiveShadow = true;
  solid.add(leftSlope);
  addWireEdges(
    wireframe,
    roofPanelGeo,
    palette.wireMat,
    [-w / 4 - 0.02, plinthH + h + roofH / 2 + 0.02, 0],
    [0, 0, slopeAngle]
  );

  const rightSlope = new THREE.Mesh(roofPanelGeo, palette.roofMat);
  rightSlope.position.set(w / 4 + 0.02, plinthH + h + roofH / 2 + 0.02, 0);
  rightSlope.rotation.z = -slopeAngle;
  rightSlope.castShadow = true;
  rightSlope.receiveShadow = true;
  solid.add(rightSlope);
  addWireEdges(
    wireframe,
    roofPanelGeo,
    palette.wireMat,
    [w / 4 + 0.02, plinthH + h + roofH / 2 + 0.02, 0],
    [0, 0, -slopeAngle]
  );

  // Ridge cap
  const ridgeGeo = new THREE.BoxGeometry(0.12, 0.1, d + 0.26);
  const ridge = new THREE.Mesh(ridgeGeo, palette.roofMat);
  ridge.position.set(0, plinthH + h + roofH + 0.04, 0);
  solid.add(ridge);

  // 5. Signature Akarai chimney accent
  if (opts.hasChimney !== false) {
    const chimGeo = new THREE.BoxGeometry(0.18, 0.42, 0.18);
    const chim = new THREE.Mesh(chimGeo, palette.roofMat);
    chim.position.set(w * 0.25, plinthH + h + roofH * 0.68, -d * 0.15);
    chim.castShadow = true;
    solid.add(chim);
    addWireEdges(wireframe, chimGeo, palette.wireMat, [
      w * 0.25,
      plinthH + h + roofH * 0.68,
      -d * 0.15,
    ]);
  }

  // 6. Recessed Doorway + Entry Step (front +Z face)
  const doorFrameGeo = new THREE.BoxGeometry(0.32, 0.56, 0.06);
  const doorFrame = new THREE.Mesh(doorFrameGeo, palette.trimMat);
  doorFrame.position.set(0.24, plinthH + 0.28, d / 2 + 0.015);
  solid.add(doorFrame);

  const doorGlassGeo = new THREE.BoxGeometry(0.22, 0.46, 0.04);
  const doorGlass = new THREE.Mesh(doorGlassGeo, palette.doorMat);
  doorGlass.position.set(0.24, plinthH + 0.28, d / 2 + 0.032);
  solid.add(doorGlass);

  const stepGeo = new THREE.BoxGeometry(0.42, 0.06, 0.22);
  const step = new THREE.Mesh(stepGeo, palette.plinthMat);
  step.position.set(0.24, 0.03, d / 2 + 0.13);
  solid.add(step);

  // 7. Warm Golden Glowing Windows with Dark Navy Frames (front + left + right)
  const addWindow = (
    wx: number,
    wy: number,
    wz: number,
    ww: number,
    wh: number,
    rotY = 0
  ) => {
    const winGroup = new THREE.Group();
    const frame = new THREE.Mesh(new THREE.BoxGeometry(ww + 0.06, wh + 0.06, 0.05), palette.trimMat);
    const pane = new THREE.Mesh(new THREE.BoxGeometry(ww, wh, 0.065), palette.windowMat);
    winGroup.add(frame, pane);
    winGroup.position.set(wx, wy, wz);
    winGroup.rotation.y = rotY;
    solid.add(winGroup);
  };

  // Large hero front window
  addWindow(-0.28, plinthH + 0.46, d / 2 + 0.01, 0.42, 0.48, 0);
  // Side glowing windows
  addWindow(w / 2 + 0.01, plinthH + 0.46, 0.14, 0.44, 0.36, Math.PI / 2);
  addWindow(-w / 2 - 0.01, plinthH + 0.46, -0.06, 0.42, 0.36, -Math.PI / 2);
  // Back window
  addWindow(0, plinthH + 0.46, -d / 2 - 0.01, 0.48, 0.36, Math.PI);

  // 8. Courtyard planter box & green shrubs
  const planterGeo = new THREE.BoxGeometry(0.54, 0.14, 0.24);
  const planter = new THREE.Mesh(planterGeo, palette.plinthMat);
  planter.position.set(-0.34, 0.07, d / 2 + 0.16);
  solid.add(planter);

  const shrubPositions: [number, number, number, number][] = [
    [-0.46, 0.2, d / 2 + 0.16, 0.13],
    [-0.32, 0.24, d / 2 + 0.16, 0.16],
    [-0.19, 0.19, d / 2 + 0.16, 0.12],
  ];
  shrubPositions.forEach(([sx, sy, sz, sr], idx) => {
    const shrub = new THREE.Mesh(
      new THREE.DodecahedronGeometry(sr, 1),
      palette.foliageMats[idx % palette.foliageMats.length]
    );
    shrub.position.set(sx, sy, sz);
    shrub.castShadow = true;
    solid.add(shrub);
  });

  const s = opts.scale ?? 1;
  solid.position.set(opts.x, 0, opts.z);
  solid.rotation.y = opts.rotY ?? 0;
  solid.scale.set(s, s, s);

  wireframe.position.copy(solid.position);
  wireframe.rotation.copy(solid.rotation);
  wireframe.scale.copy(solid.scale);

  return { solid, wireframe, delay: opts.delay ?? 0 };
}

/**
 * Composite multi-story residential apartment building (back-right landmark in all 3 storyboards)
 */
function createApartmentBuilding(
  palette: ScenePalette,
  x: number,
  z: number,
  rotY = 0
): BuildingPair {
  const w = 2.3;
  const d = 1.65;
  const h = 2.55;
  const solid = new THREE.Group();
  const wireframe = new THREE.Group();

  // 1. Podium plinth
  const plinthGeo = new THREE.BoxGeometry(w + 0.2, 0.16, d + 0.2);
  const plinth = new THREE.Mesh(plinthGeo, palette.plinthMat);
  plinth.position.set(0, 0.08, 0);
  plinth.castShadow = true;
  plinth.receiveShadow = true;
  solid.add(plinth);
  addWireEdges(wireframe, plinthGeo, palette.wireMat, [0, 0.08, 0]);

  // 2. Main 4-story tower body
  const bodyGeo = new THREE.BoxGeometry(w, h, d);
  const body = new THREE.Mesh(bodyGeo, palette.wallMat);
  body.position.set(0, 0.16 + h / 2, 0);
  body.castShadow = true;
  body.receiveShadow = true;
  solid.add(body);
  addWireEdges(wireframe, bodyGeo, palette.wireMat, [0, 0.16 + h / 2, 0]);

  // 3. Electric-blue architectural roof parapet + cornice trim
  const roofTrimGeo = new THREE.BoxGeometry(w + 0.14, 0.12, d + 0.14);
  const roofTrim = new THREE.Mesh(roofTrimGeo, palette.roofMat);
  roofTrim.position.set(0, 0.16 + h + 0.05, 0);
  roofTrim.castShadow = true;
  solid.add(roofTrim);
  addWireEdges(wireframe, roofTrimGeo, palette.wireMat, [0, 0.16 + h + 0.05, 0]);

  // Rooftop penthouse utility box
  const pentGeo = new THREE.BoxGeometry(0.76, 0.28, 0.62);
  const pent = new THREE.Mesh(pentGeo, palette.wallMat);
  pent.position.set(0.32, 0.16 + h + 0.22, -0.15);
  pent.castShadow = true;
  solid.add(pent);

  // 4. Vertical electric-blue architectural facade accent fins & balconies
  [-0.78, 0.0, 0.78].forEach((fx) => {
    const finGeo = new THREE.BoxGeometry(0.11, h - 0.1, 0.14);
    const fin = new THREE.Mesh(finGeo, palette.roofMat);
    fin.position.set(fx, 0.16 + h / 2, d / 2 + 0.04);
    solid.add(fin);
  });

  // Horizontal balcony slabs & glass railings across 3 upper stories
  [0.86, 1.48, 2.1].forEach((by) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, 0.06, 0.24), palette.plinthMat);
    slab.position.set(0, by, d / 2 + 0.09);
    solid.add(slab);

    const rail = new THREE.Mesh(
      new THREE.BoxGeometry(w - 0.16, 0.16, 0.03),
      palette.balconyGlassMat
    );
    rail.position.set(0, by + 0.11, d / 2 + 0.18);
    solid.add(rail);
  });

  // 5. Warm glowing apartment windows (4 floors × 3 bays front + 2 bays side)
  const floorYs = [0.54, 1.15, 1.76, 2.36];
  const frontXs = [-0.42, 0.42];
  floorYs.forEach((fy) => {
    frontXs.forEach((fx) => {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.36, 0.05), palette.trimMat);
      frame.position.set(fx, fy, d / 2 + 0.01);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.29, 0.065), palette.windowMat);
      pane.position.set(fx, fy, d / 2 + 0.015);
      solid.add(frame, pane);
    });

    // Side windows (-X facing the neighborhood plaza)
    [-0.38, 0.38].forEach((sz) => {
      const sFrame = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.36, 0.48), palette.trimMat);
      sFrame.position.set(-w / 2 - 0.01, fy, sz);
      const sPane = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.29, 0.4), palette.windowMat);
      sPane.position.set(-w / 2 - 0.015, fy, sz);
      solid.add(sFrame, sPane);
    });
  });

  solid.position.set(x, 0, z);
  solid.rotation.y = rotY;
  wireframe.position.copy(solid.position);
  wireframe.rotation.copy(solid.rotation);

  return { solid, wireframe, delay: 0.12 };
}

/**
 * Composite 4-part stylized miniature tree (tapered trunk + 3 organic layered foliage clusters)
 */
function createMiniatureTree(
  palette: ScenePalette,
  x: number,
  z: number,
  scale = 1
): THREE.Group {
  const tree = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.08, 0.42, 7),
    palette.trunkMat
  );
  trunk.position.y = 0.21;
  trunk.castShadow = true;
  tree.add(trunk);

  const crowns: [number, number, number, number, number][] = [
    [0, 0.54, 0, 0.3, 0],
    [0.14, 0.62, 0.09, 0.22, 1],
    [-0.12, 0.68, -0.06, 0.21, 2],
    [0.02, 0.8, 0.02, 0.18, 1],
  ];
  crowns.forEach(([cx, cy, cz, r, matIdx]) => {
    const foliage = new THREE.Mesh(
      new THREE.DodecahedronGeometry(r, 1),
      palette.foliageMats[matIdx % palette.foliageMats.length]
    );
    foliage.position.set(cx, cy, cz);
    foliage.castShadow = true;
    foliage.receiveShadow = true;
    tree.add(foliage);
  });

  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  return tree;
}

export const AkaraiDioramaScene: React.FC<AkaraiDioramaSceneProps> = ({
  isDark,
  skipToSettled,
  replayNonce,
  activePillar,
  onProgress,
  onProjectAnchors,
  onWebGLError,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Store mutable props in refs so React UI updates never rebuild the WebGL scene
  const isDarkRef = useRef(isDark);
  const skipRef = useRef(skipToSettled);
  const activePillarRef = useRef(activePillar);
  const onProgressRef = useRef(onProgress);
  const onProjectAnchorsRef = useRef(onProjectAnchors);
  const onWebGLErrorRef = useRef(onWebGLError);
  const elapsedRef = useRef(skipToSettled ? INTRO_DURATION_SEC : 0);
  const settledNotifiedRef = useRef(skipToSettled);
  const lastReportedPhaseRef = useRef(-1);

  isDarkRef.current = isDark;
  activePillarRef.current = activePillar;
  onProgressRef.current = onProgress;
  onProjectAnchorsRef.current = onProjectAnchors;
  onWebGLErrorRef.current = onWebGLError;

  useEffect(() => {
    skipRef.current = skipToSettled;
    if (skipToSettled) {
      elapsedRef.current = INTRO_DURATION_SEC;
    }
  }, [skipToSettled]);

  useEffect(() => {
    if (replayNonce > 0) {
      elapsedRef.current = 0;
      settledNotifiedRef.current = false;
      lastReportedPhaseRef.current = -1;
    }
  }, [replayNonce]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const { supported, isSoftwareGl } = probeWebGLCapability();
    if (!supported) {
      onWebGLErrorRef.current?.();
      return;
    }

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        alpha: false,
      });
    } catch {
      onWebGLErrorRef.current?.();
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = isDarkRef.current ? 1.12 : 1.08;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const initialW = Math.max(container.clientWidth, 320);
    const initialH = Math.max(container.clientHeight, 320);
    renderer.setSize(initialW, initialH);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const darkNow = isDarkRef.current;
    const bgHex = darkNow ? 0x050811 : 0xf4f8fe;
    scene.background = new THREE.Color(bgHex);
    scene.fog = new THREE.FogExp2(bgHex, darkNow ? 0.028 : 0.021);

    // Mandatory Studio Environment Reflections (RoomEnvironment)
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTarget = pmremGenerator.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, initialW / initialH, 0.1, 90);

    // Balanced 3-Point Warm/Cool Studio Lighting
    const hemiLight = new THREE.HemisphereLight(
      darkNow ? 0x3b67c4 : 0xeaf2ff,
      darkNow ? 0x0a1020 : 0xdbe6f6,
      darkNow ? 0.95 : 1.4
    );
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(
      darkNow ? 0xddeaff : 0xfff7eb,
      darkNow ? 1.5 : 2.15
    );
    keyLight.position.set(8.5, 13.5, 9.0);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 32;
    const sd = 9.5;
    keyLight.shadow.camera.left = -sd;
    keyLight.shadow.camera.right = sd;
    keyLight.shadow.camera.top = sd;
    keyLight.shadow.camera.bottom = -sd;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4b8dff, darkNow ? 1.15 : 0.72);
    rimLight.position.set(-9, 6, -8);
    scene.add(rimLight);

    // Shared PBR Palette
    const palette: ScenePalette = {
      wallMat: new THREE.MeshStandardMaterial({
        color: darkNow ? 0xdde7f7 : 0xffffff,
        roughness: 0.62,
        metalness: 0.02,
      }),
      plinthMat: new THREE.MeshStandardMaterial({
        color: darkNow ? 0x24324c : 0xe3ebf7,
        roughness: 0.78,
        metalness: 0.05,
      }),
      roofMat: new THREE.MeshStandardMaterial({
        color: 0x0145f2,
        emissive: 0x012585,
        emissiveIntensity: darkNow ? 0.35 : 0.12,
        roughness: 0.28,
        metalness: 0.14,
      }),
      trimMat: new THREE.MeshStandardMaterial({
        color: 0x132242,
        roughness: 0.42,
        metalness: 0.18,
      }),
      windowMat: new THREE.MeshStandardMaterial({
        color: 0xffe49e,
        emissive: 0xffb73b,
        emissiveIntensity: darkNow ? 1.55 : 1.05,
        roughness: 0.18,
        metalness: 0.05,
      }),
      doorMat: new THREE.MeshStandardMaterial({
        color: 0xffdfa0,
        emissive: 0xffae33,
        emissiveIntensity: darkNow ? 1.1 : 0.72,
        roughness: 0.22,
        metalness: 0.05,
      }),
      trunkMat: new THREE.MeshStandardMaterial({
        color: 0x6b4b38,
        roughness: 0.9,
        metalness: 0.0,
      }),
      foliageMats: [
        new THREE.MeshStandardMaterial({ color: 0x2d7d36, roughness: 0.85, metalness: 0.0 }),
        new THREE.MeshStandardMaterial({ color: 0x3f9644, roughness: 0.82, metalness: 0.0 }),
        new THREE.MeshStandardMaterial({ color: 0x52ab50, roughness: 0.8, metalness: 0.0 }),
      ],
      wireMat: new THREE.LineBasicMaterial({
        color: 0x1e6bff,
        transparent: true,
        opacity: 0.92,
      }),
      balconyGlassMat: new THREE.MeshStandardMaterial({
        color: 0x4b93ff,
        emissive: 0x0145f2,
        emissiveIntensity: 0.22,
        transparent: true,
        opacity: 0.55,
        roughness: 0.15,
        metalness: 0.2,
      }),
    };

    // Root container for subtle B1 pointer parallax
    const worldRoot = new THREE.Group();
    scene.add(worldRoot);

    // 1. A1 Perspective Blueprint Grid + Instanced Luminous Intersection Nodes
    const gridGroup = new THREE.Group();
    const gridSize = 22;
    const gridStep = 1.6;
    const gridPts: number[] = [];
    const nodeCoords: [number, number][] = [];
    for (let i = -gridSize / 2; i <= gridSize / 2; i += gridStep) {
      gridPts.push(i, -0.26, -gridSize / 2, i, -0.26, gridSize / 2);
      gridPts.push(-gridSize / 2, -0.26, i, gridSize / 2, -0.26, i);
      for (let j = -gridSize / 2; j <= gridSize / 2; j += gridStep) {
        if (Math.abs(i) <= 7.2 && Math.abs(j) <= 7.2) {
          nodeCoords.push([i, j]);
        }
      }
    }
    const gridGeo = new THREE.BufferGeometry();
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPts, 3));
    const gridLineMat = new THREE.LineBasicMaterial({
      color: 0x1a6bff,
      transparent: true,
      opacity: darkNow ? 0.34 : 0.24,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const gridLines = new THREE.LineSegments(gridGeo, gridLineMat);
    gridGroup.add(gridLines);

    // Instanced blueprint nodes
    const nodeGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.02, 10);
    const nodeMat = new THREE.MeshBasicMaterial({
      color: 0x3b8dff,
      transparent: true,
      opacity: 0.78,
    });
    const nodeInstanced = new THREE.InstancedMesh(nodeGeo, nodeMat, nodeCoords.length);
    nodeCoords.forEach(([nx, nz], idx) => {
      _dummyMatrix.position.set(nx, -0.25, nz);
      _dummyMatrix.scale.set(1, 1, 1);
      _dummyMatrix.updateMatrix();
      nodeInstanced.setMatrixAt(idx, _dummyMatrix.matrix);
    });
    nodeInstanced.instanceMatrix.needsUpdate = true;
    nodeInstanced.computeBoundingSphere();
    gridGroup.add(nodeInstanced);
    worldRoot.add(gridGroup);

    // 2. Soft Contact Grounding Shadow Plane
    const shadowTex = createContactShadowTexture(darkNow);
    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(13.8, 12.8),
      new THREE.MeshBasicMaterial({
        map: shadowTex,
        transparent: true,
        depthWrite: false,
        opacity: 0.9,
      })
    );
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -0.24;
    worldRoot.add(contactShadow);

    // 3. Rounded Floating Estate Island + Electric-Blue Perimeter Glow Rail
    const islandGroup = new THREE.Group();
    const islandShape = createRoundedRectShape(8.8, 8.2, 1.35);
    const islandGeo = new THREE.ExtrudeGeometry(islandShape, {
      depth: 0.22,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 3,
    });
    islandGeo.rotateX(Math.PI / 2);
    const islandMat = new THREE.MeshStandardMaterial({
      color: darkNow ? 0x131c2e : 0xfafcff,
      roughness: 0.34,
      metalness: 0.06,
    });
    const islandMesh = new THREE.Mesh(islandGeo, islandMat);
    islandMesh.position.y = 0.0;
    islandMesh.receiveShadow = true;
    islandGroup.add(islandMesh);

    // Perimeter luminous blue halo rail
    const perimeter2D = islandShape.getSpacedPoints(84);
    const perimeter3D = perimeter2D.map((p) => new THREE.Vector3(p.x, -0.02, p.y));
    const perimeterCurve = new THREE.CatmullRomCurve3(perimeter3D, true);
    const perimeterGeo = new THREE.TubeGeometry(perimeterCurve, 96, 0.048, 8, true);
    const perimeterMat = new THREE.MeshStandardMaterial({
      color: 0x3b8dff,
      emissive: 0x0145f2,
      emissiveIntensity: darkNow ? 1.85 : 1.35,
      roughness: 0.2,
    });
    const perimeterRail = new THREE.Mesh(perimeterGeo, perimeterMat);
    islandGroup.add(perimeterRail);
    worldRoot.add(islandGroup);

    // 4. Curved Flowing Luminous Electric-Blue Street & Ledger Pathways (A5 Signature)
    const pathGroup = new THREE.Group();
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const flowTex = createFlowingPathTexture(maxAniso);
    const pathMat = new THREE.MeshStandardMaterial({
      map: flowTex,
      emissiveMap: flowTex,
      emissive: new THREE.Color(0x2277ff),
      emissiveIntensity: darkNow ? 1.55 : 1.15,
      roughness: 0.18,
      metalness: 0.1,
      transparent: true,
      opacity: 0.95,
    });

    const createRoadRibbon = (points: [number, number][], radius: number) => {
      const curve = new THREE.CatmullRomCurve3(
        points.map(([px, pz]) => new THREE.Vector3(px, 0.025, pz))
      );
      const tubeGeo = new THREE.TubeGeometry(curve, 64, radius, 8, false);
      tubeGeo.scale(1, 0.18, 1);
      const mesh = new THREE.Mesh(tubeGeo, pathMat);
      mesh.position.y = 0.025;
      pathGroup.add(mesh);
    };

    // Main A5 sweeping street from foreground entry past hero house to apartment plaza
    createRoadRibbon(
      [
        [-0.35, 3.85],
        [-0.1, 2.25],
        [0.45, 0.75],
        [0.95, -0.85],
        [1.55, -2.05],
      ],
      0.24
    );
    // Cross-branch linking left cottages to right cottages
    createRoadRibbon(
      [
        [-3.4, 0.55],
        [-1.4, 0.55],
        [0.45, 0.75],
        [2.35, 0.95],
        [3.45, 0.85],
      ],
      0.16
    );
    // Upper link to back cottages
    createRoadRibbon(
      [
        [-2.3, -1.75],
        [-0.65, -1.45],
        [0.95, -0.85],
      ],
      0.14
    );
    worldRoot.add(pathGroup);

    // 5. Composite Neighborhood Buildings (Hero Gabled Homes + Multi-Story Apartment Block)
    const buildings: BuildingPair[] = [
      // Hero Foreground Gabled Home (left of A5 street glide!)
      createGabledHouse(palette, {
        x: -1.75,
        z: 2.05,
        rotY: 0.28,
        scale: 1.06,
        delay: 0.0,
        hasChimney: true,
      }),
      // Mid-Left Residential Cottage
      createGabledHouse(palette, {
        x: -2.45,
        z: -0.65,
        rotY: 0.1,
        scale: 0.94,
        delay: 0.1,
      }),
      // Back-Left Cottage
      createGabledHouse(palette, {
        x: -0.75,
        z: -2.45,
        rotY: -0.15,
        scale: 0.88,
        delay: 0.18,
      }),
      // Right Foreground Cottage
      createGabledHouse(palette, {
        x: 2.1,
        z: 2.15,
        rotY: -0.45,
        scale: 0.92,
        delay: 0.15,
      }),
      // Mid-Right Cottage
      createGabledHouse(palette, {
        x: 2.9,
        z: 0.05,
        rotY: -Math.PI / 2 + 0.15,
        scale: 0.84,
        delay: 0.24,
      }),
      // Hero Multi-Story Apartment Block (back-right landmark!)
      createApartmentBuilding(palette, 2.25, -2.05, -0.32),
    ];

    buildings.forEach(({ solid, wireframe }) => {
      worldRoot.add(solid);
      worldRoot.add(wireframe);
    });

    // 6. Stylized Courtyard Trees (11 composite multi-part trees)
    const treesGroup = new THREE.Group();
    const treeSpecs: [number, number, number][] = [
      [-3.35, 2.35, 1.05],
      [-0.55, 1.35, 0.78],
      [-3.55, -1.65, 1.0],
      [-1.75, -2.95, 0.92],
      [0.45, -2.95, 0.88],
      [3.55, -2.45, 0.96],
      [3.65, 1.55, 0.9],
      [1.05, 2.95, 0.82],
      [-2.85, 0.65, 0.76],
      [1.35, 0.1, 0.72],
    ];
    treeSpecs.forEach(([tx, tz, ts]) => {
      treesGroup.add(createMiniatureTree(palette, tx, tz, ts));
    });
    worldRoot.add(treesGroup);

    // 3D World Anchors for B1 Interactive Pillar Beacons
    const pillarAnchors: Record<PillarId, THREE.Vector3> = {
      properties: new THREE.Vector3(-1.75, 2.05, 2.05),
      tenants: new THREE.Vector3(-2.45, 1.85, -0.65),
      payments: new THREE.Vector3(2.25, 3.25, -2.05),
    };

    // Subtle pointer/touch parallax targets for B1 settled state
    const pointerTarget = { x: 0, y: 0 };
    const pointerCurrent = { x: 0, y: 0 };

    const handlePointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      pointerTarget.x = Math.max(-1, Math.min(1, nx));
      pointerTarget.y = Math.max(-1, Math.min(1, ny));
    };

    const handlePointerLeave = () => {
      pointerTarget.x = 0;
      pointerTarget.y = 0;
    };

    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    container.addEventListener('pointerleave', handlePointerLeave, { passive: true });

    // Pre-warm shaders on GPU
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    // Resize handling
    const handleResize = () => {
      if (!container) return;
      const w = Math.max(container.clientWidth, 320);
      const h = Math.max(container.clientHeight, 320);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // WebGL Context Loss Guard
    const handleContextLost = (e: Event) => {
      e.preventDefault();
      onWebGLErrorRef.current?.();
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);

    // Animation Loop (with software-GL fenceSync pacing)
    let frameId = 0;
    let disposed = false;
    let lastNow = performance.now();

    function applyChoreography(tSec: number, dt: number, totalTime: number) {
      // Phase 1 (0.00 -> 1.15): A1 Blueprint Grid & Wireframe Awakening
      const gridAlpha = smootherstep(0.0, 0.55, tSec);
      const gridFadeLater = 1 - smootherstep(3.2, 4.5, tSec) * 0.42;
      gridLineMat.opacity = (darkNow ? 0.34 : 0.24) * gridAlpha * gridFadeLater;
      nodeMat.opacity = 0.8 * gridAlpha * (1 - smootherstep(2.6, 4.0, tSec) * 0.65);

      // Floating island & glowing road rise softly
      const islandReveal = smootherstep(0.55, 1.55, tSec);
      islandGroup.scale.set(
        0.92 + 0.08 * islandReveal,
        Math.max(0.01, islandReveal),
        0.92 + 0.08 * islandReveal
      );
      islandGroup.visible = islandReveal > 0.01;
      contactShadow.visible = islandReveal > 0.05;
      (contactShadow.material as THREE.MeshBasicMaterial).opacity = 0.9 * islandReveal;

      const pathReveal = smootherstep(0.95, 1.95, tSec);
      pathGroup.visible = pathReveal > 0.01;
      pathMat.opacity = 0.95 * pathReveal;

      // Flowing blue light along street pathways
      flowTex.offset.x = -(totalTime * 0.32) % 1;

      // Buildings: wireframe extrudes first (0.25..1.15), solid rises right behind (0.90..1.95)
      buildings.forEach(({ solid, wireframe, delay }) => {
        const wProg = smootherstep(0.22 + delay, 1.02 + delay, tSec);
        const sProg = smootherstep(0.88 + delay, 1.72 + delay, tSec);
        const wFadeOut = 1 - smootherstep(1.28 + delay, 1.92 + delay, tSec);

        wireframe.visible = wProg > 0.01 && wFadeOut > 0.02;
        if (wireframe.visible) {
          wireframe.scale.y = Math.max(0.02, wProg) * solid.scale.x;
        }

        solid.visible = sProg > 0.01;
        if (solid.visible) {
          solid.scale.y = Math.max(0.02, sProg) * solid.scale.x;
        }
      });
      palette.wireMat.opacity = 0.9 * (1 - smootherstep(1.45, 2.2, tSec));

      // Courtyard trees pop in gracefully during Phase 2
      const treeProg = smootherstep(1.5, 2.45, tSec);
      treesGroup.visible = treeProg > 0.01;
      treesGroup.scale.set(1, Math.max(0.01, treeProg), 1);

      // Gentle warm golden window luminance breathing in settled state
      const breath = 1 + Math.sin(totalTime * 1.45) * 0.08;
      palette.windowMat.emissiveIntensity = (darkNow ? 1.55 : 1.05) * breath;

      // Responsive aspect adjustment so narrow portrait phones frame the whole island cleanly
      const aspect = camera.aspect;
      const portraitPullback = aspect < 0.85 ? 1 + (0.85 - aspect) * 1.25 : 1;

      // Smooth A1 + A5 Camera Choreography (4 continuous spline segments)
      if (tSec < 1.15) {
        // Segment 1: A1 Blueprint Grid Awakening -> descending toward street
        const p = smootherstep(0.0, 1.15, tSec);
        _tmpPosA.set(0.35, 3.4, 8.2 * portraitPullback);
        _tmpPosB.set(-0.35, 1.42, 5.25);
        _camPos.lerpVectors(_tmpPosA, _tmpPosB, p);

        _tmpLookA.set(0.0, 0.0, 0.35);
        _tmpLookB.set(-0.45, 0.72, 1.05);
        _camTarget.lerpVectors(_tmpLookA, _tmpLookB, p);
      } else if (tSec < 2.55) {
        // Segment 2: A5 Intimate Low-Angle Street Glide past hero glowing house toward apartments
        const p = smootherstep(1.15, 2.55, tSec);
        _tmpPosA.set(-0.35, 1.42, 5.25);
        _tmpPosB.set(0.85, 1.48, 3.55);
        _camPos.lerpVectors(_tmpPosA, _tmpPosB, p);
        // Subtle cinematic arc dipping close to street level mid-glide
        _camPos.y -= Math.sin(p * Math.PI) * 0.24;

        _tmpLookA.set(-0.45, 0.72, 1.05);
        _tmpLookB.set(0.95, 1.15, -1.2);
        _camTarget.lerpVectors(_tmpLookA, _tmpLookB, p);
      } else if (tSec < 3.95) {
        // Segment 3: A5 Continuous Crane Pull-Back into A1 Elevated Master Isometric
        const p = smootherstep(2.55, 3.95, tSec);
        _tmpPosA.set(0.85, 1.48, 3.55);
        _tmpPosB.set(
          6.8 * portraitPullback,
          7.6 * portraitPullback,
          9.4 * portraitPullback
        );
        _camPos.lerpVectors(_tmpPosA, _tmpPosB, p);
        _camPos.x += Math.sin(p * Math.PI) * 1.1;

        _tmpLookA.set(0.95, 1.15, -1.2);
        _tmpLookB.set(0.0, 0.85, 0.0);
        _camTarget.lerpVectors(_tmpLookA, _tmpLookB, p);
      } else {
        // Segment 4: Settle cleanly into B1 Living Isometric Canvas (island in lower-center third)
        const p = smootherstep(3.95, INTRO_DURATION_SEC, tSec);
        const settledDist = portraitPullback;
        _tmpPosA.set(6.8 * settledDist, 7.6 * settledDist, 9.4 * settledDist);
        _tmpPosB.set(6.35 * settledDist, 7.35 * settledDist, 9.85 * settledDist);
        _camPos.lerpVectors(_tmpPosA, _tmpPosB, p);

        // Shift target subtly upward (+1.55 on Y) so the island sits gracefully in lower-center
        // leaving clean uncluttered breathing room above for Akarai's official brand lockup
        const verticalOffset = aspect < 0.85 ? 1.55 : 1.05;
        _tmpLookA.set(0.0, 0.85, 0.0);
        _tmpLookB.set(0.0, verticalOffset, 0.0);
        _camTarget.lerpVectors(_tmpLookA, _tmpLookB, p);
      }

      // Smooth B1 pointer/touch parallax + subtle ambient orbital breathing once settled
      const isSettled = tSec >= INTRO_DURATION_SEC;
      const dampRate = 3.8;
      pointerCurrent.x = THREE.MathUtils.damp(
        pointerCurrent.x,
        isSettled ? pointerTarget.x : 0,
        dampRate,
        dt
      );
      pointerCurrent.y = THREE.MathUtils.damp(
        pointerCurrent.y,
        isSettled ? pointerTarget.y : 0,
        dampRate,
        dt
      );

      // Gentle focus nudge when user selects a pillar in B1
      let focusX = 0;
      let focusZ = 0;
      if (isSettled && activePillarRef.current) {
        const anchor = pillarAnchors[activePillarRef.current];
        focusX = anchor.x * 0.14;
        focusZ = anchor.z * 0.14;
      }

      const ambientOrbit = isSettled ? Math.sin(totalTime * 0.35) * 0.045 : 0;
      worldRoot.rotation.y = THREE.MathUtils.damp(
        worldRoot.rotation.y,
        pointerCurrent.x * 0.13 + ambientOrbit,
        4.2,
        dt
      );
      worldRoot.rotation.x = THREE.MathUtils.damp(
        worldRoot.rotation.x,
        pointerCurrent.y * 0.045,
        4.2,
        dt
      );

      camera.position.copy(_camPos);
      camera.lookAt(_camTarget.x + focusX, _camTarget.y, _camTarget.z + focusZ);
    }

    function projectPillarAnchors() {
      if (!onProjectAnchorsRef.current) return;
      worldRoot.updateMatrixWorld(true);
      const out = {} as ProjectedAnchorsMap;
      (['properties', 'tenants', 'payments'] as PillarId[]).forEach((id) => {
        _projVec.copy(pillarAnchors[id]).applyMatrix4(worldRoot.matrixWorld);
        _projVec.project(camera);
        const visible = _projVec.z < 1 && _projVec.z > -1;
        out[id] = {
          x: (_projVec.x * 0.5 + 0.5) * 100,
          y: (-_projVec.y * 0.5 + 0.5) * 100,
          visible,
        };
      });
      onProjectAnchorsRef.current(out);
    }

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const status = sync ? gl.getSyncParameter(sync, gl.SYNC_STATUS) : gl.SIGNALED;
        if (status === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const startTime = performance.now();

    function tick() {
      if (disposed) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastNow) / 1000));
      lastNow = now;

      if (skipRef.current) {
        elapsedRef.current = INTRO_DURATION_SEC;
      } else if (elapsedRef.current < INTRO_DURATION_SEC) {
        elapsedRef.current = Math.min(INTRO_DURATION_SEC, elapsedRef.current + dt);
      }

      const tSec = elapsedRef.current;
      const totalTime = (now - startTime) / 1000;
      const settled = tSec >= INTRO_DURATION_SEC;

      applyChoreography(tSec, dt, totalTime);
      renderer.render(scene, camera);
      projectPillarAnchors();

      // Throttle React progress notifications to key milestones (not every frame!)
      const quantized = Math.floor(tSec * 8);
      if (quantized !== lastReportedPhaseRef.current || (settled && !settledNotifiedRef.current)) {
        lastReportedPhaseRef.current = quantized;
        if (settled) settledNotifiedRef.current = true;
        onProgressRef.current?.(tSec, settled);
      }

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('resize', handleResize);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerleave', handlePointerLeave);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);

      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach((m) => m.dispose());
        } else if (mat) {
          mat.dispose();
        }
      });
      shadowTex.dispose();
      flowTex.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [isDark]);

  return (
    <div
      ref={mountRef}
      className="w-full h-full touch-pan-y cursor-grab active:cursor-grabbing"
    />
  );
};

export default AkaraiDioramaScene;
