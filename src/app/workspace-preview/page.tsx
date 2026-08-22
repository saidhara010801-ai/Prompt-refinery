import { notFound, redirect } from 'next/navigation';

import { WorkspacePreviewPage } from '@/components/workspace-v2/workspace-preview-page';

interface WorkspacePreviewRouteProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function WorkspacePreviewRoute({ searchParams }: WorkspacePreviewRouteProps) {
  const params = await searchParams;
  if (params.ui === 'legacy') {
    redirect('/?ui=legacy');
  }

  const enabled = process.env.CLARIFT_WORKSPACE_V2 === 'true' || process.env.NODE_ENV !== 'production';
  if (!enabled) {
    notFound();
  }

  const fixture = process.env.NODE_ENV !== 'production' && params.fixture === '1';
  return <WorkspacePreviewPage fixture={fixture} />;
}
