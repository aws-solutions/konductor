# Usage notes

`sync` walks regular files below the source directory. A dry run prints the files it would send and never writes to the storage stub.

`list` prints the objects currently known by the stub. Both commands accept the bucket, prefix, region, and verbosity options.

A missing source directory is an error. Empty directories are valid and produce a zero-file summary.
