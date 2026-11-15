import React, { useState, useMemo, useRef, useEffect } from 'react';
import { 
  SITES_DATA, 
  generateRealEphemerisWindow,
  computeEpochTelemetry,
  aggregateMissionDays,
  evaluateMissionViability,
  evaluateAllSitesDownselection,
  getTerrainObstacleInfo
} from './data';
import LunarMasterpiece3D from './components/LunarMasterpiece3D';
import LandingPage from './components/LandingPage';
import { THEMES } from './themeConfig';
import { 
  Sun, 
  Radio, 
  Thermometer, 
  Calendar,
  Layers, 
  FileText, 
  ChevronRight, 
  ChevronLeft, 
  X, 
  Navigation, 
  Play, 
  Pause, 
  BookOpen, 
  Crosshair,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Orbit,
  ArrowUpRight,
  Eye
} from 'lucide-react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  ReferenceLine 
} from 'recharts';

export default function App() {
  const currentTheme = THEMES.geolibre;
  const [showPlanner, setShowPlanner] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'geolibre');
  }, []);

  const [selectedSiteId, setSelectedSiteId] = useState('malapert');
  const [activeChartTab, setActiveChartTab] = useState('angles'); // 'angles' | 'power' | 'battery' | 'comms'
  const [selectedEpochIndex, setSelectedEpochIndex] = useState(0);
  const [manualEpochValue, setManualEpochValue] = useState('');
  const [epochDateStr, setEpochDateStr] = useState('2026-11-15');
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState(true);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(true);
  const [layerMode, setLayerMode] = useState('albedo'); // 'albedo' | 'lola'
  const [reliefExaggeration, setReliefExaggeration] = useState(2.5); // 1.0, 2.5, 4.0
  
  // Modals
  const [showMatrixModal, setShowMatrixModal] = useState(false);
  const [showProofModal, setShowProofModal] = useState(false);
  const [showStoryModal, setShowStoryModal] = useState(false);
  const [storyStep, setStoryStep] = useState(1);

  const globeRef = useRef(null);
  const [cameraTelemetry, setCameraTelemetry] = useState({
    activeCameraMode: 'southpole',
    altitudeKm: 1240,
    autoRotate: false,
    is8kActive: false
  });

  const selectedSite = SITES_DATA.find(s => s.id === selectedSiteId) || SITES_DATA[0];
  const startEpoch = useMemo(() => new Date(`${epochDateStr}T00:00:00Z`), [epochDateStr]);

  // Automated Multi-Attribute Decision Analysis (NASA SP-2016-6105 MADA)
  const downselection = useMemo(() => {
    return evaluateAllSitesDownselection(startEpoch, 0.5);
  }, [startEpoch]);
  const primary = downselection.primarySite;
  const primarySite = SITES_DATA.find(site => site.id === primary?.siteId) || SITES_DATA[0];

  // High-fidelity 30-min ephemeris (672 discrete samples across 14 days)
  const ephemerisSamples = useMemo(() => {
    return generateRealEphemerisWindow(selectedSiteId, startEpoch, 0.5);
  }, [selectedSiteId, startEpoch]);

  // 14-day aggregated summaries
  const daySummaries = useMemo(() => {
    return aggregateMissionDays(ephemerisSamples);
  }, [ephemerisSamples]);

  // Executive Viability
  const missionViability = useMemo(() => {
    return evaluateMissionViability(ephemerisSamples, daySummaries);
  }, [ephemerisSamples, daySummaries]);

  // Active Telemetry Slice
  const safeIndex = Math.min(selectedEpochIndex, ephemerisSamples.length - 1);
  const gridTelemetry = ephemerisSamples[safeIndex] || ephemerisSamples[0];
  const manualEpoch = useMemo(() => {
    if (!manualEpochValue) return null;
    const parsed = new Date(`${manualEpochValue}:00Z`);
    const offsetHours = (parsed.getTime() - startEpoch.getTime()) / 3600000;
    return Number.isFinite(parsed.getTime()) && offsetHours >= 0 && offsetHours < 14 * 24
      ? { date: parsed, offsetHours }
      : null;
  }, [manualEpochValue, startEpoch]);
  const activeTelemetry = useMemo(() => {
    if (!manualEpoch) return gridTelemetry;
    const instant = computeEpochTelemetry(selectedSiteId, manualEpoch.date);
    return {
      ...gridTelemetry,
      ...instant,
      // Battery and EPS are stateful; keep their last simulated 30-minute values.
      batterySocWh: gridTelemetry.batterySocWh,
      batterySocPercent: gridTelemetry.batterySocPercent,
      powerMode: gridTelemetry.powerMode,
      epsState: gridTelemetry.epsState,
      isTerminated: gridTelemetry.isTerminated,
      terminationReason: gridTelemetry.terminationReason,
      terminationDay: gridTelemetry.terminationDay,
      terminationHour: gridTelemetry.terminationHour,
      regolithTempK: gridTelemetry.regolithTempK,
      regolithTempC: gridTelemetry.regolithTempC,
      label: manualEpoch.date.toISOString().slice(0, 16).replace('T', ' ')
    };
  }, [gridTelemetry, manualEpoch, selectedSiteId]);
  const exactTimeInputValue = manualEpochValue || (gridTelemetry?.epochUTC
    ? gridTelemetry.epochUTC.slice(0, 16)
    : '');
  const timelineEnd = new Date(startEpoch.getTime() + 14 * 24 * 3600000 - 60000);
  const formatInputUtc = (date) => date.toISOString().slice(0, 16);

  // Crater rim / ridge obstacle clearance
  const obstacleInfo = useMemo(() => {
    return getTerrainObstacleInfo(
      selectedSiteId,
      Number(activeTelemetry.sunAzimuth),
      Number(activeTelemetry.sunElevation)
    );
  }, [selectedSiteId, activeTelemetry.sunAzimuth, activeTelemetry.sunElevation]);

  // Auto-Play Scrubber
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setSelectedEpochIndex(prev => {
        if (prev >= ephemerisSamples.length - 1) return 0;
        return prev + 1;
      });
    }, 180);
    return () => clearInterval(interval);
  }, [isPlaying, ephemerisSamples.length]);

  const selectedSiteRankInfo = downselection.rankedSites.find(r => r.siteId === selectedSiteId);
  const isSelectedRank1 = selectedSiteRankInfo?.rank === 1 && selectedSiteRankInfo?.isMissionSuccess;
  const isSelectedDisqualified = selectedSiteRankInfo?.rankStatus === 'DISQUALIFIED';

  if (!showPlanner) {
    return (
      <LandingPage
        downselection={downselection}
        theme={currentTheme}
        selectedSiteId={selectedSiteId}
        onSelectSite={setSelectedSiteId}
        onEnterPlanner={(siteId) => {
          if (siteId) setSelectedSiteId(siteId);
          setShowPlanner(true);
        }}
      />
    );
  }

  return (
    <div className="w-screen h-screen flex flex-col bg-[#121212] text-[#E0E0E0] font-sans select-none overflow-hidden antialiased">
      
      {/* 1. TOP MENU & APPLICATION TOOLBAR (Clean, Flat, Zero Neon) */}
      <header className="h-9 bg-[#161616] border-b border-[#242424] px-3 flex items-center justify-between text-xs select-none shrink-0 z-30">
        
        {/* Left: Workbench Brand & Coordinate System */}
        <div className="flex items-center gap-3 shrink-0 whitespace-nowrap">
          <div className="flex items-baseline gap-2">
            <span className="font-semibold text-xs tracking-wider text-white uppercase">
              AETHRA
            </span>
            <span className="text-[10px] font-mono text-[#888888] tracking-wider uppercase">
              Lunar site planner
            </span>
          </div>
          <span className="text-[#333333] font-light">|</span>
          <span className="text-[10px] font-mono tracking-wider text-[#777777] uppercase hidden sm:inline">
            NASA Space Apps
          </span>
          <span className="text-[#333333] font-light hidden sm:inline">|</span>
          <span className="text-[10px] font-mono text-[#888888] hidden md:inline">
            South Pole
          </span>
        </div>

        {/* Center: Mission tools */}
        <div className="flex items-center gap-1.5 text-xs">
          <button onClick={() => setShowPlanner(false)} className="px-2.5 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-[#E0E0E0] transition-colors cursor-pointer text-[11px]">Overview</button>
          <button
            onClick={() => {
              setStoryStep(1);
              setShowStoryModal(true);
            }}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-[#E0E0E0] transition-colors cursor-pointer flex items-center gap-1.5 text-[11px]"
            title="Project overview"
          >
            <FileText className="w-3.5 h-3.5 text-[#999999]" />
            <span className="hidden sm:inline font-sans">Project overview</span>
          </button>

          <button
            onClick={() => setShowMatrixModal(true)}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-[#E0E0E0] transition-colors cursor-pointer flex items-center gap-1.5 text-[11px]"
            title="Site ranking and score weights"
          >
            <Layers className="w-3.5 h-3.5 text-[#999999]" />
            <span className="hidden md:inline font-sans">Site ranking</span>
          </button>

          <button
            onClick={() => setShowProofModal(true)}
            className="px-2.5 py-1 bg-[#222222] hover:bg-[#2A2A2A] text-[#E0E0E0] transition-colors cursor-pointer flex items-center gap-1.5 text-[11px]"
            title="Calculation notes"
          >
            <BookOpen className="w-3.5 h-3.5 text-[#999999]" />
            <span className="hidden lg:inline font-sans">Calculation notes</span>
          </button>
        </div>

        {/* Right: Solstice Window & Docked Panel Toggles */}
        <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
          {/* Flight Epoch Selector */}
          <div className="hidden lg:flex items-center gap-1 px-2 py-0.5 bg-[#222222] text-[10px] font-mono">
            <Calendar className="w-3 h-3 text-[#888888]" />
            <select
              value={epochDateStr}
              onChange={(e) => {
                setEpochDateStr(e.target.value);
                setManualEpochValue('');
                setSelectedEpochIndex(0);
              }}
              className="bg-transparent text-[#E0E0E0] outline-none cursor-pointer text-[10px] font-mono"
            >
              <option value="2026-11-15" className="bg-[#1A1A1A] text-white">Nov 15, 2026</option>
              <option value="2027-02-10" className="bg-[#1A1A1A] text-white">Feb 10, 2027</option>
              <option value="2027-06-21" className="bg-[#1A1A1A] text-white">Jun 21, 2027</option>
            </select>
          </div>

          {/* Left Panel Toggle */}
          <button
            onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
            className="p-1 transition-colors cursor-pointer bg-[#222222] hover:bg-[#2A2A2A] text-[#999999] hover:text-white"
            title={isLeftPanelOpen ? "Hide Layers & Sites Panel" : "Show Layers & Sites Panel"}
          >
            {isLeftPanelOpen ? <PanelLeftClose className="w-3.5 h-3.5" /> : <PanelLeftOpen className="w-3.5 h-3.5" />}
          </button>

          {/* Right Panel Toggle */}
          <button
            onClick={() => setIsRightPanelOpen(!isRightPanelOpen)}
            className="p-1 transition-colors cursor-pointer bg-[#222222] hover:bg-[#2A2A2A] text-[#999999] hover:text-white"
            title={isRightPanelOpen ? "Hide Telemetry Inspector" : "Show Telemetry Inspector"}
          >
            {isRightPanelOpen ? <PanelRightClose className="w-3.5 h-3.5" /> : <PanelRightOpen className="w-3.5 h-3.5" />}
          </button>
        </div>
      </header>

      {/* 2. MAIN 3-PANE WORKSPACE: LEFT DOCKED SIDEBAR | 3D VIEWPORT | RIGHT DOCKED SIDEBAR */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* LEFT DOCKED SIDEBAR: Flat, Calm, Zero Outline Frames */}
        {isLeftPanelOpen && (
          <aside className="w-72 sm:w-80 bg-[#1A1A1A] border-r border-[#242424] flex flex-col text-xs text-[#E0E0E0] select-none overflow-y-auto shrink-0 z-10">
            
            {/* Panel Title */}
            <div className="px-3 py-2 bg-[#161616] border-b border-[#242424] flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                Explore sites
              </span>
              <span className="font-mono text-[10px] text-[#666666]">
                5 SITES
              </span>
            </div>

            {/* Section A: Candidate Landing Targets */}
            <div className="p-3 border-b border-[#242424] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#777777] font-medium uppercase tracking-wider">
                <span>Landing sites</span>
                <span>SP-2016-6105</span>
              </div>

              <div className="flex flex-col gap-1">
                {downselection.rankedSites.map(rSite => {
                  const isSel = rSite.siteId === selectedSiteId;
                  const isR1 = rSite.rank === 1 && rSite.isMissionSuccess;
                  const isDisq = rSite.rankStatus === 'DISQUALIFIED';
                  const siteObj = SITES_DATA.find(s => s.id === rSite.siteId);

                  return (
                    <button
                      key={rSite.siteId}
                      onClick={() => {
                        setSelectedSiteId(rSite.siteId);
                        setSelectedEpochIndex(0);
                        globeRef.current?.flyToCameraState('site', rSite.siteId);
                      }}
                      className={`p-2 text-left transition-colors cursor-pointer flex flex-col gap-0.5 ${
                        isSel 
                          ? 'bg-[#2A2A2A] text-white' 
                          : 'bg-[#1E1E1E] hover:bg-[#242424] text-[#999999]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[10px] text-[#777777]">
                            0{rSite.rank}
                          </span>
                          <span className={`font-sans text-xs font-semibold ${isSel ? 'text-white' : 'text-[#D0D0D0]'}`}>
                            {rSite.name}
                          </span>
                        </div>
                        <span className={`font-mono text-[9px] uppercase tracking-wider ${
                          isR1 
                            ? 'text-[#A1AA9E]'
                            : isDisq 
                            ? 'text-[#A78484]'
                            : 'text-[#888888]'
                        }`}>
                          {isR1 ? 'HIGHEST SCORE' : isDisq ? 'NO-GO' : 'ALTERNATE'}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-[10px] font-mono text-[#777777]">
                        <span>{siteObj ? `${siteObj.lat.toFixed(2)}°S, ${siteObj.lon.toFixed(1)}°E` : ''}</span>
                        <span>{siteObj && siteObj.elevationMeters > 0 ? `+${siteObj.elevationMeters}m` : `${siteObj?.elevationMeters}m`}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Section B: Basemap & Elevation Raster Layers */}
            <div className="p-3 border-b border-[#242424] flex flex-col gap-2">
              <span className="text-[10px] font-mono text-[#777777] font-medium uppercase tracking-wider">
                Surface layers
              </span>

              <div className="grid grid-cols-2 gap-1.5 font-mono text-xs">
                <button
                  onClick={() => {
                    setLayerMode('albedo');
                    globeRef.current?.setLayerMode?.('albedo');
                  }}
                  className={`p-2 transition-colors cursor-pointer flex flex-col items-start gap-0.5 ${
                    layerMode === 'albedo'
                      ? 'bg-[#2A2A2A] text-white font-medium'
                      : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-[#CCCCCC]'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-medium font-sans">
                    <Eye className="w-3 h-3 text-[#999999]" />
                    <span>LROC Albedo</span>
                  </div>
                  <span className="text-[9px] text-[#666666]">8K Photorealistic</span>
                </button>

                <button
                  onClick={() => {
                    setLayerMode('lola');
                    globeRef.current?.setLayerMode?.('lola');
                  }}
                  className={`p-2 transition-colors cursor-pointer flex flex-col items-start gap-0.5 ${
                    layerMode === 'lola'
                      ? 'bg-[#2A2A2A] text-white font-medium'
                      : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-[#CCCCCC]'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px] font-medium font-sans">
                    <Layers className="w-3 h-3 text-[#999999]" />
                    <span>LOLA Topo</span>
                  </div>
                  <span className="text-[9px] text-[#666666]">118m False-Color</span>
                </button>
              </div>
            </div>

            {/* Section C: 3D Terrain Relief Exaggeration */}
            <div className="p-3 border-b border-[#242424] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#777777] font-medium uppercase tracking-wider">
                <span>Terrain scale</span>
                <span className="text-[#AAAAAA] font-mono">{reliefExaggeration.toFixed(1)}×</span>
              </div>

              <div className="grid grid-cols-3 gap-1 font-mono text-xs">
                {[1.0, 2.5, 4.0].map(val => (
                  <button
                    key={val}
                    onClick={() => {
                      setReliefExaggeration(val);
                      globeRef.current?.setExaggeration?.(val);
                    }}
                    className={`py-1.5 transition-colors cursor-pointer text-center ${
                      reliefExaggeration === val
                        ? 'bg-[#2A2A2A] text-white font-medium'
                        : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-white'
                    }`}
                  >
                    {val.toFixed(1)}×
                  </button>
                ))}
              </div>
              <span className="text-[9px] font-mono text-[#666666]">
                {reliefExaggeration === 1.0 ? 'Actual elevation' : reliefExaggeration === 2.5 ? 'Working view' : 'Exaggerated relief'}
              </span>
            </div>

            {/* Section D: Camera Presets */}
            <div className="p-3 flex flex-col gap-2">
              <span className="text-[10px] font-mono text-[#777777] font-medium uppercase tracking-wider">
                Viewpoint
              </span>

              <div className="flex flex-col gap-1 font-sans text-xs">
                <button
                  onClick={() => globeRef.current?.flyToCameraState('microscopic')}
                  className={`p-2 transition-colors cursor-pointer flex items-center justify-between ${
                    cameraTelemetry.activeCameraMode === 'microscopic'
                      ? 'bg-[#2A2A2A] text-white font-medium'
                      : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Crosshair className="w-3.5 h-3.5 text-[#999999]" />
                    <span>Surface Cockpit</span>
                  </div>
                  <span className="font-mono text-[9px] text-[#666666]">16° Pitch Grazing</span>
                </button>

                <button
                  onClick={() => globeRef.current?.flyToCameraState('southpole')}
                  className={`p-2 transition-colors cursor-pointer flex items-center justify-between ${
                    cameraTelemetry.activeCameraMode === 'southpole'
                      ? 'bg-[#2A2A2A] text-white font-medium'
                      : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Navigation className="w-3.5 h-3.5 text-[#999999]" />
                    <span>South Polar Zenith</span>
                  </div>
                  <span className="font-mono text-[9px] text-[#666666]">Nadir 90°S</span>
                </button>

                <button
                  onClick={() => globeRef.current?.flyToCameraState('global')}
                  className={`p-2 transition-colors cursor-pointer flex items-center justify-between ${
                    cameraTelemetry.activeCameraMode === 'global'
                      ? 'bg-[#2A2A2A] text-white font-medium'
                      : 'bg-[#202020] text-[#777777] hover:bg-[#252525] hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Orbit className="w-3.5 h-3.5 text-[#999999]" />
                    <span>Circumlunar Orbit</span>
                  </div>
                  <span className="font-mono text-[9px] text-[#666666]">Global Sphere</span>
                </button>
              </div>
            </div>

          </aside>
        )}

        {/* CENTER VIEWPORT: Pure 3D Lunar Model in Matte Deep Space */}
        <main className="flex-1 h-full relative bg-[#121212] overflow-hidden">
          <LunarMasterpiece3D 
            ref={globeRef}
            sites={SITES_DATA}
            selectedSiteId={selectedSiteId}
            onSelectSite={(id) => {
              setSelectedSiteId(id);
              setSelectedEpochIndex(0);
              globeRef.current?.flyToCameraState('site', id);
            }}
            downselection={downselection}
            sunAzimuthDeg={Number(activeTelemetry.sunAzimuth)}
            sunElevationDeg={Number(activeTelemetry.sunElevation)}
            isSunBlocked={obstacleInfo.isBlocked}
            isSidebarOpen={isRightPanelOpen}
            onCameraUpdate={setCameraTelemetry}
            theme={currentTheme}
            layerMode={layerMode}
            reliefExaggeration={reliefExaggeration}
            onLayerModeChange={setLayerMode}
            onReliefExaggerationChange={setReliefExaggeration}
          />
        </main>

        {/* RIGHT DOCKED SIDEBAR: Clean, Flat, Zero Card Borders */}
        {isRightPanelOpen && (
          <aside className="w-80 sm:w-84 bg-[#1A1A1A] border-l border-[#242424] flex flex-col text-xs text-[#E0E0E0] select-none overflow-y-auto shrink-0 z-10">
            
            {/* Panel Title */}
            <div className="px-3 py-2 bg-[#161616] border-b border-[#242424] flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-[#888888]">
                Site conditions
              </span>
              <span className={`font-mono text-[10px] uppercase tracking-wider ${
                obstacleInfo.isBlocked ? 'text-[#A78484]' : 'text-[#A1AA9E]'
              }`}>
                {obstacleInfo.isBlocked ? 'SHADOW' : 'SUNLIT'}
              </span>
            </div>

            {/* Section A: Selected Target Reconnaissance & MADA Score */}
            <div className="p-3 border-b border-[#242424] flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-[#888888]">
                    <span>[TARGET-0{selectedSiteRankInfo?.rank || 1}]</span>
                    <span className="text-[#666666]">RECONNAISSANCE</span>
                  </div>
                  <h2 className="text-sm font-semibold text-white tracking-tight leading-tight mt-0.5">
                    {selectedSite.name}
                  </h2>
                  <div className="text-[10px] font-mono text-[#888888] mt-0.5">
                    {selectedSite.lat.toFixed(2)}°S, {selectedSite.lon.toFixed(1)}°E • <strong className="text-white">{selectedSite.elevationMeters > 0 ? `+${selectedSite.elevationMeters}` : selectedSite.elevationMeters}m</strong> (IAU-2018)
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span className="text-[8px] font-mono uppercase tracking-wider text-[#777777] block">
                    SITE SCORE
                  </span>
                  <div className={`text-base font-mono font-bold tracking-tight ${
                    isSelectedRank1 ? 'text-[#A1AA9E]' : isSelectedDisqualified ? 'text-[#A78484]' : 'text-white'
                  }`}>
                    {selectedSiteRankInfo?.compositeScore || 0}
                    <span className="text-[10px] text-[#666666] font-normal font-sans">/100</span>
                  </div>
                  <div className={`text-[10px] font-mono uppercase tracking-wider mt-0.5 ${
                    isSelectedRank1 
                      ? 'text-[#A1AA9E]'
                      : isSelectedDisqualified 
                      ? 'text-[#A78484]'
                      : 'text-[#888888]'
                  }`}>
                    {isSelectedRank1 ? 'Top candidate' : isSelectedDisqualified ? 'Not viable' : 'Alternate'}
                  </div>
                </div>
              </div>

              {/* Quick KPIs Grid - Clean Flat Columns, Zero Framed Outlines */}
              <div className="grid grid-cols-3 bg-[#202020] p-2 text-center font-mono mt-1">
                <div className="px-1">
                  <span className="text-[8px] uppercase tracking-wider text-[#888888] block">Solar Coverage</span>
                  <strong className="text-xs font-semibold text-white mt-0.5 block">
                    {selectedSiteRankInfo ? `${Math.round((selectedSiteRankInfo.survivedDays / 14) * 100)}%` : '--'}
                  </strong>
                </div>
                <div className="px-1">
                  <span className="text-[8px] uppercase tracking-wider text-[#888888] block">DSN Contact</span>
                  <strong className="text-xs font-semibold text-white mt-0.5 block">
                    {selectedSiteRankInfo?.avgDteLos != null ? `${selectedSiteRankInfo.avgDteLos}%` : '--'}
                  </strong>
                </div>
                <div className="px-1">
                  <span className="text-[8px] uppercase tracking-wider text-[#888888] block">Slope Hazard</span>
                  <strong className={`text-xs font-semibold mt-0.5 block ${
                    selectedSite.hazardRating === 'Low' ? 'text-[#A1AA9E]' : selectedSite.hazardRating === 'High' ? 'text-[#A78484]' : 'text-[#AE9B7D]'
                  }`}>
                    {selectedSite.hazardRating.toUpperCase()}
                  </strong>
                </div>
              </div>
            </div>

            {/* Section B: Live Avionics Telemetry - Flat Metric Cards, Zero Outline Frames */}
            <div className="p-3 border-b border-[#242424] flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-[#888888] font-medium uppercase tracking-wider">
                <span>Current conditions</span>
                <span className="text-[#AAAAAA]">EPOCH #{selectedEpochIndex}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {/* Sun Vector */}
                <div className="p-2 bg-[#202020]">
                  <div className="flex items-center justify-between text-[#888888] text-[9px] uppercase">
                    <span>Sun Vector</span>
                    <Sun className="w-3 h-3 text-[#777777]" />
                  </div>
                  <div className="font-semibold text-sm text-white mt-0.5">
                    El: {activeTelemetry.sunElevation}°
                  </div>
                  <span className="text-[9px] text-[#777777] block">
                    Az: {activeTelemetry.sunAzimuth}°
                  </span>
                </div>

                {/* Earth DSN */}
                <div className="p-2 bg-[#202020]">
                  <div className="flex items-center justify-between text-[#888888] text-[9px] uppercase">
                    <span>Earth DSN</span>
                    <Radio className="w-3 h-3 text-[#777777]" />
                  </div>
                  <div className="font-semibold text-sm text-white mt-0.5">
                    El: {activeTelemetry.earthElevation}°
                  </div>
                  <span className="text-[9px] text-[#777777] truncate block" title={activeTelemetry.activeDsnStation}>
                    {activeTelemetry.activeDsnStation}
                  </span>
                </div>

                {/* Power & Battery */}
                <div className="p-2 bg-[#202020]">
                  <div className="flex items-center justify-between text-[#888888] text-[9px] uppercase">
                    <span>Array / Battery</span>
                    <strong className="text-[#A1AA9E]">
                      {activeTelemetry.powerWatts}W
                    </strong>
                  </div>
                  <div className="font-semibold text-sm text-white mt-0.5">
                    SoC: {activeTelemetry.batterySocPercent}%
                  </div>
                  <span className="text-[9px] text-[#777777] block">
                    1.5 kWh Li-Ion Bus
                  </span>
                </div>

                {/* Regolith Temp */}
                <div className="p-2 bg-[#202020]">
                  <div className="flex items-center justify-between text-[#888888] text-[9px] uppercase">
                    <span>Regolith Temp</span>
                    <Thermometer className="w-3 h-3 text-[#777777]" />
                  </div>
                  <div className="font-semibold text-sm text-white mt-0.5">
                    {activeTelemetry.regolithTempC}°C
                  </div>
                  <span className="text-[9px] text-[#777777] block">
                    {activeTelemetry.regolithTempK} K (Surface)
                  </span>
                </div>
              </div>
            </div>

            {/* Section C: 14-Day Mission Ephemeris Curves */}
            <div className="p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-[#888888] uppercase tracking-wider">Two-week outlook</span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setActiveChartTab('angles')}
                    className={`px-1.5 py-0.5 cursor-pointer transition-colors ${
                      activeChartTab === 'angles' ? 'text-white font-medium bg-[#242424]' : 'text-[#777777] hover:text-[#AAAAAA]'
                    }`}
                  >
                    Sun
                  </button>
                  <button
                    onClick={() => setActiveChartTab('power')}
                    className={`px-1.5 py-0.5 cursor-pointer transition-colors ${
                      activeChartTab === 'power' ? 'text-white font-medium bg-[#242424]' : 'text-[#777777] hover:text-[#AAAAAA]'
                    }`}
                  >
                    Power
                  </button>
                  <button
                    onClick={() => setActiveChartTab('battery')}
                    className={`px-1.5 py-0.5 cursor-pointer transition-colors ${
                      activeChartTab === 'battery' ? 'text-white font-medium bg-[#242424]' : 'text-[#777777] hover:text-[#AAAAAA]'
                    }`}
                  >
                    Battery
                  </button>
                  <button
                    onClick={() => setActiveChartTab('comms')}
                    className={`px-1.5 py-0.5 cursor-pointer transition-colors ${
                      activeChartTab === 'comms' ? 'text-white font-medium bg-[#242424]' : 'text-[#777777] hover:text-[#AAAAAA]'
                    }`}
                  >
                    Comms
                  </button>
                </div>
              </div>

              <div className="w-full h-36 bg-[#161616] p-1 font-mono">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={ephemerisSamples} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
                    <XAxis dataKey="epochIndex" tick={{ fontSize: 9, fill: '#555555' }} tickLine={false} axisLine={{ stroke: '#222222' }} interval={95} tickFormatter={(val) => `D${Math.floor(val/48) + 1}`} />
                    <YAxis tick={{ fontSize: 9, fill: '#555555' }} tickLine={false} axisLine={{ stroke: '#222222' }} domain={activeChartTab === 'angles' ? [-4, 12] : activeChartTab === 'power' ? [0, 500] : activeChartTab === 'battery' ? [0, 100] : [0, 36]} />
                    <Tooltip contentStyle={{ backgroundColor: '#1A1A1A', borderColor: '#303030', borderRadius: '0px', color: '#E0E0E0', fontSize: '10px', padding: '4px 8px', fontFamily: 'monospace' }} labelFormatter={(val) => `Epoch #${val} (${ephemerisSamples[val]?.label || ''} UTC)`} />
                    <ReferenceLine x={selectedEpochIndex} stroke="#777777" strokeWidth={1} strokeDasharray="2 2" />
                    {activeChartTab === 'angles' && (
                      <>
                        <ReferenceLine y={0} stroke="#A78484" strokeDasharray="2 2" />
                        <Area isAnimationActive={false} type="monotone" dataKey="sunElevation" stroke="#8FA3B8" fillOpacity={0.08} fill="#8FA3B8" strokeWidth={1.5} name="Sun El (°)" />
                        <Area isAnimationActive={false} type="monotone" dataKey="earthElevation" stroke="#555555" fillOpacity={0} strokeWidth={1.5} name="Earth El (°)" />
                      </>
                    )}
                    {activeChartTab === 'power' && (
                      <>
                        <ReferenceLine y={65} stroke="#AE9B7D" strokeDasharray="2 2" />
                        <Area isAnimationActive={false} type="monotone" dataKey="powerWatts" stroke="#A1AA9E" fillOpacity={0.08} fill="#A1AA9E" strokeWidth={1.5} name="Solar Power (W)" />
                      </>
                    )}
                    {activeChartTab === 'battery' && (
                      <>
                        <ReferenceLine y={20} stroke="#A78484" strokeDasharray="2 2" />
                        <Area isAnimationActive={false} type="monotone" dataKey="batterySocPercent" stroke="#8FA3B8" fillOpacity={0.08} fill="#8FA3B8" strokeWidth={1.5} name="Battery SoC (%)" />
                      </>
                    )}
                    {activeChartTab === 'comms' && (
                      <>
                        <ReferenceLine y={3} stroke="#A78484" strokeDasharray="2 2" />
                        <Area isAnimationActive={false} type="monotone" dataKey="linkMarginDb" stroke="#8FA3B8" fillOpacity={0.08} fill="#8FA3B8" strokeWidth={1.5} name="DSN Link Margin (dB)" />
                      </>
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

          </aside>
        )}

      </div>

      {/* 3. SOLID BOTTOM STATUS BAR (Matte Dark, Flat Controls, Zero Outlines) */}
      <footer className="h-12 sm:h-12 bg-[#161616] border-t border-[#242424] px-3 flex items-center justify-between text-[11px] font-mono select-none text-[#888888] shrink-0 z-20">
        
        {/* Left: Playback Controls & Timestamp Readout */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => {
              setManualEpochValue('');
              setIsPlaying(!isPlaying);
            }}
            className="px-2.5 py-1 font-medium flex items-center gap-1.5 transition-colors cursor-pointer text-xs bg-[#242424] hover:bg-[#2C2C2C] text-[#E0E0E0]"
          >
            {isPlaying ? <Pause className="w-3 h-3 fill-current text-[#AAAAAA]" /> : <Play className="w-3 h-3 fill-current text-[#AAAAAA]" />}
            <span className="hidden sm:inline text-[10px]">{isPlaying ? 'HOLD' : 'SCRUB'}</span>
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setManualEpochValue('');
              setSelectedEpochIndex(prev => Math.max(0, prev - 1));
            }}
            className="p-1 bg-[#242424] hover:bg-[#2C2C2C] text-[#E0E0E0] cursor-pointer transition-colors"
            title="Step -30m"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={() => {
              setIsPlaying(false);
              setManualEpochValue('');
              setSelectedEpochIndex(prev => Math.min(ephemerisSamples.length - 1, prev + 1));
            }}
            className="p-1 bg-[#242424] hover:bg-[#2C2C2C] text-[#E0E0E0] cursor-pointer transition-colors"
            title="Step +30m"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          <div className="hidden sm:flex items-center gap-1.5 ml-2 text-[#777777]">
            <span className="text-white font-medium">#{selectedEpochIndex}</span>
            <span>•</span>
            <span className="text-[#AAAAAA]">{activeTelemetry.label || ''} UTC</span>
          </div>
        </div>

        {/* Center: Continuous 14-Day Timeline Track & Health Ribbon */}
        <div className="flex flex-col gap-1 flex-1 max-w-2xl mx-4 min-w-0">
          <div className="flex items-center justify-between gap-2 text-[9px] font-mono text-[#777777]">
            <span>D01</span>
            <label className="flex items-center gap-1.5 text-[9px] text-[#888888] whitespace-nowrap">
              <span className="hidden sm:inline">Exact time · UTC</span>
              <input
                aria-label="Exact simulation time in UTC"
                type="datetime-local"
                step="60"
                min={formatInputUtc(startEpoch)}
                max={formatInputUtc(timelineEnd)}
                value={exactTimeInputValue}
                onChange={(event) => {
                  const value = event.target.value;
                  setManualEpochValue(value);
                  const date = new Date(`${value}:00Z`);
                  const offsetHours = (date.getTime() - startEpoch.getTime()) / 3600000;
                  if (Number.isFinite(date.getTime()) && offsetHours >= 0 && offsetHours < 14 * 24) {
                    setIsPlaying(false);
                    setSelectedEpochIndex(Math.floor(offsetHours / 0.5));
                  }
                }}
                className="w-[154px] h-6 px-1.5 bg-[#202020] text-[#D0D0D0] border border-[#303030] text-[10px] font-mono outline-none focus:border-[#666666]"
              />
            </label>
            <span className="text-white font-medium truncate sm:hidden">
              #{selectedEpochIndex} • {activeTelemetry.label || ''} UTC
            </span>
            <span>D14</span>
          </div>

          {/* Interactive Range Input */}
          <input
            type="range"
            min="0"
            max={ephemerisSamples.length - 1}
            value={selectedEpochIndex}
            onChange={(e) => {
              setIsPlaying(false);
              setManualEpochValue('');
              setSelectedEpochIndex(Number(e.target.value));
            }}
            className="w-full cursor-pointer h-1.5 bg-[#242424] rounded-none transition-all"
            style={{ accentColor: '#888888' }}
          />

          {/* 14-Day Viability Health Ribbon */}
          <div className="flex gap-0.5 h-1 w-full bg-[#202020]">
            {daySummaries.map(d => {
              const isOptimal = d.status === 'Optimal';
              const isDegraded = d.status === 'Degraded';
              const startSample = (d.dayNumber - 1) * 48;

              return (
                <div
                  key={d.dayNumber}
                  onClick={() => {
                    setManualEpochValue('');
                    setSelectedEpochIndex(startSample);
                  }}
                  title={`Day ${d.dayNumber}: ${d.status} • Sun: ${d.sunlitHours}h • Earth: ${d.dteLosPercent}%`}
                  className={`flex-1 cursor-pointer transition-opacity hover:opacity-80 ${
                    isOptimal ? 'bg-[#3E7351]' : isDegraded ? 'bg-[#8C6E2E]' : 'bg-[#7E3232]'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Right: Geodetic Cursor Readout */}
        <div className="hidden md:flex items-center gap-2 text-[10px] font-mono text-[#777777] shrink-0">
          <span>LAT: <strong className="text-white">{selectedSite.lat.toFixed(2)}°S</strong></span>
          <span>|</span>
          <span>LON: <strong className="text-white">{selectedSite.lon.toFixed(1)}°E</strong></span>
          <span>|</span>
          <span>ELEV: <strong className="text-[#CCCCCC]">{selectedSite.elevationMeters > 0 ? `+${selectedSite.elevationMeters}` : selectedSite.elevationMeters}m</strong></span>
        </div>

      </footer>

      {/* 4. NASA SYSTEMS ENGINEERING MADA TRADE STUDY MODAL */}
      {showMatrixModal && (
        <div 
          onClick={() => setShowMatrixModal(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1C1C1C] border border-[#303030] rounded-none max-w-4xl w-full p-5 text-[#E0E0E0] max-h-[90vh] overflow-y-auto font-sans shadow-2xl cursor-default"
          >
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#AAAAAA]" />
                <h3 className="font-semibold text-sm text-white tracking-tight">
                  Site ranking
                </h3>
              </div>
              <button 
                onClick={() => setShowMatrixModal(false)} 
                className="text-[#888888] hover:text-white p-1 rounded-none hover:bg-[#262626] cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-3 space-y-3">
              <p className="text-xs text-[#999999] leading-relaxed">
                Aethra calculates its project score using these weights:
                <strong className="text-white"> 40% feasibility</strong>, <strong className="text-white">30% Earth contact</strong>, <strong className="text-white">20% generated energy</strong>, and <strong className="text-white">10% terrain hazard</strong>. <a className="underline underline-offset-2 text-[#D0D0D0]" href="https://www.nasa.gov/reference/systems-engineering-handbook/" target="_blank" rel="noreferrer">NASA/SP-2016-6105 §6.8</a> describes decision analysis; the weights and 0% battery rule shown here are set by this project. A site is marked no-go if the modeled battery reaches 0%.
              </p>

              {/* Clean Matte Table */}
              <div className="overflow-x-auto border border-[#2A2A2A]">
                <table className="w-full text-left text-xs font-sans">
                  <thead className="bg-[#242424] text-white font-medium border-b border-[#303030]">
                    <tr>
                      <th className="p-2.5">Rank</th>
                      <th className="p-2.5">Candidate site</th>
                      <th className="p-2.5">Solar Exposure</th>
                      <th className="p-2.5">DSN Link</th>
                      <th className="p-2.5">Composite Score</th>
                      <th className="p-2.5">Status</th>
                      <th className="p-2.5">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#242424] font-mono">
                    {downselection.rankedSites.map(site => {
                      const isR1 = site.rank === 1 && site.isMissionSuccess;
                      const isDisq = site.rankStatus === 'DISQUALIFIED';
                      const isSel = site.siteId === selectedSiteId;

                      return (
                        <tr key={site.siteId} className={isSel ? 'bg-[#262626]' : 'hover:bg-[#222222]'}>
                          <td className="p-2.5 font-medium">
                            <span className={`px-1.5 py-0.5 text-[11px] ${
                              isR1 
                                ? 'bg-[#1E2D23] text-[#A1AA9E]'
                                : isDisq 
                                ? 'bg-[#331A1A] text-[#A78484]'
                                : 'bg-[#242424] text-[#888888]'
                            }`}>
                              0{site.rank}
                            </span>
                          </td>
                          <td className="p-2.5 font-sans font-medium text-white">
                            {site.name}
                          </td>
                          <td className="p-2.5 text-[#E0E0E0] font-mono">
                            {site.solarCoveragePercent ?? 0}%
                            {!site.isMissionSuccess && (
                                <span className="text-[10px] text-[#A78484] block font-mono font-medium">Battery reaches 0%</span>
                            )}
                          </td>
                          <td className="p-2.5 text-[#E0E0E0] font-mono">{site.dsnCoveragePercent ?? 0}%</td>
                          <td className="p-2.5 font-medium text-white">
                            {site.compositeScore} / 100
                          </td>
                          <td className="p-2.5">
                            <span className={`px-2 py-0.5 text-[10px] ${
                              isR1 
                                ? 'text-[#A1AA9E]'
                                : isDisq 
                                ? 'text-[#A78484]'
                                : 'text-[#888888]'
                            }`}>
                              {isR1 ? 'Highest score' : isDisq ? 'No-go' : 'Alternate'}
                            </span>
                          </td>
                          <td className="p-2.5">
                            <button
                              onClick={() => {
                                setSelectedSiteId(site.siteId);
                                setSelectedEpochIndex(0);
                                globeRef.current?.flyToCameraState('site', site.siteId);
                                setShowMatrixModal(false);
                              }}
                              className="px-2.5 py-1 bg-[#262626] hover:bg-[#303030] text-white font-sans text-xs font-medium cursor-pointer transition-colors"
                            >
                              View site
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border-t border-[#2A2A2A] pt-3 flex justify-end">
              <button
                onClick={() => setShowMatrixModal(false)}
                className="px-3.5 py-1.5 bg-[#262626] hover:bg-[#303030] text-white font-sans font-medium text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. ASTRODYNAMICS & GEODETIC FORMULATION MODAL */}
      {showProofModal && (
        <div 
          onClick={() => setShowProofModal(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1C1C1C] border border-[#303030] rounded-none max-w-3xl w-full p-5 text-[#E0E0E0] max-h-[90vh] overflow-y-auto font-sans shadow-2xl cursor-default"
          >
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#AAAAAA]" />
                <h3 className="font-semibold text-sm text-white tracking-tight">
                  Calculation notes
                </h3>
              </div>
              <button 
                onClick={() => setShowProofModal(false)} 
                className="text-[#888888] hover:text-white p-1 rounded-none hover:bg-[#262626] cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="my-3 space-y-3 text-xs text-[#999999] leading-relaxed">
              <div className="p-3 bg-[#222222]">
                <strong className="text-white text-xs font-mono font-medium block mb-1 uppercase">
                  1. Lunar shape
                </strong>
                <p>
                  Position calculations use an equatorial radius of <strong className="text-white">1738.1 km</strong> and a polar radius of <strong className="text-white">1735.97 km</strong>, following the IAU 2018 reference. The model uses an ellipsoid to account for the difference between those radii.
                </p>
              </div>

              <div className="p-3 bg-[#222222]">
                <strong className="text-white text-xs font-mono font-medium block mb-1 uppercase">
                  2. Sunlight near the horizon
                </strong>
                <p>
                  When a ridge partly covers the Sun, the model estimates the visible part of the solar disk. The calculation checks two symmetry conditions: <strong className="text-white">f(0) = 0.5000</strong> and <strong className="text-white">f(y) + f(-y) = 1.0000</strong>.
                </p>
              </div>

              <div className="p-3 bg-[#222222]">
                <strong className="text-white text-xs font-mono font-medium block mb-1 uppercase">
                  3. Earth-station visibility
                </strong>
                <p>
                  The model checks the line of sight to Goldstone (DSS-24), Madrid (DSS-54) and Canberra (DSS-35). It uses WGS-84 coordinates, Earth rotation, and a 10° minimum station elevation.
                </p>
              </div>
            </div>

            <div className="border-t border-[#2A2A2A] pt-3 flex justify-end">
              <button
                onClick={() => setShowProofModal(false)}
                className="px-3.5 py-1.5 bg-[#262626] hover:bg-[#303030] text-white font-sans font-medium text-xs cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 6. MISSION BRIEFING MODAL */}
      {showStoryModal && (
        <div 
          onClick={() => setShowStoryModal(false)}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-150 cursor-pointer"
        >
          <div 
            onClick={(e) => e.stopPropagation()}
            className="bg-[#1C1C1C] border border-[#303030] rounded-none max-w-2xl w-full p-5 text-[#E0E0E0] font-sans shadow-2xl cursor-default"
          >
            <div className="flex items-center justify-between border-b border-[#2A2A2A] pb-3">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-[#AAAAAA]" />
                <h3 className="font-semibold text-sm text-white tracking-tight">
                  Site-selection briefing · 0{storyStep} / 04
                </h3>
              </div>
              <button 
                onClick={() => setShowStoryModal(false)} 
                className="text-[#888888] hover:text-white p-1 rounded-none hover:bg-[#262626] cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="py-4">
              {storyStep === 1 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-mono font-medium uppercase tracking-wider text-[#CCCCCC] bg-[#2A2A2A] px-2 py-0.5">
                    SOUTH-POLE CONDITIONS
                  </span>
                  <h2 className="text-lg font-semibold tracking-tight text-white">
                    Sunlight at a low angle
                  </h2>
                  <p className="text-[#999999] text-xs leading-relaxed">
                    Near the lunar south pole, the Sun stays close to the horizon. Ridges can cast long shadows, and some crater floors never receive direct sunlight. These conditions affect solar power and surface temperature.
                  </p>
                </div>
              )}

              {storyStep === 2 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-mono font-medium uppercase tracking-wider text-[#A78484] bg-[#331A1A] px-2 py-0.5">
                    PROJECT SCORING RULE
                  </span>
                  <h2 className="text-lg font-semibold tracking-tight text-white">
                    When a site is marked no-go
                  </h2>
                  <p className="text-[#999999] text-xs leading-relaxed">
                    A site is marked no-go if its modeled battery state reaches 0% during the selected window. This exclusion rule belongs to Aethra’s project model; it is not a requirement from NASA/SP-2016-6105. Change the date in the planner to recalculate each site.
                  </p>
                </div>
              )}

              {storyStep === 3 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-mono font-medium uppercase tracking-wider text-[#A1AA9E] bg-[#1E2D23] px-2 py-0.5">
                    CURRENT RANKING
                  </span>
                  <h2 className="text-lg font-semibold tracking-tight text-white">
                    {primary?.name || primarySite.name} · {primary?.compositeScore ?? '—'} / 100
                  </h2>
                  <p className="text-[#999999] text-xs leading-relaxed">
                    {primary?.name || primarySite.name} has the highest score for the selected date: {primary?.compositeScore ?? '—'} out of 100. The score comes from Aethra’s model. Select the site in the planner to inspect its conditions over time.
                  </p>
                </div>
              )}

              {storyStep === 4 && (
                <div className="space-y-2.5">
                  <span className="text-[9px] font-mono font-medium uppercase tracking-wider text-[#CCCCCC] bg-[#2A2A2A] px-2 py-0.5">
                    TERRAIN VIEW
                  </span>
                  <h2 className="text-lg font-semibold tracking-tight text-white">
                    Inspect the local slope
                  </h2>
                  <p className="text-[#999999] text-xs leading-relaxed">
                    Open the surface view over Malapert Mountain. The terrain comes from a 256 × 256 elevation grid. Use it to inspect the local slope and the Sun’s direction.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={() => {
                        setSelectedSiteId('malapert');
                        setSelectedEpochIndex(0);
                        globeRef.current?.flyToCameraState('microscopic', 'malapert');
                        setShowStoryModal(false);
                      }}
                      className="w-full py-2.5 bg-[#262626] hover:bg-[#303030] text-white font-medium text-xs font-sans flex items-center justify-center gap-2 transition-colors cursor-pointer"
                    >
                      <span>View Malapert terrain</span>
                      <ArrowUpRight className="w-3.5 h-3.5 text-[#CCCCCC]" />
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Stepper Footer */}
            <div className="border-t border-[#2A2A2A] pt-3 flex items-center justify-between text-xs">
              <button
                disabled={storyStep === 1}
                onClick={() => setStoryStep(prev => Math.max(1, prev - 1))}
                className={`px-3 py-1 font-medium cursor-pointer ${
                  storyStep === 1 
                    ? 'opacity-30 text-[#555555] cursor-not-allowed' 
                    : 'bg-[#242424] hover:bg-[#2C2C2C] text-[#E0E0E0]'
                }`}
              >
                Back
              </button>

              <div className="flex items-center gap-1 font-mono text-[10px] text-[#777777]">
                <span>[ STEP {storyStep} / 4 ]</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowStoryModal(false)}
                  className="px-2.5 py-1 text-[#888888] hover:text-white font-sans text-xs cursor-pointer hover:bg-[#242424]"
                >
                  Close
                </button>
                {storyStep < 4 ? (
                  <button
                    onClick={() => setStoryStep(prev => Math.min(4, prev + 1))}
                    className="px-3.5 py-1 bg-[#262626] hover:bg-[#303030] text-white font-medium cursor-pointer"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={() => setShowStoryModal(false)}
                    className="px-3.5 py-1 bg-[#262626] hover:bg-[#303030] text-white font-medium cursor-pointer"
                  >
                    Done
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
