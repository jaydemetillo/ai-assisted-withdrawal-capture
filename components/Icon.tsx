import type { CSSProperties } from 'react';

/**
 * Every glyph is an SVG exported from the Pulse Figma file and committed under
 * public/icons. They render through <img> rather than being inlined so the exported
 * artwork stays byte-identical to the design.
 */
export type IconName =
  | 'ios-signal' | 'ios-wifi' | 'ios-battery' | 'menu' | 'transfer-alt' | 'cart'
  | 'error-solid' | 'warning-solid' | 'chevron-right' | 'home-alt' | 'history'
  | 'scan' | 'shopping-bag' | 'help-circle' | 'left-arrow-alt' | 'scan-line'
  | 'qr' | 'qr-scan' | 'camera' | 'file' | 'book-open' | 'layout' | 'sitemap'
  | 'user' | 'envelope-open' | 'cog' | 'link-external' | 'filter' | 'search';

export function Icon({
  name,
  size = 24,
  className = '',
  style,
  alt = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/icons/${name}.svg`}
      alt={alt}
      aria-hidden={alt === '' ? true : undefined}
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, ...style }}
    />
  );
}
