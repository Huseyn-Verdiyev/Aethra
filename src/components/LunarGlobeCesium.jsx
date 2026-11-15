import React, { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from 'react';
import * as Cesium from 'cesium';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { Loader2 } from 'lucide-react';

Cesium.Ion.defaultAccessToken = '';
Cesium.Ellipsoid.default = Cesium.Ellipsoid.MOON;

/**
 * Calculates camera destination and orientation vectors using a local
 * East-North-Up (ENU) tangent frame at the landing site.
 * This guarantees rock-solid stability even at polar latitudes (-89.9°),
 * eliminating gimbal locks, pole crossing artifacts, or flat top-down views.
 */
function getSiteCameraPose(site, mode) {
  const targetCartesian = Cesium.Cartesian3.fromDegrees(
    site.lon, 
    site.lat, 
    site.elevationMeters ? site.elevationMeters : 0, 
    Cesium.Ellipsoid.MOON
  );
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(targetCartesian, Cesium.Ellipsoid.MOON);

  if (mode === 'microscopic') {
    // Oblique Grazing Hero Cockpit Perspective:
    // Standoff range: 26,000 meters (26 km)
    // Elevation above local horizon: 18 degrees
    // View direction: looking toward peak & lunar horizon
    const range = 26000.0;
    const elevRad = Cesium.Math.toRadians(18.0);
    const zLocal = range * Math.sin(elevRad); // ~8.0 km altitude
    const horizDist = range * Math.cos(elevRad); // ~24.7 km standoff

    // Offset camera to local South so it looks Northward towards the massif and space
    const localOffset = new Cesium.Cartesian3(0.0, -horizDist, zLocal);
    const cameraPosition = Cesium.Matrix4.multiplyByPoint(enu, localOffset, new Cesium.Cartesian3());

    const direction = Cesium.Cartesian3.subtract(targetCartesian, cameraPosition, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(direction, direction);
    const up = Cesium.Ellipsoid.MOON.geodeticSurfaceNormal(targetCartesian, new Cesium.Cartesian3());

    return { destination: cameraPosition, direction, up };
  } else {
    // mode === 'site' (Tactical Reconnaissance):
    // Standoff range: 180,000 meters (180 km)
    // Elevation above horizon: 42 degrees
    const range = 180000.0;
    const elevRad = Cesium.Math.toRadians(42.0);
    const zLocal = range * Math.sin(elevRad); // ~120 km altitude
    const horizDist = range * Math.cos(elevRad);

    const localOffset = new Cesium.Cartesian3(0.0, -horizDist, zLocal);
    const cameraPosition = Cesium.Matrix4.multiplyByPoint(enu, localOffset, new Cesium.Cartesian3());

    const direction = Cesium.Cartesian3.subtract(targetCartesian, cameraPosition, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(direction, direction);
    const up = Cesium.Ellipsoid.MOON.geodeticSurfaceNormal(targetCartesian, new Cesium.Cartesian3());

    return { destination: cameraPosition, direction, up };
  }
}

const LunarGlobeCesium = forwardRef(function LunarGlobeCesium({
  sites = [],
  selectedSiteId,
  onSelectSite,
  downselection,
  sunAzimuthDeg = 114.5,
  sunElevationDeg = 1.5,
  isSunBlocked = false,
  isSidebarOpen = true,
  onCameraUpdate
}, ref) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const entitiesMapRef = useRef(new Map());

  const [activeCameraMode, setActiveCameraMode] = useState('southpole');
  const [altitudeKm, setAltitudeKm] = useState(1500);
  const [isTileStreaming, setIsTileStreaming] = useState(false);
  const [queuedTiles, setQueuedTiles] = useState(0);
  const autoRotateRef = useRef(false);

  // Initialize Cesium Viewer with NASA Moon Trek WMTS Tile Streaming
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Clear any previous canvas nodes
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // 1. Real NASA Moon Trek Tile Provider (Levels 0 through 8 Quadtree pyramid)
    const nasaMoonImagery = new Cesium.UrlTemplateImageryProvider({
      url: 'https://trek.nasa.gov/tiles/Moon/EQ/LRO_WAC_Mosaic_Global_303ppd_v02/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
      tilingScheme: new Cesium.GeographicTilingScheme({
        ellipsoid: Cesium.Ellipsoid.MOON,
        numberOfLevelZeroTilesX: 2,
        numberOfLevelZeroTilesY: 1
      }),
      maximumLevel: 8,
      credit: new Cesium.Credit('NASA / GSFC / ASU (LROC)')
    });

    const moonLayer = new Cesium.ImageryLayer(nasaMoonImagery, {
      brightness: 1.30,
      contrast: 1.15,
      gamma: 1.1
    });

    // 2. High-Performance Cesium Viewer configured for the Moon
    const viewer = new Cesium.Viewer(container, {
      sceneMode: Cesium.SceneMode.SCENE3D,
      globe: new Cesium.Globe(Cesium.Ellipsoid.MOON),
      baseLayer: moonLayer,
      skyBox: new Cesium.SkyBox({
        sources: {
          positiveX: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_px.jpg',
          negativeX: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mx.jpg',
          positiveY: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_py.jpg',
          negativeY: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_my.jpg',
          positiveZ: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_pz.jpg',
          negativeZ: 'https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Assets/Textures/SkyBox/tycho2t3_80_mz.jpg'
        }
      }),
      skyAtmosphere: false,
      baseLayerPicker: false,
      timeline: false,
      animation: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      selectionIndicator: false,
      navigationHelpButton: false,
      scene3DOnly: true,
      fullscreenButton: false
    });

    viewerRef.current = viewer;

    const globe = viewer.scene.globe;
    globe.enableLighting = false;
    globe.showGroundAtmosphere = false;
    globe.baseColor = Cesium.Color.fromCssColorString('#02040a');
    viewer.scene.highDynamicRange = true;
    globe.maximumScreenSpaceError = 1.15;
    globe.tileCacheSize = 3500;

    // 3. Tile Load Progress Tracking (Real progressive tile pyramid stream)
    const removeProgressListener = globe.tileLoadProgressEvent.addEventListener((queueLength) => {
      setQueuedTiles(queueLength);
      setIsTileStreaming(queueLength > 0);
    });

    // 4. Initial Majestic South Pole Overview Framing
    viewer.camera.setView({
      destination: Cesium.Cartesian3.fromDegrees(0.0, -84.0, 1600000.0, Cesium.Ellipsoid.MOON),
      orientation: {
        heading: Cesium.Math.toRadians(0.0),
        pitch: Cesium.Math.toRadians(-65.0),
        roll: 0.0
      }
    });

    // 5. Camera Altitude Telemetry Listener
    const onCameraMove = () => {
      const carto = Cesium.Cartographic.fromCartesian(viewer.camera.position, Cesium.Ellipsoid.MOON);
      if (carto) {
        setAltitudeKm(Math.round(carto.height / 1000.0));
      }
    };
    viewer.camera.changed.addEventListener(onCameraMove);

    // 6. Interactive Site Markers
    entitiesMapRef.current.clear();
    sites.forEach(site => {
      const isRank1 = site.id === 'malapert';
      const isDisq = site.id === 'haworth' || site.id === 'de_gerlache';
      const pinColor = isRank1 ? '#10b981' : isDisq ? '#f43f5e' : '#38bdf8';

      const entity = viewer.entities.add({
        id: site.id,
        name: site.name,
        position: Cesium.Cartesian3.fromDegrees(site.lon, site.lat, 100.0, Cesium.Ellipsoid.MOON),
        point: {
          pixelSize: site.id === selectedSiteId ? 12 : 8,
          color: Cesium.Color.fromCssColorString(pinColor),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: site.id === selectedSiteId ? 3 : 2,
          scaleByDistance: new Cesium.NearFarScalar(1.0e3, 1.8, 1.0e7, 0.4)
        },
        label: {
          text: `${site.name.split(' ')[0]} #${downselection?.rankedSites?.find(r => r.siteId === site.id)?.rank || ''}`,
          font: '10px JetBrains Mono, monospace',
          fillColor: Cesium.Color.WHITE,
          outlineColor: Cesium.Color.fromCssColorString('#020617'),
          outlineWidth: 3,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1800000)
        }
      });
      entitiesMapRef.current.set(site.id, entity);
    });

    // Click handler for 3D Pin Selection
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handler.setInputAction((click) => {
      const picked = viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id && typeof picked.id.id === 'string') {
        const siteId = picked.id.id;
        onSelectSite?.(siteId);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // 7. Auto-Rotation Loop (Rotates camera around lunar center)
    let lastTime = performance.now();
    const rotateListener = viewer.clock.onTick.addEventListener(() => {
      if (autoRotateRef.current) {
        const now = performance.now();
        const delta = (now - lastTime) / 1000;
        lastTime = now;
        viewer.camera.rotateRight(delta * 0.04);
      } else {
        lastTime = performance.now();
      }
    });

    return () => {
      rotateListener();
      removeProgressListener();
      handler.destroy();
      viewer.camera.changed.removeEventListener(onCameraMove);
      viewer.destroy();
    };
  }, [sites]);

  // Highlight active pin when selectedSiteId changes
  useEffect(() => {
    entitiesMapRef.current.forEach((entity, id) => {
      const isSelected = id === selectedSiteId;
      if (entity.point) {
        entity.point.pixelSize = isSelected ? 12 : 8;
        entity.point.outlineWidth = isSelected ? 3 : 2;
      }
    });
  }, [selectedSiteId]);

  // Dynamic Camera Flight Controller
  const flyToCameraState = useCallback((stateKey, customSiteId = null) => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    setActiveCameraMode(stateKey);
    autoRotateRef.current = false;

    if (stateKey === 'global') {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0.0, 10.0, 6800000.0, Cesium.Ellipsoid.MOON),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-90.0),
          roll: 0.0
        },
        duration: 2.0
      });

    } else if (stateKey === 'southpole') {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0.0, -84.0, 1500000.0, Cesium.Ellipsoid.MOON),
        orientation: {
          heading: Cesium.Math.toRadians(0.0),
          pitch: Cesium.Math.toRadians(-65.0),
          roll: 0.0
        },
        duration: 2.2
      });

    } else if (stateKey === 'microscopic') {
      const siteId = customSiteId || selectedSiteId;
      const site = sites.find(s => s.id === siteId) || sites[0];
      const pose = getSiteCameraPose(site, 'microscopic');
      viewer.camera.flyTo({
        destination: pose.destination,
        orientation: {
          direction: pose.direction,
          up: pose.up
        },
        duration: 2.4,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
      });

    } else if (stateKey === 'site' || customSiteId) {
      const siteId = customSiteId || selectedSiteId;
      const site = sites.find(s => s.id === siteId) || sites[0];
      const pose = getSiteCameraPose(site, 'site');
      viewer.camera.flyTo({
        destination: pose.destination,
        orientation: {
          direction: pose.direction,
          up: pose.up
        },
        duration: 2.2,
        easingFunction: Cesium.EasingFunction.QUADRATIC_IN_OUT
      });
    }
  }, [selectedSiteId, sites]);

  // Smooth Zoom Controller
  const handleZoom = useCallback((factor) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const height = viewer.camera.positionCartographic.height;
    if (factor < 1.0) {
      viewer.camera.zoomIn(height * 0.35);
    } else {
      viewer.camera.zoomOut(height * 0.45);
    }
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
        is8kActive: !isTileStreaming
      });
    },
    setAutoRotate: (val) => { 
      autoRotateRef.current = val; 
      onCameraUpdate?.({
        activeCameraMode,
        altitudeKm,
        autoRotate: autoRotateRef.current,
        is8kActive: !isTileStreaming
      });
    },
    getCameraMode: () => activeCameraMode
  }), [flyToCameraState, handleZoom, activeCameraMode, altitudeKm, isTileStreaming, onCameraUpdate]);

  // Synchronize Telemetry with Parent (App.jsx)
  useEffect(() => {
    onCameraUpdate?.({
      activeCameraMode,
      altitudeKm,
      autoRotate: autoRotateRef.current,
      is8kActive: !isTileStreaming
    });
  }, [activeCameraMode, altitudeKm, isTileStreaming, onCameraUpdate]);

  return (
    <div className="relative w-full h-full bg-[#010204] overflow-hidden select-none">
      {/* Cesium WebGL Canvas Container */}
      <div ref={containerRef} className="w-full h-full block cursor-grab active:cursor-grabbing" />

      {/* Real NASA Moon Trek Tile Streaming HUD Indicator */}
      <div className="absolute top-4 right-4 z-20 pointer-events-none select-none">
        {isTileStreaming ? (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-950/85 border border-sky-500/40 backdrop-blur-xl text-[10px] font-mono text-sky-300 shadow-2xl">
            <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
            <span>STREAMING NASA LROC TILES [{queuedTiles} IN FLIGHT]</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-950/85 border border-emerald-500/40 backdrop-blur-xl text-[10px] font-mono text-emerald-300 shadow-2xl">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>NASA MOON TREK // LROC PEAK RESOLUTION</span>
          </div>
        )}
      </div>
    </div>
  );
});

export default LunarGlobeCesium;
