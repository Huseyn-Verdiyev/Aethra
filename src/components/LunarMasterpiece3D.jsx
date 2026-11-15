import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three-stdlib';
import { gsap } from 'gsap';
import { Layers, Mountain, Eye, Crosshair } from 'lucide-react';

const TERRAIN_SIZE = 40.0;
const GRID_RES = 256; // 256x256 vertices = 65,536 physical 3D elevation points
const MEAN_DATUM_HEIGHT = 80.0 / 255.0; // Mean elevation datum at lunar south pole

// Exact site coordinates on the 3D South Polar Stereographic terrain mesh [-20..+20 units]
// Calibrated with NASA LOLA South Polar Stereographic DEM (90°S center, 8.5° colatitude radius = 20.0 3D units)
const SITE_TERRAIN_COORDS = {
  malapert: { x: 0.0, z: -9.44, elevBase: 115 / 255.0, shortName: 'Malapert' },
  shackleton: { x: 0.0, z: -0.24, elevBase: 83 / 255.0, shortName: 'Shackleton' },
  haworth: { x: -0.54, z: -6.09, elevBase: 52 / 255.0, shortName: 'Haworth' },
  nobile: { x: 9.08, z: -6.72, elevBase: 84 / 255.0, shortName: 'Nobile' },
  de_gerlache: { x: -3.73, z: -1.45, elevBase: 83 / 255.0, shortName: 'de Gerlache' }
};

const LunarMasterpiece3D = forwardRef(function LunarMasterpiece3D({
  sites = [],
  selectedSiteId = 'nobile',
  onSelectSite,
  downselection,
  sunAzimuthDeg = 114.5,
  sunElevationDeg = 1.5,
  isSunBlocked = false,
  isSidebarOpen = true,
  onCameraUpdate,
  theme,
  layerMode: propLayerMode,
  reliefExaggeration: propReliefExaggeration,
  onLayerModeChange,
  onReliefExaggerationChange
}, ref) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const controlsRef = useRef(null);

  const terrainMeshRef = useRef(null);
  const terrainGeoRef = useRef(null);
  const rawHeightsRef = useRef(null);
  const sunLightRef = useRef(null);
  const markersRef = useRef([]);

  const [activeCameraMode, setActiveCameraMode] = useState('southpole');
  const [altitudeKm, setAltitudeKm] = useState(1200);
  const [internalRelief, setInternalRelief] = useState(2.5);
  const [internalLayerMode, setInternalLayerMode] = useState('albedo');
  const autoRotateRef = useRef(false);

  const reliefExaggeration = propReliefExaggeration !== undefined ? propReliefExaggeration : internalRelief;
  const layerMode = propLayerMode !== undefined ? propLayerMode : internalLayerMode;

  const setReliefExaggeration = useCallback((val) => {
    setInternalRelief(val);
    onReliefExaggerationChange?.(val);
  }, [onReliefExaggerationChange]);

  const setLayerMode = useCallback((mode) => {
    setInternalLayerMode(mode);
    onLayerModeChange?.(mode);
  }, [onLayerModeChange]);

  // 2D Screen markers direct DOM element refs (eliminates 60fps React re-renders and projection lag)
  const badgeDomRefs = useRef({});

  // Textures cache
  const texturesRef = useRef({
    albedo: null,
    lola: null
  });

  // Calculate local terrain height at given (x, z)
  const getTerrainHeight = useCallback((x, z, exaggeration = reliefExaggeration) => {
    if (!rawHeightsRef.current) return 0;
    const gx = Math.min(Math.max(Math.round(((x + 20.0) / 40.0) * (GRID_RES - 1)), 0), GRID_RES - 1);
    const gz = Math.min(Math.max(Math.round(((z + 20.0) / 40.0) * (GRID_RES - 1)), 0), GRID_RES - 1);
    const idx = gz * GRID_RES + gx;
    const rawVal = rawHeightsRef.current[idx] / 255.0;
    const baseRelief = 2.4;
    return (rawVal - MEAN_DATUM_HEIGHT) * baseRelief * exaggeration;
  }, [reliefExaggeration]);

  // Initialize Three.js Scene, 3D Polar Terrain Mesh, and Dynamic Shadow Engine
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // 1. Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(theme?.canvasThreeHex !== undefined ? theme.canvasThreeHex : 0x121212);
    sceneRef.current = scene;

    // 2. Camera with 0.05 Near Plane
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000.0);
    camera.position.set(0, 24.0, 32.0);
    camera.up.set(0, 1, 0);
    cameraRef.current = camera;

    // 3. WebGL Renderer with High-Precision Shadow Maps
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      logarithmicDepthBuffer: true
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.45;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    rendererRef.current = renderer;

    // 4. OrbitControls
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.045;
    controls.minDistance = 2.0;
    controls.maxDistance = 180.0;
    controls.enablePan = false;
    controls.target.set(0, 0, -5.0);
    controls.update();
    controlsRef.current = controls;

    // 5. Procedural Deep Space Starfield (5,500 Stars)
    const starCount = 5500;
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);

    for (let i = 0; i < starCount; i++) {
      const i3 = i * 3;
      const r = 500 + Math.random() * 400;
      const theta = 2 * Math.PI * Math.random();
      const phi = Math.acos(2 * Math.random() - 1);

      starPos[i3] = r * Math.sin(phi) * Math.cos(theta);
      starPos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPos[i3 + 2] = r * Math.cos(phi);

      // Subtle natural celestial starfield (neutral white/warm tones)
      const starBrightness = 0.30 + Math.random() * 0.25;
      starColors[i3] = starBrightness;
      starColors[i3 + 1] = starBrightness;
      starColors[i3 + 2] = starBrightness;
    }

    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));

    const starMat = new THREE.PointsMaterial({
      size: 1.1,
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true
    });
    scene.add(new THREE.Points(starGeo, starMat));

    // 6. Directional Sunlight with High-Fidelity Shadow Frustum (Pure Solar White, High Dynamic Range)
    const sunLight = new THREE.DirectionalLight(0xffffff, 5.6);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 5.0;
    sunLight.shadow.camera.far = 160.0;
    sunLight.shadow.camera.left = -22.0;
    sunLight.shadow.camera.right = 22.0;
    sunLight.shadow.camera.top = 22.0;
    sunLight.shadow.camera.bottom = -22.0;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 0.035;
    scene.add(sunLight);
    scene.add(sunLight.target);
    sunLightRef.current = sunLight;

    // Deep vacuum space ambient fill - keeps unlit crater shadows pitch dark
    const ambientLight = new THREE.AmbientLight(0x0a0a0a, 0.12);
    scene.add(ambientLight);

    // 7. Load Textures & 3D LOLA Elevation Grid (65,536 Elevation Vertices)
    const textureLoader = new THREE.TextureLoader();
    const albedoTex = textureLoader.load('/textures/south_pole_albedo.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy() || 16;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      if (terrainMeshRef.current && layerMode === 'albedo') {
        terrainMeshRef.current.material.map = tex;
        terrainMeshRef.current.material.needsUpdate = true;
      }
    });

    const lolaTex = textureLoader.load('/textures/south_pole_lola_color.jpg', (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy() || 16;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
    });

    texturesRef.current = { albedo: albedoTex, lola: lolaTex };

    // Fetch raw 64KB NASA LOLA elevation heights
    fetch('/textures/south_pole_heights.bin')
      .then(res => res.arrayBuffer())
      .then(buffer => {
        const heights = new Uint8Array(buffer);
        rawHeightsRef.current = heights;

        // Construct 3D Plane Geometry in XZ plane
        const geo = new THREE.PlaneGeometry(TERRAIN_SIZE, TERRAIN_SIZE, GRID_RES - 1, GRID_RES - 1);
        geo.rotateX(-Math.PI / 2); // Lay flat so +Y is UP (elevation), +X is East, +Z is South
        terrainGeoRef.current = geo;

        // Displace physical vertices in 3D space
        const pos = geo.attributes.position;
        const baseRelief = 2.4;
        for (let i = 0; i < pos.count; i++) {
          const rawVal = heights[i] / 255.0;
          const yElev = (rawVal - MEAN_DATUM_HEIGHT) * baseRelief * reliefExaggeration;
          pos.setY(i, yElev);
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        // Create soft circular alpha falloff mask so terrain has zero sharp cardboard corners
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = 512;
        maskCanvas.height = 512;
        const maskCtx = maskCanvas.getContext('2d');
        const grad = maskCtx.createRadialGradient(256, 256, 185, 256, 256, 248);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(1, '#000000');
        maskCtx.fillStyle = grad;
        maskCtx.fillRect(0, 0, 512, 512);
        const alphaMask = new THREE.CanvasTexture(maskCanvas);
        alphaMask.wrapS = THREE.ClampToEdgeWrapping;
        alphaMask.wrapT = THREE.ClampToEdgeWrapping;

        // 3D PBR Material with full Shadow Map integration & Circular Alpha Mask
        const terrainMat = new THREE.MeshStandardMaterial({
          map: albedoTex,
          alphaMap: alphaMask,
          transparent: true,
          color: new THREE.Color(0xffffff),
          roughness: 0.82,
          metalness: 0.04,
          flatShading: false
        });

        const terrainMesh = new THREE.Mesh(geo, terrainMat);
        terrainMesh.castShadow = true;
        terrainMesh.receiveShadow = true;
        terrainMeshRef.current = terrainMesh;
        scene.add(terrainMesh);

        // Update markers positions to snap directly on top of the displaced 3D terrain
        updateMarkerPositions();
      })
      .catch(err => {
        console.error('Failed to load south_pole_heights.bin:', err);
      });

    // 8. 3D Interactive Landing Site Markers
    const markersGroup = new THREE.Group();
    scene.add(markersGroup);

    const createdMarkers = [];
    sites.forEach(site => {
      const coords = SITE_TERRAIN_COORDS[site.id] || { x: 0, z: 0, elevBase: 0.3 };
      const siteRankInfo = downselection?.rankedSites?.find(r => r.siteId === site.id);
      const isRank1 = siteRankInfo ? (siteRankInfo.rank === 1 && siteRankInfo.isMissionSuccess) : (site.id === 'malapert');
      const isDisq = siteRankInfo ? (siteRankInfo.rankStatus === 'DISQUALIFIED') : (site.id === 'haworth' || site.id === 'de_gerlache' || site.id === 'shackleton');
      const pinColor = isRank1 ? 0x0d9488 : isDisq ? 0xbe123c : 0x0a192f;
      const beadColor = isRank1 ? 0x0d9488 : isDisq ? 0xbe123c : 0x334e68;

      // Base Technical Reticle (Sharp 4-point square bracket, NO round circle)
      const ringGeo = new THREE.RingGeometry(0.18, 0.26, 4);
      ringGeo.rotateX(-Math.PI / 2);
      ringGeo.rotateY(Math.PI / 4); // Aligns as a crisp square ground bracket
      const ringMat = new THREE.MeshBasicMaterial({
        color: pinColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.95
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      markersGroup.add(ringMesh);

      // Slender Technical Stanchion Pin
      const pinGeo = new THREE.CylinderGeometry(0.015, 0.015, 1.2, 4);
      const pinMat = new THREE.MeshBasicMaterial({ color: pinColor });
      const pinMesh = new THREE.Mesh(pinGeo, pinMat);
      markersGroup.add(pinMesh);

      // Sharp Technical Micro Reticle Box (Square, NO round sphere ball)
      const beadGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
      const beadMat = new THREE.MeshBasicMaterial({ color: beadColor });
      const beadMesh = new THREE.Mesh(beadGeo, beadMat);
      markersGroup.add(beadMesh);

      createdMarkers.push({
        siteId: site.id,
        site,
        coords,
        ringMesh,
        pinMesh,
        beadMesh
      });
    });
    markersRef.current = createdMarkers;

    function updateMarkerPositions() {
      markersRef.current.forEach(m => {
        const yElev = getTerrainHeight(m.coords.x, m.coords.z);
        m.ringMesh.position.set(m.coords.x, yElev + 0.04, m.coords.z);
        m.pinMesh.position.set(m.coords.x, yElev + 0.65, m.coords.z);
        m.beadMesh.position.set(m.coords.x, yElev + 1.25, m.coords.z);
      });
    }

    // 9. Interactive Pin Selection Click Handler
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    const onPointerDown = (event) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const pickables = [];
      markersRef.current.forEach(m => {
        pickables.push(m.beadMesh, m.pinMesh, m.ringMesh);
      });

      const intersects = raycaster.intersectObjects(pickables, false);
      if (intersects.length > 0) {
        const hit = intersects[0].object;
        const matched = markersRef.current.find(m => 
          m.beadMesh === hit || m.pinMesh === hit || m.ringMesh === hit
        );
        if (matched) {
          onSelectSite?.(matched.siteId);
        }
      }
    };
    canvas.addEventListener('pointerdown', onPointerDown);

    // 10. Render Loop & Orbit Auto-Spin
    let animationFrameId;
    let lastTime = performance.now();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = (now - lastTime) / 1000;
      lastTime = now;

      // Auto-rotate around current target
      if (autoRotateRef.current) {
        const speed = 0.25;
        const x = camera.position.x - controls.target.x;
        const z = camera.position.z - controls.target.z;
        const cos = Math.cos(delta * speed);
        const sin = Math.sin(delta * speed);
        camera.position.x = controls.target.x + (x * cos - z * sin);
        camera.position.z = controls.target.z + (x * sin + z * cos);
      }

      controls.update();

      // Project 3D site markers into 2D Screen space with strict frustum and view-space culling
      const halfW = container.clientWidth / 2;
      const halfH = container.clientHeight / 2;
      const tempVec = new THREE.Vector3();
      const viewPos = new THREE.Vector3();

      markersRef.current.forEach(m => {
        const badgeEl = badgeDomRefs.current[m.siteId];
        if (!badgeEl) return;

        // Physical world position of the tip bead
        m.beadMesh.getWorldPosition(tempVec);
        tempVec.y += 0.28; // small clearance above bead sphere

        // 1. Camera View-Space Test: Marker MUST be strictly in front of the camera near plane
        viewPos.copy(tempVec).applyMatrix4(camera.matrixWorldInverse);
        if (viewPos.z >= -0.5) {
          badgeEl.style.display = 'none';
          return;
        }

        // 2. Project 3D coordinate to Normalized Device Coordinates (NDC) [-1..+1]
        tempVec.project(camera);

        // 3. Frustum Culling: Hide if outside viewport boundaries or behind camera
        if (tempVec.x < -0.94 || tempVec.x > 0.94 || tempVec.y < -0.94 || tempVec.y > 0.94 || tempVec.z > 1.0) {
          badgeEl.style.display = 'none';
          return;
        }

        // 4. Distance Culling: When zoomed in tightly on a site, hide sites on the far side of the moon
        const camDist = camera.position.distanceTo(m.beadMesh.position);
        if (camDist > 140.0) {
          badgeEl.style.display = 'none';
          return;
        }

        // 5. Convert NDC to Screen Container Pixels
        const sx = (tempVec.x * halfW) + halfW;
        const sy = -(tempVec.y * halfH) + halfH;

        badgeEl.style.display = 'block';
        badgeEl.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -100%)`;
      });

      // Altitude telemetry
      const dist = camera.position.distanceTo(controls.target);
      const approxAltKm = Math.round(dist * 38.0);
      setAltitudeKm(approxAltKm);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);
      canvas.removeEventListener('pointerdown', onPointerDown);
      cancelAnimationFrame(animationFrameId);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  // Update Dynamic Ephemeris Sunlight Position & Shadows
  useEffect(() => {
    const sunLight = sunLightRef.current;
    if (!sunLight) return;

    const psiRad = THREE.MathUtils.degToRad(sunAzimuthDeg);
    // Effective visual solar elevation: scales with vertical relief so mountain shadows
    // illuminate the lunar plateaus in brilliant silvery sunlight, while keeping deep pitch-black shadows inside craters!
    const effectiveElevDeg = Math.max(sunElevationDeg * 1.8 + 8.5, 6.0);
    const thetaRad = THREE.MathUtils.degToRad(effectiveElevDeg);

    const dist = 75.0;
    const cosElev = Math.cos(thetaRad);
    const sinElev = Math.sin(thetaRad);

    const sunX = dist * cosElev * Math.sin(psiRad);
    const sunY = dist * sinElev;
    const sunZ = -dist * cosElev * Math.cos(psiRad);

    sunLight.position.set(sunX, sunY, sunZ);
    sunLight.target.position.set(0, 0, -4.0);
    sunLight.target.updateMatrixWorld();
  }, [sunAzimuthDeg, sunElevationDeg]);

  // Update Vertical Exaggeration (1.0x, 2.5x, 4.0x) on the 3D Elevation Mesh
  useEffect(() => {
    const geo = terrainGeoRef.current;
    const heights = rawHeightsRef.current;
    if (!geo || !heights) return;

    const pos = geo.attributes.position;
    const baseRelief = 2.4;

    for (let i = 0; i < pos.count; i++) {
      const rawVal = heights[i] / 255.0;
      const yElev = (rawVal - MEAN_DATUM_HEIGHT) * baseRelief * reliefExaggeration;
      pos.setY(i, yElev);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // Re-align marker pins with new surface height
    markersRef.current.forEach(m => {
      const yElev = getTerrainHeight(m.coords.x, m.coords.z, reliefExaggeration);
      m.ringMesh.position.set(m.coords.x, yElev + 0.05, m.coords.z);
      m.pinMesh.position.set(m.coords.x, yElev + 0.75, m.coords.z);
      m.beadMesh.position.set(m.coords.x, yElev + 1.45, m.coords.z);
    });
  }, [reliefExaggeration, getTerrainHeight]);

  // Switch Texture Layer Mode (Photorealistic 8K Albedo vs LOLA Topography)
  useEffect(() => {
    const mesh = terrainMeshRef.current;
    if (!mesh || !texturesRef.current) return;

    if (layerMode === 'albedo' && texturesRef.current.albedo) {
      mesh.material.map = texturesRef.current.albedo;
      mesh.material.needsUpdate = true;
    } else if (layerMode === 'lola' && texturesRef.current.lola) {
      mesh.material.map = texturesRef.current.lola;
      mesh.material.needsUpdate = true;
    }
  }, [layerMode]);

  // Dynamically update Three.js scene background color on theme switch
  useEffect(() => {
    if (sceneRef.current && theme?.canvasThreeHex !== undefined) {
      sceneRef.current.background = new THREE.Color(theme.canvasThreeHex);
    }
  }, [theme?.canvasThreeHex]);

  // Highlight selected site marker
  useEffect(() => {
    markersRef.current.forEach(m => {
      const isSelected = m.siteId === selectedSiteId;
      const isRank1 = m.siteId === 'malapert' || m.siteId === 'nobile';
      const isDisq = m.siteId === 'haworth' || m.siteId === 'de_gerlache' || m.siteId === 'shackleton';
      
      const pinHex = isSelected ? 0x0284c7 : isRank1 ? 0x0d9488 : isDisq ? 0xbe123c : 0x0a192f;
      const beadHex = isSelected ? 0x0284c7 : isRank1 ? 0x0d9488 : isDisq ? 0xbe123c : 0x334e68;
      
      if (m.ringMesh?.material) m.ringMesh.material.color.setHex(pinHex);
      if (m.pinMesh?.material) m.pinMesh.material.color.setHex(pinHex);
      if (m.beadMesh?.material) m.beadMesh.material.color.setHex(beadHex);
      m.ringMesh.scale.setScalar(isSelected ? 1.6 : 1.0);
      m.beadMesh.scale.setScalar(isSelected ? 1.5 : 1.0);
    });
  }, [selectedSiteId]);

  // Cinematic Camera Flights
  const flyToCameraState = useCallback((stateKey, customSiteId = null) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    setActiveCameraMode(stateKey);
    autoRotateRef.current = false;

    const siteId = customSiteId || selectedSiteId;
    const coords = SITE_TERRAIN_COORDS[siteId] || SITE_TERRAIN_COORDS.malapert;
    const yElev = getTerrainHeight(coords.x, coords.z, reliefExaggeration);

    if (stateKey === 'microscopic') {
      // Oblique Grazing Hero Cockpit Perspective (~16° grazing angle looking across summit and crater towards space)
      const targetLook = new THREE.Vector3(coords.x, yElev + 0.2, coords.z);
      const targetCam = new THREE.Vector3(coords.x, yElev + 1.35, coords.z + 4.6);

      gsap.to(controls.target, {
        x: targetLook.x,
        y: targetLook.y,
        z: targetLook.z,
        duration: 2.2,
        ease: 'power2.inOut'
      });

      gsap.to(camera.position, {
        x: targetCam.x,
        y: targetCam.y,
        z: targetCam.z,
        duration: 2.4,
        ease: 'power2.inOut'
      });

    } else if (stateKey === 'site' || customSiteId) {
      // Tactical Reconnaissance (~120 km)
      const targetLook = new THREE.Vector3(coords.x, yElev, coords.z);
      const targetCam = new THREE.Vector3(coords.x, yElev + 7.5, coords.z + 8.5);

      gsap.to(controls.target, {
        x: targetLook.x,
        y: targetLook.y,
        z: targetLook.z,
        duration: 2.0,
        ease: 'power2.inOut'
      });

      gsap.to(camera.position, {
        x: targetCam.x,
        y: targetCam.y,
        z: targetCam.z,
        duration: 2.2,
        ease: 'power2.inOut'
      });

    } else if (stateKey === 'southpole') {
      // South Pole Overview Framing
      gsap.to(controls.target, {
        x: 0,
        y: 0,
        z: -5.0,
        duration: 2.0,
        ease: 'power2.inOut'
      });

      gsap.to(camera.position, {
        x: 0,
        y: 22.0,
        z: 28.0,
        duration: 2.2,
        ease: 'power2.inOut'
      });

    } else if (stateKey === 'global') {
      // High Global Orbit
      gsap.to(controls.target, {
        x: 0,
        y: 0,
        z: 0,
        duration: 2.2,
        ease: 'power2.inOut'
      });

      gsap.to(camera.position, {
        x: 0,
        y: 55.0,
        z: 65.0,
        duration: 2.4,
        ease: 'power2.inOut'
      });
    }
  }, [selectedSiteId, getTerrainHeight, reliefExaggeration]);

  // Smooth Zoom Controller
  const handleZoom = useCallback((factor) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;

    const dir = new THREE.Vector3().subVectors(controls.target, camera.position);
    const dist = dir.length();
    const step = (factor < 1.0) ? dist * 0.35 : -dist * 0.45;
    dir.normalize().multiplyScalar(step);

    gsap.to(camera.position, {
      x: camera.position.x + dir.x,
      y: camera.position.y + dir.y,
      z: camera.position.z + dir.z,
      duration: 0.45,
      ease: 'power2.out'
    });
  }, []);

  // Expose Imperative API to App.jsx
  useImperativeHandle(ref, () => ({
    flyToCameraState,
    handleZoom,
    toggleAutoRotate: () => { 
      autoRotateRef.current = !autoRotateRef.current;
      onCameraUpdate?.({
        activeCameraMode,
        altitudeKm,
        autoRotate: autoRotateRef.current,
        is8kActive: true
      });
    },
    setAutoRotate: (val) => { 
      autoRotateRef.current = val;
      onCameraUpdate?.({
        activeCameraMode,
        altitudeKm,
        autoRotate: autoRotateRef.current,
        is8kActive: true
      });
    },
    setExaggeration: setReliefExaggeration,
    setLayerMode,
    getCameraMode: () => activeCameraMode
  }), [flyToCameraState, handleZoom, activeCameraMode, altitudeKm, onCameraUpdate]);

  // Synchronize Telemetry with Parent
  useEffect(() => {
    onCameraUpdate?.({
      activeCameraMode,
      altitudeKm,
      autoRotate: autoRotateRef.current,
      is8kActive: true
    });
  }, [activeCameraMode, altitudeKm, onCameraUpdate]);

  return (
    <div 
      className="relative w-full h-full overflow-hidden select-none bg-[#121212]"
    >
      {/* Three.js Canvas Container */}
      <div ref={containerRef} className="w-full h-full block cursor-grab active:cursor-grabbing">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* 3D Landing Site Callout Badges (Locked to 3D pins with zero lag & downward pointer stem) */}
      <div className="absolute inset-0 pointer-events-none z-10 overflow-hidden">
        {sites.map(site => {
          const coords = SITE_TERRAIN_COORDS[site.id];
          const isSelected = site.id === selectedSiteId;
          const siteRankInfo = downselection?.rankedSites?.find(r => r.siteId === site.id);
          const siteRank = siteRankInfo?.rank;
          const isRank1 = siteRank === 1 && siteRankInfo?.isMissionSuccess;
          const isDisq = siteRankInfo?.rankStatus === 'DISQUALIFIED' || site.id === 'haworth' || site.id === 'de_gerlache' || site.id === 'shackleton';
          const shortName = coords?.shortName || site.name.split(' ')[0];

          return (
            <div
              key={site.id}
              ref={el => { badgeDomRefs.current[site.id] = el; }}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                willChange: 'transform',
                display: 'none'
              }}
              className={`pointer-events-auto cursor-pointer select-none transition-all duration-150 ${
                isSelected ? 'z-40' : 'z-20 group'
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectSite?.(site.id);
              }}
            >
              {isSelected ? (
                /* AUTHENTIC NASA TACTICAL TARGET RETICLE (Matte Dark, Sharp, Zero Slop) */
                <div className="relative font-mono text-xs select-none flex flex-col items-center">
                  <div 
                    className="flex items-center gap-1.5 px-2 py-0.5 bg-[#1C1C1C] text-white shadow-lg rounded-none"
                  >
                    <span className="font-mono font-bold text-[10px] tracking-wider uppercase text-[#CCCCCC]">
                      [0{siteRank || 1}]
                    </span>
                    <span className="text-[#555555]">|</span>
                    <span className="font-sans font-semibold text-xs tracking-tight text-white">
                      {shortName.toUpperCase()}
                    </span>
                  </div>

                  {/* Precision Vertical Stanchion */}
                  <div className="w-[1px] h-3 bg-[#777777]" />
                  {/* Ground Contact Sharp Reticle */}
                  <div className="w-1 h-1 bg-white -mt-0.5" />
                </div>
              ) : (
                /* MINIMAL TACTICAL INDEX BADGE */
                <div className="relative font-mono text-[10px] select-none flex flex-col items-center group">
                  <div 
                    className={`flex items-center gap-1 px-1.5 py-0.5 bg-[#1A1A1A]/95 shadow-md rounded-none transition-colors ${
                      isDisq 
                        ? 'text-[#C45555]' 
                        : isRank1 
                        ? 'text-[#68B684]' 
                        : 'text-[#888888]'
                    } group-hover:bg-[#252525] group-hover:text-white`}
                  >
                    <span className="font-semibold">0{siteRank || '0'}</span>
                    <span className="font-sans text-[10px] font-medium hidden group-hover:inline ml-0.5">
                      {shortName}
                    </span>
                  </div>

                  {/* Hairline contact guide */}
                  <div className="w-[1px] h-2 bg-[#444444]" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default LunarMasterpiece3D;
