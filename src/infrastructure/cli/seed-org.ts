import { sequelize } from '../persistence/sequelize';
import '../persistence/models';
import { SequelizeUnitOfWork } from '../persistence/repositories';
import { SeedOrganizationRolesUseCase } from '../../application/use-cases/seed-organization-roles';

/**
 * CLI para sembrar una organización con roles plantilla.
 * Uso: npx tsx src/infrastructure/cli/seed-org.ts --org <id> --country EC --name "Mi Org" --founder <userId>
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const organizationId = args['--org'] ?? args['--organization'];
  const countryCode = args['--country'] ?? null;
  const name = args['--name'] ?? null;
  const founderUserId = args['--founder'] ?? args['--founder-user-id'];

  if (!organizationId || !founderUserId) {
    console.error('Uso: npx tsx src/infrastructure/cli/seed-org.ts --org <id> --country EC [--name "Mi Org"] --founder <userId>');
    process.exit(1);
  }

  await sequelize.authenticate();
  console.log('Conectado a la base de datos.');

  const uow = new SequelizeUnitOfWork();
  const useCase = new SeedOrganizationRolesUseCase(uow);

  await useCase.execute({ organizationId, countryCode, name, founderUserId });
  console.log(`Organización ${organizationId} sembrada. Roles plantilla asignados al usuario ${founderUserId}.`);

  await sequelize.close();
}

function parseArgs(argv: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        map[argv[i]] = next;
        i++;
      } else {
        map[argv[i]] = 'true';
      }
    }
  }
  return map;
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
