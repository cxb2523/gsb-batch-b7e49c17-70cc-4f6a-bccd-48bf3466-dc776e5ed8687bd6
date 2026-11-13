# Extract / Unzip

`extract` and `unzip` unpack a downloaded archive into the directory that holds
it. They share one implementation, so both apply the same safety rules. Use
`extract` for new workflows; `unzip` is the historical name and keeps working.

Supported formats are ZIP (`.zip`), TAR (`.tar`), compressed TAR (`.tar.gz`,
`.tgz`) and GZIP (`.gz`). Each extracted file becomes its own pipeline entry,
with `src_fn` pointing at the archive it came from.

## Safety

Extraction never uses a bare `zipfile`/`tarfile` call. Each archive is validated
before anything is published, and a rejected archive publishes **no files at
all** — not even the members that were already processed. Validation raises
`UnsafeArchiveError`, a `ValueError` subclass, and the hook logs the reason and
passes the original entry through.

An archive is rejected when:

- a member path is absolute, or resolves outside the output directory
  (path traversal such as `../evil.txt`, including backslash and `a//b` forms);
- two selected members map to the same output path, including duplicate names,
  paths that normalise to the same place (`a//b`, `a\b`, `a/./b`), and a file
  with the same name as a directory;
- the member count exceeds `max_members`, or the total uncompressed size
  exceeds `max_total_size`.

TAR symlinks, hard links, device nodes and FIFOs are never created. Only
regular files are extracted, and a ZIP entry is always written as a regular
file even when its stored mode claims to be a link.

An existing output is reused when `overwrite` is false and the file matches the
archive entry: ZIP and GZIP compare size and CRC32, TAR compares size only
(TAR records no content checksum). Otherwise the member is extracted again.

## Configuration

| Argument | Default | Behavior |
| --- | --- | --- |
| `remove` | `False` | Delete the original archive after a successful extraction. It is kept when extraction fails. |
| `overwrite` | `False` | Re-extract and replace existing outputs instead of reusing matching ones. |
| `members` | `None` | Only extract members whose basename or full path matches one of these patterns (substring or `fnmatch`). A single string is treated as one pattern. |
| `max_members` | `None` | Reject an archive with more than this many selected members. |
| `max_total_size` | `None` | Reject an archive whose selected outputs total more than this many uncompressed bytes. Enforced on the bytes actually decompressed, so understated headers do not help. |
| `stage` | `file` | Run after each file is acquired. |

`max_members` and `max_total_size` default to no limit. Set them when the
archives come from an untrusted third-party site.

## Entry handling

- An entry whose `status` is not `0`, or that has no `dst_fn`, passes through
  unchanged.
- A file that is not a recognised archive format passes through unchanged,
  without an error.
- An unsafe archive or an extraction failure is logged, the original entry is
  returned unchanged, and the remaining entries are still processed.

## CLI example

```bash
# Extract only GeoTIFFs and remove the archive, with a size ceiling
fetchez build charts --hook "extract:members=.tif,remove=true,max_total_size=500000000"

# The historical name behaves identically
fetchez build charts --hook "unzip:overwrite=true,max_members=100"
```

Inspect the registered arguments:

```bash
fetchez hooks info extract
```
