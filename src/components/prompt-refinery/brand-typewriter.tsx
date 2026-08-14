'use client';

import { useEffect, useState } from 'react';

const headline = 'Clarify all the prompting Rifts and...';
const strengths = [
  'Turn raw ideas into precise instructions.',
  'Preserve context without the clutter.',
  'Build reliable prompts for any model.',
];

export function BrandTypewriter() {
  const [phraseIndex, setPhraseIndex] = useState(0);
  const [visibleLength, setVisibleLength] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const phrase = strengths[phraseIndex];

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReduceMotion(preference.matches);
    updatePreference();
    preference.addEventListener('change', updatePreference);
    return () => preference.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (reduceMotion) return;

    const atEnd = visibleLength === phrase.length;
    const atStart = visibleLength === 0;
    const delay = !isDeleting && atEnd ? 2_200 : isDeleting && atStart ? 500 : isDeleting ? 65 : 110;
    const timeout = window.setTimeout(() => {
      if (!isDeleting && atEnd) {
        setIsDeleting(true);
      } else if (isDeleting && atStart) {
        setIsDeleting(false);
        setPhraseIndex((current) => (current + 1) % strengths.length);
      } else {
        setVisibleLength((current) => current + (isDeleting ? -1 : 1));
      }
    }, delay);

    return () => window.clearTimeout(timeout);
  }, [isDeleting, phrase, reduceMotion, visibleLength]);

  const visiblePhrase = reduceMotion ? strengths[0] : phrase.slice(0, visibleLength);

  return (
    <div className="flex min-h-36 w-full max-w-4xl flex-col items-center justify-center gap-2 sm:min-h-32">
      <h1
        className="text-balance text-center text-2xl font-semibold leading-snug sm:text-3xl"
        aria-label={`${headline} ${phrase}`}
      >
        {headline}
      </h1>
      <p aria-hidden="true" className="min-h-7 text-balance text-center text-base font-medium text-primary sm:text-lg">
        {visiblePhrase}
        <span className="ml-1 inline-block h-[1em] w-px translate-y-0.5 animate-pulse bg-primary motion-reduce:hidden" />
      </p>
    </div>
  );
}
