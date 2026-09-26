# Railway atlas deployment

## topology and current state

Vercel continues to serve the frontend and `/api/atlas`. setting its
`ATLAS_READ_SERVICE_URL` to the HTTPS Railway reader makes that endpoint proxy
bounded reads. Railway hosts one `atlas-read` Node service beside
`atlas-postgres` on its private network. the browser still calls its own origin.

the reader has four database connections, a 750 ms query work budget, a 1 MiB
response cap, one replica, and a proposed 256 MiB / 0.5 vCPU container limit.
the Vercel proxy times out after three seconds. failures return an explicit
unavailable response; they never substitute a different build or provider.

the user withdrew Railway deployment approval on 2026-09-25 to avoid recurring
hobby-project costs and chose to keep SQLite. do not apply this plan without new
authorization. see [the backend decision and free alternatives](atlas-backend-cost.md).

the private Railway project exists. no database, read-service deployment or
Vercel proxy setting has been applied. the checked-in S0 SQLite snapshots still
serve the preview without cloud database credentials. large scale receipts
are local measurements, not hosted performance claims.

`railway config plan` with CLI 5.62.1 evaluated this configuration against the
empty private project on 2026-09-25: **2 to add, 0 to change, 0 to destroy**
(`atlas-postgres` and `atlas-read`). the plan was read-only; it was not applied.

[`.railway/railway.ts`](../.railway/railway.ts) and
[`Dockerfile.atlas`](../Dockerfile.atlas) define the proposed backend. deployment
dependencies are isolated in `.railway/`. use CLI 5.42.1 or newer. Railway's
current [infrastructure-as-code workflow](https://docs.railway.com/infrastructure-as-code)
replaces per-service `railway.toml`; new services cannot opt into that legacy
format. do not introduce a second frontend deployment authority.

## bootstrap and release sequence

1. pass the PR's required `app-and-data-health` and Vercel checks. review the
   backend plan and approve its running cost before applying it. the Git source
   is `haidmoham/log-pose` on `main`; the reader cannot deploy this change until
   that branch contains its Dockerfile and service.
2. provision the private database. record its exact Postgres version, volume,
   backup policy and resource limits. start with S0 and one instance; neither
   HA nor PgBouncer is needed for a four-connection reader. do not import the
   synthetic S1/S2 capacity fixtures as research evidence.
3. use an administrator session for the additive migrations and the explicit
   [snapshot publisher](atlas-postgres.md). import both retained S0 builds,
   selecting `990c81ef7202ecab9a0c9bf8185c459537dd1d48d7981d2839a297ed242396b5`
   as current. import the earlier `969c7f43e62ddc409484bf41b9e3309741fd78199437f1e752732dbaf42204f8`
   with `--no-current`. migration and import are never request-time work.
4. create an `atlas_reader` login using a generated secret supplied outside
   source control. grant `CONNECT` on the atlas database, `USAGE` on `gold`,
   and `SELECT` on its six `atlas_*` views. give it no evidence-table or DDL
   privileges. configure `default_transaction_read_only=on`. place its private
   connection URL in the environment's `ATLAS_READER_DATABASE_URL` shared
   secret. the service must not receive the administrator credential.
5. apply the reviewed read-service configuration. `/healthz` is ready only when
   discovery reads a validated current snapshot. generate an HTTPS Railway
   service domain, then verify discovery, top-k, exact premises, old build
   links and explicit error responses there.
6. set `ATLAS_READ_SERVICE_URL` on the Vercel preview first and deploy the exact
   reviewed commit. repeat the browser and API checks through that preview.
   enable production only after its approval and required checks. leave the
   frontend custom domain and DNS unchanged.

private mode is accepted only for `*.railway.internal` database hosts. Railway
documents its private network as an encrypted WireGuard mesh. external direct
database connections use certificate verification; a supplied CA can be set
with `ATLAS_DATABASE_CA`. never disable verification for an external host.
see [private networking](https://docs.railway.com/networking/private-networking).

## restore and rollback

the SQLite derivative and manifests are independently restorable serving
inputs. before release, exercise a backup restore into a separate disposable
database and republish from the retained files. reconcile build IDs, all row
counts, exact premise IDs/hashes, top-k order and discovery. test with the
SELECT-only role as well as the importer role.

the publisher commits validated imports with `ready=false`, then runs
VACUUM/ANALYZE before a final reconciliation. readiness and `atlas_current`
change together in the final transaction. a failed import or maintenance step
keeps the prior current pointer; a staged build stays hidden from the reader
and can be resumed by rerunning the command. rerunning the publisher for a
retained ready build is the pointer rollback path.
rolling the service code back does not repair evidence or remove new builds.
restoring the previous Vercel environment setting is a separate operational
rollback; never fall back silently during a request.

the disposable Postgres tests exercise publication, idempotence and failed
imports. a Railway volume backup restore and deployed SELECT-only-role check
remain release work, not claims established by those unit/integration tests.

## cost and observation

Railway charges for actual usage. its published rates include roughly $10 per
GB-month of RAM, $20 per vCPU-month, $0.15 per GB-month of volume storage and
$0.05 per GB of egress. a planning estimate of 0.5–1 GiB for Postgres plus
0.125–0.25 GiB for the reader implies about $6–13 per month for memory alone;
CPU, storage, egress and plan terms add to this. this is not a quote or a spend
cap. set the agreed budget controls and verify actual usage before claiming a
monthly operating cost. [pricing](https://railway.com/pricing)

on 2026-09-25 Railway announced tracing in Priority Boarding preview, free
accountless temporary VMs, and OpenCode support for Cloud Agents. tracing is a
useful next measurement seam: edge spans can locate request overhead, while
application/database spans require instrumentation. the temporary VMs have a
60-minute work window, so this plan uses persistent Postgres.
[release notes](https://railway.com/changelog/2026-09-25-free-vms-without-an-account)

other recent database changes include one-click Postgres major upgrades on
September 11 and CLI support for HA, PITR and PgBouncer on September 4. those
capabilities are available options; this milestone neither upgrades an existing
database nor establishes a need for HA or a pooler.
[upgrade release](https://railway.com/changelog/2026-09-11-one-click-postgres-major-version-upgrades),
[database CLI release](https://railway.com/changelog/2026-09-04-postgres-in-the-railway-cli)
