# log pose agent workflow

- start each parallel thread in its own git worktree and branch. create the worktree early, before exploration is likely to turn into edits.
- never let two threads modify the same working tree. keep `main` available for integration and use a separate checkout for feature work.
- check `git worktree list` and `git status` before editing, merging, or cleaning up. preserve work owned by other threads.
- land verified work on `main` through git. remove a thread's worktree only after its work is merged and the checkout is clean; do not remove another thread's worktree.

## publishing

- `https://github.com/haidmoham/log-pose` is the source repository. the Vercel `log-pose` project builds the static `web/` export from `main`, with routes in `vercel.json`.
- a push to `main` is the production publish path. verify the matching Vercel deployment and `https://logpose.mhaider.dev/` before reporting a release. check that the served HTML and `dashboard.json` match the pushed commit.
- keep the old Sites project separate. do not treat a GitHub push as a Sites deployment or publish the same release through both hosts.
