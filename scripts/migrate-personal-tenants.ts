import { migrateTenantUsersPage } from '../src/lib/server/tenant-migration';

async function main() {
  const apply = process.argv.includes('--apply');
  const pageTokenIndex = process.argv.indexOf('--page-token');
  const pageToken = pageTokenIndex >= 0 ? process.argv[pageTokenIndex + 1] : null;
  const result = await migrateTenantUsersPage({ apply, pageToken, limit: Number(process.env.MIGRATION_LIMIT) || 25 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'Tenant migration failed.');
  process.exitCode = 1;
});
