'use client';

import { useState, type ReactNode } from 'react';
import { getAuth, signOut } from 'firebase/auth';
import {
  BarChart3,
  Crown,
  FileText,
  FolderKanban,
  Gauge,
  Library,
  LogOut,
  MoreHorizontal,
  Settings,
  Users,
  Wand2,
} from 'lucide-react';

import { Logo } from '@/components/icons/logo';
import { SettingsDialog } from '@/components/settings-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';

export type WorkspaceDestination = 'refinery' | 'evaluator' | 'converter' | 'saved' | 'projects' | 'analytics' | 'shared';

const destinations = [
  { id: 'refinery', label: 'Workspace', icon: Wand2, pro: false },
  { id: 'evaluator', label: 'Evaluator', icon: Gauge, pro: false },
  { id: 'converter', label: 'Converter', icon: FileText, pro: false },
  { id: 'saved', label: 'Saved', icon: Library, pro: false },
  { id: 'projects', label: 'Projects', icon: FolderKanban, pro: true },
  { id: 'analytics', label: 'Analytics', icon: BarChart3, pro: true },
  { id: 'shared', label: 'Shared', icon: Users, pro: true },
] as const;

const mobilePrimary = ['refinery', 'projects', 'saved', 'analytics'] as const;
const mobileMore = ['evaluator', 'converter', 'shared'] as const;

interface WorkspaceShellProps {
  activeDestination: WorkspaceDestination;
  onDestinationChange: (destination: WorkspaceDestination) => void;
  isPro: boolean;
  planLabel: string;
  savedPromptCount: number;
  savedPromptLimit: number | null;
  dailyUnits: number | null;
  monthlyUnits: number | null;
  availableCredits: number;
  reservedCredits: number;
  children: ReactNode;
  showAccountControls?: boolean;
}

export function WorkspaceShell({
  activeDestination,
  onDestinationChange,
  isPro,
  planLabel,
  savedPromptCount,
  savedPromptLimit,
  dailyUnits,
  monthlyUnits,
  availableCredits,
  reservedCredits,
  children,
  showAccountControls = true,
}: WorkspaceShellProps) {
  const [moreOpen, setMoreOpen] = useState(false);

  const selectDestination = (destination: WorkspaceDestination) => {
    onDestinationChange(destination);
    setMoreOpen(false);
  };

  const isDestinationDisabled = (destination: WorkspaceDestination) => {
    const item = destinations.find((candidate) => candidate.id === destination);
    return Boolean(item?.pro && !isPro);
  };

  const handleSignOut = () => signOut(getAuth());

  return (
    <SidebarProvider
      defaultOpen
      style={{ '--sidebar-width': '240px', '--sidebar-width-icon': '56px' } as React.CSSProperties}
      className="workspace-v2"
    >
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="h-16 justify-center border-b px-3">
          <Logo variant="wordmark" className="h-8 w-28 group-data-[collapsible=icon]:hidden" />
          <Logo variant="icon" className="hidden h-8 w-8 group-data-[collapsible=icon]:inline-flex" />
        </SidebarHeader>
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {destinations.map(({ id, label, icon: Icon, pro }) => (
                  <SidebarMenuItem key={id}>
                    <SidebarMenuButton
                      type="button"
                      tooltip={pro && !isPro ? `${label} is available on Pro` : label}
                      isActive={activeDestination === id}
                      disabled={pro && !isPro}
                      onClick={() => selectDestination(id)}
                    >
                      <Icon />
                      <span>{label}</span>
                      {pro && !isPro && <Crown className="ml-auto h-3.5 w-3.5" />}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        {showAccountControls && <SidebarSeparator />}
        {showAccountControls && <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SettingsDialog trigger={
                <SidebarMenuButton type="button" tooltip="Settings"><Settings /><span>Settings</span></SidebarMenuButton>
              } />
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton type="button" tooltip="Sign out" onClick={handleSignOut}><LogOut /><span>Sign out</span></SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>}
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 bg-background pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:px-6">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger className="hidden md:inline-flex" />
            <Logo variant="icon" className="h-8 w-8 md:hidden" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{destinations.find((item) => item.id === activeDestination)?.label}</p>
              <p className="truncate text-xs text-muted-foreground">Personal workspace</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={isPro ? 'default' : 'outline'} className="hidden gap-1 sm:flex"><Crown className="h-3 w-3" />{planLabel}</Badge>
            {showAccountControls && <SettingsDialog />}
            <ThemeToggle />
          </div>
        </header>

        <div className="border-b bg-muted/25 px-4 py-2 md:px-6">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{planLabel}</span>
            {dailyUnits !== null && monthlyUnits !== null && <span>{dailyUnits} daily / {monthlyUnits} monthly weighted units</span>}
            <span>{savedPromptCount}/{savedPromptLimit ?? 'unlimited'} saved</span>
            <span>{availableCredits} credits{reservedCredits ? `, ${reservedCredits} reserved` : ''}</span>
          </div>
        </div>

        <main className="min-w-0 flex-1 px-4 py-5 md:px-6 md:py-6">{children}</main>
      </SidebarInset>

      <nav data-testid="workspace-mobile-nav" className="fixed inset-x-0 bottom-0 z-40 grid h-[calc(4.25rem+env(safe-area-inset-bottom))] grid-cols-5 border-t bg-background/98 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_hsl(var(--background)/0.45)] md:hidden" aria-label="Workspace navigation">
        {mobilePrimary.map((id) => {
          const item = destinations.find((candidate) => candidate.id === id)!;
          const Icon = item.icon;
          const disabled = isDestinationDisabled(id);
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => selectDestination(id)}
              className={cn('flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] text-muted-foreground disabled:opacity-40', activeDestination === id && 'text-primary')}
            >
              <Icon className="h-5 w-5" />
              <span className="max-w-full truncate">{item.label}</span>
            </button>
          );
        })}
        <button type="button" onClick={() => setMoreOpen(true)} className="flex min-w-0 flex-col items-center justify-center gap-1 px-1 text-[11px] text-muted-foreground">
          <MoreHorizontal className="h-5 w-5" /><span>More</span>
        </button>
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-lg pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
          <SheetHeader className="text-left">
            <SheetTitle>More</SheetTitle>
            <SheetDescription>Open another Clarift tool or manage your account.</SheetDescription>
          </SheetHeader>
          <div className="mt-5 grid gap-2">
            {mobileMore.map((id) => {
              const item = destinations.find((candidate) => candidate.id === id)!;
              const Icon = item.icon;
              return (
                <Button key={id} type="button" variant="ghost" className="justify-start" disabled={isDestinationDisabled(id)} onClick={() => selectDestination(id)}>
                  <Icon className="h-4 w-4" />{item.label}
                </Button>
              );
            })}
            {showAccountControls && <SettingsDialog trigger={<Button type="button" variant="ghost" className="justify-start"><Settings className="h-4 w-4" />Settings</Button>} />}
            {showAccountControls && <Button type="button" variant="ghost" className="justify-start" onClick={handleSignOut}><LogOut className="h-4 w-4" />Sign out</Button>}
          </div>
        </SheetContent>
      </Sheet>
    </SidebarProvider>
  );
}
