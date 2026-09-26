import { defineRailway, github, postgres, project, service } from 'railway/iac';

export default defineRailway((context) => {
  if (context.projectName && context.projectName !== 'log-pose') {
    throw new Error('this configuration belongs to the log-pose project');
  }
  const database = postgres('atlas-postgres');
  const reader = service('atlas-read', {
    source: github('haidmoham/log-pose', { branch: 'main' }),
    build: { builder: 'DOCKERFILE', dockerfilePath: 'Dockerfile.atlas' },
    start: 'node scripts/atlas_service.js',
    healthcheck: '/healthz',
    healthcheckTimeout: 60,
    replicas: 1,
    deploy: {
      restartPolicyType: 'ON_FAILURE',
      restartPolicyMaxRetries: 3,
      limitOverride: { containers: { cpu: 0.5, memoryBytes: 268435456 } }
    },
    env: {
      NODE_ENV: 'production',
      // Bootstrap a SELECT-only role before setting this shared secret.
      ATLAS_DATABASE_URL: context.shared.ATLAS_READER_DATABASE_URL,
      ATLAS_DATABASE_TLS: 'private'
    }
  });
  return project('log-pose', { resources: [database, reader] });
});
