# hobby backend decision

on 2026-09-25 the user withdrew Railway deployment approval to avoid recurring
cost, then chose to keep the existing SQLite backend. no Railway database or
reader was deployed. the private project contains no services. deployment plans
remain optional code, not an active service or an instruction to provision one.

the public read path uses immutable SQLite snapshots bundled with the existing
Vercel function. the current inventory snapshot is about 6.15 MB; the reviewed
claims derivative is about 88 KB. this adds no separate database bill. it does
not assert that the current Vercel account is on a particular plan or that all
hosting usage is free. canonical evidence writes remain in the retained
Postgres workflow; public requests are read-only.

## alternatives checked

official limits checked on 2026-09-25. these are capacity comparisons, not hosted
latency measurements. no account, upgrade or deployment was created.

| option | free allowance relevant here | implication for this project |
| --- | --- | --- |
| [Neon](https://neon.com/blog/neon-backend-is-ga) | 0.5 GB storage and 100 CU-hours per project per month | closest fit to the existing Postgres provider; current data fits, measured 1.19 GB S1 Postgres fixture does not |
| [Supabase](https://supabase.com/pricing) | 500 MB database, 5 GB egress; pauses after a week of inactivity | current data fits; S1 does not; its extra auth/storage services are not needed for this read-only route |
| [Turso](https://turso.tech/pricing) | 5 GB storage, 500 million rows read and 10 million rows written monthly; no card required | storage accommodates the measured 687 MB S1 SQLite fixture; requires a libSQL provider and measured parity/latency checks |
| [Cloudflare D1](https://developers.cloudflare.com/d1/platform/limits/) | 500 MB per free database, 5 GB per account | current data fits; S1 needs partitioning or paid capacity and a Worker binding adapter |

Neon's free compute [suspends after five minutes](https://neon.com/docs/manage/endpoints/).
its wake latency would need measurement before claiming fast cold requests.
free storage allowances are not substitutes for row, compute, request or transfer
budgets. Turso overages require enabling them; this project has not enabled any.

## packaging correction

Vercel's standard Node function limit is 250 MB uncompressed. its current
[Large Functions beta](https://vercel.com/docs/functions/limitations#large-functions)
also permits up to 5 GB on eligible Fluid Compute projects using Active CPU
billing, with an opt-in for existing projects. earlier scale notes treated
250 MB as an absolute platform limit; that was incomplete. neither the beta nor
the 687 MB / 3.43 GB fixtures have been deployed here. package eligibility,
startup cost and cold latency remain unmeasured. no opt-in setting was applied.

keep the small bundled snapshots now. reconsider a remote provider only after
real retained data or write requirements exceed this deployment, using measured
size, query work and the user's budget. synthetic scale fixtures do not by
themselves justify a recurring hobby-project bill.
