import React from 'react';

interface DioramaSvgFallbackProps {
  isDark: boolean;
  className?: string;
}

/**
 * High-key architectural isometric diorama fallback rendered when WebGL is
 * unavailable, context is lost, prefers-reduced-motion is enabled, or while
 * the lazy Three.js chunk finishes hydrating (zero blank flash).
 */
export const DioramaSvgFallback: React.FC<DioramaSvgFallbackProps> = ({
  isDark,
  className = '',
}) => {
  const bgTop = isDark ? '#050811' : '#F6F9FE';
  const bgBottom = isDark ? '#0B1222' : '#EDF2FA';
  const gridStroke = isDark ? 'rgba(59, 130, 246, 0.22)' : 'rgba(1, 69, 242, 0.14)';
  const platformTop = isDark ? '#141C2B' : '#FFFFFF';
  const platformSide = isDark ? '#0D1524' : '#DCE7FA';
  const wallLight = isDark ? '#E2EAF7' : '#FFFFFF';
  const wallShade = isDark ? '#BCCAE2' : '#E2EAF6';
  const roofLight = '#1E6BFF';
  const roofDark = '#0145F2';
  const windowGlow = '#FFD57A';

  return (
    <div
      className={`w-full h-full flex items-center justify-center overflow-hidden select-none ${className}`}
      style={{
        background: `radial-gradient(circle at 50% 34%, ${bgTop} 0%, ${bgBottom} 100%)`,
      }}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 640 520"
        className="w-full h-full max-w-[760px] object-contain translate-y-[7%]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <filter id="akaraiGlow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="islandShadow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0145F2" stopOpacity={isDark ? '0.32' : '0.20'} />
            <stop offset="70%" stopColor="#0145F2" stopOpacity={isDark ? '0.08' : '0.05'} />
            <stop offset="100%" stopColor="#0145F2" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Perspective A1 Blueprint Grid */}
        <g stroke={gridStroke} strokeWidth="1">
          <path d="M40 365 L320 225 L600 365 L320 505 Z" />
          <path d="M110 330 L390 470" />
          <path d="M180 295 L460 435" />
          <path d="M250 260 L530 400" />
          <path d="M530 330 L250 470" />
          <path d="M460 295 L180 435" />
          <path d="M390 260 L110 400" />
        </g>

        {/* Grounding Contact Glow */}
        <ellipse cx="320" cy="396" rx="228" ry="74" fill="url(#islandShadow)" />

        {/* Rounded Isometric Estate Platform */}
        <path
          d="M124 358 Q106 348 124 338 L302 248 Q320 239 338 248 L516 338 Q534 348 516 358 L338 448 Q320 457 302 448 Z"
          fill={platformSide}
          stroke="#0145F2"
          strokeOpacity="0.45"
          strokeWidth="2.5"
        />
        <path
          d="M124 347 Q106 337 124 327 L302 237 Q320 228 338 237 L516 327 Q534 337 516 347 L338 437 Q320 446 302 437 Z"
          fill={platformTop}
          stroke="#2E7BFF"
          strokeWidth="2.2"
          filter="url(#akaraiGlow)"
        />

        {/* Flowing Electric-Blue Ledger Pathways */}
        <g stroke="#0145F2" strokeLinecap="round" filter="url(#akaraiGlow)">
          <path d="M210 382 L320 326 L432 380" strokeWidth="4.5" strokeOpacity="0.88" />
          <path d="M320 326 L385 292" strokeWidth="4" strokeOpacity="0.85" />
          <path d="M242 308 L320 348" strokeWidth="3.5" strokeOpacity="0.72" />
        </g>
        <g stroke="#8BC4FF" strokeLinecap="round">
          <path d="M210 382 L320 326 L432 380" strokeWidth="1.6" />
          <path d="M320 326 L385 292" strokeWidth="1.5" />
        </g>

        {/* Multi-Story Residential Apartment Complex (Back-Right) */}
        <g>
          <polygon points="365,204 426,234 426,312 365,282" fill={wallShade} />
          <polygon points="426,234 476,208 476,286 426,312" fill={wallLight} />
          <polygon points="365,204 415,178 476,208 426,234" fill={roofLight} />
          <polygon points="374,204 415,183 467,208 426,229" fill={wallLight} opacity="0.9" />
          {/* Warm glowing apartment windows */}
          {[0, 1, 2].map((row) => (
            <React.Fragment key={row}>
              <rect
                x={379}
                y={222 + row * 22}
                width="12"
                height="13"
                rx="1.5"
                fill={windowGlow}
                transform={`skewY(26) translate(0, ${-379 * 0.487})`}
              />
              <rect
                x={401}
                y={233 + row * 22}
                width="12"
                height="13"
                rx="1.5"
                fill={windowGlow}
                transform={`skewY(26) translate(0, ${-401 * 0.487})`}
              />
              <polygon
                points={`438,${242 + row * 22} 450,${236 + row * 22} 450,${249 + row * 22} 438,${255 + row * 22}`}
                fill={windowGlow}
              />
              <polygon
                points={`457,${232 + row * 22} 468,${226 + row * 22} 468,${239 + row * 22} 457,${245 + row * 22}`}
                fill={windowGlow}
              />
            </React.Fragment>
          ))}
        </g>

        {/* Back-Left Cottage */}
        <g>
          <polygon points="212,262 256,284 256,314 212,292" fill={wallShade} />
          <polygon points="256,284 294,264 294,294 256,314" fill={wallLight} />
          <polygon points="205,264 256,240 264,286 205,264" fill={roofDark} />
          <polygon points="256,240 300,262 256,286" fill={roofLight} />
          <polygon points="266,284 282,276 282,292 266,300" fill={windowGlow} />
        </g>

        {/* Hero Foreground Gabled Home (Left-Center) */}
        <g>
          <polygon points="236,332 294,362 294,404 236,374" fill={wallShade} />
          <polygon points="294,362 346,336 346,378 294,404" fill={wallLight} />
          <polygon points="228,334 294,300 294,365" fill={roofDark} />
          <polygon points="294,300 354,334 294,365" fill={roofLight} />
          {/* Chimney */}
          <polygon points="315,302 325,307 325,322 315,317" fill="#0145F2" />
          {/* Warm lit windows & door */}
          <polygon points="250,352 268,361 268,382 250,373" fill={windowGlow} />
          <polygon points="306,368 320,361 320,388 306,395" fill="#172544" />
          <polygon points="325,358 338,351 338,368 325,375" fill={windowGlow} />
        </g>

        {/* Right Foreground Cottage */}
        <g>
          <polygon points="372,334 422,360 422,394 372,368" fill={wallShade} />
          <polygon points="422,360 462,339 462,373 422,394" fill={wallLight} />
          <polygon points="365,336 418,308 422,362" fill={roofDark} />
          <polygon points="418,308 468,338 422,362" fill={roofLight} />
          <polygon points="384,350 400,358 400,376 384,368" fill={windowGlow} />
        </g>

        {/* Stylized Courtyard Trees */}
        {[
          { cx: 196, cy: 332, r: 16 },
          { cx: 336, cy: 268, r: 15 },
          { cx: 486, cy: 318, r: 14 },
          { cx: 356, cy: 392, r: 12 },
        ].map((tree, idx) => (
          <g key={idx}>
            <rect x={tree.cx - 2} y={tree.cy + 8} width="4" height="14" rx="1.5" fill="#6D4C3D" />
            <circle cx={tree.cx} cy={tree.cy} r={tree.r} fill="#2E7D32" />
            <circle cx={tree.cx - 4} cy={tree.cy - 4} r={tree.r * 0.65} fill="#4CAF50" />
          </g>
        ))}
      </svg>
    </div>
  );
};
