import React, { useMemo } from 'react';

interface Palette {
  bg: string;
  stroke: string;
  text: string;
  label: string;
}

const SOFT_PALETTES: Palette[] = [
  { bg: '#ebf2e8', stroke: '#7c9c77', text: '#2e482b', label: 'Sage' },
  { bg: '#eaf0f8', stroke: '#6f8faa', text: '#203a56', label: 'Slate' },
  { bg: '#faede0', stroke: '#b28e6c', text: '#543920', label: 'Sand' },
  { bg: '#f3eaf6', stroke: '#93749e', text: '#472951', label: 'Mauve' },
  { bg: '#faeae5', stroke: '#b57d70', text: '#5b2a20', label: 'Clay' },
  { bg: '#eef2e3', stroke: '#7f925e', text: '#34441b', label: 'Moss' },
  { bg: '#eaf4f3', stroke: '#699690', text: '#1d4641', label: 'Teal' },
  { bg: '#fbf2df', stroke: '#ae9054', text: '#513a11', label: 'Ochre' },
];

function paletteAt(index: number): Palette {
  const palette = SOFT_PALETTES[index];
  if (!palette) {
    throw new Error(`No thumbnail palette at index ${index}`);
  }
  return palette;
}

// 32-bit FNV-1a Hash
function hashString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 16777619) >>> 0;
  }
  return h;
}

// Seeded PRNG (Mulberry32)
function mulberry32(a: number) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface ThumbnailCoverProps {
  id: string;
  label: string;
  className?: string;
}

export const ThumbnailCover: React.FC<ThumbnailCoverProps> = React.memo(
  ({ id, label, className = '' }) => {
    const { palette, elements } = useMemo(() => {
      // Seed strictly based on the immutable canvas ID so renaming titles never alters the artwork
      const seed = hashString(id);
      const rand = mulberry32(seed);

      // 1. Pick Palette
      const pal = paletteAt(Math.floor(rand() * SOFT_PALETTES.length));

      // ViewBox dimensions: 320 x 160
      const w = 320;
      const h = 160;

      // 2. Select two distinct shapes: Shape 1 for Left Side, Shape 2 for Right Side
      // Shape types: 0 = circle, 1 = square, 2 = rectangle, 3 = triangle
      const leftShapeType = Math.floor(rand() * 4);
      const rightShapeType = (leftShapeType + 1 + Math.floor(rand() * 3)) % 4;

      // Left position: Top-Left (cy ~ 0) or Bottom-Left (cy ~ h)
      const leftIsTop = rand() > 0.5;
      const leftCx = -10 - rand() * 25; // Center is <= 0 (outside left boundary, ensures <= 50% visibility)
      const leftCy = leftIsTop ? -10 + rand() * 35 : h + 10 - rand() * 35;

      // Right position: Top-Right (cy ~ 0) or Bottom-Right (cy ~ h)
      const rightIsTop = rand() > 0.5;
      const rightCx = w + 10 + rand() * 25; // Center is >= w (outside right boundary, ensures <= 50% visibility)
      const rightCy = rightIsTop ? -10 + rand() * 35 : h + 10 - rand() * 35;

      const strokeColor = pal.stroke;
      const strokeWidth = '1.25';
      const fillOpacity = '0.035';

      // Helper to render a specific closed shape on Left or Right
      const renderShape = (
        side: 'left' | 'right',
        shapeType: number,
        cx: number,
        cy: number,
        key: string,
      ) => {
        switch (shapeType) {
          // 0: CIRCLE (Anchored arc, max 50% visible, single line)
          case 0: {
            const r1 = 95 + rand() * 45;
            return (
              <circle
                key={key}
                cx={cx}
                cy={cy}
                r={r1}
                fill={strokeColor}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity="0.8"
              />
            );
          }

          // 1: SQUARE (Rotated diamond/box anchored to boundary, max 50% visible)
          case 1: {
            const sideLen = 100 + rand() * 40;
            const angle = 20 + rand() * 50;
            const x = cx - sideLen / 2;
            const y = cy - sideLen / 2;
            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={sideLen}
                height={sideLen}
                fill={strokeColor}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity="0.8"
                transform={`rotate(${angle} ${cx} ${cy})`}
              />
            );
          }

          // 2: RECTANGLE (Angled architectural block, max 50% visible)
          case 2: {
            const rw = 125 + rand() * 45;
            const rh = 70 + rand() * 35;
            const angle = side === 'left' ? 15 + rand() * 45 : -15 - rand() * 45;
            const x = cx - rw / 2;
            const y = cy - rh / 2;
            return (
              <rect
                key={key}
                x={x}
                y={y}
                width={rw}
                height={rh}
                fill={strokeColor}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity="0.8"
                transform={`rotate(${angle} ${cx} ${cy})`}
              />
            );
          }

          // 3: TRIANGLE (Anchored 3-vertex polygon, max 50% visible)
          case 3:
          default: {
            const triRadius = 105 + rand() * 40;
            // Base angle so triangle points inward towards center of thumbnail
            const baseAngle = side === 'left' ? 0 : Math.PI;
            const angleJitter = (rand() - 0.5) * 0.5;
            const rot = baseAngle + angleJitter;

            const p0x = cx + triRadius * Math.cos(rot);
            const p0y = cy + triRadius * Math.sin(rot);

            const p1x = cx + triRadius * Math.cos(rot + (2 * Math.PI) / 3);
            const p1y = cy + triRadius * Math.sin(rot + (2 * Math.PI) / 3);

            const p2x = cx + triRadius * Math.cos(rot + (4 * Math.PI) / 3);
            const p2y = cy + triRadius * Math.sin(rot + (4 * Math.PI) / 3);

            const pointsStr = `${p0x.toFixed(1)},${p0y.toFixed(1)} ${p1x.toFixed(1)},${p1y.toFixed(1)} ${p2x.toFixed(1)},${p2y.toFixed(1)}`;

            return (
              <polygon
                key={key}
                points={pointsStr}
                fill={strokeColor}
                fillOpacity={fillOpacity}
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeOpacity="0.8"
              />
            );
          }
        }
      };

      const generatedElements = [
        renderShape('left', leftShapeType, leftCx, leftCy, 'left-shape'),
        renderShape('right', rightShapeType, rightCx, rightCy, 'right-shape'),
      ];

      return { palette: pal, elements: generatedElements };
    }, [id]);

    return (
      <div
        className={`h-38 sm:h-40 relative overflow-hidden flex items-center justify-center p-4 border-b border-border select-none ${className}`}
        style={{ backgroundColor: palette.bg }}
      >
        {/* Background SVG with corner shapes at various angles */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 320 160"
          preserveAspectRatio="xMidYMid slice"
          xmlns="http://www.w3.org/2000/svg"
        >
          {elements}
        </svg>

        {/* Center Label: Monospace tracked uppercase directly layered on cover */}
        <span
          className="relative z-10 font-mono text-[10px] sm:text-[11px] font-bold tracking-[0.22em] uppercase select-none text-center px-3 py-1 pointer-events-none truncate max-w-[90%]"
          style={{ color: palette.text }}
        >
          {label}
        </span>
      </div>
    );
  },
);
