'use client';

import { Download, Puzzle, Settings2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { version as extensionVersion } from '../../extension/manifest.json';

export function BrowserExtensionPanel({ enabled }: { enabled: boolean }) {
  return (
    <div className="border-t pt-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Puzzle className="h-4 w-4 text-primary" />
        <h3 className="font-medium">Browser Extension</h3>
        <Badge variant="outline">Test Build</Badge>
        <Badge variant="secondary">v{extensionVersion}</Badge>
      </div>
      <p className="mb-3 text-sm text-muted-foreground">
        Bring clearer prompts and your project context to your next conversation. Refine text across supported web editors, collect chat history, and create an editable context pill to continue in a new chat or another chatbot.
      </p>
      <Button type="button" asChild>
        <a href={`/downloads/clarift-browser-extension.zip?v=${extensionVersion}`} download>
          <Download className="h-4 w-4" />
          Download v{extensionVersion} for Chrome / Edge
        </a>
      </Button>
      <div className="mt-4 rounded-lg border bg-muted/30 p-4">
        <h4 className="mb-2 text-sm font-medium">What&apos;s new</h4>
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted-foreground">
          <li><strong className="text-foreground">More ways to refine.</strong> Use text and search fields, rich text editors, the standalone Refine text editor, or the clarift address-bar shortcut. Enable individual pages or opt into access across websites.</li>
          <li><strong className="text-foreground">Automatic chat history collection.</strong> Collect older messages as the conversation scrolls, with progress and stop controls, then return to your original position.</li>
          <li><strong className="text-foreground">Portable context pills.</strong> Review captured text, add your goal, confirmed decisions, constraints, and next steps, then copy an editable pill or download Markdown. Choose compact excerpts or all captured text, and import text or Markdown transcripts.</li>
          <li><strong className="text-foreground">Whole-chat handoff request.</strong> Copy a prepared request into your current chatbot to ask it for a continuation summary using the conversation context available to it. Review its answer and carry it into your next chat.</li>
          <li><strong className="text-foreground">Context-aware refinement.</strong> Attach reviewed context so subsequent prompt refinements on the source page reflect your project.</li>
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">Local capture, pill editing, and export need no account. You choose when to share context or send it with a refinement. Capture includes the history the page makes available and reports its coverage.</p>
      </div>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
        <li>Extract the downloaded ZIP, then load that folder from the browser&apos;s Extensions page with Developer mode enabled.</li>
        <li>{enabled ? 'Open the extension settings and choose Connect Clarift Account.' : 'Sign in to Clarift before connecting the extension.'}</li>
        <li>Approve the account link in the Clarift tab, then enable it on your chatbot page. No provider key is required.</li>
        <li>Choose Create context pill to collect chat history automatically, review the draft, and copy it into a new chat.</li>
        <li>For the address bar, type clarift, press Tab or Space, and enter a prompt. Optional access to all websites is available in the extension popup.</li>
      </ol>
      <p className="mt-3 text-sm text-muted-foreground">Updating an existing installation? Extract this ZIP into the folder you originally loaded, click Reload on the browser&apos;s Extensions page, then reload your chat tabs. The popup should show v{extensionVersion}.</p>
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        <Settings2 className="h-3.5 w-3.5" />
        Chrome: chrome://extensions &nbsp; Edge: edge://extensions
      </div>
    </div>
  );
}
