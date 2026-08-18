# Evidence

Generated evidence belongs under `evidence/runs/<UTC timestamp>-<label>/` and is excluded from Git because logs and cluster state may contain environment details. Publish only a reviewed, redacted evidence summary in `docs/evidence/`.

Minimum evidence for a release or incident claim:

- Git revision and all deployed image digests.
- Argo CD revision, sync, and health state.
- Kubernetes nodes, workloads, placement, endpoints, and relevant events.
- Smoke-test output proving the business path.
- Prometheus query or alert state tied to the incident.
- Timeline, hypothesis, evidence, action, verification, and prevention decision.

