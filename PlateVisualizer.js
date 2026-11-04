/**
 * @fileoverview Stage 3: 1960s EMT-140 Cutaway Studio Chassis Renderer (Three.js r128+),
 * PBR Metallurgy Switcher, Vacuum Tube Amplifier Assembly, and Zero-GC 2D Modal Standing-Wave Solver.
 */

const MATERIAL_PRESETS = [
  {
    name: 'COLD-ROLLED STEEL (EMT 140)',
    color: 0xb8c9dc,
    roughness: 0.33,
    metalness: 0.91,
    clearcoat: 0.12,
    clearcoatRoughness: 0.24
  },
  {
    name: '24K GOLD FOIL (EMT 240)',
    color: 0xffd700,
    roughness: 0.18,
    metalness: 0.98,
    clearcoat: 0.50,
    clearcoatRoughness: 0.10
  },
  {
    name: 'ALUMINIUM ALLOY',
    color: 0xe2e8f0,
    roughness: 0.52,
    metalness: 0.78,
    clearcoat: 0.00,
    clearcoatRoughness: 0.40
  },
  {
    name: 'TITANIUM FOIL',
    color: 0x7c8b99,
    roughness: 0.28,
    metalness: 0.87,
    clearcoat: 0.32,
    clearcoatRoughness: 0.18
  }
];

export class PlateVisualizer {
  constructor(containerEl, audioEngine) {
    this.container = containerEl;
    this.audioEngine = audioEngine;

    this.THREE = window.THREE;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    // Scene Meshes
    this.rootGroup = null;
    this.plateMesh = null;
    this.plateGeometry = null;
    this.plateMaterial = null;
    this.damperGroup = null;
    this.driverMesh = null;
    this.driverCoilGlow = null;
    this.pickupLeftMesh = null;
    this.pickupRightMesh = null;
    this.springMeshes = [];
    this.tubeFilaments = [];

    // Pre-allocated Zero-GC Modal Displacement Buffers (129 x 129 = 16,641 vertices)
    this.segX = 128;
    this.segY = 128;
    this.vertexCount = (this.segX + 1) * (this.segY + 1);
    this.baseZ = new Float32Array(this.vertexCount);
    this.modalBasis = new Float32Array(16 * this.vertexCount);
    this.modePhases = new Float32Array(16);
    this.modeSpeeds = new Float32Array([
      14.2, 21.7, 29.3, 38.1,
      23.5, 31.4, 41.8, 52.6,
      34.9, 44.2, 56.1, 68.4,
      47.3, 59.8, 73.5, 89.2
    ]);
    this.modeAmplitudes = new Float32Array(16);

    // Target & Smoothed Physical Parameters
    this.targetDampingZ = 0.12;
    this.currentDampingZ = 0.12;
    this.targetPlateScale = 1.0;
    this.currentPlateScale = 1.0;
    this.lastTime = performance.now() * 0.001;

    this._initScene();
    this._buildProceduralEnvironment();
    this._buildProceduralChassis();
    this._initOrbitControls();
    this._bindResize();
  }

  _initScene() {
    const THREE = this.THREE;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 360;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c0e10);
    this.scene.fog = new THREE.FogExp2(0x0c0e10, 0.13);

    this.camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 50);
    this.camera.position.set(0.0, -1.68, 1.88);
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.28;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    // 1960s Studio Warm Tungsten + Cool Hammerite Rim Lighting
    const ambient = new THREE.AmbientLight(0xe6dcc8, 0.58);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffe6c2, 2.5);
    keyLight.position.set(2.0, -2.4, 3.1);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x88b4d8, 1.45);
    rimLight.position.set(-2.5, 1.8, 1.9);
    this.scene.add(rimLight);

    const tubeWarmLight = new THREE.PointLight(0xff8c24, 1.6, 4.2);
    tubeWarmLight.position.set(-0.65, -0.52, 0.45);
    this.scene.add(tubeWarmLight);
  }

  _buildProceduralEnvironment() {
    const THREE = this.THREE;
    if (!THREE.PMREMGenerator) return;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x16191c);

    const stripGeo = new THREE.PlaneGeometry(4.2, 0.65);
    const warmMat = new THREE.MeshBasicMaterial({ color: 0xffd6a5, side: THREE.DoubleSide });
    const sageMat = new THREE.MeshBasicMaterial({ color: 0x9cb4c2, side: THREE.DoubleSide });

    const lightStrip1 = new THREE.Mesh(stripGeo, warmMat);
    lightStrip1.position.set(0, -2.0, 2.8);
    lightStrip1.lookAt(0, 0, 0);
    envScene.add(lightStrip1);

    const lightStrip2 = new THREE.Mesh(stripGeo, sageMat);
    lightStrip2.position.set(-2.0, 2.0, 2.4);
    lightStrip2.lookAt(0, 0, 0);
    envScene.add(lightStrip2);

    const envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
  }

  _buildProceduralChassis() {
    const THREE = this.THREE;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'Root_Chassis';
    this.scene.add(this.rootGroup);

    // Studio Parquet / Acoustic Floor Grid Beneath Crate
    const gridHelper = new THREE.GridHelper(6.0, 24, 0x3b352e, 0x1c1917);
    gridHelper.rotation.x = Math.PI * 0.5;
    gridHelper.position.z = -0.22;
    this.scene.add(gridHelper);

    // -------------------------------------------------------------------------
    // 1. 1960s EMT 140 Tubular Steel Frame & Cutaway Mahogany/Hammerite Crate
    // -------------------------------------------------------------------------
    const frameGroup = new THREE.Group();
    frameGroup.name = 'Frame_Outer';
    this.rootGroup.add(frameGroup);

    const hammeriteMat = new THREE.MeshStandardMaterial({
      color: 0x394549,
      roughness: 0.44,
      metalness: 0.78
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xd4dce6,
      roughness: 0.22,
      metalness: 0.94
    });

    const woodTrimMat = new THREE.MeshStandardMaterial({
      color: 0x4a2c18,
      roughness: 0.62,
      metalness: 0.12
    });

    const frameW = 2.4;
    const frameH = 1.2;
    const tubeRadius = 0.028;

    const zOffsets = [-0.11, 0.11];
    zOffsets.forEach((zPos) => {
      const topRail = new THREE.Mesh(new THREE.CylinderGeometry(tubeRadius, tubeRadius, frameW, 20), hammeriteMat);
      topRail.rotation.z = Math.PI * 0.5;
      topRail.position.set(0, frameH * 0.5, zPos);
      frameGroup.add(topRail);

      const botRail = new THREE.Mesh(new THREE.CylinderGeometry(tubeRadius, tubeRadius, frameW, 20), hammeriteMat);
      botRail.rotation.z = Math.PI * 0.5;
      botRail.position.set(0, -frameH * 0.5, zPos);
      frameGroup.add(botRail);

      const leftRail = new THREE.Mesh(new THREE.CylinderGeometry(tubeRadius, tubeRadius, frameH, 20), hammeriteMat);
      leftRail.position.set(-frameW * 0.5, 0, zPos);
      frameGroup.add(leftRail);

      const rightRail = new THREE.Mesh(new THREE.CylinderGeometry(tubeRadius, tubeRadius, frameH, 20), hammeriteMat);
      rightRail.position.set(frameW * 0.5, 0, zPos);
      frameGroup.add(rightRail);
    });

    // Cutaway Mahogany Studio Side Cheek Trim Panels
    const leftCheek = new THREE.Mesh(new THREE.BoxGeometry(0.035, frameH + 0.08, 0.32), woodTrimMat);
    leftCheek.position.set(-frameW * 0.5 - 0.03, 0, 0);
    frameGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(new THREE.BoxGeometry(0.035, frameH + 0.08, 0.32), woodTrimMat);
    rightCheek.position.set(frameW * 0.5 + 0.03, 0, 0);
    frameGroup.add(rightCheek);

    // Corner Gusset Brackets & Chrome Turnbuckle Lugs
    const corners = [
      [-frameW * 0.5, frameH * 0.5],
      [frameW * 0.5, frameH * 0.5],
      [-frameW * 0.5, -frameH * 0.5],
      [frameW * 0.5, -frameH * 0.5]
    ];

    corners.forEach(([cx, cy]) => {
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.30, 16), chromeMat);
      strut.rotation.x = Math.PI * 0.5;
      strut.position.set(cx, cy, 0);
      frameGroup.add(strut);

      const lug = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.11, 0.08), hammeriteMat);
      lug.position.set(cx * 0.96, cy * 0.93, 0);
      frameGroup.add(lug);
    });

    // 1960s Telefunken/EMT Vacuum Tube Amplifier Tray on Bottom Left Rail
    const ampBox = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.12), hammeriteMat);
    ampBox.position.set(-0.76, -0.52, 0.06);
    frameGroup.add(ampBox);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.85,
      transparent: true,
      opacity: 0.65
    });

    for (let t = 0; t < 3; t++) {
      const tx = -0.92 + t * 0.15;
      const tubeGlass = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.09, 16), glassMat);
      tubeGlass.rotation.x = Math.PI * 0.5;
      tubeGlass.position.set(tx, -0.52, 0.15);
      frameGroup.add(tubeGlass);

      const filMat = new THREE.MeshBasicMaterial({ color: 0xff7b1c });
      const filament = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.05, 8), filMat);
      filament.rotation.x = Math.PI * 0.5;
      filament.position.set(tx, -0.52, 0.15);
      frameGroup.add(filament);
      this.tubeFilaments.push(filament);
    }

    // -------------------------------------------------------------------------
    // 2. Central Suspended Metal Plate: THREE.PlaneGeometry(2.0, 1.0, 128, 128)
    // -------------------------------------------------------------------------
    const Lx = 2.0;
    const Ly = 1.0;
    this.plateGeometry = new THREE.PlaneGeometry(Lx, Ly, this.segX, this.segY);

    const posAttr = this.plateGeometry.attributes.position;
    const numVerts = posAttr.count;

    for (let i = 0; i < numVerts; i++) {
      const vx = posAttr.getX(i);
      const vy = posAttr.getY(i);
      this.baseZ[i] = posAttr.getZ(i);

      const normX = (vx + Lx * 0.5) / Lx;
      const normY = (vy + Ly * 0.5) / Ly;

      let modeIdx = 0;
      for (let m = 1; m <= 4; m++) {
        const sinX = Math.sin(m * Math.PI * normX);
        for (let n = 1; n <= 4; n++) {
          const sinY = Math.sin(n * Math.PI * normY);
          this.modalBasis[modeIdx * numVerts + i] = sinX * sinY;
          modeIdx++;
        }
      }
    }

    const initialPreset = MATERIAL_PRESETS[0];
    this.plateMaterial = new THREE.MeshPhysicalMaterial({
      color: initialPreset.color,
      roughness: initialPreset.roughness,
      metalness: initialPreset.metalness,
      clearcoat: initialPreset.clearcoat,
      clearcoatRoughness: initialPreset.clearcoatRoughness,
      side: THREE.DoubleSide
    });

    this.plateMesh = new THREE.Mesh(this.plateGeometry, this.plateMaterial);
    this.plateMesh.name = 'Plate_Mesh';
    this.plateMesh.castShadow = true;
    this.plateMesh.receiveShadow = true;
    this.rootGroup.add(this.plateMesh);

    // -------------------------------------------------------------------------
    // 3. Four Corner Helical Tension Springs (THREE.TubeGeometry along Helical Curve)
    // -------------------------------------------------------------------------
    const springDefs = [
      { name: 'Spring_Corner_TL', pStart: [-1.0, 0.5, 0], pEnd: [-1.16, 0.56, 0] },
      { name: 'Spring_Corner_TR', pStart: [1.0, 0.5, 0], pEnd: [1.16, 0.56, 0] },
      { name: 'Spring_Corner_BL', pStart: [-1.0, -0.5, 0], pEnd: [-1.16, -0.56, 0] },
      { name: 'Spring_Corner_BR', pStart: [1.0, -0.5, 0], pEnd: [1.16, -0.56, 0] }
    ];

    springDefs.forEach((def) => {
      const springMesh = this._createHelicalSpringMesh(def.pStart, def.pEnd, chromeMat);
      springMesh.name = def.name;
      this.rootGroup.add(springMesh);
      this.springMeshes.push(springMesh);
    });

    // -------------------------------------------------------------------------
    // 4. Voice-Coil Driver Assembly & Dual Piezo Pickup Transducers
    // -------------------------------------------------------------------------
    this.driverMesh = new THREE.Group();
    this.driverMesh.name = 'Transducer_Driver';
    this.driverMesh.position.set(-0.35, 0.08, 0.02);

    const magnetMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.32,
      metalness: 0.86
    });

    const driverCup = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.14, 28), hammeriteMat);
    driverCup.rotation.x = Math.PI * 0.5;
    driverCup.position.z = 0.07;
    this.driverMesh.add(driverCup);

    const copperRing = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.16, 24), magnetMat);
    copperRing.rotation.x = Math.PI * 0.5;
    copperRing.position.z = 0.075;
    this.driverMesh.add(copperRing);

    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff8c24 });
    this.driverCoilGlow = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 12, 28), glowMat);
    this.driverCoilGlow.position.z = 0.03;
    this.driverMesh.add(this.driverCoilGlow);

    this.rootGroup.add(this.driverMesh);

    const pickupMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.28,
      metalness: 0.90
    });

    this.pickupLeftMesh = this._createPickupMesh('Pickup_Left', pickupMat, hammeriteMat);
    this.pickupLeftMesh.position.set(0.45, 0.22, 0.015);
    this.rootGroup.add(this.pickupLeftMesh);

    this.pickupRightMesh = this._createPickupMesh('Pickup_Right', pickupMat, hammeriteMat);
    this.pickupRightMesh.position.set(0.52, -0.24, 0.015);
    this.rootGroup.add(this.pickupRightMesh);

    // -------------------------------------------------------------------------
    // 5. Mechanical Damping Plate Assembly (1960s Pressed Asbestos/Felt Pad)
    // -------------------------------------------------------------------------
    this.damperGroup = new THREE.Group();
    this.damperGroup.name = 'Damper_Bar';

    const feltMat = new THREE.MeshStandardMaterial({
      color: 0x8f7e68,
      roughness: 0.94,
      metalness: 0.05
    });

    const feltPad = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.84, 0.018), feltMat);
    feltPad.position.set(0, 0, -0.012);
    this.damperGroup.add(feltPad);

    const backingPlate = new THREE.Mesh(new THREE.BoxGeometry(1.82, 0.88, 0.014), hammeriteMat);
    backingPlate.position.set(0, 0, 0.005);
    this.damperGroup.add(backingPlate);

    const actuatorBar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 2.36, 16), chromeMat);
    actuatorBar.rotation.z = Math.PI * 0.5;
    actuatorBar.position.set(0, 0, 0.035);
    this.damperGroup.add(actuatorBar);

    this.setDampingPosition(0.35);
    this.damperGroup.position.z = -this.currentDampingZ;
    this.rootGroup.add(this.damperGroup);
  }

  _createHelicalSpringMesh(pStart, pEnd, material) {
    const THREE = this.THREE;
    const vStart = new THREE.Vector3(pStart[0], pStart[1], pStart[2]);
    const vEnd = new THREE.Vector3(pEnd[0], pEnd[1], pEnd[2]);

    class HelicalCurve extends THREE.Curve {
      constructor(start, end, turns = 7, radius = 0.022) {
        super();
        this.start = start;
        this.end = end;
        this.turns = turns;
        this.radius = radius;
      }
      getPoint(t, optionalTarget = new THREE.Vector3()) {
        const point = optionalTarget.lerpVectors(this.start, this.end, t);
        const env = Math.sin(Math.PI * t);
        const angle = t * Math.PI * 2.0 * this.turns;
        point.z += Math.cos(angle) * this.radius * env;
        point.y += Math.sin(angle) * this.radius * 0.5 * env;
        return point;
      }
    }

    const curve = new HelicalCurve(vStart, vEnd, 7, 0.022);
    const tubeGeo = new THREE.TubeGeometry(curve, 64, 0.006, 8, false);
    return new THREE.Mesh(tubeGeo, material);
  }

  _createPickupMesh(name, brassMat, bodyMat) {
    const THREE = this.THREE;
    const group = new THREE.Group();
    group.name = name;

    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.055, 0.08, 20), brassMat);
    base.rotation.x = Math.PI * 0.5;
    base.position.z = 0.04;
    group.add(base);

    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.05, 16), bodyMat);
    cap.rotation.x = Math.PI * 0.5;
    cap.position.z = 0.09;
    group.add(cap);

    return group;
  }

  _initOrbitControls() {
    const THREE = this.THREE;
    const OrbitControls = THREE.OrbitControls || window.OrbitControls;
    if (!OrbitControls) return;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minAzimuthAngle = -Infinity;
    this.controls.maxAzimuthAngle = Infinity;
    this.controls.minPolarAngle = Math.PI * 0.15;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.minDistance = 1.05;
    this.controls.maxDistance = 4.8;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  _bindResize() {
    this._onResize = () => {
      if (!this.container || !this.renderer || !this.camera) return;
      const w = this.container.clientWidth || 800;
      const h = this.container.clientHeight || 360;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._onResize);
  }

  setMaterialPreset(presetIndex) {
    const idx = Math.max(0, Math.min(MATERIAL_PRESETS.length - 1, presetIndex | 0));
    const p = MATERIAL_PRESETS[idx];
    if (!this.plateMaterial) return;

    this.plateMaterial.color.setHex(p.color);
    this.plateMaterial.roughness = p.roughness;
    this.plateMaterial.metalness = p.metalness;
    this.plateMaterial.clearcoat = p.clearcoat;
    this.plateMaterial.clearcoatRoughness = p.clearcoatRoughness;
    this.plateMaterial.needsUpdate = true;
  }

  setDampingPosition(dampingNorm) {
    const clamped = Math.max(0.0, Math.min(1.0, dampingNorm));
    this.targetDampingZ = 0.18 - clamped * (0.18 - 0.008);
  }

  setPlateSizeScale(sizeFactor) {
    const clamped = Math.max(0.5, Math.min(2.0, sizeFactor));
    this.targetPlateScale = 0.82 + ((clamped - 0.5) / 1.5) * 0.24;
  }

  resetCamera() {
    if (!this.camera || !this.controls) return;
    this.camera.position.set(0.0, -1.68, 1.88);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  update(nowMs, telemetry) {
    const nowSec = nowMs * 0.001;
    const dt = Math.min(0.05, Math.max(0.001, nowSec - this.lastTime));
    this.lastTime = nowSec;

    this.currentDampingZ += (this.targetDampingZ - this.currentDampingZ) * 0.14;
    if (this.damperGroup) {
      this.damperGroup.position.z = -this.currentDampingZ;
    }

    this.currentPlateScale += (this.targetPlateScale - this.currentPlateScale) * 0.12;
    if (this.plateMesh) {
      this.plateMesh.scale.set(this.currentPlateScale, this.currentPlateScale, 1.0);
    }
    for (let s = 0; s < this.springMeshes.length; s++) {
      const sp = this.springMeshes[s];
      const invTension = 1.0 + (1.0 - this.currentPlateScale) * 0.35;
      sp.scale.set(invTension, invTension, 1.0);
    }

    const modalEnergies = telemetry ? telemetry.modalEnergies : null;
    const outRms = telemetry ? telemetry.outputRms : 0.0;
    const inRms = telemetry ? telemetry.inputRms : 0.0;
    const totalExcitation = Math.min(1.0, outRms * 3.8 + inRms * 1.8);

    let activeEnergySum = 0.0;
    for (let k = 0; k < 16; k++) {
      const bandEnergy = modalEnergies ? modalEnergies[k] : 0.0;
      this.modePhases[k] += this.modeSpeeds[k] * dt / Math.max(0.6, this.currentPlateScale);
      const osc = Math.sin(this.modePhases[k]);
      const amp = (bandEnergy * 0.018 + totalExcitation * 0.006) * osc / (1.0 + k * 0.18);
      this.modeAmplitudes[k] = amp;
      activeEnergySum += Math.abs(amp);
    }

    if (this.plateGeometry && (activeEnergySum > 0.00001 || this._wasDisplaced)) {
      const posAttr = this.plateGeometry.attributes.position;
      const posArray = posAttr.array;
      const numVerts = this.vertexCount;
      const basis = this.modalBasis;
      const amps = this.modeAmplitudes;
      const baseZ = this.baseZ;

      for (let i = 0; i < numVerts; i++) {
        let zDisp = baseZ[i];
        zDisp +=
          amps[0] * basis[i] +
          amps[1] * basis[numVerts + i] +
          amps[2] * basis[2 * numVerts + i] +
          amps[3] * basis[3 * numVerts + i] +
          amps[4] * basis[4 * numVerts + i] +
          amps[5] * basis[5 * numVerts + i] +
          amps[6] * basis[6 * numVerts + i] +
          amps[7] * basis[7 * numVerts + i] +
          amps[8] * basis[8 * numVerts + i] +
          amps[9] * basis[9 * numVerts + i] +
          amps[10] * basis[10 * numVerts + i] +
          amps[11] * basis[11 * numVerts + i] +
          amps[12] * basis[12 * numVerts + i] +
          amps[13] * basis[13 * numVerts + i] +
          amps[14] * basis[14 * numVerts + i] +
          amps[15] * basis[15 * numVerts + i];

        posArray[i * 3 + 2] = zDisp;
      }

      posAttr.needsUpdate = true;
      this.plateGeometry.computeVertexNormals();
      this._wasDisplaced = activeEnergySum > 0.00001;
    }

    if (this.driverMesh) {
      const driverThrow = Math.sin(nowSec * 45.0) * Math.min(0.015, inRms * 0.05);
      this.driverMesh.position.z = 0.02 + driverThrow;
    }
    if (this.driverCoilGlow) {
      const glowIntensity = Math.min(1.0, 0.35 + inRms * 4.0 + outRms * 2.5);
      this.driverCoilGlow.material.color.setRGB(
        1.0 * glowIntensity,
        0.52 * glowIntensity,
        0.12 * glowIntensity
      );
    }
    if (this.pickupLeftMesh && this.pickupRightMesh) {
      this.pickupLeftMesh.position.z = 0.015 + this.modeAmplitudes[2] * 1.5;
      this.pickupRightMesh.position.z = 0.015 + this.modeAmplitudes[5] * 1.5;
    }

    if (this.controls) {
      this.controls.update();
    }
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }
}
