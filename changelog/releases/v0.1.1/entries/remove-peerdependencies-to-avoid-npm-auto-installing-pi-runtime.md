---
title: Remove peerDependencies to avoid npm auto-installing pi runtime
type: bugfix
authors:
  - mavam
  - claude
created: 2026-02-28T15:15:45.363868Z
---

Drop the peerDependencies section from package.json. npm 7+ auto-installs peer deps, which pulled in the entire pi runtime stack. Pi provides these modules at runtime via its module loader.
