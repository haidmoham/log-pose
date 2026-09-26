# atlas infrastructure

this directory owns only the Railway atlas backend. the frontend remains on
Vercel. install these deployment-only dependencies with `npm ci --prefix .railway`.
use Railway CLI 5.42.1 or newer and Node 22 or newer.

link the private `log-pose` project, then run `railway config plan` from the
repository root. review the plan before applying it. the configuration creates
one Postgres database and one read service; it makes no DNS changes.

the service requires the environment's `ATLAS_READER_DATABASE_URL` shared
secret. create the SELECT-only role and publish a validated build before
starting the reader. do not substitute the database administrator URL.
see [bootstrap, recovery, and release checks](../docs/atlas-railway.md).

this is a whole-project configuration. do not add unrelated resources to this
Railway project: a later apply can remove resources omitted from this file.
the app does not load this SDK or evaluate this configuration at runtime.
