'use client';

import { useState } from 'react';
import { Check, ChevronDown, Copy, Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatOutput, type OutputStyle } from '@/lib/output-formats';

interface OutputActionsProps {
  prompt: string;
  originalPrompt?: string;
  promptType?: string;
}

function downloadOutput(style: OutputStyle, prompt: string, originalPrompt?: string, promptType?: string) {
  const content = formatOutput(style, prompt, originalPrompt, promptType);
  const extension = style === 'markdown' ? 'md' : style === 'json' ? 'json' : 'txt';
  const blob = new Blob([content], { type: style === 'json' ? 'application/json' : 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `refined-prompt.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function OutputActions({ prompt, originalPrompt, promptType }: OutputActionsProps) {
  const [hasCopied, setHasCopied] = useState(false);

  const copyOutput = async (style: OutputStyle) => {
    await navigator.clipboard.writeText(formatOutput(style, prompt, originalPrompt, promptType));
    setHasCopied(true);
    setTimeout(() => setHasCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={() => copyOutput('plain')}>
        {hasCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        <span className="hidden sm:inline">{hasCopied ? 'Copied' : 'Copy'}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="icon" className="h-9 w-9" aria-label="More copy and export options">
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>Copy as</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => copyOutput('plain')}>
            <Copy />
            Plain text
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyOutput('markdown')}>
            <Copy />
            Markdown
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copyOutput('json')}>
            <Copy />
            JSON
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Export</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => downloadOutput('plain', prompt, originalPrompt, promptType)}>
            <Download />
            TXT file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadOutput('markdown', prompt, originalPrompt, promptType)}>
            <Download />
            Markdown file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => downloadOutput('json', prompt, originalPrompt, promptType)}>
            <Download />
            JSON file
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
