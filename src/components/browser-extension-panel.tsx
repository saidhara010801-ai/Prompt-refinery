'use client';

import { Download, Puzzle, Settings2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function BrowserExtensionPanel({ enabled }: { enabled: boolean }) {
  return (
    <div className="border-t pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Puzzle className="h-4 w-4 text-primary" />
        <h3 className="font-medium">Browser Extension</h3>
        <Badge variant="outline">Test Build</Badge>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Refine prompts inside ChatGPT, Claude, Gemini, and other browser-based chatbots.
      </p>
      <Button type="button" asChild>
        <a href="/downloads/clarift-browser-extension.zip" download>
          <Download className="h-4 w-4" />
          Download for Chrome / Edge
        </a>
      </Button>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Extract the downloaded ZIP, then load that folder from the browser&apos;s Extensions page with Developer mode enabled.</li>
        <li>{enabled ? 'Create a Browser extension key under Public API below.' : 'A Pro account is required to create the Clarift API key.'}</li>
        <li>Open the Clarift toolbar icon, add the Clarift and provider API keys, then enable it on your chatbot page.</li>
      </ol>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Settings2 className="h-3.5 w-3.5" />
        Chrome: chrome://extensions &nbsp; Edge: edge://extensions
      </div>
    </div>
  );
}
