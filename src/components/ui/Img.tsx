import type { ImgHTMLAttributes } from 'react';

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  /** Путь без расширения, напр. /images/hero — подставит .webp + .jpg fallback */
  base?: string;
  /** eager только для LCP (hero) */
  priority?: boolean;
};

/**
 * WebP + JPEG fallback, lazy по умолчанию.
 * Если base задан: /images/foo → webp + jpg.
 * Иначе — обычный src.
 */
export function Img({
  base,
  src,
  alt,
  priority = false,
  className,
  width,
  height,
  ...rest
}: Props) {
  const loading = priority ? 'eager' : 'lazy';
  const decoding = priority ? 'sync' : 'async';

  const imgProps = {
    alt: alt ?? '',
    className,
    width,
    height,
    loading: loading as 'eager' | 'lazy',
    decoding: decoding as 'sync' | 'async',
    draggable: false as const,
    ...rest,
  };

  if (base) {
    return (
      <picture>
        <source srcSet={`${base}.webp`} type="image/webp" />
        <img
          src={`${base}.jpg`}
          {...imgProps}
          {...(priority ? { fetchPriority: 'high' as const } : {})}
        />
      </picture>
    );
  }

  return (
    <img
      src={src}
      {...imgProps}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
    />
  );
}
