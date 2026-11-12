# Research React Agent

## Tests

Offline tests for the section writing and source collection pipeline live in
`agent/tests/`. They use self-made fixtures (fake LLM / fake Tavily clients),
so no network access or API keys are required:

```bash
cd agent
python -m pytest tests
```
