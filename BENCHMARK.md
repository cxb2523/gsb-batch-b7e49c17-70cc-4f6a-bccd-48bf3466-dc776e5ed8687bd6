# SkillHawk Benchmark

SkillHawk ships with a small, reproducible **synthetic benchmark** for its static detection rules.

The benchmark is intentionally transparent: it includes easy positives, benign negatives, and several hard cases that expose known false positives and false negatives. It is **not** an independent security audit and must not be interpreted as real-world malware detection accuracy.

## Current snapshot

| Metric | Result |
|---|---:|
| Fixtures | **50** |
| Malicious / suspicious fixtures | **33** |
| Safe fixtures | **17** |
| Detection rules | **15** |
| True positives | **32** |
| False positives | **0** |
| True negatives | **17** |
| False negatives | **1** |
| Precision | **100%** |
| Recall | **96.97%** |
| F1 | **96.88%** |
| Specificity | **100%** |
| Accuracy | **98%** |

This snapshot is reproduced by the repository CI benchmark job, not hand-entered from an unverified local run.

### Defensive-context handling

The benchmark treats a fixture as detected ("malicious" prediction) only when it
produces a non-defensive finding. Matches inside defensive prose are still
recorded on each fixture as `defensiveMatches` for review, but they do not count
as detections because they quote dangerous patterns rather than request them.

## Reproduce it

```bash
npm run benchmark
```

Machine-readable output:

```bash
npm run benchmark -- --json
```

The benchmark runs in CI as a regression gate. It currently requires at least 40 labeled fixtures and both precision and recall of at least 90%.

## Dataset design

The fixtures live in [`benchmark/fixtures.js`](benchmark/fixtures.js). They are synthetic and contain no live credentials or active harmful payloads.

The positive set covers all 15 current SkillHawk rules, including remote script execution, encoded commands, destructive filesystem operations, credential access, persistence, privilege escalation, outbound uploads, broad permissions, prompt-injection patterns, dynamic shell execution, unpinned `npx`, and recursive access.

The negative set contains normal agent instructions and hard negatives that mention dangerous strings in defensive documentation.

## Defensive documentation (formerly false positives)

Two safe fixtures deliberately document the limitation of regex-only line
scanning and now exercise SkillHawk's defensive-context classifier:

- **S15:** defensive documentation quotes a `curl ... | bash` command, which matches `SH001`.
- **S16:** defensive documentation mentions `~/.ssh/id_rsa`, which matches `SH004`.

Both still produce findings — nothing is silently dropped — but each is flagged
`defensive: true` with an explainable reason, excluded from scoring and risk,
and downgraded to `note` in SARIF. They are therefore counted as true negatives
rather than false positives. A line that combines defensive wording with an
explicit instruction to run the command remains an actionable finding.

## Known false negatives

Suspicious fixtures document coverage gaps:

- **M33:** MCP configuration launching a shell with elevated privileges (`{"command":"sudo","args":["bash","./server.sh"]}`). Expected rule: `SH006`; observed result: no finding / clean (false negative) because command and arguments are separate JSON fields.

This case is intentionally retained so benchmark improvements represent real rule improvements rather than deleting difficult cases.

## Metric definitions

- **Precision:** TP / (TP + FP)
- **Recall:** TP / (TP + FN)
- **F1:** harmonic mean of precision and recall
- **Specificity:** TN / (TN + FP)
- **Accuracy:** (TP + TN) / all fixtures

## Scope and limitations

This benchmark measures the current labeled synthetic fixture set only. Real repositories are more complex, and SkillHawk remains a first-pass heuristic static scanner. A clean result is not proof of safety, and a finding is not proof of malicious intent.
