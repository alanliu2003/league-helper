/**
 * Temporary read-only M12-v2 Phase 1 DB baseline gate.
 * Do not print connection strings or secrets.
 */
import { PrismaClient } from '@prisma/client';

const EXPECTED_M11_MIGRATIONS = [
  '20260804070223_init_domain_schema',
  '20260804081120_add_ingestion_job_pending_status',
  '20260804081130_set_ingestion_job_pending_default',
  '20260805160846_champion_aggregate_csdiff_and_versioning',
  '20260805170000_champion_aggregation_recalc_scope',
  '20260807090838_tracked_player_collector_run',
  '20260807140000_task4_population_expansion',
  '20260810120000_milestone_11_ladder_enrollment',
  '20260810130000_milestone_11_refresh_activity',
];

const prisma = new PrismaClient();

function fail(reason, details) {
  console.log('DB_BASELINE_INCOMPATIBLE');
  console.log('REASON=' + reason);
  if (details !== undefined) {
    console.log('DETAILS=' + JSON.stringify(details, null, 2));
  }
}

try {
  const migrations = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM _prisma_migrations
    ORDER BY started_at ASC
  `;

  const activeMigrations = migrations
    .filter((m) => m.rolled_back_at == null)
    .map((m) => m.migration_name);

  console.log('MIGRATION_NAMES=' + JSON.stringify(activeMigrations, null, 2));
  console.log('MIGRATION_COUNT=' + activeMigrations.length);
  console.log(
    'MIGRATION_HEAD=' +
      (activeMigrations.length
        ? activeMigrations[activeMigrations.length - 1]
        : 'NONE'),
  );

  const abandonedMigrationRows = activeMigrations.filter(
    (name) =>
      name.includes('participant_rank_enrichment') ||
      name.includes('20260810160000'),
  );

  const unexpectedMigrations = activeMigrations.filter(
    (name) => !EXPECTED_M11_MIGRATIONS.includes(name),
  );
  const missingMigrations = EXPECTED_M11_MIGRATIONS.filter(
    (name) => !activeMigrations.includes(name),
  );

  const tables = await prisma.$queryRaw`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('ParticipantRankObservation')
    ORDER BY table_name
  `;

  const enums = await prisma.$queryRaw`
    SELECT t.typname AS enum_name
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname IN ('ParticipantRankResolutionStatus')
    ORDER BY t.typname
  `;

  const abandonedColumns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MatchParticipant'
      AND column_name IN ('rankResolutionStatus', 'rankResolvedAt')
    ORDER BY column_name
  `;

  const mpColumns = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'MatchParticipant'
    ORDER BY ordinal_position
  `;

  console.log('ABANDONED_TABLES=' + JSON.stringify(tables));
  console.log('ABANDONED_ENUMS=' + JSON.stringify(enums));
  console.log('ABANDONED_COLUMNS=' + JSON.stringify(abandonedColumns));
  console.log(
    'MATCHPARTICIPANT_HAS_rankTierAtIngestion=' +
      String(mpColumns.some((c) => c.column_name === 'rankTierAtIngestion')),
  );
  console.log(
    'MATCHPARTICIPANT_COLUMN_COUNT=' + String(mpColumns.length),
  );

  const incompatibilities = [];
  if (abandonedMigrationRows.length > 0) {
    incompatibilities.push({
      kind: 'abandoned_migration_rows',
      values: abandonedMigrationRows,
    });
  }
  if (unexpectedMigrations.length > 0) {
    incompatibilities.push({
      kind: 'unexpected_migrations',
      values: unexpectedMigrations,
    });
  }
  if (missingMigrations.length > 0) {
    incompatibilities.push({
      kind: 'missing_m11_migrations',
      values: missingMigrations,
    });
  }
  if (
    activeMigrations[activeMigrations.length - 1] !==
    '20260810130000_milestone_11_refresh_activity'
  ) {
    incompatibilities.push({
      kind: 'wrong_migration_head',
      values: [
        activeMigrations[activeMigrations.length - 1] ?? 'NONE',
      ],
    });
  }
  if (tables.length > 0) {
    incompatibilities.push({
      kind: 'abandoned_tables',
      values: tables.map((t) => t.table_name),
    });
  }
  if (enums.length > 0) {
    incompatibilities.push({
      kind: 'abandoned_enums',
      values: enums.map((e) => e.enum_name),
    });
  }
  if (abandonedColumns.length > 0) {
    incompatibilities.push({
      kind: 'abandoned_match_participant_columns',
      values: abandonedColumns.map((c) => c.column_name),
    });
  }

  if (incompatibilities.length > 0) {
    fail('database_not_m11_compatible', incompatibilities);
    process.exitCode = 2;
  } else {
    console.log('DB_BASELINE_COMPATIBLE');
    console.log('RESULT=M11_COMPATIBLE');
  }
} catch (error) {
  fail('db_probe_failed', {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
  });
  process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
