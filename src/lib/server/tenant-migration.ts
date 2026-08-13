import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';

import { getAdminFirestore } from './firebase-admin';
import { ensurePersonalTenant, personalTenantId, personalWorkspaceId } from './tenant-service';

const MIGRATION_VERSION = 2;

function migratedTopLevelId(uid: string, legacyId: string) {
  return `legacy_${createHash('sha256').update(`${uid}:${legacyId}`).digest('hex').slice(0, 40)}`;
}

async function copyCollection(input: {
  sourcePath: string;
  targetPath: string;
  tenantId: string;
  workspaceId: string;
  uid: string;
  apply: boolean;
  extra?: Record<string, unknown>;
  namespaceDocumentIds?: boolean;
}) {
  const firestore = getAdminFirestore();
  const snapshot = await firestore.collection(input.sourcePath).get();
  if (input.apply && !snapshot.empty) {
    for (let offset = 0; offset < snapshot.docs.length; offset += 400) {
      const batch = firestore.batch();
      for (const document of snapshot.docs.slice(offset, offset + 400)) {
        const targetId = input.namespaceDocumentIds ? migratedTopLevelId(input.uid, document.id) : document.id;
        batch.set(firestore.doc(`${input.targetPath}/${targetId}`), {
          ...document.data(),
          ...input.extra,
          tenantId: input.tenantId,
          workspaceId: input.workspaceId,
          createdBy: document.data().createdBy || document.data().actorUid || document.data().userId || input.uid,
          migratedFrom: document.ref.path,
          legacyId: document.id,
          migrationVersion: MIGRATION_VERSION,
          migratedAt: Timestamp.now(),
        }, { merge: true });
      }
      await batch.commit();
    }
  }
  return snapshot.size;
}

export async function migrateUserTenantData(uid: string, apply = true) {
  const firestore = getAdminFirestore();
  const userRef = firestore.doc(`users/${uid}`);
  const user = await userRef.get();
  if (apply && Number(user.data()?.tenantDataMigrationVersion) >= MIGRATION_VERSION) {
    return { uid, applied: false, alreadyMigrated: true, savedPrompts: 0, projects: 0, sessions: 0, memoryEntries: 0, evaluations: 0, usageEvents: 0 };
  }
  if (apply) await ensurePersonalTenant(uid);
  const tenantId = personalTenantId(uid);
  const workspaceId = personalWorkspaceId(uid);
  const savedPrompts = await copyCollection({ sourcePath: `users/${uid}/savedPrompts`, targetPath: 'savedPrompts', tenantId, workspaceId, uid, apply, namespaceDocumentIds: true });
  const evaluations = await copyCollection({ sourcePath: `users/${uid}/evaluationRuns`, targetPath: 'evaluations', tenantId, workspaceId, uid, apply, namespaceDocumentIds: true });
  const usageEvents = await copyCollection({ sourcePath: `users/${uid}/usageEvents`, targetPath: 'usageEvents', tenantId, workspaceId, uid, apply, namespaceDocumentIds: true, extra: { legacy: true } });
  const legacyProjects = await firestore.collection(`users/${uid}/projects`).get();
  let sessions = 0;
  let memoryEntries = 0;
  for (const project of legacyProjects.docs) {
    const migratedProjectId = migratedTopLevelId(uid, project.id);
    if (apply) {
      await firestore.doc(`projects/${migratedProjectId}`).set({
        ...project.data(),
        tenantId,
        workspaceId,
        createdBy: project.data().createdBy || project.data().userId || uid,
        migratedFrom: project.ref.path,
        legacyId: project.id,
        migrationVersion: MIGRATION_VERSION,
        migratedAt: Timestamp.now(),
      }, { merge: true });
    }
    sessions += await copyCollection({
      sourcePath: `${project.ref.path}/projectSessions`,
      targetPath: `projects/${migratedProjectId}/projectSessions`,
      tenantId,
      workspaceId,
      uid,
      apply,
      extra: { projectId: migratedProjectId, legacyProjectId: project.id },
    });
    memoryEntries += await copyCollection({
      sourcePath: `${project.ref.path}/memoryEntries`,
      targetPath: `projects/${migratedProjectId}/memoryEntries`,
      tenantId,
      workspaceId,
      uid,
      apply,
      extra: { projectId: migratedProjectId, legacyProjectId: project.id },
    });
  }
  if (apply) {
    await userRef.set({
      activeTenantId: tenantId,
      activeWorkspaceId: workspaceId,
      tenantDataMigrationVersion: MIGRATION_VERSION,
      tenantDataMigratedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: true });
  }
  return {
    uid,
    applied: apply,
    alreadyMigrated: false,
    savedPrompts,
    projects: legacyProjects.size,
    sessions,
    memoryEntries,
    evaluations,
    usageEvents,
  };
}

export async function migrateTenantUsersPage(input: { apply: boolean; limit?: number; pageToken?: string | null }) {
  const firestore = getAdminFirestore();
  const limit = Math.max(1, Math.min(input.limit || 25, 100));
  let query = firestore.collection('users').orderBy('__name__').limit(limit);
  if (input.pageToken) {
    const cursor = await firestore.doc(`users/${input.pageToken}`).get();
    if (!cursor.exists) throw new Error('The migration page token is invalid.');
    query = query.startAfter(cursor);
  }
  const users = await query.get();
  const results = [];
  for (const user of users.docs) results.push(await migrateUserTenantData(user.id, input.apply));
  return {
    applied: input.apply,
    users: results,
    nextPageToken: users.size === limit ? users.docs.at(-1)?.id ?? null : null,
  };
}
