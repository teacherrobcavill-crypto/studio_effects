/**
 * @fileoverview Stage 3B: Classic Tube-Driven Spring Reverb 3D Cutaway Visualizer (Three.js r128+)
 * Renders the Accutronics Type 4 / Hammond dual-spring mechanical transmission line tank,
 * magnetic input/output transducers, coupled torsional (u) and transverse (v) helical wave displacement,
 * and the selectable tube chassis topology:
 *  - Version A: 1961 Fender 6G15 Standalone Tube Reverb (6K6 Power Pentode + Driver Transformer + 12AX7 + 7025)
 *  - Version B: 1963 Fender AB763 Twin Reverb Built-in Amp Chassis (Parallel 12AT7 Driver + Dual 12" Speaker Acoustic Coupling)
 *  - 1939 Hammond Organ Oil-Filled Damping Tube overlay
 */

export class SpringVisualizer {
  constructor(containerEl, audioEngine) {
    this.container = containerEl;
    this.audioEngine = audioEngine;

    this.THREE = window.THREE;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    this.rootGroup = null;
    this.tankGroup = null;
    this.oilTubeGroup = null;
    this.speakerComboGroup = null;
    this.tube6K6Group = null;
    this.driverTransformerMesh = null;

    // Dual Helical Spring Dynamic Tube Meshes
    this.springMesh1 = null;
    this.springMesh2 = null;
    this.springGeo1 = null;
    this.springGeo2 = null;
    this.springBasePos1 = null;
    this.springBasePos2 = null;

    this.driveTransducerCoil = null;
    this.receiveTransducerCoil = null;
    this.speakerCone1 = null;
    this.speakerCone2 = null;
    this.tubeFilaments = [];

    // Physical Spring Geometry & Wave State
    this.wireRadiusMm = 0.25;
    this.helixRadiusMm = 3.0;
    this.wireLengthM = 2.65;
    this.topology = 0; // 0 = 6G15 Standalone, 1 = AB763 Combo
    this.tankEra = 0;  // 0 = 1960 Type 4, 1 = 1939 Hammond Oil, 2 = 1930s Bell Labs
    this.kickShockEnv = 0.0;
    this.waveTime = 0.0;
    this.lastTime = performance.now() * 0.001;

    this._initScene();
    this._buildProceduralEnvironment();
    this._buildProceduralSpringTank();
    this._initOrbitControls();
    this._bindResize();
  }

  _initScene() {
    const THREE = this.THREE;
    const width = this.container.clientWidth || 800;
    const height = this.container.clientHeight || 340;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0b09);
    this.scene.fog = new THREE.FogExp2(0x0d0b09, 0.14);

    this.camera = new THREE.PerspectiveCamera(34, width / height, 0.1, 50);
    this.camera.position.set(0.0, -1.75, 1.45);
    this.camera.up.set(0, 0, 1);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.32;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.container.innerHTML = '';
    this.container.appendChild(this.renderer.domElement);

    const ambient = new THREE.AmbientLight(0xf5e3c8, 0.62);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffe0b2, 2.6);
    keyLight.position.set(1.8, -2.2, 2.8);
    keyLight.castShadow = true;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.35);
    rimLight.position.set(-2.2, 1.9, 1.8);
    this.scene.add(rimLight);

    this.tubeGlowLight = new THREE.PointLight(0xff7b1c, 1.8, 3.8);
    this.tubeGlowLight.position.set(-0.62, 0.35, 0.32);
    this.scene.add(this.tubeGlowLight);
  }

  _buildProceduralEnvironment() {
    const THREE = this.THREE;
    if (!THREE.PMREMGenerator) return;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0x18130e);

    const stripGeo = new THREE.PlaneGeometry(4.0, 0.6);
    const warmMat = new THREE.MeshBasicMaterial({ color: 0xffd8a8, side: THREE.DoubleSide });
    const coolMat = new THREE.MeshBasicMaterial({ color: 0x94a3b8, side: THREE.DoubleSide });

    const s1 = new THREE.Mesh(stripGeo, warmMat);
    s1.position.set(0, -1.8, 2.5);
    s1.lookAt(0, 0, 0);
    envScene.add(s1);

    const s2 = new THREE.Mesh(stripGeo, coolMat);
    s2.position.set(-1.8, 1.8, 2.2);
    s2.lookAt(0, 0, 0);
    envScene.add(s2);

    const envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = envRT.texture;
    pmrem.dispose();
  }

  _buildProceduralSpringTank() {
    const THREE = this.THREE;
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    const gridHelper = new THREE.GridHelper(6.0, 24, 0x443627, 0x1c1610);
    gridHelper.rotation.x = Math.PI * 0.5;
    gridHelper.position.z = -0.25;
    this.scene.add(gridHelper);

    // Materials
    const chassisHammerMat = new THREE.MeshStandardMaterial({
      color: 0x4a453e,
      roughness: 0.42,
      metalness: 0.78
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.18,
      metalness: 0.95
    });

    const tolexBlondeMat = new THREE.MeshStandardMaterial({
      color: 0xd4be94,
      roughness: 0.72,
      metalness: 0.08
    });

    const copperCoilMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.28,
      metalness: 0.88
    });

    const springSteelMat = new THREE.MeshPhysicalMaterial({
      color: 0xdbeafe,
      roughness: 0.22,
      metalness: 0.94,
      clearcoat: 0.35,
      clearcoatRoughness: 0.15
    });

    // -------------------------------------------------------------------------
    // 1. Cutaway Accutronics Type 4 Folded Steel Spring Tank Pan (16.75" Long)
    // -------------------------------------------------------------------------
    this.tankGroup = new THREE.Group();
    this.rootGroup.add(this.tankGroup);

    const tankLen = 2.26;
    const tankWid = 0.68;
    const tankFloor = new THREE.Mesh(new THREE.BoxGeometry(tankLen, tankWid, 0.025), chassisHammerMat);
    tankFloor.position.set(0, -0.08, -0.09);
    this.tankGroup.add(tankFloor);

    const backWall = new THREE.Mesh(new THREE.BoxGeometry(tankLen, 0.025, 0.18), chassisHammerMat);
    backWall.position.set(0, -0.08 + tankWid * 0.5, -0.01);
    this.tankGroup.add(backWall);

    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.03, tankWid, 0.18), chassisHammerMat);
    leftWall.position.set(-tankLen * 0.5, -0.08, -0.01);
    this.tankGroup.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.03, tankWid, 0.18), chassisHammerMat);
    rightWall.position.set(tankLen * 0.5, -0.08, -0.01);
    this.tankGroup.add(rightWall);

    // Blonde Tolex / Brownface Outer Vinyl Bag Base
    const tolexBase = new THREE.Mesh(new THREE.BoxGeometry(tankLen + 0.12, tankWid + 0.12, 0.03), tolexBlondeMat);
    tolexBase.position.set(0, -0.08, -0.125);
    this.tankGroup.add(tolexBase);

    // -------------------------------------------------------------------------
    // 2. Input (8-Ohm Drive) & Output (High-Z Recovery) Magnetic Transducer Blocks
    // -------------------------------------------------------------------------
    const buildTransducerBlock = (xPos, isDriver) => {
      const grp = new THREE.Group();
      grp.position.set(xPos, -0.08, 0.0);

      // Laminated iron core lamination stack
      const core = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.44, 0.11), chromeMat);
      grp.add(core);

      // Dual bobbins / copper coils
      const coil1 = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.12, 24), copperCoilMat);
      coil1.rotation.z = Math.PI * 0.5;
      coil1.position.set(0, 0.11, 0.01);
      grp.add(coil1);

      const coil2 = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.12, 24), copperCoilMat);
      coil2.rotation.z = Math.PI * 0.5;
      coil2.position.set(0, -0.11, 0.01);
      grp.add(coil2);

      const glowMat = new THREE.MeshBasicMaterial({ color: isDriver ? 0xff922b : 0x00f5d4 });
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.008, 10, 24), glowMat);
      glowRing.rotation.y = Math.PI * 0.5;
      glowRing.position.set(isDriver ? 0.065 : -0.065, 0.11, 0.01);
      grp.add(glowRing);

      if (isDriver) {
        this.driveTransducerCoil = glowRing;
      } else {
        this.receiveTransducerCoil = glowRing;
      }
      return grp;
    };

    const driverTransducer = buildTransducerBlock(-0.92, true);
    const recoveryTransducer = buildTransducerBlock(0.92, false);
    this.tankGroup.add(driverTransducer);
    this.tankGroup.add(recoveryTransducer);

    // -------------------------------------------------------------------------
    // 3. Dual Helical Transmission Springs (Counter-Wound / Coupled Center Filaments)
    // -------------------------------------------------------------------------
    const createHelicalSpringGeometry = (yOffset, turns) => {
      const segs = 360;
      const radialSegs = 8;
      const xStart = -0.84;
      const xEnd = 0.84;
      const helixR = 0.042;
      const wireR = 0.0075;

      class SpringHelixCurve extends THREE.Curve {
        getPoint(t, optionalTarget = new THREE.Vector3()) {
          const x = xStart + (xEnd - xStart) * t;
          // Tapered hook ends into magnetic armature
          const hookEnv = Math.sin(Math.PI * Math.min(1.0, Math.min(t * 14.0, (1.0 - t) * 14.0)));
          const angle = t * Math.PI * 2.0 * turns;
          const y = yOffset + Math.cos(angle) * helixR * hookEnv;
          const z = Math.sin(angle) * helixR * hookEnv;
          return optionalTarget.set(x, y, z);
        }
      }

      const curve = new SpringHelixCurve();
      const geo = new THREE.TubeGeometry(curve, segs, wireR, radialSegs, false);
      return geo;
    };

    this.springGeo1 = createHelicalSpringGeometry(0.03, 52);
    this.springGeo2 = createHelicalSpringGeometry(-0.19, 45);

    this.springBasePos1 = new Float32Array(this.springGeo1.attributes.position.array);
    this.springBasePos2 = new Float32Array(this.springGeo2.attributes.position.array);

    this.springMesh1 = new THREE.Mesh(this.springGeo1, springSteelMat);
    this.springMesh2 = new THREE.Mesh(this.springGeo2, springSteelMat);
    this.tankGroup.add(this.springMesh1);
    this.tankGroup.add(this.springMesh2);

    // -------------------------------------------------------------------------
    // 4. 1939 Hammond Organ Oil-Filled Damping Glass Cylinders (Visible in Era 1)
    // -------------------------------------------------------------------------
    this.oilTubeGroup = new THREE.Group();
    const oilGlassMat = new THREE.MeshPhysicalMaterial({
      color: 0xfbbf24,
      roughness: 0.12,
      metalness: 0.05,
      transmission: 0.78,
      transparent: true,
      opacity: 0.42
    });
    const oilCyl1 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 1.66, 24), oilGlassMat);
    oilCyl1.rotation.z = Math.PI * 0.5;
    oilCyl1.position.set(0, 0.03, 0);
    this.oilTubeGroup.add(oilCyl1);

    const oilCyl2 = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 1.66, 24), oilGlassMat);
    oilCyl2.rotation.z = Math.PI * 0.5;
    oilCyl2.position.set(0, -0.19, 0);
    this.oilTubeGroup.add(oilCyl2);
    this.oilTubeGroup.visible = false;
    this.tankGroup.add(this.oilTubeGroup);

    // -------------------------------------------------------------------------
    // 5. Tube Driver & Recovery Deck (6G15 6K6 Pentode + Transformer vs AB763 12AT7)
    // -------------------------------------------------------------------------
    const tubeDeck = new THREE.Group();
    tubeDeck.position.set(-0.48, 0.40, -0.04);
    this.rootGroup.add(tubeDeck);

    const chassisRail = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.24, 0.10), chromeMat);
    tubeDeck.add(chassisRail);

    // Output Driver Transformer (Matches High-Z 6K6 Plate to 8-Ohm Transducer Coil)
    this.driverTransformerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 0.16, 0.16),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.38, metalness: 0.82 })
    );
    this.driverTransformerMesh.position.set(-0.42, 0, 0.12);
    tubeDeck.add(this.driverTransformerMesh);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      roughness: 0.08,
      metalness: 0.1,
      transmission: 0.86,
      transparent: true,
      opacity: 0.68
    });

    // 3 Tubes: V1 Driver (6K6GT Pentode or 12AT7), V2 Recovery (12AX7), V3 Mixer (7025)
    for (let t = 0; t < 3; t++) {
      const tx = -0.12 + t * 0.26;
      const isPowerTube = t === 0;
      const rTube = isPowerTube ? 0.044 : 0.030;
      const hTube = isPowerTube ? 0.18 : 0.13;

      const tubeGrp = new THREE.Group();
      tubeGrp.position.set(tx, 0, 0.06 + hTube * 0.5);

      const bulb = new THREE.Mesh(new THREE.CylinderGeometry(rTube, rTube, hTube, 20), glassMat);
      bulb.rotation.x = Math.PI * 0.5;
      tubeGrp.add(bulb);

      const filMat = new THREE.MeshBasicMaterial({ color: 0xff7b1c });
      const fil = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, hTube * 0.65, 10), filMat);
      fil.rotation.x = Math.PI * 0.5;
      tubeGrp.add(fil);

      if (isPowerTube) this.tube6K6Group = tubeGrp;
      this.tubeFilaments.push(fil);
      tubeDeck.add(tubeGrp);
    }

    // -------------------------------------------------------------------------
    // 6. Version B (AB763 Combo): Dual 12" Speaker Acoustic Feedback Cones
    // -------------------------------------------------------------------------
    this.speakerComboGroup = new THREE.Group();
    this.speakerComboGroup.position.set(0.62, 0.42, 0.02);

    const speakerFrameMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.7
    });
    const conePaperMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.88,
      metalness: 0.05,
      side: THREE.DoubleSide
    });

    const buildSpeaker = (xOff) => {
      const spk = new THREE.Group();
      spk.position.set(xOff, 0, 0);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.09, 28, 1, true), conePaperMat);
      cone.rotation.x = -Math.PI * 0.5;
      spk.add(cone);

      const magnet = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.06, 20), speakerFrameMat);
      magnet.rotation.x = Math.PI * 0.5;
      magnet.position.z = -0.05;
      spk.add(magnet);
      return cone;
    };

    this.speakerCone1 = buildSpeaker(-0.20);
    this.speakerCone2 = buildSpeaker(0.20);
    this.speakerComboGroup.add(this.speakerCone1.parent);
    this.speakerComboGroup.add(this.speakerCone2.parent);
    this.speakerComboGroup.visible = false;
    this.rootGroup.add(this.speakerComboGroup);
  }

  _initOrbitControls() {
    const THREE = this.THREE;
    const OrbitControls = THREE.OrbitControls || window.OrbitControls;
    if (!OrbitControls) return;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minPolarAngle = Math.PI * 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.85;
    this.controls.minDistance = 0.95;
    this.controls.maxDistance = 4.6;
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  _bindResize() {
    this._onResize = () => {
      this.resize();
    };
    window.addEventListener('resize', this._onResize);
  }

  resize() {
    if (!this.container || !this.renderer || !this.camera) return;
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 340;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  setSpringGeometryParams({ wireRadiusMm, helixRadiusMm, wireLengthM }) {
    if (typeof wireRadiusMm === 'number') this.wireRadiusMm = wireRadiusMm;
    if (typeof helixRadiusMm === 'number') this.helixRadiusMm = helixRadiusMm;
    if (typeof wireLengthM === 'number') this.wireLengthM = wireLengthM;

    const rScale = 0.65 + ((this.helixRadiusMm - 1.5) / 4.5) * 0.75;
    if (this.springMesh1) {
      this.springMesh1.scale.set(1.0, rScale, rScale);
    }
    if (this.springMesh2) {
      this.springMesh2.scale.set(1.0, rScale, rScale);
    }
  }

  setTopologyVisual(topology) {
    this.topology = topology | 0;
    if (this.speakerComboGroup) {
      this.speakerComboGroup.visible = this.topology === 1;
    }
    if (this.tube6K6Group) {
      // Scale V1 tube: larger 6K6GT glass envelope in 6G15 Standalone mode vs compact 12AT7 dual-triode in AB763 mode
      const s = this.topology === 0 ? 1.0 : 0.72;
      this.tube6K6Group.scale.set(s, s, s);
    }
  }

  setTankEraVisual(era) {
    this.tankEra = era | 0;
    if (this.oilTubeGroup) {
      this.oilTubeGroup.visible = this.tankEra === 1;
    }
    if (this.springMesh2) {
      this.springMesh2.visible = this.tankEra !== 2; // Bell Labs 1930s is single-line
    }
  }

  triggerMechanicalKick() {
    this.kickShockEnv = 1.0;
  }

  resetCamera() {
    if (!this.camera || !this.controls) return;
    this.camera.position.set(0.0, -1.75, 1.45);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  update(nowMs, telemetry) {
    const nowSec = nowMs * 0.001;
    const dt = Math.min(0.05, Math.max(0.001, nowSec - this.lastTime));
    this.lastTime = nowSec;

    const inRms = telemetry ? telemetry.inputRms : 0.0;
    const outRms = telemetry ? telemetry.outputRms : 0.0;
    this.kickShockEnv *= 0.93;

    const totalEnergy = Math.min(1.2, inRms * 2.5 + outRms * 3.8 + this.kickShockEnv * 0.9);
    this.waveTime += dt * (18.0 + (3.5 / Math.max(1.0, this.wireLengthM)) * 12.0);

    // Animate coupled longitudinal/torsional (u) and transverse (v) helical spring waves
    const displaceSpring = (geo, baseArray, phaseOffset) => {
      if (!geo || !baseArray) return;
      const posAttr = geo.attributes.position;
      const arr = posAttr.array;
      const count = posAttr.count;

      for (let i = 0; i < count; i++) {
        const idx = i * 3;
        const bx = baseArray[idx];
        const by = baseArray[idx + 1];
        const bz = baseArray[idx + 2];

        // Normalized arc position along tank [0..1]
        const sNorm = (bx + 0.84) / 1.68;
        const pinEnvelope = Math.sin(Math.PI * Math.max(0.0, Math.min(1.0, sNorm)));

        // Dispersive chirp packet: high wavenumber near receiver, low wavenumber trailing
        const kDisp = 10.0 + 26.0 * sNorm;
        const uWave = Math.sin(kDisp * sNorm - this.waveTime * 1.4 + phaseOffset);
        const vWave = Math.sin(6.0 * Math.PI * sNorm - this.waveTime * 0.65 + phaseOffset);

        arr[idx] = bx + uWave * totalEnergy * 0.018 * pinEnvelope;
        arr[idx + 1] = by + vWave * totalEnergy * 0.022 * pinEnvelope;
        arr[idx + 2] = bz + Math.cos(kDisp * sNorm - this.waveTime + phaseOffset) * totalEnergy * 0.018 * pinEnvelope;
      }
      posAttr.needsUpdate = true;
    };

    if (totalEnergy > 0.0002 || this._wasSpringDisplaced) {
      displaceSpring(this.springGeo1, this.springBasePos1, 0.0);
      displaceSpring(this.springGeo2, this.springBasePos2, 1.7);
      this._wasSpringDisplaced = totalEnergy > 0.0002;
    }

    // Pulse transducer coils and tube filaments
    if (this.driveTransducerCoil) {
      const g = Math.min(1.0, 0.3 + inRms * 5.0 + this.kickShockEnv);
      this.driveTransducerCoil.material.color.setRGB(1.0 * g, 0.56 * g, 0.15 * g);
    }
    if (this.receiveTransducerCoil) {
      const g = Math.min(1.0, 0.3 + outRms * 5.0);
      this.receiveTransducerCoil.material.color.setRGB(0.0, 0.96 * g, 0.83 * g);
    }

    if (this.speakerComboGroup && this.speakerComboGroup.visible) {
      const coneThrow = Math.sin(nowSec * 55.0) * Math.min(0.025, outRms * 0.08);
      this.speakerCone1.position.z = coneThrow;
      this.speakerCone2.position.z = coneThrow;
    }

    if (this.renderer && this.scene && this.camera) {
      if (this.controls) this.controls.update();
      this.renderer.render(this.scene, this.camera);
    }
  }
}
