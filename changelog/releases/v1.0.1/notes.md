Background MCP schema discovery failures no longer interrupt every Pi session with warning notifications. Unavailable server details remain accessible through /mcporter status while healthy integrations continue working.

## 🐞 Bug fixes

### Quiet background discovery failures

Background schema discovery failures from individual MCP servers no longer show warning notifications in every Pi session. Use `/mcporter status` to inspect unavailable servers and their errors while healthy integrations remain available.

*By @mavam and @codex in #14.*
