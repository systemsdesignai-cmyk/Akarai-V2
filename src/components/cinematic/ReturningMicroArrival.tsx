import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useLanguagePreference } from '../DesignSystem';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { CINEMATIC_WELCOME_I18N } from './welcomeI18n';
import { markArrivedThisSession } from './launchState';

interface ReturningMicroArrivalProps {
  onComplete: () => void;
}

/**
 * Crisp ~0.65s branded returning-user micro-arrival (Option B).
 * Runs only on cold browser/PWA launches for returning users, never on
 * background resume or route changes, and never blocks workflow.
 */
export const ReturningMicroArrival: React.FC<ReturningMicroArrivalProps> = ({
  onComplete,
}) => {
  const { languageCode } = useLanguagePreference();
  const strings = CINEMATIC_WELCOME_I18N[languageCode] || CINEMATIC_WELCOME_I18N.en;
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    markArrivedThisSession();
    const fadeTimer = window.setTimeout(() => setVisible(false), 430);
    const doneTimer = window.setTimeout(() => onComplete(), 660);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onComplete]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          aria-hidden="true"
          className="fixed inset-0 z-[85] pointer-events-none flex flex-col items-center justify-center bg-[#F4F8FE] dark:bg-[#050811]"
        >
          {/* Subtle A1 blueprint hairline horizon accent */}
          <div
            className="absolute inset-0 opacity-30 dark:opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(1,69,242,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(1,69,242,0.14) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
              maskImage: 'radial-gradient(circle at 50% 50%, black 12%, transparent 68%)',
              WebkitMaskImage:
                'radial-gradient(circle at 50% 50%, black 12%, transparent 68%)',
            }}
          />

          <motion.div
            initial={{ opacity: 0.65, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="relative flex flex-col items-center"
          >
            <div className="w-[74px] h-[74px] rounded-[20px] p-1 bg-[#FFFFFF] border border-[#DCE6F7] dark:border-[#243B70] shadow-lg flex items-center justify-center">
              <img
                src={resolveAssetUrl('akarai-icon-1024.png')}
                alt="Akarai"
                className="w-full h-full object-contain rounded-[16px]"
              />
            </div>
            <div className="mt-3 text-[20px] font-extrabold tracking-[0.07em] text-[#0B1B3B] dark:text-[#FFFFFF]">
              AKARAI
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-[#465A7E] dark:text-[#9CB8E8]">
              {strings.returningSubtitle}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
