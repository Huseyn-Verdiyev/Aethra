import React, { useEffect, useRef, useState } from 'react';
import scrollama from 'scrollama';
import { MotionConfig, motion } from 'motion/react';
import autoAnimate from '@formkit/auto-animate';
import { ArrowDown, ArrowRight, Check, Compass, Radio, Sun } from 'lucide-react';
import { SITES_DATA } from '../data';
import LunarMasterpiece3D from './LunarMasterpiece3D';

const NOOP = () => {};

const chapters = [
  {
    eyebrow: '01 · LIGHT',
    title: 'Sunlight skims the ground.',
    text: 'Near the south pole, the Sun stays low. A ridge may be lit while a nearby crater floor remains in shadow. That difference affects how much power a lander can generate.',
    metric: '1.5°',
    metricLabel: 'solar elevation shown in the terrain view'
  },
  {
    eyebrow: '02 · CONTACT',
    title: 'The lander needs a clear view of Earth.',
    text: 'A direct radio link is available only when local terrain does not block the station. The planner calculates Earth elevation and checks the terrain along that direction.',
    metric: 'Direct Earth link',
    metricLabel: 'checked against the local horizon'
  },
  {
    eyebrow: '03 · COMPARISON',
    title: 'Every site uses the same 14-day window.',
    text: 'The planner advances in 30-minute steps. That gives 672 samples per location, so the sites can be compared over the same dates and intervals.',
    metric: '672 samples',
    metricLabel: 'per site, at 30-minute intervals'
  },
  {
    eyebrow: '04 · DECISION',
    title: 'The score uses four weighted inputs.',
    text: 'Feasibility counts for 40%, Earth contact for 30%, energy for 20%, and terrain for 10%. These are Aethra’s project weights. Open the planner to see how a site scores.',
    metric: '40% / 30% / 20% / 10%',
    metricLabel: 'feasibility · Earth contact · energy · terrain'
  }
];

export default function LandingPage({ downselection, theme, selectedSiteId, onSelectSite, onEnterPlanner }) {
  const [activeChapter, setActiveChapter] = useState(0);
  const scrollerRef = useRef(null);
  const detailRef = useRef(null);

  useEffect(() => {
    if (!detailRef.current) return;
    const motion = autoAnimate(detailRef.current);
    return () => motion.destroy();
  }, []);
  const primary = downselection.primarySite;
  const primarySite = SITES_DATA.find(site => site.id === primary?.siteId) || SITES_DATA[0];

  useEffect(() => {
    document.documentElement.classList.add('aethra-landing-scroll');
    document.body.classList.add('aethra-landing-scroll');

    const instance = scrollama();
    instance
      .setup({ step: '.aethra-step', offset: 0.58, threshold: 4 })
      .onStepEnter(({ index }) => setActiveChapter(index));

    const resize = () => instance.resize();
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      instance.destroy();
      document.documentElement.classList.remove('aethra-landing-scroll');
      document.body.classList.remove('aethra-landing-scroll');
    };
  }, []);

  const active = chapters[activeChapter] || chapters[0];
  const siteCount = downselection.rankedSites.length;

  return (
    <MotionConfig reducedMotion="user">
    <main className="aethra-landing">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="Aethra home">AETHRA <span>Moon site study</span></a>
        <nav aria-label="Main navigation">
          <a href="#why">Why the south pole</a>
          <a href="#method">The model</a>
          <button onClick={() => onEnterPlanner(selectedSiteId)}>Open planner <ArrowRight size={15} /></button>
        </nav>
      </header>

      <section className="landing-hero" id="top">
        <motion.div className="hero-copy" initial={{ y: 32 }} whileInView={{ y: 0 }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}>
          <p className="landing-kicker">NASA SPACE APPS · CLPS LANDING SITE STUDY</p>
          <h1>Where could a lander<br className="hero-title-break" />keep power and contact?</h1>
          <p className="hero-lede">At the lunar south pole, ridges can shade a site or block its direct link to Earth. Aethra compares five candidate locations over a 14-day window.</p>
          <div className="hero-actions">
            <button className="primary-cta" onClick={() => onEnterPlanner(primary?.siteId)}>
              Open the site comparison <ArrowRight size={17} />
            </button>
            <a className="text-cta" href="#why">Why these conditions matter <ArrowDown size={15} /></a>
          </div>
          <div className="hero-facts" aria-label="Analysis overview">
            <div><strong>{siteCount}</strong><span>candidate locations</span></div>
            <div><strong>14 days</strong><span>comparison window</span></div>
            <div><strong>30 min</strong><span>between samples</span></div>
          </div>
        </motion.div>
        <div className="hero-visual" aria-label="Interactive three-dimensional lunar south pole terrain">
          <div className="visual-label"><span>South-pole terrain</span><span>3D view · select a marker</span></div>
          <div className="landing-globe">
            <LunarMasterpiece3D
              sites={SITES_DATA}
              selectedSiteId={selectedSiteId}
              onSelectSite={onSelectSite}
              downselection={downselection}
              sunAzimuthDeg={114.5}
              sunElevationDeg={1.5}
              isSunBlocked={false}
              isSidebarOpen={false}
              onCameraUpdate={NOOP}
              theme={theme}
              layerMode="albedo"
              reliefExaggeration={2.5}
            />
          </div>
          <div className="visual-note" ref={detailRef}>
            <div className="visual-note-icon"><Compass size={17} /></div>
            <div key={active.eyebrow}>
              <span className="visual-note-eyebrow">{active.eyebrow}</span>
              <h2>{active.title}</h2>
              <p>{active.metric} <span>· {active.metricLabel}</span></p>
            </div>
          </div>
        </div>
      </section>

      <section className="story-section" id="why">
        <div className="story-intro">
          <p className="landing-kicker">LIGHT AND RADIO AT THE SOUTH POLE</p>
          <h2>A ridge can block<br />light or radio.</h2>
          <p>The Sun and Earth stay low in the sky near the lunar south pole. A ridge between either one and a landing site can block sunlight or a direct radio link.</p>
          <div className="sightline-key">
            <span><Sun size={16} /> Sunlight → solar power</span>
            <span><Radio size={16} /> Earth line of sight → radio link</span>
          </div>
          <div className="story-stage" aria-live="polite">
            <div className="story-stage-topline"><span>FIELD NOTE</span><span>0{activeChapter + 1} / 04</span></div>
            <motion.div key={activeChapter} className="chapter-readout" initial={{ y: 14 }} animate={{ y: 0 }} transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}>
              <span className="chapter-readout-index">{active.eyebrow}</span>
              <h3>{active.title}</h3>
              <p><strong>{active.metric}</strong><span>{active.metricLabel}</span></p>
            </motion.div>
            <div className="story-progress-track"><div className="story-progress-fill" style={{ transform: `scaleX(${(activeChapter + 1) / chapters.length})` }} /></div>
          </div>
        </div>
        <div className="story-steps" ref={scrollerRef}>
          {chapters.map((chapter, index) => (
            <motion.article className={`aethra-step ${activeChapter === index ? 'is-current' : ''}`} key={chapter.eyebrow} initial={{ y: 38 }} whileInView={{ y: 0 }} viewport={{ once: true, amount: 0.22 }} transition={{ duration: 0.62, delay: 0.04, ease: [0.22, 1, 0.36, 1] }}>
              <p className="step-number">{chapter.eyebrow}</p>
              <h3>{chapter.title}</h3>
              <p>{chapter.text}</p>
            </motion.article>
          ))}
        </div>
      </section>

      <section className="method-section" id="method">
        <div className="method-heading">
          <p className="landing-kicker">HOW THE COMPARISON WORKS</p>
          <h2>How Aethra scores a site.</h2>
          <p>Choose a date in the planner to recalculate conditions and rankings.</p>
        </div>
        <div className="method-grid">
          <motion.article initial={{ y: 38 }} whileInView={{ y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.55, delay: 0, ease: [0.22, 1, 0.36, 1] }}><span className="method-index">01</span><Sun size={19} /><h3>Calculate each time step</h3><p>At each sample, the model estimates sunlight, Earth elevation, array output, battery charge and surface temperature.</p></motion.article>
          <motion.article initial={{ y: 38 }} whileInView={{ y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.55, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}><span className="method-index">02</span><Compass size={19} /><h3>Apply the project weights</h3><p>The score assigns 40% to feasibility, 30% to Earth contact, 20% to energy and 10% to terrain.</p></motion.article>
          <motion.article initial={{ y: 38 }} whileInView={{ y: 0 }} viewport={{ once: true, amount: 0.35 }} transition={{ duration: 0.55, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}><span className="method-index">03</span><Check size={19} /><h3>Check the inputs</h3><p>Select another date or location in the planner to see the conditions and ranking update.</p></motion.article>
        </div>
        <div className="score-explainer">
          <div><p className="landing-kicker">HIGHEST SCORE FOR THIS RUN</p><h3>{primary?.name || primarySite.name}</h3><p>{Math.abs(primary?.lat ?? primarySite.lat).toFixed(2)}°{(primary?.lat ?? primarySite.lat) < 0 ? 'S' : 'N'}, {Math.abs(primary?.lon ?? primarySite.lon).toFixed(2)}°{(primary?.lon ?? primarySite.lon) < 0 ? 'W' : 'E'} · current date selection</p></div>
          <div className="score-number"><strong>{primary?.compositeScore ?? '—'}</strong><span> / 100 project score</span></div>
          <button className="primary-cta" onClick={() => onEnterPlanner(primary?.siteId)}>Open this location <ArrowRight size={17} /></button>
        </div>
        <p className="model-note">These scores come from Aethra’s project model. They are not NASA assessments or landing recommendations.</p>
      </section>

      <footer className="landing-footer">
        <div><span className="landing-brand">AETHRA</span><p>Project estimates for five lunar south-pole locations.</p></div>
        <div className="source-links">
          <span>Data: <a href="https://pgda.gsfc.nasa.gov/products/90" target="_blank" rel="noreferrer">NASA GSFC · South Pole LOLA DEM</a> · <a href="https://pgda.gsfc.nasa.gov/products/78" target="_blank" rel="noreferrer">5 m site DEMs</a> · <a href="https://ntrs.nasa.gov/api/citations/20250002845/downloads/M2M-30044%20Lunar%20Surface%20Data%20Book%20Baseline_Final.pdf" target="_blank" rel="noreferrer">NASA Lunar Surface Data Book</a></span>
        </div>
      </footer>
    </main>
    </MotionConfig>
  );
}
