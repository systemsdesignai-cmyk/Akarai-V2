const INTRO_SEEN_KEY = 'akarai_cinematic_intro_seen_v1';
const SESSION_ARRIVED_KEY = 'akarai_session_arrived_v1';

export type LaunchExperienceMode = 'first_launch' | 'returning_micro' | 'none';

export function hasSeenCinematicIntro(): boolean {
  try {
    return localStorage.getItem(INTRO_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markCinematicIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
    sessionStorage.setItem(SESSION_ARRIVED_KEY, '1');
  } catch {
    // ignore private-browsing storage restrictions
  }
}

export function hasArrivedThisSession(): boolean {
  try {
    return sessionStorage.getItem(SESSION_ARRIVED_KEY) === '1';
  } catch {
    return false;
  }
}

export function markArrivedThisSession(): void {
  try {
    sessionStorage.setItem(SESSION_ARRIVED_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function resolveInitialLaunchMode(pathname: string): LaunchExperienceMode {
  // Never hijack explicit sub-routes (e.g. direct deep links to /properties or /welcome)
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const isHomeEntry = normalized === '/' || normalized === '/dashboard';
  if (!isHomeEntry) {
    return 'none';
  }

  if (!hasSeenCinematicIntro()) {
    return 'first_launch';
  }

  if (prefersReducedMotion()) {
    markArrivedThisSession();
    return 'none';
  }

  if (!hasArrivedThisSession()) {
    return 'returning_micro';
  }

  return 'none';
}

export interface WebGLCapability {
  supported: boolean;
  isSoftwareGl: boolean;
}

export function probeWebGLCapability(): WebGLCapability {
  if (typeof document === 'undefined') {
    return { supported: false, isSoftwareGl: true };
  }
  try {
    const canvas = document.createElement('canvas');
    const gl =
      (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ||
      (canvas.getContext('webgl') as WebGLRenderingContext | null);
    if (!gl) {
      return { supported: false, isSoftwareGl: true };
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param) || '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    const isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    return { supported: true, isSoftwareGl };
  } catch {
    return { supported: false, isSoftwareGl: true };
  }
}
