Fixes a slow startup caused by npm auto-installing peer dependencies that pi already provides at runtime.

## 🐞 Bug fixes

### Remove peerDependencies to avoid npm auto-installing pi runtime

Drop the peerDependencies section from package.json. npm 7+ auto-installs peer deps, which pulled in the entire pi runtime stack. Pi provides these modules at runtime via its module loader.

*By @mavam and @claude.*
