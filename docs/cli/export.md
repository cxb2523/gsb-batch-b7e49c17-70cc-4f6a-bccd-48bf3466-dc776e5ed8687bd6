# Export

Export the published PPoS Dex data points to a `.csv` file, for your own
analysis.

```text
$ uv run pposdex export --help
{{#include help/export.txt}}
```

The data points published with the selected `--algo-threshold` are written to
`ppos_dex_data.csv`, in the current directory.

Before exporting, every note fetched from the publisher is accounted for: the
command prints how many notes were valid data points, skipped for not
complying with the schema, skipped for failing msgpack decoding, or filtered
out because their `algo_threshold` does not match the requested one.
Threshold filtering is expected history, not an error. Only the valid data
points reach the CSV: its columns are the schema fields present in at least
one of them, and older records missing a field leave that column empty
instead of being zero-filled. If no valid data point is found, the command
fails reporting the publisher address and the starting block, together with
the counts above.
