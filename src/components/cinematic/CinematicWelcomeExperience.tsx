import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowRight,
  ChevronDown,
  Globe,
  Home,
  RotateCcw,
  SlidersHorizontal,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  useLanguagePreference,
} from '../DesignSystem';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { CINEMATIC_WELCOME_I18N } from './welcomeI18n';
import {
  markCinematicIntroSeen,
  prefersReducedMotion,
} from './launchState';
import { DioramaSvgFallback } from './DioramaSvgFallback';
import type { PillarId, ProjectedAnchorsMap } from './AkaraiDioramaScene';

const LazyAkaraiDioramaScene = React.lazy(() => import('./AkaraiDioramaScene'));

export interface CinematicWelcomeExperienceProps {
  /** Called when user enters Home (Explore Demo / Continue) */
  onEnterApp: () => void;
  /** Called when user chooses to start a clean personal portfolio immediately */
  onStartCleanWorkspace?: () => void;
  /** Called when user chooses Workspace Setup (/onboarding) */
  onOpenWorkspaceSetup: () => void;
  /** Called when user chooses Switch Role (/account) */
  onOpenRoleSwitch: () => void;
  /** When true (e.g. /welcome manual replay), starts fresh from 0.00s unless reduced motion */
  isReplay?: boolean;
}

const FALLBACK_ANCHORS: ProjectedAnchorsMap = {
  properties: { x: 38, y: 63, visible: true },
  tenants: { x: 29, y: 51, visible: true },
  payments: { x: 67, y: 48, visible: true },
};

export const CinematicWelcomeExperience: React.FC<CinematicWelcomeExperienceProps> = ({
  onEnterApp,
  onStartCleanWorkspace,
  onOpenWorkspaceSetup,
  onOpenRoleSwitch,
  isReplay = false,
}) => {
  const { languageCode, currentLanguage, setLanguage } = useLanguagePreference();
  const strings = CINEMATIC_WELCOME_I18N[languageCode] || CINEMATIC_WELCOME_I18N.en;

  const reducedMotion = useMemo(() => prefersReducedMotion(), []);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  );
  const [webglFailed, setWebglFailed] = useState(false);
  const [skipToSettled, setSkipToSettled] = useState<boolean>(reducedMotion);
  const [replayNonce, setReplayNonce] = useState(0);
  const [elapsedSec, setElapsedSec] = useState<number>(reducedMotion ? 4.8 : 0);
  const [settled, setSettled] = useState<boolean>(reducedMotion);
  const [activePillar, setActivePillar] = useState<PillarId | null>(null);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  // Direct DOM refs for 3D-projected pillar buttons (zero per-frame React re-renders)
  const beaconRefs = useRef<Record<PillarId, HTMLButtonElement | null>>({
    properties: null,
    tenants: null,
    payments: null,
  });

  // Sync with live document theme changes
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const syncTheme = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    syncTheme();
    const observer = new MutationObserver(syncTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => observer.disconnect();
  }, []);

  // Lock body scroll while full-screen welcome experience is active
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  // Keyboard accessibility: Escape closes menu or skips intro
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (langMenuOpen) {
          setLangMenuOpen(false);
        } else if (!settled) {
          setSkipToSettled(true);
          setElapsedSec(4.8);
          setSettled(true);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [langMenuOpen, settled]);

  const handleProgress = useCallback((tSec: number, isNowSettled: boolean) => {
    setElapsedSec(tSec);
    if (isNowSettled) {
      setSettled(true);
    }
  }, []);

  const handleProjectAnchors = useCallback((anchors: ProjectedAnchorsMap) => {
    (['properties', 'tenants', 'payments'] as PillarId[]).forEach((id) => {
      const btn = beaconRefs.current[id];
      const pt = anchors[id];
      if (!btn || !pt) return;
      const clampedX = Math.max(12, Math.min(88, pt.x));
      const clampedY = Math.max(36, Math.min(76, pt.y));
      btn.style.left = `${clampedX}%`;
      btn.style.top = `${clampedY}%`;
    });
  }, []);

  const handleWebGLError = useCallback(() => {
    setWebglFailed(true);
    setSkipToSettled(true);
    setElapsedSec(4.8);
    setSettled(true);
  }, []);

  const handleSkip = () => {
    setSkipToSettled(true);
    setElapsedSec(4.8);
    setSettled(true);
  };

  const handleReplay = () => {
    if (reducedMotion || webglFailed) return;
    setActivePillar(null);
    setLangMenuOpen(false);
    setSkipToSettled(false);
    setElapsedSec(0);
    setSettled(false);
    setReplayNonce((n) => n + 1);
  };

  const handleCompletePrimary = () => {
    markCinematicIntroSeen();
    onEnterApp();
  };

  const handleCompleteCleanStart = () => {
    markCinematicIntroSeen();
    if (onStartCleanWorkspace) {
      onStartCleanWorkspace();
    } else {
      onOpenWorkspaceSetup();
    }
  };

  const handleCompleteWorkspace = () => {
    markCinematicIntroSeen();
    onOpenWorkspaceSetup();
  };

  const handleCompleteRole = () => {
    markCinematicIntroSeen();
    onOpenRoleSwitch();
  };

  // Show language selector, Skip, brand lockup, and primary CTAs swiftly (~0.35s) so users are never trapped waiting 4+ seconds
  const showSkip = !settled && elapsedSec >= 0.2;
  const showBrandReveal = settled || elapsedSec >= 0.3;
  const showControls = settled || elapsedSec >= 0.35;

  const pillarConfigs: {
    id: PillarId;
    appearAt: number;
    icon: React.ReactNode;
    label: string;
    preview: string;
  }[] = [
    {
      id: 'properties',
      appearAt: 2.55,
      icon: <Home className="w-4 h-4" />,
      label: strings.pillars.properties.label,
      preview: strings.pillars.properties.preview,
    },
    {
      id: 'tenants',
      appearAt: 2.9,
      icon: <Users className="w-4 h-4" />,
      label: strings.pillars.tenants.label,
      preview: strings.pillars.tenants.preview,
    },
    {
      id: 'payments',
      appearAt: 3.25,
      icon: <Wallet className="w-4 h-4" />,
      label: strings.pillars.payments.label,
      preview: strings.pillars.payments.preview,
    },
  ];

  const activePillarData = pillarConfigs.find((p) => p.id === activePillar) || null;
  const useStaticFallback = reducedMotion || webglFailed;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={strings.dioramaAria}
      className={`fixed inset-0 z-[90] w-full h-[100dvh] overflow-hidden select-none ${
        isDark ? 'bg-[#050811] text-[#FFFFFF]' : 'bg-[#F4F8FE] text-[#0B1B3B]'
      }`}
    >
      {/* Layer 1: Full-Viewport 3D A1+A5 Miniature Diorama (or Reduced-Motion / Non-WebGL SVG Fallback) */}
      <div className="absolute inset-0 z-0">
        {useStaticFallback ? (
          <DioramaSvgFallback isDark={isDark} />
        ) : (
          <Suspense fallback={<DioramaSvgFallback isDark={isDark} />}>
            <LazyAkaraiDioramaScene
              isDark={isDark}
              skipToSettled={skipToSettled}
              replayNonce={replayNonce}
              activePillar={activePillar}
              onProgress={handleProgress}
              onProjectAnchors={handleProjectAnchors}
              onWebGLError={handleWebGLError}
            />
          </Suspense>
        )}
      </div>

      {/* Subtle Top & Bottom Atmospheric Legibility Scrims (zero backdrop-filter over WebGL) */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[42%] z-[5]"
        style={{
          background: isDark
            ? 'linear-gradient(to bottom, rgba(5,8,17,0.88) 0%, rgba(5,8,17,0.52) 55%, rgba(5,8,17,0) 100%)'
            : 'linear-gradient(to bottom, rgba(244,248,254,0.92) 0%, rgba(244,248,254,0.56) 55%, rgba(244,248,254,0) 100%)',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-[32%] z-[5]"
        style={{
          background: isDark
            ? 'linear-gradient(to top, rgba(5,8,17,0.94) 0%, rgba(5,8,17,0.62) 55%, rgba(5,8,17,0) 100%)'
            : 'linear-gradient(to top, rgba(244,248,254,0.96) 0%, rgba(244,248,254,0.64) 55%, rgba(244,248,254,0) 100%)',
        }}
      />

      {/* Layer 2: 3D-Anchored Interactive Pillar Beacons (Emerge in cadence during A5 crane ascent -> interactive in B1) */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {pillarConfigs.map((pillar) => {
          const isVisible = settled || elapsedSec >= pillar.appearAt;
          const isSelected = activePillar === pillar.id;
          const fallbackPos = FALLBACK_ANCHORS[pillar.id];

          return (
            <button
              key={pillar.id}
              ref={(el) => {
                beaconRefs.current[pillar.id] = el;
              }}
              type="button"
              disabled={!settled}
              onClick={() =>
                setActivePillar((prev) => (prev === pillar.id ? null : pillar.id))
              }
              aria-pressed={isSelected}
              aria-label={pillar.label}
              style={{
                left: `${fallbackPos.x}%`,
                top: `${fallbackPos.y}%`,
                transform: 'translate(-50%, -50%)',
                opacity: isVisible ? 1 : 0,
              }}
              className={`absolute transition-opacity duration-500 ${
                settled ? 'pointer-events-auto cursor-pointer' : 'pointer-events-none'
              } min-h-[44px] min-w-[44px] flex items-center justify-center group focus:outline-none`}
            >
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold tracking-tight border shadow-md transition-transform duration-200 ${
                  isSelected
                    ? 'bg-[#0145F2] text-white border-[#3B8DFF] scale-105'
                    : isDark
                      ? 'bg-[#0E1729]/95 text-[#E8F1FF] border-[#2954B8]/80 group-hover:border-[#3B8DFF] group-hover:scale-105'
                      : 'bg-[#FFFFFF]/95 text-[#0B1B3B] border-[#C6DBFC] group-hover:border-[#0145F2] group-hover:scale-105'
                }`}
              >
                <span
                  className={
                    isSelected ? 'text-white' : 'text-[#0145F2] dark:text-[#66A3FF]'
                  }
                >
                  {pillar.icon}
                </span>
                <span>{pillar.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Layer 3: Semantic Top Bar (6-Language Switcher + Skip / Replay) */}
      <header className="relative z-20 w-full max-w-5xl mx-auto px-4 sm:px-6 pt-[max(14px,env(safe-area-inset-top))] flex items-center justify-between gap-2">
        {/* Left: 6-Language Switcher (appears smoothly as B1 arrives) */}
        <div className="relative">
          <AnimatePresence>
            {showControls && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35 }}
              >
                <button
                  type="button"
                  onClick={() => setLangMenuOpen((v) => !v)}
                  aria-expanded={langMenuOpen}
                  aria-label={strings.languageSelectorAria}
                  className={`min-h-[44px] px-3.5 py-2 rounded-full border text-[12.5px] font-semibold inline-flex items-center gap-2 transition-colors ${
                    isDark
                      ? 'bg-[#101829]/95 border-[#253657] text-[#EEF4FF] hover:border-[#3B8DFF]'
                      : 'bg-[#FFFFFF]/95 border-[#D6E2F5] text-[#0B1B3B] hover:border-[#0145F2]'
                  }`}
                >
                  <Globe className="w-4 h-4 text-[#0145F2] dark:text-[#66A3FF]" />
                  <span>{currentLanguage.nativeName}</span>
                  <ChevronDown className="w-3.5 h-3.5 opacity-70" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 6-Language Selector Popover */}
          <AnimatePresence>
            {langMenuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.97 }}
                transition={{ duration: 0.18 }}
                className={`absolute left-0 mt-2 w-[236px] rounded-[20px] border p-1.5 shadow-xl z-40 ${
                  isDark
                    ? 'bg-[#11192B] border-[#253657] text-white'
                    : 'bg-[#FFFFFF] border-[#D6E2F5] text-[#0B1B3B]'
                }`}
              >
                {SUPPORTED_LANGUAGES.map((lang) => {
                  const selected = lang.code === languageCode;
                  return (
                    <button
                      key={lang.code}
                      type="button"
                      onClick={() => {
                        setLanguage(lang.code);
                        setLangMenuOpen(false);
                      }}
                      className={`w-full min-h-[44px] px-3 py-2 rounded-[14px] text-left flex items-center justify-between gap-2 text-[13px] transition-colors ${
                        selected
                          ? 'bg-[#0145F2] text-white font-semibold'
                          : isDark
                            ? 'hover:bg-[#1A2540] text-[#E5ECF7]'
                            : 'hover:bg-[#EFF5FF] text-[#111318]'
                      }`}
                    >
                      <span className="truncate">{lang.nativeName}</span>
                      <span
                        className={`text-[11px] font-mono ${
                          selected
                            ? 'text-white/85'
                            : isDark
                              ? 'text-[#8E9BB2]'
                              : 'text-[#626A78]'
                        }`}
                      >
                        {lang.shortBadge}
                      </span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right: Skip (during cinematic flight) or Replay (once settled in B1) */}
        <div className="flex items-center gap-2">
          {showSkip && (
            <button
              type="button"
              onClick={handleSkip}
              aria-label={strings.skipAria}
              className={`min-h-[44px] px-4 py-2 rounded-full border text-[13px] font-semibold transition-colors ${
                isDark
                  ? 'bg-[#101829]/95 border-[#253657] text-[#E5ECF7] hover:border-[#3B8DFF]'
                  : 'bg-[#FFFFFF]/95 border-[#D6E2F5] text-[#0B1B3B] hover:border-[#0145F2]'
              }`}
            >
              {strings.skipBtn}
            </button>
          )}

          {settled && !useStaticFallback && (
            <button
              type="button"
              onClick={handleReplay}
              aria-label={strings.replayAria}
              className={`min-h-[44px] px-3.5 py-2 rounded-full border text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors ${
                isDark
                  ? 'bg-[#101829]/95 border-[#253657] text-[#C8D5EC] hover:text-white hover:border-[#3B8DFF]'
                  : 'bg-[#FFFFFF]/95 border-[#D6E2F5] text-[#46536A] hover:text-[#0145F2] hover:border-[#0145F2]'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>{strings.replayBtn}</span>
            </button>
          )}
        </div>
      </header>

      {/* Layer 4: Official Akarai Brand Lockup (Reveals cleanly in upper-center third at 3.72s) */}
      <div className="pointer-events-none relative z-20 flex flex-col items-center text-center px-5 mt-2 sm:mt-4">
        <AnimatePresence>
          {showBrandReveal && (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 14, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-center"
            >
              {/* Official Akarai App Mark (preserved verbatim — white rounded square + blue house + አካራይ + arc) */}
              <div
                className={`w-[72px] h-[72px] sm:w-[82px] sm:h-[82px] rounded-[20px] p-1 bg-[#FFFFFF] border shadow-lg flex items-center justify-center ${
                  isDark
                    ? 'border-[#2B4B8C]/70 shadow-[#0145F2]/20'
                    : 'border-[#DCE6F7] shadow-[#0145F2]/12'
                }`}
              >
                <img
                  src={resolveAssetUrl('akarai-icon-1024.png')}
                  alt="Akarai — አካራይ"
                  className="w-full h-full object-contain rounded-[16px]"
                />
              </div>

              <h1
                className={`mt-3 text-[28px] sm:text-[34px] font-extrabold tracking-[0.06em] leading-none ${
                  isDark ? 'text-[#FFFFFF]' : 'text-[#0B1B3B]'
                }`}
              >
                AKARAI
              </h1>
              <p
                className={`mt-1.5 text-[13.5px] sm:text-[15px] font-semibold tracking-tight ${
                  isDark ? 'text-[#9CB8E8]' : 'text-[#2D4775]'
                }`}
              >
                {strings.brandTagline}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Layer 5: Bottom Thumb-Zone Action Bar + Contextual B1 Pillar Preview Card */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 px-4 sm:px-6 pb-[max(20px,env(safe-area-inset-bottom))] flex flex-col items-center">
        <div className="w-full max-w-[400px] flex flex-col items-center gap-2.5">
          {/* Selected B1 Architectural Pillar Preview Card */}
          <AnimatePresence mode="wait">
            {settled && activePillarData && (
              <motion.div
                key={activePillarData.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.2 }}
                className={`pointer-events-auto w-full rounded-[18px] border px-4 py-3 text-left shadow-md ${
                  isDark
                    ? 'bg-[#101829]/95 border-[#28457D] text-[#E8F1FF]'
                    : 'bg-[#FFFFFF]/95 border-[#C9DCFA] text-[#0B1B3B]'
                }`}
              >
                <div className="flex items-center gap-2 text-[12.5px] font-bold text-[#0145F2] dark:text-[#78B0FF]">
                  {activePillarData.icon}
                  <span>{activePillarData.label}</span>
                </div>
                <p
                  className={`mt-1 text-[12.5px] leading-snug ${
                    isDark ? 'text-[#C8D5EC]' : 'text-[#42526E]'
                  }`}
                >
                  {activePillarData.preview}
                </p>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Subtle interaction hint when settled and no pillar selected yet */}
          {settled && !activePillarData && !useStaticFallback && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.45, delay: 0.15 }}
              className={`text-[11.5px] font-medium text-center ${
                isDark ? 'text-[#8EA4C8]' : 'text-[#556582]'
              }`}
            >
              {strings.tapToExploreHint}
            </motion.p>
          )}

          {/* Primary CTA + Calm Secondary Actions */}
          <AnimatePresence>
            {showControls && (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.48, ease: [0.22, 1, 0.36, 1] }}
                className="pointer-events-auto w-full flex flex-col items-center gap-2"
              >
                <button
                  type="button"
                  onClick={handleCompletePrimary}
                  className="w-full min-h-[52px] px-6 py-3 rounded-full bg-[#0145F2] hover:bg-[#0039CC] active:scale-[0.98] text-white text-[15.5px] font-bold shadow-lg shadow-[#0145F2]/25 inline-flex items-center justify-center gap-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-[#0145F2]"
                >
                  <span>{strings.getStartedBtn}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>

                {onStartCleanWorkspace && (
                  <button
                    type="button"
                    onClick={handleCompleteCleanStart}
                    className={`w-full min-h-[46px] px-5 py-2.5 rounded-full border text-[13.5px] font-semibold inline-flex items-center justify-center gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] ${
                      isDark
                        ? 'bg-[#101829]/95 border-[#2A3F6B] text-[#EEF4FF] hover:border-[#3B8DFF]'
                        : 'bg-[#FFFFFF]/95 border-[#C6DBFC] text-[#0B1B3B] hover:border-[#0145F2]'
                    }`}
                  >
                    <span>Start My Own Portfolio (Empty)</span>
                  </button>
                )}

                <div className="w-full flex items-center justify-center gap-4 pt-0.5">
                  <button
                    type="button"
                    onClick={handleCompleteWorkspace}
                    className={`min-h-[44px] px-3 py-1.5 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] ${
                      isDark
                        ? 'text-[#B5C8E8] hover:text-white'
                        : 'text-[#394B68] hover:text-[#0145F2]'
                    }`}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>{strings.setupWorkspaceBtn}</span>
                  </button>

                  <span
                    aria-hidden="true"
                    className={`h-3.5 w-[1px] ${
                      isDark ? 'bg-[#283652]' : 'bg-[#CBD6E8]'
                    }`}
                  />

                  <button
                    type="button"
                    onClick={handleCompleteRole}
                    className={`min-h-[44px] px-3 py-1.5 rounded-full text-[12.5px] font-semibold inline-flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0145F2] ${
                      isDark
                        ? 'text-[#B5C8E8] hover:text-white'
                        : 'text-[#394B68] hover:text-[#0145F2]'
                    }`}
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>{strings.rolePreviewBtn}</span>
                  </button>
                </div>

                {isReplay && <span className="sr-only">Replay mode active</span>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
