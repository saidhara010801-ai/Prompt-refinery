'use client';

import React, { createContext, ReactNode, useCallback, useState } from 'react';

interface SettingsContextType {
  animate: boolean;
  setAnimate: (animate: boolean) => void;
  triggerAnimation: () => void;
}

export const SettingsContext = createContext<SettingsContextType>({
  animate: false,
  setAnimate: () => {},
  triggerAnimation: () => {},
});

interface SettingsProviderProps {
  children: ReactNode;
}

export function SettingsProvider({ children }: SettingsProviderProps) {
  const [animate, setAnimate] = useState(false);

  const triggerAnimation = useCallback(() => {
    setAnimate(true);
  }, []);

  return (
    <SettingsContext.Provider value={{ animate, setAnimate, triggerAnimation }}>
      {children}
    </SettingsContext.Provider>
  );
}
