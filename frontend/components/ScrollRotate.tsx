
import React, { useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface ScrollRotateProps {
  /** Single fallback image, used for the swing/tilt effect. */
  image: string;
  /** Optional turntable frame set - when length > 1, swaps frames by scroll progress instead of tilting. */
  frames?: string[];
  alt: string;
}

/**
 * ScrollRotate - scroll-driven product presentation, GSAP + ScrollTrigger powered.
 *
 * With a single `image` (today's placeholder/stock photography), a full CSS
 * rotateY 360 spin would go edge-on and disappear at 90/270deg, so instead this
 * plays a tasteful swing/tilt (~-22deg to +22deg) with a subtle scale bump at the
 * midpoint, driven by a scrubbed GSAP timeline tied to how far the component has
 * scrolled through the viewport - no manual per-frame transform math.
 *
 * When a real turntable `frames` set (length > 1) is supplied, it branches to a
 * genuinely different mode: the visible frame index is picked directly from
 * ScrollTrigger's `onUpdate` progress callback - the future-proofing path for real
 * 360 product photography.
 */
const ScrollRotate: React.FC<ScrollRotateProps> = ({ image, frames, alt }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [frameIdx, setFrameIdx] = useState(0);
  const [reducedMotion] = useState(prefersReducedMotion);

  const hasFrames = Array.isArray(frames) && frames.length > 1;

  useEffect(() => {
    if (reducedMotion) return;
    const node = containerRef.current;
    if (!node) return;

    if (hasFrames) {
      const trigger = ScrollTrigger.create({
        trigger: node,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
        onUpdate: (self) => {
          const idx = Math.min(frames!.length - 1, Math.floor(self.progress * frames!.length));
          setFrameIdx(idx);
        },
      });
      return () => trigger.kill();
    }

    const imgEl = imgRef.current;
    if (!imgEl) return;

    // Two chained tweens (-22deg -> 0 -> +22deg) sweep the full swing linearly
    // over the whole scroll trip, while scale ramps 0.94 -> 1 -> 0.94 to sell a
    // bit of depth at the midpoint - a scrubbed-timeline equivalent of the old
    // sine-based scale bump.
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: node,
        start: 'top bottom',
        end: 'bottom top',
        scrub: 1,
      },
    });
    tl.fromTo(
      imgEl,
      { rotateY: -22, scale: 0.94, transformPerspective: 1000 },
      { rotateY: 0, scale: 1, ease: 'none' }
    ).to(imgEl, { rotateY: 22, scale: 0.94, ease: 'none' });

    return () => {
      tl.scrollTrigger?.kill();
      tl.kill();
    };
  }, [reducedMotion, hasFrames, frames]);

  if (hasFrames) {
    const idx = reducedMotion ? 0 : frameIdx;
    return (
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        <img src={frames![idx]} alt={alt} className="max-w-full max-h-full object-contain" />
      </div>
    );
  }

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center" style={{ perspective: '1000px' }}>
      <img
        ref={imgRef}
        src={image}
        alt={alt}
        className="max-w-full max-h-full object-contain will-change-transform drop-shadow-[0_24px_28px_rgba(29,43,73,0.35)]"
      />
    </div>
  );
};

export default ScrollRotate;
