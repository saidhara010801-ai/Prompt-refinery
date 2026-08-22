import { LegacyHomePage } from '@/components/prompt-refinery/legacy-home-page';
import { WorkspacePreviewPage } from '@/components/workspace-v2/workspace-preview-page';

interface HomeRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Home({ searchParams }: HomeRouteProps) {
  const params = await searchParams;
  const workspaceV2Enabled = process.env.CLARIFT_WORKSPACE_V2 === 'true';

  if (workspaceV2Enabled && params.ui !== 'legacy') {
    return <WorkspacePreviewPage />;
  }

  return <LegacyHomePage />;
}
