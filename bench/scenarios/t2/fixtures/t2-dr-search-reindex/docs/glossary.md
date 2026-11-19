# Search glossary

**Alias**: A stable search name that points at one or more concrete indices. The read alias is the name used by clients.

**Bulk copy**: A scroll-and-bulk operation that reads documents from the current index and sends them to the replacement index.

**Generation**: The date-stamped concrete index built for one release. A generation is immutable after validation in the normal release flow.

**Control query**: A fixed query and expected-result set used to compare search behavior across releases.

**Writer lag**: The age of the oldest uncommitted product-change event for the writer deployment.

**Cutover**: The atomic alias update that changes which generation serves reads.

**Headroom**: Disk capacity kept unused for merges, replicas, snapshots, and recovery. The cluster sizing sheet expresses it as a minimum free percentage.
