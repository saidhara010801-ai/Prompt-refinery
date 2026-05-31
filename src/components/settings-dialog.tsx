'use client';

import { useContext, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Settings } from 'lucide-react';
import { AIProvider, ApiKeyContext, DEFAULT_OPENROUTER_MODELS } from '@/context/api-key-context';
import { SettingsContext } from '@/context/settings-context';
import { cn } from '@/lib/utils';
import { SubscriptionContext } from '@/context/subscription-context';

export function SettingsDialog() {
  const {
    apiKey,
    setApiKey,
    openRouterApiKey,
    setOpenRouterApiKey,
    aiProvider,
    setAiProvider,
    openRouterModels,
    setOpenRouterModels,
  } = useContext(ApiKeyContext);
  const { animate, setAnimate } = useContext(SettingsContext);
  const { isPro } = useContext(SubscriptionContext);
  const [open, setOpen] = useState(false);

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen);
    if (!isOpen) {
      setAnimate(false);
    }
  };

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const newApiKey = formData.get('apiKey') as string;
    const newOpenRouterApiKey = formData.get('openRouterApiKey') as string;
    const newProvider = formData.get('aiProvider') as AIProvider;
    setApiKey(newApiKey);
    setOpenRouterApiKey(newOpenRouterApiKey);
    setAiProvider(newProvider === 'openrouter' ? 'openrouter' : 'gemini');
    setOpenRouterModels({
      specifier: (formData.get('openRouterSpecifierModel') as string) || DEFAULT_OPENROUTER_MODELS.specifier,
      simplifier: (formData.get('openRouterSimplifierModel') as string) || DEFAULT_OPENROUTER_MODELS.simplifier,
      stylist: (formData.get('openRouterStylistModel') as string) || DEFAULT_OPENROUTER_MODELS.stylist,
      critic: (formData.get('openRouterCriticModel') as string) || DEFAULT_OPENROUTER_MODELS.critic,
      formatter: (formData.get('openRouterFormatterModel') as string) || DEFAULT_OPENROUTER_MODELS.formatter,
    });
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className={cn(animate && 'animate-pulse ring-2 ring-destructive ring-offset-2')}>
          <Settings className="h-4 w-4" />
          <span className="sr-only">Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Manage local AI provider settings. API keys are saved only in this browser.
            {!isPro && ' Upgrade to Pro to customize the five OpenRouter council models.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave}>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="aiProvider" className="text-right">
                Provider
              </Label>
              <select
                id="aiProvider"
                name="aiProvider"
                defaultValue={aiProvider}
                className="col-span-3 h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="gemini">Gemini</option>
                <option value="openrouter">OpenRouter</option>
              </select>

              <Label htmlFor="apiKey" className="text-right">
                Gemini API Key
              </Label>
              <Input
                id="apiKey"
                name="apiKey"
                defaultValue={apiKey}
                className="col-span-3"
                type="password"
                placeholder="Enter your Gemini API key"
              />

              <Label htmlFor="openRouterApiKey" className="text-right">
                OpenRouter Key
              </Label>
              <Input
                id="openRouterApiKey"
                name="openRouterApiKey"
                defaultValue={openRouterApiKey}
                className="col-span-3"
                type="password"
                placeholder="Enter your OpenRouter API key"
              />

              <Label htmlFor="openRouterSpecifierModel" className="text-right">
                Specifier Model
              </Label>
              <Input
                id="openRouterSpecifierModel"
                name="openRouterSpecifierModel"
                defaultValue={openRouterModels.specifier}
                className="col-span-3"
                placeholder={DEFAULT_OPENROUTER_MODELS.specifier}
                disabled={!isPro}
              />

              <Label htmlFor="openRouterSimplifierModel" className="text-right">
                Simplifier Model
              </Label>
              <Input
                id="openRouterSimplifierModel"
                name="openRouterSimplifierModel"
                defaultValue={openRouterModels.simplifier}
                className="col-span-3"
                placeholder={DEFAULT_OPENROUTER_MODELS.simplifier}
                disabled={!isPro}
              />

              <Label htmlFor="openRouterStylistModel" className="text-right">
                Stylist Model
              </Label>
              <Input
                id="openRouterStylistModel"
                name="openRouterStylistModel"
                defaultValue={openRouterModels.stylist}
                className="col-span-3"
                placeholder={DEFAULT_OPENROUTER_MODELS.stylist}
                disabled={!isPro}
              />

              <Label htmlFor="openRouterCriticModel" className="text-right">
                Critic Model
              </Label>
              <Input
                id="openRouterCriticModel"
                name="openRouterCriticModel"
                defaultValue={openRouterModels.critic}
                className="col-span-3"
                placeholder={DEFAULT_OPENROUTER_MODELS.critic}
                disabled={!isPro}
              />

              <Label htmlFor="openRouterFormatterModel" className="text-right">
                Formatter Model
              </Label>
              <Input
                id="openRouterFormatterModel"
                name="openRouterFormatterModel"
                defaultValue={openRouterModels.formatter}
                className="col-span-3"
                placeholder={DEFAULT_OPENROUTER_MODELS.formatter}
                disabled={!isPro}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="submit">Save changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
