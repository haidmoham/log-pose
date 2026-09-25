# log pose agent workflow

- start each parallel thread in its own git worktree and branch. create the worktree early, before exploration is likely to turn into edits.
- never let two threads modify the same working tree. keep `main` available for integration and use a separate checkout for feature work.
- check `git worktree list` and `git status` before editing, merging, or cleaning up. preserve work owned by other threads.
- land verified work on `main` through git. remove a thread's worktree only after its work is merged and the checkout is clean; do not remove another thread's worktree.

## extension standards

- keep names and control flow explicit. comments explain data grain, units, source time, arrival time, provenance, or a non-obvious invariant; they do not repeat the code.
- keep browser calculations in the pure research model, DOM primitives in the UI module, and route composition in the app or its named view module. update the architecture note when a contract or extension seam changes.
- preserve immutable evidence and its identifiers. add tested migrations; never rewrite an applied migration. use the raw → bronze → silver → gold read path for every durable record family, including ontology; `public` remains the current write storage until a tested physical migration moves it. treat `warehouse` as a legacy read-model seam, not a separate source of truth.
- document each shared dataset with its row grain, key, timestamps, and provenance. identity candidates remain leads until a reviewed company relationship says otherwise.
- when missing data blocks a task, make a bounded attempt to source the needed data. record sources checked, access or rights limits, failed retrievals, and the remaining gap. keep the attempt within the task's declared acquisition budget; ask before expanding that budget.

## publishing

- `https://github.com/haidmoham/log-pose` is the source repository. the Vercel `log-pose` project builds the static `web/` export from `main`, with routes in `vercel.json`.
- a push to `main` is the production publish path. verify the matching Vercel deployment and `https://logpose.mhaider.dev/` before reporting a release. check that the served HTML and `dashboard.json` match the pushed commit.
- Cloudflare owns `mhaider.dev` DNS. keep the `logpose` CNAME in DNS-only mode and use the target currently recommended by Vercel; verify authoritative DNS and TLS after any domain change.
- keep the old Sites project separate. do not treat a GitHub push as a Sites deployment or publish the same release through both hosts.
