export function buildDatabaseUrl(): string | undefined {
  const discreteDbEnvIsSet =
    !!process.env.DATABASE_HOST ||
    !!process.env.DATABASE_PORT ||
    !!process.env.DATABASE_USERNAME ||
    !!process.env.DATABASE_PASSWORD ||
    !!process.env.DATABASE_NAME ||
    !!process.env.DATABASE_SCHEMA;

  if (discreteDbEnvIsSet) {
    return buildDatabaseUrlFromParts();
  }

  return process.env.DATABASE_URL ?? undefined;
}

function buildDatabaseUrlFromParts(): string | undefined {
  const host = process.env.DATABASE_HOST?.trim() || '';
  const port = process.env.DATABASE_PORT?.trim() || '';
  const username = process.env.DATABASE_USERNAME?.trim() || '';
  const password = process.env.DATABASE_PASSWORD ?? '';
  const dbName = process.env.DATABASE_NAME?.trim() || '';
  const schema = process.env.DATABASE_SCHEMA?.trim() || 'public';

  if (!host || !port || !username || !dbName) return undefined;

  const encodedPassword = encodeURIComponent(password);
  return `postgresql://${username}:${encodedPassword}@${host}:${port}/${dbName}?schema=${encodeURIComponent(schema)}`;
}
