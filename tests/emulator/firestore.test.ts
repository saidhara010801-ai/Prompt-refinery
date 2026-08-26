import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, getDoc, setDoc } from 'firebase/firestore';

import {
  createDeveloperMemory,
  deleteDeveloperMemory,
  listDeveloperMemory,
  searchDeveloperMemory,
  updateDeveloperMemory,
} from '../../src/lib/server/developer-project-service';
import { getAdminFirestore } from '../../src/lib/server/firebase-admin';
import { AuthorizationError } from '../../src/lib/server/user-access';
import type { PublicApiCaller } from '../../src/lib/server/api-key-service';
import { authenticatePublicApi } from '../../src/lib/server/api-key-service';
import { personalTenantId, personalWorkspaceId } from '../../src/lib/tenant-ids';

const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'clarift-phase-a-emulator';
const [host, portText] = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const port = Number(portText);

function caller(uid: string, tenantId: string, workspaceId: string): PublicApiCaller {
  return {
    uid,
    keyId: `key-${uid}`,
    entitlement: { isPro: true } as PublicApiCaller['entitlement'],
    context: { tenantId, workspaceId } as PublicApiCaller['context'],
    scopes: ['memory:read', 'memory:write'],
  };
}

function mutationRequest(id: string) {
  return new Request('http://localhost/api/v1/test', {
    headers: {
      'X-Request-Id': id,
      'X-Clarift-Client': 'mcp',
      'X-Clarift-Agent': 'phase-a-emulator',
      'X-Clarift-Write-Consent': 'true',
    },
  });
}

test('A-SCP-04 & A-SCP-12: deployed Firestore rules isolate tenant memory and deny browser mutations/audit access', async () => {
  const environment = await initializeTestEnvironment({
    projectId,
    firestore: { host, port, rules: await readFile('firestore.rules', 'utf8') },
  });
  try {
    await environment.clearFirestore();
    await environment.withSecurityRulesDisabled(async (context) => {
      const database = context.firestore();
      await setDoc(doc(database, 'tenantMembers/tenant-a_user-a'), { tenantId: 'tenant-a', userId: 'user-a', status: 'active' });
      await setDoc(doc(database, 'tenantMembers/tenant-b_user-b'), { tenantId: 'tenant-b', userId: 'user-b', status: 'active' });
      await setDoc(doc(database, 'projects/project-a'), { tenantId: 'tenant-a', workspaceId: 'workspace-a', status: 'active' });
      await setDoc(doc(database, 'projects/project-b'), { tenantId: 'tenant-b', workspaceId: 'workspace-b', status: 'active' });
      await setDoc(doc(database, 'projects/project-a/memoryEntries/entry-a'), { tenantId: 'tenant-a', workspaceId: 'workspace-a', content: 'tenant-a-sentinel', active: true });
      await setDoc(doc(database, 'projects/project-b/memoryEntries/entry-b'), { tenantId: 'tenant-b', workspaceId: 'workspace-b', content: 'tenant-b-sentinel', active: true });
      await setDoc(doc(database, 'projectMemoryAudit/audit-a'), { tenantId: 'tenant-a', projectId: 'project-a', entryId: 'entry-a' });
      await setDoc(doc(database, 'apiKeys/key-a'), { tenantId: 'tenant-a', active: true });
      await setDoc(doc(database, 'projects/project-a/memoryGraphNodes/node-a'), { tenantId: 'tenant-a', active: true });
    });

    const userA = environment.authenticatedContext('user-a').firestore();
    const userB = environment.authenticatedContext('user-b').firestore();
    const anonymous = environment.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(userA, 'projects/project-a/memoryEntries/entry-a')));
    await assertFails(getDoc(doc(userA, 'projects/project-b/memoryEntries/entry-b')));
    await assertFails(getDoc(doc(userB, 'projects/project-a/memoryEntries/entry-a')));
    await assertFails(getDoc(doc(anonymous, 'projects/project-a/memoryEntries/entry-a')));
    await assertFails(setDoc(doc(userA, 'projects/project-a/memoryEntries/new-entry'), { content: 'forbidden' }));
    await assertFails(deleteDoc(doc(userA, 'projects/project-a/memoryEntries/entry-a')));
    await assertFails(getDoc(doc(userA, 'projectMemoryAudit/audit-a')));
    await assertFails(getDoc(doc(userA, 'apiKeys/key-a')));
    await assertFails(getDoc(doc(userA, 'projects/project-a/memoryGraphNodes/node-a')));
  } finally {
    await environment.cleanup();
  }
});

test('A-MEM-02 through A-MEM-11: persisted server memory lifecycle, search, provenance, audits, and tenant isolation', async () => {
  const database = getAdminFirestore();
  const projectRef = database.doc('projects/project-lifecycle');
  await projectRef.set({
    userId: 'user-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    name: 'Phase A lifecycle',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const userA = caller('user-a', 'tenant-a', 'workspace-a');
  const userB = caller('user-b', 'tenant-b', 'workspace-b');

  const created = await createDeveloperMemory(mutationRequest('create-1'), userA, projectRef.id, {
    kind: 'note',
    title: 'Rollback constraint',
    content: 'qa-rollback-a requires verified backups.',
    sourceRef: 'phase-a-emulator',
    consent: true,
  });
  assert.equal(created.active, true);
  assert.equal(created.status, 'active');
  assert.equal(created.validTo, null);
  assert.equal(created.provenance.source, 'mcp');
  assert.equal(created.provenance.requestId, 'create-1');

  assert.deepEqual((await listDeveloperMemory(userA, projectRef.id, { activeOnly: true })).map((entry) => entry.id), [created.id]);
  assert.deepEqual((await searchDeveloperMemory(userA, { projectId: projectRef.id, query: 'rollback', activeOnly: true })).map((entry) => entry.id), [created.id]);
  await assert.rejects(
    listDeveloperMemory(userB, projectRef.id),
    (error: Error) => error instanceof AuthorizationError && error.name === 'ProjectNotFoundError'
  );

  const deactivated = await updateDeveloperMemory(mutationRequest('deactivate-1'), userA, projectRef.id, created.id, { active: false, consent: true });
  assert.equal(deactivated.active, false);
  assert.equal(deactivated.status, 'inactive');
  assert.ok(deactivated.validTo);
  assert.equal(deactivated.createdAt, created.createdAt);
  assert.equal((await listDeveloperMemory(userA, projectRef.id, { activeOnly: true })).length, 0);
  assert.equal((await searchDeveloperMemory(userA, { projectId: projectRef.id, query: 'rollback', activeOnly: true })).length, 0);
  assert.deepEqual((await listDeveloperMemory(userA, projectRef.id, { activeOnly: false })).map((entry) => entry.id), [created.id]);

  const reactivated = await updateDeveloperMemory(mutationRequest('reactivate-1'), userA, projectRef.id, created.id, { active: true, consent: true });
  assert.equal(reactivated.active, true);
  assert.equal(reactivated.validTo, null);
  assert.notEqual(reactivated.validFrom, created.validFrom);

  const edited = await updateDeveloperMemory(mutationRequest('update-1'), userA, projectRef.id, created.id, {
    title: 'Validated rollback constraint',
    content: 'qa-cutover-a requires checksum validation.',
    consent: true,
  });
  assert.equal(edited.title, 'Validated rollback constraint');
  assert.deepEqual((await searchDeveloperMemory(userA, { projectId: projectRef.id, query: 'checksum', activeOnly: true })).map((entry) => entry.id), [created.id]);

  const deleted = await deleteDeveloperMemory(mutationRequest('delete-1'), userA, projectRef.id, created.id, true);
  assert.deepEqual(deleted, { deleted: true, id: created.id });
  assert.equal((await listDeveloperMemory(userA, projectRef.id)).length, 0);

  const audits = await database.collection('projectMemoryAudit').where('entryId', '==', created.id).get();
  const actions = audits.docs.map((snapshot) => snapshot.data().action).sort();
  assert.deepEqual(actions, ['create', 'deactivate', 'delete', 'reactivate', 'update']);
  for (const audit of audits.docs.map((snapshot) => snapshot.data())) {
    assert.equal('content' in audit, false);
    assert.equal('title' in audit, false);
    assert.equal(audit.tenantId, 'tenant-a');
    assert.equal(audit.workspaceId, 'workspace-a');
  }
});

test('A-AUTH-13: first legacy-token request enforces default scopes before migration and after persistence', async () => {
  const database = getAdminFirestore();
  const uid = 'legacy-user';
  const tenantId = personalTenantId(uid);
  const workspaceId = personalWorkspaceId(uid);
  const token = 'clf_live_legacy_emulator_token';
  const pepper = 'phase-a-emulator-pepper';
  const keyHash = createHmac('sha256', pepper).update(token).digest('hex');
  const previous = {
    enabled: process.env.ENABLE_PUBLIC_API,
    pepper: process.env.CLARIFT_API_TOKEN_PEPPER,
  };
  process.env.ENABLE_PUBLIC_API = 'true';
  process.env.CLARIFT_API_TOKEN_PEPPER = pepper;

  try {
    await database.doc(`users/${uid}`).set({
      id: uid,
      email: 'legacy-user@example.test',
      name: 'Legacy Test User',
      role: 'user',
      accountStatus: 'active',
      subscriptionTier: 'free',
    });
    await database.doc(`tenantEntitlements/${tenantId}`).set({
      tenantId,
      plan: 'developer',
      status: 'active',
      developerAccess: true,
      developerAccessSource: 'developer-plan',
      developerFeatures: ['api', 'cli', 'mcp'],
    });
    const keyRef = database.doc('apiKeys/legacy-key');
    await keyRef.set({
      ownerUid: uid,
      keyHash,
      prefix: token.slice(0, 18),
      active: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const request = new Request('http://localhost/api/v1/test', {
      headers: { Authorization: `Bearer ${token}` },
    });

    await assert.rejects(
      authenticatePublicApi(request, 'memory:write'),
      (error: Error) => error instanceof AuthorizationError && error.name === 'ApiScopeError'
    );
    const beforeMigration = (await keyRef.get()).data() ?? {};
    assert.equal('tenantId' in beforeMigration, false);
    assert.equal('scopes' in beforeMigration, false);

    const allowed = await authenticatePublicApi(request, 'refinements:write');
    assert.equal(allowed.context.tenantId, tenantId);
    assert.equal(allowed.context.workspaceId, workspaceId);
    assert.deepEqual(allowed.scopes, ['refinements:write', 'evaluations:write', 'conversions:write']);

    const migrated = (await keyRef.get()).data() ?? {};
    assert.equal(migrated.tenantId, tenantId);
    assert.equal(migrated.workspaceId, workspaceId);
    assert.deepEqual(migrated.scopes, ['refinements:write', 'evaluations:write', 'conversions:write']);
    await assert.rejects(
      authenticatePublicApi(request, 'memory:write'),
      (error: Error) => error instanceof AuthorizationError && error.name === 'ApiScopeError'
    );
  } finally {
    if (previous.enabled === undefined) delete process.env.ENABLE_PUBLIC_API;
    else process.env.ENABLE_PUBLIC_API = previous.enabled;
    if (previous.pepper === undefined) delete process.env.CLARIFT_API_TOKEN_PEPPER;
    else process.env.CLARIFT_API_TOKEN_PEPPER = previous.pepper;
  }
});
