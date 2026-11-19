# Release risk register

| Risk | Signal | Handling |
|---|---|---|
| session pressure during a regional increase | pool utilization and request retries | cap the first canary and stop on the approved error gate |
| bank contract not active | partner certification status | keep the adapter in health-check mode |
| records written in the wrong region | residency violation count | block the Veyra flag and page Privacy Engineering |
| low support coverage | staffed coverage percentage | wait for the named rota |

A routine certificate-renewal warning appears in adapter logs. The status thread records it as an existing warning with no failed authorizations; it is not a release blocker by itself.
