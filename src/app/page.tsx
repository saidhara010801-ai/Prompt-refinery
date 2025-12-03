import { PromptRefineryApp } from '@/components/prompt-refinery/prompt-refinery-app';

export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <main className="flex-1 container mx-auto px-4 py-8 md:py-12">
        <PromptRefineryApp />
      </main>
    </div>
  );
}
