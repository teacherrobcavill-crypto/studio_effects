import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createMaterialTexture, MATERIALS } from '../physics/Materials.js';
import { POLAR_PATTERNS } from '../physics/AcousticMath.js';
import { RayTracer3D } from './RayTracer3D.js';

export class SceneManager {
  constructor(containerEl, initialState, onPositionsChanged) {
    this.container = containerEl;
    this.state = initialState;
    this.onPositionsChanged = onPositionsChanged;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0d0e11);

    // Camera
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(46, aspect, 0.1, 120);
    this.camera.position.set(7.8, 5.4, 8.6);

    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.container.appendChild(this.renderer.domElement);

    // OrbitControls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.35, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.maxDistance = 35;
    this.controls.minDistance = 1.5;
    this.controls.update();

    // Camera transition state for educational scenario presets
    this.cameraTransition = null;

    // Lighting
    this._setupLighting();

    // Room Geometry (6 independently textured walls with auto-cutaway opacity)
    this.roomGroup = new THREE.Group();
    this.scene.add(this.roomGroup);
    this.wallMeshes = {};
    this._buildRoomGeometry();

    // Draggable 3D Acoustic Entities: Source & Microphone
    this.draggableRoots = [];
    this.sourceGroup = this._createSourceMesh();
    this.micGroup = this._createMicMesh();
    this.scene.add(this.sourceGroup);
    this.scene.add(this.micGroup);

    this.setPositions(this.state.sourcePos, this.state.micPos, this.state.micYawDeg);
    this.updatePolarPatternMesh(this.state.polarPattern);

    // 3D Acoustic Ray Tracer & Wavefront Visualizer
    this.rayTracer = new RayTracer3D(this.scene);

    // Custom Raycast Plane-Intersection Dragging (XZ horizontal + Shift/Alt modifier for Y vertical)
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.dragPlane = new THREE.Plane();
    this.dragIntersectPoint = new THREE.Vector3();
    this.dragOffset = new THREE.Vector3();
    this.activeDragTarget = null; // 'source' | 'mic' | null
    this.hoveredTarget = null;
    this.activePointerId = null;
    this.lastPointerScreenPos = { x: 0, y: 0 };
    this.isModifierDown = false;

    this._bindEvents();

    this.clock = new THREE.Clock();
    this._animate = this._animate.bind(this);
    requestAnimationFrame(this._animate);
  }

  _setupLighting() {
    const ambient = new THREE.AmbientLight(0xdbe4ff, 0.72);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xfff3d6, 1.15);
    keyLight.position.set(5, 11, 6);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x4dabf7, 0.45);
    rimLight.position.set(-7, 6, -6);
    this.scene.add(rimLight);
  }

  _buildRoomGeometry() {
    // Clear existing meshes
    while (this.roomGroup.children.length > 0) {
      const child = this.roomGroup.children[0];
      this.roomGroup.remove(child);
    }
    this.wallMeshes = {};

    const { width, height, depth } = this.state.dimensions;
    const mats = this.state.surfaceMaterials;

    const faces = [
      {
        id: 'floor',
        w: width,
        h: depth,
        pos: [0, 0, 0],
        rot: [-Math.PI / 2, 0, 0],
        normal: new THREE.Vector3(0, 1, 0),
        isFloor: true
      },
      {
        id: 'ceiling',
        w: width,
        h: depth,
        pos: [0, height, 0],
        rot: [Math.PI / 2, 0, 0],
        normal: new THREE.Vector3(0, -1, 0)
      },
      {
        id: 'left',
        w: depth,
        h: height,
        pos: [-width / 2, height / 2, 0],
        rot: [0, Math.PI / 2, 0],
        normal: new THREE.Vector3(1, 0, 0)
      },
      {
        id: 'right',
        w: depth,
        h: height,
        pos: [width / 2, height / 2, 0],
        rot: [0, -Math.PI / 2, 0],
        normal: new THREE.Vector3(-1, 0, 0)
      },
      {
        id: 'front',
        w: width,
        h: height,
        pos: [0, height / 2, -depth / 2],
        rot: [0, 0, 0],
        normal: new THREE.Vector3(0, 0, 1)
      },
      {
        id: 'back',
        w: width,
        h: height,
        pos: [0, height / 2, depth / 2],
        rot: [0, Math.PI, 0],
        normal: new THREE.Vector3(0, 0, -1)
      }
    ];

    for (const f of faces) {
      const matId = mats[f.id] || 'wood_oak';
      const matInfo = MATERIALS[matId] || MATERIALS.wood_oak;
      const tex = createMaterialTexture(matId, f.w / 2.0, f.h / 2.0);

      const geom = new THREE.PlaneGeometry(f.w, f.h);
      const material = new THREE.MeshStandardMaterial({
        map: tex,
        roughness: matInfo.roughness,
        metalness: matInfo.metalness,
        transparent: !f.isFloor,
        opacity: f.isFloor ? 1.0 : 0.72,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(geom, material);
      mesh.position.set(...f.pos);
      mesh.rotation.set(...f.rot);
      mesh.receiveShadow = f.isFloor;
      mesh.userData = { wallId: f.id, inwardNormal: f.normal, isFloor: !!f.isFloor };

      this.roomGroup.add(mesh);
      this.wallMeshes[f.id] = mesh;
    }

    // Subtle architectural studio wireframe cage & 1-meter floor measurement grid
    const boxGeom = new THREE.BoxGeometry(width, height, depth);
    const edges = new THREE.EdgesGeometry(boxGeom);
    const edgeLines = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color: 0x495057, transparent: true, opacity: 0.75 })
    );
    edgeLines.position.set(0, height / 2, 0);
    this.roomGroup.add(edgeLines);

    // Custom rectangular floor metric grid lines (1m intervals)
    const gridPoints = [];
    const halfW = width / 2;
    const halfD = depth / 2;
    for (let x = -Math.floor(halfW); x <= Math.floor(halfW); x++) {
      gridPoints.push(new THREE.Vector3(x, 0.004, -halfD), new THREE.Vector3(x, 0.004, halfD));
    }
    for (let z = -Math.floor(halfD); z <= Math.floor(halfD); z++) {
      gridPoints.push(new THREE.Vector3(-halfW, 0.004, z), new THREE.Vector3(halfW, 0.004, z));
    }
    const gridGeom = new THREE.BufferGeometry().setFromPoints(gridPoints);
    const gridLines = new THREE.LineSegments(
      gridGeom,
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.14 })
    );
    this.roomGroup.add(gridLines);
  }

  _createSourceMesh() {
    const group = new THREE.Group();
    group.userData = { dragId: 'source' };

    // Vintage 1950s tweed/mahogany studio monitor / amplifier cabinet at acoustic height
    const cabinetGeom = new THREE.BoxGeometry(0.46, 0.42, 0.32);
    const cabinetMat = new THREE.MeshStandardMaterial({
      color: 0xb47b38,
      roughness: 0.55,
      metalness: 0.1
    });
    const cabinet = new THREE.Mesh(cabinetGeom, cabinetMat);
    cabinet.castShadow = true;
    group.add(cabinet);

    // Speaker driver cone
    const coneGeom = new THREE.CylinderGeometry(0.14, 0.04, 0.08, 24);
    coneGeom.rotateX(Math.PI / 2);
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0x1a1b1e,
      emissive: 0xff922b,
      emissiveIntensity: 0.45
    });
    this.sourceCone = new THREE.Mesh(coneGeom, coneMat);
    this.sourceCone.position.set(0, 0, 0.14);
    group.add(this.sourceCone);

    // Glowing Acoustic Center Beacon Sphere
    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xff922b })
    );
    beacon.position.set(0, 0.28, 0);
    group.add(beacon);

    // Boundary-Loading Proximity Aura Ring (glows brighter when pushed near walls/corners)
    const auraGeom = new THREE.RingGeometry(0.32, 0.48, 32);
    auraGeom.rotateX(-Math.PI / 2);
    this.boundaryAuraMat = new THREE.MeshBasicMaterial({
      color: 0xff6b6b,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide
    });
    this.boundaryAura = new THREE.Mesh(auraGeom, this.boundaryAuraMat);
    this.boundaryAura.position.set(0, -0.18, 0);
    group.add(this.boundaryAura);

    // Invisible larger hit sphere for effortless mouse/touch grabbing
    const hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 16, 16),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitSphere.userData = { dragId: 'source' };
    group.add(hitSphere);
    this.draggableRoots.push(hitSphere, cabinet, beacon);

    // Vertical floor drop-stem line so user always sees exact (X, Z) floor footprint
    const stemGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1.2, 0)
    ]);
    this.sourceStem = new THREE.Line(
      stemGeom,
      new THREE.LineDashedMaterial({ color: 0xff922b, dashSize: 0.08, gapSize: 0.06 })
    );
    group.add(this.sourceStem);

    return group;
  }

  _createMicMesh() {
    const group = new THREE.Group();
    group.userData = { dragId: 'mic' };

    // Vintage 1950s Chrome Ribbon/Condenser Microphone Capsule (RCA 44 / U47 style)
    const bodyGeom = new THREE.CylinderGeometry(0.065, 0.065, 0.22, 20);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: 0xd0d7de,
      roughness: 0.22,
      metalness: 0.85
    });
    const capsule = new THREE.Mesh(bodyGeom, bodyMat);
    capsule.castShadow = true;
    group.add(capsule);

    // Cyan acoustic receiver indicator ring
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.015, 12, 24),
      new THREE.MeshBasicMaterial({ color: 0x00f5d4 })
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    // On-axis directional arrow showing where the microphone's front (0°) is aimed
    const arrowDir = new THREE.Vector3(0, 0, -1);
    this.micDirectionArrow = new THREE.ArrowHelper(
      arrowDir,
      new THREE.Vector3(0, 0, 0),
      0.55,
      0x00f5d4,
      0.14,
      0.09
    );
    group.add(this.micDirectionArrow);

    // 3D Polar Pattern Sensitivity Lobe Visualization Mesh
    this.polarMeshGroup = new THREE.Group();
    group.add(this.polarMeshGroup);

    // Invisible hit sphere for easy dragging
    const hitSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false })
    );
    hitSphere.userData = { dragId: 'mic' };
    group.add(hitSphere);
    this.draggableRoots.push(hitSphere, capsule, ring);

    // Vertical floor stand line
    const stemGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, -1.2, 0)
    ]);
    this.micStem = new THREE.Line(
      stemGeom,
      new THREE.LineDashedMaterial({ color: 0x00f5d4, dashSize: 0.08, gapSize: 0.06 })
    );
    group.add(this.micStem);

    return group;
  }

  /**
   * Builds an accurate 3D spherical-coordinate polar pattern surface mesh around the microphone
   * r(theta, phi) = |M(cos(angle_to_front_axis))|
   */
  updatePolarPatternMesh(patternId) {
    while (this.polarMeshGroup.children.length > 0) {
      const c = this.polarMeshGroup.children[0];
      this.polarMeshGroup.remove(c);
      c.geometry.dispose();
      c.material.dispose();
    }

    const pattern = POLAR_PATTERNS[patternId] || POLAR_PATTERNS.cardioid;
    const scaleRadius = 0.52;

    const geom = new THREE.SphereGeometry(1, 36, 24);
    const posAttr = geom.attributes.position;
    const v = new THREE.Vector3();

    for (let i = 0; i < posAttr.count; i++) {
      v.fromBufferAttribute(posAttr, i).normalize();
      // Front axis of mic in local space is -Z (cosTheta = -v.z)
      const cosTheta = -v.z;
      const r = Math.abs(pattern.formula(cosTheta)) * scaleRadius;
      posAttr.setXYZ(i, v.x * r, v.y * r, v.z * r);
    }
    geom.computeVertexNormals();

    const solidMesh = new THREE.Mesh(
      geom,
      new THREE.MeshBasicMaterial({
        color: 0x00f5d4,
        transparent: true,
        opacity: 0.14,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );

    const wireMesh = new THREE.Mesh(
      geom.clone(),
      new THREE.MeshBasicMaterial({
        color: 0x00f5d4,
        wireframe: true,
        transparent: true,
        opacity: 0.32,
        depthWrite: false
      })
    );

    this.polarMeshGroup.add(solidMesh);
    this.polarMeshGroup.add(wireMesh);
  }

  rebuildRoom() {
    this._buildRoomGeometry();
    // Clamp positions inside new room dimensions
    this.setPositions(this.state.sourcePos, this.state.micPos, this.state.micYawDeg);
  }

  setPositions(sourcePos, micPos, micYawDeg = 0) {
    const { width, height, depth } = this.state.dimensions;
    const margin = 0.22;

    sourcePos.x = Math.max(-width / 2 + margin, Math.min(width / 2 - margin, sourcePos.x));
    sourcePos.y = Math.max(margin, Math.min(height - margin, sourcePos.y));
    sourcePos.z = Math.max(-depth / 2 + margin, Math.min(depth / 2 - margin, sourcePos.z));

    micPos.x = Math.max(-width / 2 + margin, Math.min(width / 2 - margin, micPos.x));
    micPos.y = Math.max(margin, Math.min(height - margin, micPos.y));
    micPos.z = Math.max(-depth / 2 + margin, Math.min(depth / 2 - margin, micPos.z));

    this.sourceGroup.position.set(sourcePos.x, sourcePos.y, sourcePos.z);
    this.micGroup.position.set(micPos.x, micPos.y, micPos.z);
    this.micGroup.rotation.y = -((micYawDeg || 0) * Math.PI) / 180;

    // Update floor stems
    const srcStemArr = this.sourceStem.geometry.attributes.position.array;
    srcStemArr[4] = -sourcePos.y;
    this.sourceStem.geometry.attributes.position.needsUpdate = true;
    this.sourceStem.computeLineDistances();

    const micStemArr = this.micStem.geometry.attributes.position.array;
    micStemArr[4] = -micPos.y;
    this.micStem.geometry.attributes.position.needsUpdate = true;
    this.micStem.computeLineDistances();
  }

  updateVisualsFromSolution(solution) {
    this.rayTracer.updateFromSolution(this.state.sourcePos, this.state.micPos, solution);

    // Update boundary loading aura ring intensity around source
    const boostNorm = Math.min(1.0, solution.boundaryLoading.boostDb / 9.0);
    this.boundaryAuraMat.opacity = 0.1 + boostNorm * 0.65;
    const auraScale = 0.85 + boostNorm * 0.9;
    this.boundaryAura.scale.set(auraScale, auraScale, 1);
  }

  /**
   * Smoothly animates camera position and lookAt target when loading an educational scenario.
   */
  transitionCamera(targetPos, lookAtPos = { x: 0, y: 1.3, z: 0 }) {
    this.cameraTransition = {
      startPos: this.camera.position.clone(),
      endPos: new THREE.Vector3(targetPos.x, targetPos.y, targetPos.z),
      startTarget: this.controls.target.clone(),
      endTarget: new THREE.Vector3(lookAtPos.x, lookAtPos.y, lookAtPos.z),
      progress: 0
    };
  }

  _isVerticalModifier(e) {
    return Boolean(e && (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey));
  }

  _updateElevationTooltip(visible) {
    const badge = document.getElementById('hud-elevation-badge');
    const hint = document.getElementById('interaction-hint');
    const isVertical = this.isModifierDown;

    if (hint) {
      hint.classList.toggle('active-vertical', Boolean(this.activeDragTarget && isVertical));
    }

    if (!badge) return;

    if (!visible || !this.activeDragTarget) {
      badge.style.display = 'none';
      return;
    }

    const isMic = this.activeDragTarget === 'mic';
    const pos = isMic ? this.state.micPos : this.state.sourcePos;
    const label = isMic ? 'Microphone' : 'Sound Source';
    const hMax = this.state.dimensions.height;

    badge.className = `elevation-badge ${isMic ? 'cyan' : 'amber'}`;
    badge.innerHTML = `⇕ ${label} Height (Y): <strong>${pos.y.toFixed(2)} m</strong> <span style="opacity:0.75; font-size:9.5px; margin-left:4px;">[Ceiling: ${hMax.toFixed(1)}m · Floor: 0.0m]</span>`;
    badge.style.display = 'inline-flex';
  }

  _bindEvents() {
    const dom = this.renderer.domElement;

    const updatePointer = (e) => {
      const rect = dom.getBoundingClientRect();
      this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const updateCursor = (e) => {
      const isVertical = this._isVerticalModifier(e) || this.isModifierDown;
      if (this.activeDragTarget) {
        dom.style.cursor = isVertical ? 'ns-resize' : 'grabbing';
      } else if (this.hoveredTarget) {
        dom.style.cursor = isVertical ? 'ns-resize' : 'grab';
      } else {
        dom.style.cursor = 'default';
      }
      this._updateElevationTooltip(Boolean(this.activeDragTarget));
    };

    // Keyboard modifier tracking for dynamic elevation cursor & immediate mode switching
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
        this.isModifierDown = true;
        updateCursor(e);
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.key === 'Shift' || e.key === 'Alt' || e.key === 'Control' || e.key === 'Meta') {
        this.isModifierDown = this._isVerticalModifier(e);
        updateCursor(e);
      }
    });

    // Capture phase pointerdown intercepts interaction before OrbitControls can pan
    dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // Only primary mouse button drags entities
      updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObjects(this.draggableRoots, true);

      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.dragId) {
          obj = obj.parent;
        }
        const dragId = obj?.userData?.dragId;
        if (dragId) {
          e.stopPropagation();
          e.stopImmediatePropagation();
          this.activeDragTarget = dragId;
          this.activePointerId = e.pointerId;
          try {
            dom.setPointerCapture(e.pointerId);
          } catch (_) {}

          this.controls.enabled = false;
          this.lastPointerScreenPos = { x: e.clientX, y: e.clientY };

          const isVertical = this._isVerticalModifier(e) || this.isModifierDown;
          dom.style.cursor = isVertical ? 'ns-resize' : 'grabbing';

          const targetGroup = dragId === 'source' ? this.sourceGroup : this.micGroup;
          this.dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            targetGroup.position
          );

          if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersectPoint)) {
            this.dragOffset.copy(targetGroup.position).sub(this.dragIntersectPoint);
          }

          this._updateElevationTooltip(true);
        }
      }
    }, { capture: true });

    window.addEventListener('pointermove', (e) => {
      updatePointer(e);
      this.raycaster.setFromCamera(this.pointer, this.camera);

      if (this.activeDragTarget) {
        const isVertical = this._isVerticalModifier(e) || this.isModifierDown;
        dom.style.cursor = isVertical ? 'ns-resize' : 'grabbing';

        const posObj =
          this.activeDragTarget === 'source' ? this.state.sourcePos : this.state.micPos;
        const targetGroup =
          this.activeDragTarget === 'source' ? this.sourceGroup : this.micGroup;

        if (isVertical) {
          // Vertical elevation adjustment directly driven by vertical mouse movement
          const deltaScreenY = this.lastPointerScreenPos.y - e.clientY;
          const rect = dom.getBoundingClientRect();
          const camDist = this.camera.position.distanceTo(targetGroup.position);
          const vFovRad = (this.camera.fov * Math.PI) / 180;
          const visibleHeightAtDist = 2 * Math.tan(vFovRad / 2) * camDist;
          const metersPerPixel = visibleHeightAtDist / Math.max(1, rect.height);

          posObj.y += deltaScreenY * metersPerPixel;
          const margin = 0.22;
          posObj.y = Math.max(margin, Math.min(this.state.dimensions.height - margin, posObj.y));

          // Keep horizontal drag plane & offset synced with new Y position
          this.dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(posObj.x, posObj.y, posObj.z)
          );
          if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersectPoint)) {
            this.dragOffset.copy(new THREE.Vector3(posObj.x, posObj.y, posObj.z)).sub(this.dragIntersectPoint);
          }
        } else {
          // Horizontal floor XZ plane dragging
          this.dragPlane.setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(posObj.x, posObj.y, posObj.z)
          );
          if (this.raycaster.ray.intersectPlane(this.dragPlane, this.dragIntersectPoint)) {
            const newPos = this.dragIntersectPoint.clone().add(this.dragOffset);
            posObj.x = newPos.x;
            posObj.z = newPos.z;
          }
        }

        this.lastPointerScreenPos = { x: e.clientX, y: e.clientY };
        this.setPositions(this.state.sourcePos, this.state.micPos, this.state.micYawDeg);
        if (this.onPositionsChanged) {
          this.onPositionsChanged(this.activeDragTarget);
        }
        this._updateElevationTooltip(true);
        return;
      }

      // Hover feedback when not actively dragging
      const hits = this.raycaster.intersectObjects(this.draggableRoots, true);
      if (hits.length > 0) {
        let obj = hits[0].object;
        while (obj && !obj.userData?.dragId) {
          obj = obj.parent;
        }
        this.hoveredTarget = obj?.userData?.dragId || null;
      } else {
        this.hoveredTarget = null;
      }

      const isVertical = this._isVerticalModifier(e) || this.isModifierDown;
      dom.style.cursor = this.hoveredTarget ? (isVertical ? 'ns-resize' : 'grab') : 'default';
      this.lastPointerScreenPos = { x: e.clientX, y: e.clientY };
    });

    const endDrag = (e) => {
      if (this.activeDragTarget) {
        if (this.activePointerId !== null && dom.hasPointerCapture(this.activePointerId)) {
          try {
            dom.releasePointerCapture(this.activePointerId);
          } catch (_) {}
        }
        this.activeDragTarget = null;
        this.activePointerId = null;
        this.controls.enabled = true;
        const isVertical = this._isVerticalModifier(e) || this.isModifierDown;
        dom.style.cursor = this.hoveredTarget ? (isVertical ? 'ns-resize' : 'grab') : 'default';
        this._updateElevationTooltip(false);
      }
    };

    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);

    window.addEventListener('resize', () => {
      if (!this.container) return;
      const w = this.container.clientWidth;
      const h = Math.max(1, this.container.clientHeight);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    });
  }

  _updateWallCutawayOpacity() {
    // Automatically make camera-blocking walls translucent so interior is always visible
    const camPos = this.camera.position;
    const roomCenter = new THREE.Vector3(0, this.state.dimensions.height / 2, 0);
    const toCam = new THREE.Vector3().subVectors(camPos, roomCenter).normalize();

    for (const id of Object.keys(this.wallMeshes)) {
      const mesh = this.wallMeshes[id];
      if (mesh.userData.isFloor) continue;
      // Inward normal points into the room; if dot(inwardNormal, toCam) < 0, camera is outside looking through this wall
      const dot = mesh.userData.inwardNormal.dot(toCam);
      const targetOpacity = dot < -0.12 ? 0.11 : 0.78;
      mesh.material.opacity += (targetOpacity - mesh.material.opacity) * 0.15;
    }
  }

  _animate() {
    requestAnimationFrame(this._animate);
    const dt = Math.min(0.05, this.clock.getDelta());

    if (this.cameraTransition) {
      this.cameraTransition.progress = Math.min(1.0, this.cameraTransition.progress + dt * 1.9);
      const t = 1 - Math.pow(1 - this.cameraTransition.progress, 3); // Cubic ease-out
      this.camera.position.lerpVectors(
        this.cameraTransition.startPos,
        this.cameraTransition.endPos,
        t
      );
      this.controls.target.lerpVectors(
        this.cameraTransition.startTarget,
        this.cameraTransition.endTarget,
        t
      );
      if (this.cameraTransition.progress >= 1.0) {
        this.cameraTransition = null;
      }
    }

    this.controls.update();
    this._updateWallCutawayOpacity();
    this.rayTracer.animate(dt);
    this.renderer.render(this.scene, this.camera);
  }
}
