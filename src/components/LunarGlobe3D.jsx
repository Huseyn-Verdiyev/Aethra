import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { gsap } from 'gsap';

const MOON_RADIUS = 10.0;

// Selenographic coordinates (lat/lon) to 3D Cartesian coordinates on Moon sphere
function selenographicToCartesian(latDeg, lonDeg, radius = MOON_RADIUS) {
  const phi = (latDeg * Math.PI) / 180;
  const lambda = (lonDeg * Math.PI) / 180;

  const cosPhi = Math.cos(phi);
  const x = radius * cosPhi * Math.sin(lambda);
  const y = radius * Math.sin(phi); // South Pole is at -Y, North Pole at +Y
  const z = radius * cosPhi * Math.cos(lambda);

  return new THREE.Vector3(x, y, z);
}

/**
 * Computes physically accurate, high-clarity camera vectors for landing sites.
 * Avoids sub-pixel texture smearing by maintaining optically crisp orbital altitudes.
 */
function getHeroCameraVectors(siteLat, siteLon, isMicroscopic = false) {
  const DEG2RAD = Math.PI / 180;
  const phi = siteLat * DEG2RAD;
  const lambda = siteLon * DEG2RAD;

  // Exact site position on Moon surface (Radius = MOON_RADIUS)
  const sitePos = new THREE.Vector3(
    MOON_RADIUS * Math.cos(phi) * Math.sin(lambda),
    MOON_RADIUS * Math.sin(phi),
    MOON_RADIUS * Math.cos(phi) * Math.cos(lambda)
  );

  // Exact Right-Handed Orthonormal Topocentric Triad (Up, North, East):
  const u_Up = sitePos.clone().normalize();

  // Local North towards Lunar North Pole (+Y):
  const worldNorth = new THREE.Vector3(0, 1, 0);
  const u_North = worldNorth.clone().sub(u_Up.clone().multiplyScalar(worldNorth.dot(u_Up))).normalize();
  const u_East = new THREE.Vector3().crossVectors(u_North, u_Up).normalize();

  let targetLookAt;
  let targetCamPos;
  const targetUp = new THREE.Vector3(0, 1, 0); // Always universal (0, 1, 0) to prevent polar singularities
  let minD;
  let maxD;

  if (isMicroscopic) {
    // Cinematic Hero Grazing Approach (~550 km altitude):
    // Oblique grazing angle looking across the crater massif towards the summit and horizon.
    // Preserves crisp 8K relief, crater rim shadows and deep space backdrop.
    targetLookAt = sitePos.clone()
      .add(u_North.clone().multiplyScalar(0.8));

    targetCamPos = sitePos.clone()
      .add(u_Up.clone().multiplyScalar(2.8))
      .add(u_North.clone().multiplyScalar(-3.0))
      .add(u_East.clone().multiplyScalar(1.2));

    minD = 2.0;
    maxD = 40.0;
  } else {
    // Tactical Orbital Reconnaissance (~1,100 km altitude):
    // Frames the landing site prominently with the 3D curvature of the Moon against deep space.
    targetLookAt = sitePos.clone();

    targetCamPos = sitePos.clone()
      .add(u_Up.clone().multiplyScalar(5.5))
      .add(u_North.clone().multiplyScalar(-5.0))
      .add(u_East.clone().multiplyScalar(2.0));

    minD = 3.0;
    maxD = 65.0;
  }

  return { targetLookAt, targetCamPos, targetUp, minD, maxD };
}

const LunarGlobe3D = forwardRef(function LunarGlobe3D({
  sites = [],
  selectedSiteId,
  onSelectSite,
  downselection,
  sunAzimuthDeg = 114.5,
  sunElevationDeg = 1.5,
  isSunBlocked = false,
  isSidebarOpen = true,
  onCameraUpdate,
  onLoadStatus
}, ref) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);
  const moonMeshRef = useRef(null);
  const moonMaterialRef = useRef(null);

  const sunMeshRef = useRef(null);
  const sunLightRef = useRef(null);
  const sunRayLineRef = useRef(null);
  const markersRef = useRef([]);

  const [activeCameraMode, setActiveCameraMode] = useState('southpole');
  const autoRotateRef = useRef(false);
  const [screenMarkers, setScreenMarkers] = useState([]);
  const [altitudeKm, setAltitudeKm] = useState(2650);

  // Progressive LoD Texture Streaming State
  const [lodState, setLodState] = useState('base'); // 'base' | 'streaming' | '8k_active'
  const [lodProgress, setLodProgress] = useState(0);

  const isFlyingRef = useRef(false);
  const isFirstMountRef = useRef(true);
  const is8kStartedRef = useRef(false);

  // Initialize Three.js Scene with High-Res NASA LROC & LOLA Relief
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x010204); // Deep cosmic void
    sceneRef.current = scene;

    // 2. Camera with 0.05 Near Plane - Positioned in majestic South Pole overview
    const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, 50000);
    camera.position.set(0, -15.5, 20.0);
    camera.up.set(0, 1, 0);
    cameraRef.current = camera;

    // 3. WebGL Renderer with Logarithmic Depth Buffer & PCF Soft Shadows
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05; // Balanced, crisp exposure
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // 4. OrbitControls: Initialized targeting South Pole surface exploration zone
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.minDistance = 3.5;
    controls.maxDistance = 140.0;
    controls.enablePan = false;
    controls.target.set(0, -9.5, 0); // Focus on South Pole region
    controls.update();
    controlsRef.current = controls;

    // 5. 5,500 Procedural Deep Space Stars
    const starCount = 5500;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const r = 700 + Math.random() * 600;
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);

      starPos[i3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i3 + 2] = r * Math.cos(phi);

      const tint = 0.8 + Math.random() * 0.2;
      starColors[i3] = tint * 0.9;
      starColors[i3 + 1] = tint * 0.95;
      starColors[i3 + 2] = tint * 1.0;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 1.6,
      vertexColors: true,
      transparent: true,
      opacity: 0.85,
      sizeAttenuation: true
    });
    const starfield = new THREE.Points(starGeo, starMat);
    scene.add(starfield);

    // 6. Progressive Level-of-Detail (LoD) Texture Pipeline
    const maxAnisotropy = Math.min(renderer.capabilities.getMaxAnisotropy() || 1, 16);
    const textureLoader = new THREE.TextureLoader();

    // Tier 1: Fast Base Texture (Instantly renders the Moon sphere with 0ms blocking)
    const baseColorMap = textureLoader.load('/textures/moon_color.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = maxAnisotropy;
      tex.generateMipmaps = true;
    });

    const baseBumpMap = textureLoader.load('/textures/moon_bump.jpg', (tex) => {
      tex.anisotropy = maxAnisotropy;
      tex.generateMipmaps = true;
    });

    // 192x192 High-Precision Tessellated Lunar Spheroid
    const moonGeometry = new THREE.SphereGeometry(MOON_RADIUS, 192, 192);
    const moonMaterial = new THREE.MeshStandardMaterial({
      map: baseColorMap,
      bumpMap: baseBumpMap,
      bumpScale: 0.12, // Initial base depth
      roughness: 0.95, // Highly diffuse lunar regolith
      metalness: 0.01
    });
    moonMaterialRef.current = moonMaterial;

    const moonMesh = new THREE.Mesh(moonGeometry, moonMaterial);
    moonMesh.castShadow = true;
    moonMesh.receiveShadow = true;
    moonMeshRef.current = moonMesh;
    scene.add(moonMesh);

    // Tier 2: Progressive Asynchronous Background Streaming of NASA 8K LROC & 5.7K LOLA DEM
    const load8kTextures = () => {
      if (is8kStartedRef.current) return;
      is8kStartedRef.current = true;
      setLodState('streaming');

      let loadedCount = 0;
      let colorTex = null;
      let bumpTex = null;

      const checkBothLoaded = () => {
        loadedCount += 1;
        setLodProgress(Math.round((loadedCount / 2) * 100));

        if (loadedCount >= 2 && colorTex && bumpTex && moonMaterialRef.current) {
          moonMaterialRef.current.map = colorTex;
          moonMaterialRef.current.bumpMap = bumpTex;
          moonMaterialRef.current.bumpScale = 0.22; // High-depth LOLA DEM crater relief
          moonMaterialRef.current.needsUpdate = true;
          setLodState('8k_active');
          onLoadStatus?.(true);
        }
      };

      // Load 8K LROC Color Map (8192 x 4096)
      colorTex = textureLoader.load('/textures/moon_8k.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = maxAnisotropy;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        checkBothLoaded();
      });

      // Load 5.7K LOLA Altimetry DEM (5760 x 2880)
      bumpTex = textureLoader.load('/textures/moon_bump_hires.jpg', (tex) => {
        tex.anisotropy = maxAnisotropy;
        tex.generateMipmaps = true;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        checkBothLoaded();
      });
    };

    // Trigger progressive 8K stream shortly after initial frame renders
    const streamTimer = setTimeout(() => {
      load8kTextures();
    }, 350);

    // 7. Tactical Landing Site Markers (Clean, Sharp Pins — ZERO PointLights)
    const markersGroup = new THREE.Group();
    scene.add(markersGroup);

    const createdMarkers = [];
    sites.forEach(site => {
      const pos = selenographicToCartesian(site.lat, site.lon, MOON_RADIUS + 0.01);
      
      const isRank1 = site.id === 'malapert';
      const isDisq = site.id === 'haworth' || site.id === 'de_gerlache';
      const pinColor = isRank1 ? 0x10b981 : isDisq ? 0xf43f5e : 0x38bdf8;
      
      // Precision Base Ring
      const ringGeo = new THREE.RingGeometry(0.04, 0.07, 32);
      const ringMat = new THREE.MeshBasicMaterial({
        color: pinColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.position.copy(pos);
      ringMesh.lookAt(pos.clone().multiplyScalar(2));
      markersGroup.add(ringMesh);

      // Delicate Needle Pin
      const pinGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.25, 8);
      const pinMat = new THREE.MeshBasicMaterial({ color: pinColor });
      const pinMesh = new THREE.Mesh(pinGeo, pinMat);
      const pinNormal = pos.clone().normalize();
      pinMesh.position.copy(pos.clone().add(pinNormal.clone().multiplyScalar(0.125)));
      pinMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pinNormal);
      markersGroup.add(pinMesh);

      // Microscopic Tip Bead
      const beadGeo = new THREE.SphereGeometry(0.02, 16, 16);
      const beadMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const beadMesh = new THREE.Mesh(beadGeo, beadMat);
      beadMesh.position.copy(pos.clone().add(pinNormal.clone().multiplyScalar(0.25)));
      markersGroup.add(beadMesh);

      createdMarkers.push({
        siteId: site.id,
        pos,
        ringMesh,
        pinMesh,
        beadMesh
      });
    });
    markersRef.current = createdMarkers;

    // 8. 3D Sun Vector Ray from Selected Site
    const rayGeo = new THREE.BufferGeometry();
    const rayPos = new Float32Array(6);
    rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPos, 3));
    const rayMat = new THREE.LineBasicMaterial({
      color: 0xfbbf24,
      transparent: true,
      opacity: 0.9,
      linewidth: 2
    });
    const sunRayLine = new THREE.Line(rayGeo, rayMat);
    sunRayLineRef.current = sunRayLine;
    scene.add(sunRayLine);

    // 9. Physical Directional Solar Illumination & Distant Sun Orb
    const sunLight = new THREE.DirectionalLight(0xfff8ee, 2.0);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 300;
    sunLight.shadow.camera.left = -16;
    sunLight.shadow.camera.right = 16;
    sunLight.shadow.camera.top = 16;
    sunLight.shadow.camera.bottom = -16;
    sunLight.shadow.bias = -0.0003;

    // Aim light directly at South Pole
    const sunTarget = new THREE.Object3D();
    sunTarget.position.set(0, -MOON_RADIUS, 0);
    scene.add(sunTarget);
    sunLight.target = sunTarget;
    sunLightRef.current = sunLight;
    scene.add(sunLight);

    // Deep space Earthshine fill: subtle directional bounce + soft hemisphere light
    const hemiLight = new THREE.HemisphereLight(0x2d3a4f, 0x070b12, 0.35);
    scene.add(hemiLight);

    const ambientLight = new THREE.AmbientLight(0x0f172a, 0.15);
    scene.add(ambientLight);

    // Glowing Sun Visual Orb in deep space
    const sunGeo = new THREE.SphereGeometry(6, 32, 32);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(120, -10, 60);
    sunMeshRef.current = sunMesh;
    scene.add(sunMesh);

    // Sun Corona Glow
    const coronaGeo = new THREE.SphereGeometry(14, 32, 32);
    const coronaMat = new THREE.MeshBasicMaterial({
      color: 0xffedd5,
      transparent: true,
      opacity: 0.25,
      side: THREE.BackSide
    });
    sunMesh.add(new THREE.Mesh(coronaGeo, coronaMat));

    // Animation & Render Loop
    let animId;
    let lastAltUpdate = 0;

    const animate = (time) => {
      animId = requestAnimationFrame(animate);

      // Decoupled: Only update OrbitControls when NOT in a GSAP flight animation
      if (!isFlyingRef.current) {
        controls.update();
      }

      // Gentle auto-rotation when enabled
      if (autoRotateRef.current && controls.enabled) {
        moonMesh.rotation.y += 0.0006;
      }

      // Marker pulse animation
      const pulse = Math.sin(time * 0.004) * 0.5 + 0.5;
      markersRef.current.forEach(m => {
        if (m.ringMesh.material) {
          m.ringMesh.material.opacity = 0.5 + pulse * 0.5;
        }
      });

      // Calculate Real Altitude above surface
      if (time - lastAltUpdate > 100) {
        const camDistFromCenter = camera.position.distanceTo(new THREE.Vector3(0, 0, 0));
        const altitudeUnits = Math.max(0.001, camDistFromCenter - MOON_RADIUS);
        // Scale: 1 unit = 173.74 km
        const altitudeRealKm = Math.round(altitudeUnits * 173.74);
        setAltitudeKm(altitudeRealKm);
        lastAltUpdate = time;
      }

      // Project 3D site positions into 2D Screen Space for HTML callout pins
      if (containerRef.current) {
        const contW = containerRef.current.clientWidth;
        const contH = containerRef.current.clientHeight;
        const projected = [];

        sites.forEach(site => {
          const worldPos = selenographicToCartesian(site.lat, site.lon, MOON_RADIUS + 0.12);
          worldPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), moonMesh.rotation.y);

          // Visibility check (front vs back of lunar sphere)
          const camToPoint = worldPos.clone().sub(camera.position).normalize();
          const normal = worldPos.clone().normalize();
          const dot = normal.dot(camToPoint);

          if (dot < 0.15) { // Visible on front hemisphere
            const ndc = worldPos.clone().project(camera);
            const x = (ndc.x * 0.5 + 0.5) * contW;
            const y = (-ndc.y * 0.5 + 0.5) * contH;

            projected.push({
              siteId: site.id,
              name: site.name,
              lat: site.lat,
              lon: site.lon,
              elevation: site.elevationMeters,
              x,
              y,
              visible: true,
              opacity: Math.max(0.2, Math.min(1.0, (0.15 - dot) * 4))
            });
          }
        });

        setScreenMarkers(projected);
      }

      renderer.render(scene, camera);
    };
    animate(performance.now());

    // Window Resize Handler with Golden Ratio Offset
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      cameraRef.current.aspect = w / h;

      const isDesktop = w >= 1024;
      const offset = (isSidebarOpen && isDesktop) ? -210 : 0;
      if (offset !== 0) {
        cameraRef.current.setViewOffset(w, h, offset, 0, w, h);
      } else {
        cameraRef.current.clearViewOffset();
      }

      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };

    handleResize(); // Initial setup with golden offset

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      clearTimeout(streamTimer);
      cancelAnimationFrame(animId);
      resizeObserver.disconnect();
      renderer.dispose();
      moonGeometry.dispose();
      moonMaterial.dispose();
      starGeo.dispose();
      starMat.dispose();
      baseColorMap.dispose();
      baseBumpMap.dispose();
    };
  }, [sites]);

  // Update Golden Ratio View Offset when Sidebar Toggles
  useEffect(() => {
    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const isDesktop = w >= 1024;
    const offset = (isSidebarOpen && isDesktop) ? -210 : 0;

    if (offset !== 0) {
      camera.setViewOffset(w, h, offset, 0, w, h);
    } else {
      camera.clearViewOffset();
    }
    camera.updateProjectionMatrix();
  }, [isSidebarOpen]);

  // Synchronize dynamic Sun Vector from real IAU Ephemeris
  useEffect(() => {
    if (!sunLightRef.current || !sunMeshRef.current || !sunLightRef.current.target) return;
    const azRad = (sunAzimuthDeg * Math.PI) / 180;
    const elRad = (sunElevationDeg * Math.PI) / 180;

    const dist = 140.0;
    const sunX = dist * Math.cos(elRad) * Math.sin(azRad);
    const sunY = -MOON_RADIUS - dist * Math.sin(elRad);
    const sunZ = dist * Math.cos(elRad) * Math.cos(azRad);

    sunLightRef.current.position.set(sunX, sunY, sunZ);
    sunLightRef.current.target.position.set(0, -MOON_RADIUS, 0);
    sunLightRef.current.target.updateMatrixWorld();

    sunMeshRef.current.position.set(sunX, sunY, sunZ).normalize().multiplyScalar(420);

    // Update 3D Sun Vector Ray from selected landing site
    if (sunRayLineRef.current) {
      const site = sites.find(s => s.id === selectedSiteId) || sites[0];
      if (site) {
        const sitePos = selenographicToCartesian(site.lat, site.lon, MOON_RADIUS + 0.05);
        const sunWorldPos = new THREE.Vector3(sunX, sunY, sunZ);
        const sunDir = sunWorldPos.clone().sub(new THREE.Vector3(0, -MOON_RADIUS, 0)).normalize();
        const rayEnd = sitePos.clone().add(sunDir.multiplyScalar(2.0));

        const positions = sunRayLineRef.current.geometry.attributes.position.array;
        positions[0] = sitePos.x;
        positions[1] = sitePos.y;
        positions[2] = sitePos.z;
        positions[3] = rayEnd.x;
        positions[4] = rayEnd.y;
        positions[5] = rayEnd.z;
        sunRayLineRef.current.geometry.attributes.position.needsUpdate = true;

        if (isSunBlocked) {
          sunRayLineRef.current.material.color.setHex(0xf43f5e); // Blocked: Crimson red ray
          sunRayLineRef.current.material.opacity = 0.85;
        } else {
          sunRayLineRef.current.material.color.setHex(0xfbbf24); // Direct: Golden sunlight ray
          sunRayLineRef.current.material.opacity = 0.95;
        }
      }
    }
  }, [sunAzimuthDeg, sunElevationDeg, selectedSiteId, isSunBlocked, sites]);

  // GSAP Smooth Cinematic Camera Flights with Local Orthonormal Up Vectors
  const flyToCameraState = useCallback((stateKey, customSiteId = null) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    setActiveCameraMode(stateKey);
    autoRotateRef.current = false;

    let targetCamPos = new THREE.Vector3(0, -15.5, 20.0);
    let targetLookAt = new THREE.Vector3(0, -9.5, 0);
    let minD = 4.0;
    let maxD = 140.0;
    let duration = 2.2;
    let ease = 'power3.inOut';

    if (stateKey === 'global') {
      targetCamPos.set(0, 16, 45);
      targetLookAt.set(0, 0, 0);
      minD = 10.3; // Can zoom all the way close to surface from deep space
      maxD = 180.0;
      duration = 2.0;
      ease = 'power3.inOut';

    } else if (stateKey === 'southpole') {
      targetCamPos.set(0, -15.5, 20.0);
      targetLookAt.set(0, -9.5, 0);
      minD = 1.8;
      maxD = 90.0;
      duration = 2.2;
      ease = 'power3.inOut';

    } else if (stateKey === 'microscopic') {
      // MICROSCOPIC HERO VIEW: Oblique flyby angle showing the crater rim, peak and lunar horizon in 8K!
      const siteId = customSiteId || selectedSiteId;
      const site = sites.find(s => s.id === siteId) || sites[0];
      const hero = getHeroCameraVectors(site.lat, site.lon, true);

      targetLookAt.copy(hero.targetLookAt);
      targetCamPos.copy(hero.targetCamPos);
      minD = hero.minD;
      maxD = hero.maxD;
      duration = 2.4;
      ease = 'power3.inOut';

    } else if (stateKey === 'site' || customSiteId) {
      // TACTICAL ORBITAL RECONNAISSANCE (~1,100 km altitude)
      // Frames the landing target clearly while showing the magnificent Moon sphere!
      const siteId = customSiteId || selectedSiteId;
      const site = sites.find(s => s.id === siteId) || sites[0];
      const hero = getHeroCameraVectors(site.lat, site.lon, false);

      targetLookAt.copy(hero.targetLookAt);
      targetCamPos.copy(hero.targetCamPos);
      minD = hero.minD;
      maxD = hero.maxD;
      duration = 2.2;
      ease = 'power3.inOut';
    }

    // Decouple OrbitControls from GSAP during flight: prevents clamping & fighting
    isFlyingRef.current = true;
    controls.enabled = false;

    gsap.killTweensOf(camera.position);
    gsap.killTweensOf(controls.target);

    // Keep camera.up strictly (0, 1, 0) universally to prevent polar gimbal flips
    camera.up.set(0, 1, 0);

    const tl = gsap.timeline({
      onUpdate: () => {
        camera.lookAt(controls.target);
      },
      onComplete: () => {
        camera.position.copy(targetCamPos);
        controls.target.copy(targetLookAt);
        camera.lookAt(targetLookAt);
        controls.minDistance = minD;
        controls.maxDistance = maxD;
        controls.update();
        isFlyingRef.current = false;
        controls.enabled = true;
      }
    });

    tl.to(camera.position, {
      x: targetCamPos.x,
      y: targetCamPos.y,
      z: targetCamPos.z,
      duration,
      ease
    }, 0);

    tl.to(controls.target, {
      x: targetLookAt.x,
      y: targetLookAt.y,
      z: targetLookAt.z,
      duration,
      ease
    }, 0);
  }, [selectedSiteId, sites]);

  // When selectedSiteId changes via explicit user click, fly to site recon view
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return; // Do NOT auto-plunge camera into the surface on page load!
    }
    if (selectedSiteId) {
      flyToCameraState('site', selectedSiteId);
    }
  }, [selectedSiteId]);

  // Manual Smooth Zoom In / Out Handlers
  const handleZoom = useCallback((factor) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const currentDist = camera.position.distanceTo(controls.target);
    const newDist = Math.max(controls.minDistance, Math.min(controls.maxDistance, currentDist * factor));
    const dir = camera.position.clone().sub(controls.target).normalize();

    gsap.to(camera.position, {
      x: controls.target.x + dir.x * newDist,
      y: controls.target.y + dir.y * newDist,
      z: controls.target.z + dir.z * newDist,
      duration: 0.35,
      ease: 'power2.out',
      onUpdate: () => controls.update()
    });
  }, []);

  // Expose Camera API to Parent (App.jsx)
  useImperativeHandle(ref, () => ({
    flyToCameraState,
    handleZoom,
    toggleAutoRotate: () => { autoRotateRef.current = !autoRotateRef.current; },
    setAutoRotate: (val) => { autoRotateRef.current = val; },
    getCameraMode: () => activeCameraMode
  }), [flyToCameraState, handleZoom, activeCameraMode]);

  // Send Telemetry Updates to Parent
  useEffect(() => {
    onCameraUpdate?.({
      activeCameraMode,
      altitudeKm,
      autoRotate: autoRotateRef.current,
      is8kActive: lodState === '8k_active',
      lodState,
      lodProgress
    });
  }, [activeCameraMode, altitudeKm, lodState, lodProgress, onCameraUpdate]);

  return (
    <div ref={containerRef} className="relative w-full h-full min-h-screen bg-black overflow-hidden select-none">
      <canvas ref={canvasRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

      {/* Non-Blocking Progressive LoD Status Telemetry Pill */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none select-none">
        {lodState === 'streaming' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950/85 border border-sky-500/40 backdrop-blur-xl text-[10px] font-mono text-sky-300 shadow-2xl">
            <span className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
            <span>STREAMING NASA 8K LROC [{lodProgress}%]</span>
          </div>
        )}
        {lodState === '8k_active' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/85 border border-emerald-500/40 backdrop-blur-xl text-[10px] font-mono text-emerald-300 shadow-2xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>NASA 8K LROC // LOLA DEM ACTIVE</span>
          </div>
        )}
        {lodState === 'base' && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950/80 border border-white/10 backdrop-blur-xl text-[10px] font-mono text-zinc-400 shadow-2xl">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
            <span>OPTICAL RESOLUTION: 4K BASE</span>
          </div>
        )}
      </div>

      {/* Screen Projections of 3D Landing Pins */}
      {screenMarkers.map(m => {
        const isSelected = m.siteId === selectedSiteId;
        const rankInfo = downselection?.rankedSites?.find(r => r.siteId === m.siteId);
        const isRank1 = rankInfo?.rank === 1 && rankInfo?.isMissionSuccess;
        const isLOM = rankInfo?.rankStatus === 'DISQUALIFIED';

        return (
          <div
            key={m.siteId}
            onClick={(e) => {
              e.stopPropagation();
              onSelectSite(m.siteId);
            }}
            style={{
              position: 'absolute',
              left: `${m.x}px`,
              top: `${m.y}px`,
              transform: 'translate(-50%, -100%)',
              opacity: m.opacity,
              pointerEvents: m.opacity > 0.4 ? 'auto' : 'none'
            }}
            className="flex flex-col items-center group cursor-pointer transition-transform duration-200 hover:scale-110"
          >
            {/* Callout Label */}
            <div className={`px-2 py-0.5 rounded border font-mono text-[10px] flex items-center gap-1.5 shadow-2xl transition-all ${
              isSelected 
                ? 'bg-zinc-100 text-zinc-950 border-white font-bold scale-110 shadow-white/30' 
                : isRank1 
                ? 'bg-emerald-950/90 text-emerald-300 border-emerald-500/80 shadow-emerald-950/50' 
                : isLOM 
                ? 'bg-rose-950/90 text-rose-300 border-rose-600/80 shadow-rose-950/50' 
                : 'bg-zinc-900/90 text-zinc-300 border-zinc-700'
            }`}>
              <span className={`w-1.5 h-1.5 rounded-full ${
                isRank1 ? 'bg-emerald-400' : isLOM ? 'bg-rose-400' : 'bg-sky-400'
              }`} />
              <span>{m.name.split(' ')[0]}</span>
              <span className="opacity-75 font-normal">#{rankInfo?.rank || '-'}</span>
            </div>

            {/* Pin Stem */}
            <div className={`w-0.5 h-3 ${
              isSelected ? 'bg-white' : isRank1 ? 'bg-emerald-400' : isLOM ? 'bg-rose-500' : 'bg-sky-400'
            }`} />
            <div className={`w-1.5 h-1.5 rounded-full border ${
              isSelected 
                ? 'bg-white border-zinc-900' 
                : isRank1 
                ? 'bg-emerald-500 border-emerald-200' 
                : isLOM 
                ? 'bg-rose-500 border-rose-200' 
                : 'bg-sky-400 border-sky-200'
            }`} />
          </div>
        );
      })}
    </div>
  );
});

export default LunarGlobe3D;