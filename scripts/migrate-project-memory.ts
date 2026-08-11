import 'dotenv/config';

import { migrateProjectMemoryPage } from '../src/lib/server/project-memory-migration';

async function main() {
  const result = await migrateProjectMemoryPage({
    apply: process.argv.includes('--apply'),
    limit: Math.max(1, Math.min(Number(process.env.MIGRATION_LIMIT) || 500, 500)),
    pageToken: process.env.MIGRATION_PAGE_TOKEN || null,
  });
  console.log(`${result.applied ? 'Migrated' : 'Would migrate'} ${result.memoryEntries} memory entries from ${result.sessions} project sessions.`);
  if (result.nextPageToken) console.log(`Next page token: ${result.nextPageToken}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Project memory migration failed.');
  process.exitCode = 1;
});
