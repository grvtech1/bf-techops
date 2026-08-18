# API Unavailable

```bash
kubectl -n merchant-platform get pods -o wide
kubectl -n merchant-platform get svc,endpointslice merchant-api
kubectl -n merchant-platform describe deploy merchant-api
kubectl -n merchant-platform get events --sort-by=.lastTimestamp | tail -80
```

Follow the path in order: ALB target health, Service selector/endpoints, readiness response, container state, node state, then MySQL. Healthy pods with no endpoints indicates selector/readiness wiring; no Ready pods indicates release, configuration, dependency, resource, or node failure. Restore service through rollback or targeted repair and avoid blind restarts that erase evidence.

