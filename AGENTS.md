# log pose agent workflow

- start each parallel thread in its own git worktree and branch. create the worktree early, before exploration is likely to turn into edits.
- never let two threads modify the same working tree. keep `main` available for integration and use a separate checkout for feature work.
- check `git worktree list` and `git status` before editing, merging, or cleaning up. preserve work owned by other threads.
- land verified work on `main` through git. remove a thread's worktree only after its work is merged and the checkout is clean; do not remove another thread's worktree.
