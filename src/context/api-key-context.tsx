'use client';

import React, { createContext, useState, useEffect, ReactNode } from 'react';

export type AIProvider = 'gemini' | 'openrouter';

export interface OpenRouterModels {
  specifier: string;
  simplifier: string;
  stylist: string;
  critic: string;
  formatter: string;
}

export const DEFAULT_OPENROUTER_MODELS: OpenRouterModels = {
  specifier: 'openai/gpt-4o-mini',
  simplifier: 'anthropic/claude-3.5-haiku',
  stylist: 'google/gemini-2.0-flash-001',
  critic: 'anthropic/claude-3.5-haiku',
  formatter: 'openai/gpt-4o-mini',
};

interface ApiKeyContextType {
  apiKey: string;
  setApiKey: (key: string) => void;
  openRouterApiKey: string;
  setOpenRouterApiKey: (key: string) => void;
  aiProvider: AIProvider;
  setAiProvider: (provider: AIProvider) => void;
  openRouterModels: OpenRouterModels;
  setOpenRouterModels: (models: OpenRouterModels) => void;
}

export const ApiKeyContext = createContext<ApiKeyContextType>({
  apiKey: '',
  setApiKey: () => {},
  openRouterApiKey: '',
  setOpenRouterApiKey: () => {},
  aiProvider: 'gemini',
  setAiProvider: () => {},
  openRouterModels: DEFAULT_OPENROUTER_MODELS,
  setOpenRouterModels: () => {},
});

interface ApiKeyProviderProps {
  children: ReactNode;
}

export const ApiKeyProvider = ({ children }: ApiKeyProviderProps) => {
  const [apiKey, setApiKeyState] = useState('');
  const [openRouterApiKey, setOpenRouterApiKeyState] = useState('');
  const [aiProvider, setAiProviderState] = useState<AIProvider>('gemini');
  const [openRouterModels, setOpenRouterModelsState] = useState<OpenRouterModels>(DEFAULT_OPENROUTER_MODELS);

  useEffect(() => {
    const storedApiKey = localStorage.getItem('geminiApiKey');
    if (storedApiKey) {
      setApiKeyState(storedApiKey);
    }

    const storedOpenRouterApiKey = localStorage.getItem('openRouterApiKey');
    if (storedOpenRouterApiKey) {
      setOpenRouterApiKeyState(storedOpenRouterApiKey);
    }

    const storedProvider = localStorage.getItem('aiProvider');
    if (storedProvider === 'gemini' || storedProvider === 'openrouter') {
      setAiProviderState(storedProvider);
    }

    const storedOpenRouterModels = localStorage.getItem('openRouterModels');
    if (storedOpenRouterModels) {
      try {
        setOpenRouterModelsState({
          ...DEFAULT_OPENROUTER_MODELS,
          ...JSON.parse(storedOpenRouterModels),
        });
      } catch {
        localStorage.removeItem('openRouterModels');
      }
    }
  }, []);

  const setApiKey = (key: string) => {
    setApiKeyState(key);
    if (key) {
      localStorage.setItem('geminiApiKey', key);
    } else {
      localStorage.removeItem('geminiApiKey');
    }
  };

  const setOpenRouterApiKey = (key: string) => {
    setOpenRouterApiKeyState(key);
    if (key) {
      localStorage.setItem('openRouterApiKey', key);
    } else {
      localStorage.removeItem('openRouterApiKey');
    }
  };

  const setAiProvider = (provider: AIProvider) => {
    setAiProviderState(provider);
    localStorage.setItem('aiProvider', provider);
  };

  const setOpenRouterModels = (models: OpenRouterModels) => {
    const normalizedModels = {
      specifier: models.specifier || DEFAULT_OPENROUTER_MODELS.specifier,
      simplifier: models.simplifier || DEFAULT_OPENROUTER_MODELS.simplifier,
      stylist: models.stylist || DEFAULT_OPENROUTER_MODELS.stylist,
      critic: models.critic || DEFAULT_OPENROUTER_MODELS.critic,
      formatter: models.formatter || DEFAULT_OPENROUTER_MODELS.formatter,
    };

    setOpenRouterModelsState(normalizedModels);
    localStorage.setItem('openRouterModels', JSON.stringify(normalizedModels));
  };

  return (
    <ApiKeyContext.Provider
      value={{
        apiKey,
        setApiKey,
        openRouterApiKey,
        setOpenRouterApiKey,
        aiProvider,
        setAiProvider,
        openRouterModels,
        setOpenRouterModels,
      }}
    >
      {children}
    </ApiKeyContext.Provider>
  );
};
