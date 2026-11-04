import * as THREE from 'three';

const BOUNDARY_NORMALS = {
  left: new THREE.Vector3(1, 0, 0),
  right: new THREE.Vector3(-1, 0, 0),
  floor: new THREE.Vector3(0, 1, 0),
  ceiling: new THREE.Vector3(0, -1, 0),
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1)
};

export class RayTracer3D {
  constructor(scene) {
    this.scene = scene;
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    this.visibility = {
      direct: true,
      earlyReflections: true,
      imageGhosts: false,
      wavefronts: true
    };

    // 1. Direct Path Beam & Traveling Pulse
    this.directGroup = new THREE.Group();
    this.rootGroup.add(this.directGroup);

    const directGeom = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(0, 1, 0)
    ]);
    const directMat = new THREE.LineBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.95
    });
    this.directLine = new THREE.Line(directGeom, directMat);
    this.directGroup.add(this.directLine);

    // Glowing core cylinder for direct path visibility
    const tubeGeom = new THREE.CylinderGeometry(0.018, 0.018, 1, 8);
    const tubeMat = new THREE.MeshBasicMaterial({
      color: 0x00f5d4,
      transparent: true,
      opacity: 0.55
    });
    this.directTube = new THREE.Mesh(tubeGeom, tubeMat);
    this.directGroup.add(this.directTube);

    // 2. Specular Reflection Rays + Wall Impact Markers + Virtual Image Ghosts
    this.reflectionsGroup = new THREE.Group();
    this.rootGroup.add(this.reflectionsGroup);

    this.ghostsGroup = new THREE.Group();
    this.ghostsGroup.visible = this.visibility.imageGhosts;
    this.rootGroup.add(this.ghostsGroup);

    this.reflectionVisuals = {};

    const boundaryColors = {
      left: 0xff6b6b,
      right: 0xf59f00,
      floor: 0x4dabf7,
      ceiling: 0x9775fa,
      front: 0x20c997,
      back: 0xe64980
    };

    Object.keys(boundaryColors).forEach((id) => {
      const hex = boundaryColors[id];

      // Specular 2-segment polyline: Source -> Wall Reflection Point -> Mic
      const lineGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const lineMat = new THREE.LineBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.78
      });
      const line = new THREE.Line(lineGeom, lineMat);
      this.reflectionsGroup.add(line);

      // Specular Reflection Point Disc + Ring on the Wall
      const impactGroup = new THREE.Group();
      const discGeom = new THREE.CircleGeometry(0.14, 24);
      const discMat = new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const disc = new THREE.Mesh(discGeom, discMat);

      const ringGeom = new THREE.RingGeometry(0.16, 0.21, 28);
      const ringMat = new THREE.MeshBasicMaterial({
        color: hex,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false
      });
      const ring = new THREE.Mesh(ringGeom, ringMat);
      impactGroup.add(disc);
      impactGroup.add(ring);
      this.reflectionsGroup.add(impactGroup);

      // Virtual Image Source Ghost Speaker + Dashed Ray to Reflection Point
      const ghostNode = new THREE.Group();
      const ghostBox = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 16, 16),
        new THREE.MeshBasicMaterial({
          color: hex,
          wireframe: true,
          transparent: true,
          opacity: 0.65
        })
      );
      const ghostCore = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 12, 12),
        new THREE.MeshBasicMaterial({
          color: hex,
          transparent: true,
          opacity: 0.85
        })
      );
      ghostNode.add(ghostBox);
      ghostNode.add(ghostCore);
      this.ghostsGroup.add(ghostNode);

      const ghostRayGeom = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3()
      ]);
      const ghostRayMat = new THREE.LineDashedMaterial({
        color: hex,
        dashSize: 0.18,
        gapSize: 0.12,
        transparent: true,
        opacity: 0.55
      });
      const ghostRay = new THREE.Line(ghostRayGeom, ghostRayMat);
      this.ghostsGroup.add(ghostRay);

      this.reflectionVisuals[id] = {
        line,
        lineMat,
        impactGroup,
        discMat,
        ringMat,
        ghostNode,
        ghostRay
      };
    });

    // 3. Expanding 3D Acoustic Wavefront Rings Pool
    this.wavefrontsGroup = new THREE.Group();
    this.rootGroup.add(this.wavefrontsGroup);
    this.activeWavefronts = [];
    this.lastSolution = null;
  }

  setVisibility(key, visible) {
    this.visibility[key] = visible;
    if (key === 'direct') this.directGroup.visible = visible;
    if (key === 'earlyReflections') this.reflectionsGroup.visible = visible;
    if (key === 'imageGhosts') this.ghostsGroup.visible = visible;
    if (key === 'wavefronts') this.wavefrontsGroup.visible = visible;
  }

  /**
   * Spawns a 3D expanding acoustic wavefront ring at the current source position.
   */
  spawnWavefront(sourcePos, intensity = 0.8) {
    if (!this.visibility.wavefronts) return;
    if (this.activeWavefronts.length > 14) {
      const oldest = this.activeWavefronts.shift();
      this.wavefrontsGroup.remove(oldest.mesh);
      oldest.mesh.geometry.dispose();
      oldest.mesh.material.dispose();
    }

    const group = new THREE.Group();
    group.position.set(sourcePos.x, sourcePos.y, sourcePos.z);

    // Horizontal equatorial wavefront torus + vertical meridian ring
    const ringGeom = new THREE.RingGeometry(0.94, 1.0, 48);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38d9a9,
      transparent: true,
      opacity: Math.min(0.75, 0.35 + intensity * 0.4),
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const ringXZ = new THREE.Mesh(ringGeom, mat);
    ringXZ.rotation.x = Math.PI / 2;
    group.add(ringXZ);

    const sphereWire = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 20, 12),
      new THREE.MeshBasicMaterial({
        color: 0x00f5d4,
        wireframe: true,
        transparent: true,
        opacity: Math.min(0.25, intensity * 0.22),
        depthWrite: false
      })
    );
    group.add(sphereWire);

    this.wavefrontsGroup.add(group);
    this.activeWavefronts.push({
      mesh: group,
      matH: mat,
      matS: sphereWire.material,
      radius: 0.15,
      maxRadius: 9.5,
      intensity
    });
  }

  /**
   * Updates all 3D ray vectors, reflection points, and virtual image sources from AcousticMath.
   */
  updateFromSolution(sourcePos, micPos, solution) {
    this.lastSolution = solution;
    const pSrc = new THREE.Vector3(sourcePos.x, sourcePos.y, sourcePos.z);
    const pMic = new THREE.Vector3(micPos.x, micPos.y, micPos.z);

    // 1. Update Direct Line & Tube
    const directPositions = this.directLine.geometry.attributes.position.array;
    directPositions[0] = pSrc.x;
    directPositions[1] = pSrc.y;
    directPositions[2] = pSrc.z;
    directPositions[3] = pMic.x;
    directPositions[4] = pMic.y;
    directPositions[5] = pMic.z;
    this.directLine.geometry.attributes.position.needsUpdate = true;

    const dirVec = new THREE.Vector3().subVectors(pMic, pSrc);
    const len = Math.max(0.05, dirVec.length());
    this.directTube.position.copy(pSrc).addScaledVector(dirVec, 0.5);
    this.directTube.scale.set(1, len, 1);
    this.directTube.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      dirVec.clone().normalize()
    );

    const directAlpha = Math.max(0.18, Math.min(0.9, solution.direct.polar.magnitude));
    this.directTube.material.opacity = directAlpha * 0.55;

    // 2. Update 6 Specular Reflection Rays, Wall Impact Discs, and Ghost Sources
    for (const refl of solution.reflections) {
      const vis = this.reflectionVisuals[refl.id];
      if (!vis) continue;

      const rPt = refl.reflectionPoint;
      const imgPt = refl.imageSource;

      // Update Source -> ReflectionPoint -> Mic polyline
      const posArr = vis.line.geometry.attributes.position.array;
      posArr[0] = pSrc.x;
      posArr[1] = pSrc.y;
      posArr[2] = pSrc.z;
      posArr[3] = rPt.x;
      posArr[4] = rPt.y;
      posArr[5] = rPt.z;
      posArr[6] = pMic.x;
      posArr[7] = pMic.y;
      posArr[8] = pMic.z;
      vis.line.geometry.attributes.position.needsUpdate = true;
      vis.line.geometry.computeBoundingSphere();

      // Scale opacity & disc size by acoustic reflection strength (R_1kHz * polar)
      const energyFactor = Math.max(
        0.1,
        Math.min(1.0, refl.reflectionCoeff[1000] * refl.polar.magnitude)
      );
      vis.lineMat.opacity = 0.2 + energyFactor * 0.72;
      vis.discMat.opacity = 0.15 + energyFactor * 0.5;
      vis.ringMat.opacity = 0.25 + energyFactor * 0.7;

      // Position & orient impact disc slightly inside wall plane to avoid z-fighting
      const normal = BOUNDARY_NORMALS[refl.id];
      vis.impactGroup.position
        .set(rPt.x, rPt.y, rPt.z)
        .addScaledVector(normal, 0.012);
      vis.impactGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      const scale = 0.65 + energyFactor * 0.65;
      vis.impactGroup.scale.set(scale, scale, 1);

      // Update Virtual Image Source Ghost & dashed line to reflection point
      vis.ghostNode.position.set(imgPt.x, imgPt.y, imgPt.z);
      const ghostArr = vis.ghostRay.geometry.attributes.position.array;
      ghostArr[0] = imgPt.x;
      ghostArr[1] = imgPt.y;
      ghostArr[2] = imgPt.z;
      ghostArr[3] = rPt.x;
      ghostArr[4] = rPt.y;
      ghostArr[5] = rPt.z;
      vis.ghostRay.geometry.attributes.position.needsUpdate = true;
      vis.ghostRay.computeLineDistances();
    }
  }

  /**
   * Animates expanding acoustic wavefronts per frame
   */
  animate(dt) {
    for (let i = this.activeWavefronts.length - 1; i >= 0; i--) {
      const wf = this.activeWavefronts[i];
      wf.radius += dt * 5.8; // Visual acoustic expansion speed (m/s scaled for observation)
      const progress = wf.radius / wf.maxRadius;

      if (progress >= 1.0) {
        this.wavefrontsGroup.remove(wf.mesh);
        wf.mesh.children.forEach((c) => {
          c.geometry.dispose();
          c.material.dispose();
        });
        this.activeWavefronts.splice(i, 1);
      } else {
        wf.mesh.scale.setScalar(wf.radius);
        const fade = Math.pow(1.0 - progress, 1.6);
        wf.matH.opacity = fade * 0.55 * wf.intensity;
        wf.matS.opacity = fade * 0.18 * wf.intensity;
      }
    }
  }
}
