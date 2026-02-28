This release improves startup performance by shipping and loading a precompiled extension bundle instead of transpiling TypeScript at runtime.

## 🐞 Bug fixes

### Load precompiled extension bundle on startup

Ship a precompiled dist/index.js bundle and register that as the extension entrypoint instead of loading TypeScript sources at runtime. This reduces startup overhead from jiti transpilation and module graph loading during pi launch.

*By @mavam and @claude.*
