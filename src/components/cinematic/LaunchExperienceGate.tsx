import React, { useCallback, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { CinematicWelcomeExperience } from './CinematicWelcomeExperience';
import { ReturningMicroArrival } from './ReturningMicroArrival';
import { clearSampleDataToEmptyWorkspace } from '../../services/domainService';
import {
  type LaunchExperienceMode,
  resolveInitialLaunchMode,
} from './launchState';

/**
 * Isolated launch & /welcome gate mounted inside BrowserRouter.
 * Implements Option B launch frequency:
 * - First launch: Full A1+A5 cinematic intro -> B1 Living Isometric Portfolio Canvas
 * - Returning cold launch: Crisp ~0.65s branded micro-arrival (never on background resume)
 * - Manual replay: Navigating to /welcome replays the full experience anytime
 */
export const LaunchExperienceGate: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const [mode, setMode] = useState<LaunchExperienceMode>(() =>
    resolveInitialLaunchMode(location.pathname)
  );

  const isExplicitWelcomeRoute =
    location.pathname.replace(/\/+$/, '') === '/welcome';

  const handleEnterApp = useCallback(() => {
    setMode('none');
    if (isExplicitWelcomeRoute) {
      navigate('/', { replace: true });
    }
  }, [isExplicitWelcomeRoute, navigate]);

  const handleStartCleanWorkspace = useCallback(async () => {
    try {
      await clearSampleDataToEmptyWorkspace();
    } catch {
      // Fall back to entering app cleanly if DB write is unavailable
    }
    setMode('none');
    navigate('/', { replace: true });
  }, [navigate]);

  const handleOpenWorkspaceSetup = useCallback(() => {
    setMode('none');
    navigate('/onboarding');
  }, [navigate]);

  const handleOpenRoleSwitch = useCallback(() => {
    setMode('none');
    navigate('/account');
  }, [navigate]);

  const handleMicroComplete = useCallback(() => {
    setMode('none');
  }, []);

  if (isExplicitWelcomeRoute) {
    return (
      <CinematicWelcomeExperience
        isReplay
        onEnterApp={handleEnterApp}
        onStartCleanWorkspace={handleStartCleanWorkspace}
        onOpenWorkspaceSetup={handleOpenWorkspaceSetup}
        onOpenRoleSwitch={handleOpenRoleSwitch}
      />
    );
  }

  if (mode === 'first_launch') {
    return (
      <CinematicWelcomeExperience
        onEnterApp={handleEnterApp}
        onStartCleanWorkspace={handleStartCleanWorkspace}
        onOpenWorkspaceSetup={handleOpenWorkspaceSetup}
        onOpenRoleSwitch={handleOpenRoleSwitch}
      />
    );
  }

  if (mode === 'returning_micro') {
    return <ReturningMicroArrival onComplete={handleMicroComplete} />;
  }

  return null;
};
