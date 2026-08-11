'use client';

import React, { createContext, ReactNode, useCallback, useEffect, useState } from 'react';

export type FontScale = 90 | 100 | 112.5 | 125;

interface SettingsContextType {
  animate: boolean;
  setAnimate: (animate: boolean) => void;
  triggerAnimation: () => void;
  fontScale: FontScale;
  setFontScale: (fontScale: FontScale) => void;
  highContrast: boolean;
  setHighContrast: (highContrast: boolean) => void;
}

export const SettingsContext = createContext<SettingsContextType>({
  animate: false,
  setAnimate: () => {},
  triggerAnimation: () => {},
  fontScale: 100,
  setFontScale: () => {},
  highContrast: false,
  setHighContrast: () => {},
});

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [animate, setAnimate] = useState(false);
  const [fontScale, setFontScale] = useState<FontScale>(100);
  const [highContrast, setHighContrast] = useState(false);

  useEffect(() => {
    const savedScale = Number(localStorage.getItem('clarift-font-scale'));
    if (savedScale === 90 || savedScale === 100 || savedScale === 112.5 || savedScale === 125) {
      setFontScale(savedScale);
    }
    setHighContrast(localStorage.getItem('clarift-high-contrast') === 'true');
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--clarift-font-scale', `${fontScale / 100}`);
    localStorage.setItem('clarift-font-scale', String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.classList.toggle('high-contrast', highContrast);
    localStorage.setItem('clarift-high-contrast', String(highContrast));
  }, [highContrast]);

  const triggerAnimation = useCallback(() => {
    setAnimate(true);
  }, []);

  return (
    <SettingsContext.Provider value={{
      animate,
      setAnimate,
      triggerAnimation,
      fontScale,
      setFontScale,
      highContrast,
      setHighContrast,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}
