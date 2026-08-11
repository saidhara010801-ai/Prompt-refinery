import { FieldPath, Timestamp } from 'firebase-admin/firestore';

import { estimateTokenCounts, normalizedSearchTerms } from '@/lib/stage2-utils';
import { getAdminFirestore } from './firebase-admin';

export async function migrateProjectMemoryPage(input: { apply: boolean; limit?: number; pageToken?: string | null }) {
  const firestore = getAdminFirestore();
  const limit = Math.max(1, Math.min(input.limit ?? 250, 500));
  let query = firestore.collectionGroup('projectSessions').orderBy(FieldPath.documentId()).limit(limit);
  if (input.pageToken) {
    const cursor = await firestore.doc(input.pageToken).get();
    if (!cursor.exists) throw new Error('The migration page token is no longer valid.');
    query = query.startAfter(cursor);
  }
  const sessions = await query.get();
  const writes: Array<{ path: string; data: Record<string, unknown> }> = [];

  for (const session of sessions.docs) {
    const segments = session.ref.path.split('/');
    if (segments.length !== 6 || segments[0] !== 'users' || segments[2] !== 'projects') continue;
    const uid = segments[1];
    const projectId = segments[3];
    const data = session.data();
    const rawPrompt = String(data.rawPrompt ?? '').trim();
    const refinedPrompt = String(data.refinedPrompt ?? '').trim();
    const response = String(data.llmResponse ?? '').trim();
    const createdAt = data.createdAt instanceof Timestamp ? data.createdAt : data.timestamp instanceof Timestamp ? data.timestamp : Timestamp.now();
    const entries = [
      rawPrompt || refinedPrompt ? { id: `session-${session.id}-refinement`, kind: 'refinement', title: rawPrompt.slice(0, 120) || 'Legacy refinement', content: refinedPrompt || rawPrompt } : null,
      response ? { id: `session-${session.id}-response`, kind: 'response', title: `Response to ${rawPrompt.slice(0, 100) || 'legacy refinement'}`, content: response } : null,
    ].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    for (const entry of entries) {
      writes.push({
        path: `users/${uid}/projects/${projectId}/memoryEntries/${entry.id}`,
        data: {
          projectId,
          ownerUid: uid,
          actorUid: uid,
          kind: entry.kind,
          title: entry.title,
          content: entry.content,
          active: true,
          tokenEstimate: estimateTokenCounts(entry.content).gemini,
          sourceRef: `projectSession:${session.id}`,
          searchTerms: normalizedSearchTerms(entry.title, entry.content),
          createdAt,
          updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt : createdAt,
        },
      });
    }
  }

  if (input.apply) {
    for (let offset = 0; offset < writes.length; offset += 400) {
      const batch = firestore.batch();
      for (const write of writes.slice(offset, offset + 400)) batch.set(firestore.doc(write.path), write.data, { merge: true });
      await batch.commit();
    }
  }

  return {
    applied: input.apply,
    sessions: sessions.size,
    memoryEntries: writes.length,
    nextPageToken: sessions.size === limit ? sessions.docs.at(-1)?.ref.path ?? null : null,
  };
}
