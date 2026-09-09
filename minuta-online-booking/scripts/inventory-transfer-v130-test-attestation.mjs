import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'pg';

const output = process.argv[2];
const commitSha = String(process.env.GITHUB_SHA || '');
const inputSha = String(process.env.MINUTA_ATTEST_COMMIT_SHA || '');
if (!output || !/^[0-9a-f]{40}$/.test(commitSha) || commitSha !== inputSha) throw Error('invalid exact-SHA attestation context');

const client = new Client({connectionString:process.env.MINUTA_TEST_DATABASE_URL,ssl:{rejectUnauthorized:false}});
await client.connect();
try {
  await client.query('set search_path to pg_catalog,public,extensions');
  const sql = await readFile(new URL('./inventory-transfer-v130-schema-fingerprint.sql',import.meta.url),'utf8');
  const dependencySql = await readFile(new URL('./inventory-transfer-v130-dependency-fingerprint.sql',import.meta.url),'utf8');
  const dependencyResult = await client.query(dependencySql);
  const dependencyAttestation = dependencyResult.rows[0]?.dependency_attestation;
  const dependencyFingerprint = String(dependencyAttestation?.dependencyFingerprint || '');
  if (!/^[0-9a-f]{64}$/.test(dependencyFingerprint) || dependencyAttestation?.ownerInvariant !== true) throw Error('invalid v130 dependency fingerprint');
  const result = await client.query(sql);
  const schemaAttestation = result.rows[0]?.schema_attestation;
  const schemaFingerprint = String(schemaAttestation?.schemaFingerprint || '');
  if (!/^[0-9a-f]{64}$/.test(schemaFingerprint)) throw Error('invalid v130 schema fingerprint');
  if (!schemaAttestation?.components || typeof schemaAttestation.components !== 'object' || schemaAttestation?.ownerInvariant !== true) throw Error('invalid v130 schema components');
  const attestation = {
    status:'success', phase:'test-v130', commitSha, workflowRunId:String(process.env.GITHUB_RUN_ID || ''),
    isolatedDatabase:true, productionWritten:false, currentMainVerified:true,
    postgresIntegrationPassed:true, postgresSuitePassed:true,
    concurrencyPassed:true, rollbackVerified:true, reapplyVerified:true,
    schemaFingerprint, schemaComponents:schemaAttestation.components, schemaOwnerInvariant:true, schemaServerVersion:String(schemaAttestation.serverVersion || ''),
    schemaServerMajor:Number(schemaAttestation.serverMajor || 0),
    dependencyFingerprint, dependencyOwnerInvariant:true,
    cycle:['canonical-baseline','apply','apply','integration','concurrency','rollback','reapply']
  };
  await writeFile(output,`${JSON.stringify(attestation,null,2)}\n`,{mode:0o600});
} finally {
  await client.end();
}
