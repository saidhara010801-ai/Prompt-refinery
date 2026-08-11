import { Timestamp } from 'firebase-admin/firestore';
import { NextResponse } from 'next/server';

import { getAdminFirestore } from '@/lib/server/firebase-admin';
import { isAuthorizedJobRequest } from '@/lib/server/job-auth';

export const runtime = 'nodejs';

async function purge(request: Request) {
  if (!isAuthorizedJobRequest(request)) return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 });
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collectionGroup('projects')
    .where('status', '==', 'trashed')
    .where('purgeAt', '<=', Timestamp.now())
    .limit(100)
    .get();
  for (const project of snapshot.docs) await firestore.recursiveDelete(project.ref);
  return NextResponse.json({ purged: snapshot.size, hasMore: snapshot.size === 100 });
}

export async function POST(request: Request) { return purge(request); }
export async function GET(request: Request) { return purge(request); }
