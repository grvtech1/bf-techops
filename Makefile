.PHONY: bootstrap preflight test validate build up down kind deploy addons monitoring alert-test argocd smoke evidence restore-drill configure-production release-gate

bootstrap:
	bash scripts/bootstrap-local.sh

preflight:
	bash scripts/preflight.sh

test:
	npm test

validate:
	npm run validate

build:
	npm run build

up:
	docker compose up --build -d

down:
	docker compose down --remove-orphans

kind:
	bash scripts/bootstrap-kind.sh

deploy:
	bash scripts/deploy-local.sh

addons:
	bash scripts/install-aws-addons.sh

monitoring:
	bash scripts/install-observability.sh

alert-test:
	bash scripts/verify-alert-delivery.sh

argocd:
	bash scripts/install-argocd.sh

smoke:
	bash scripts/smoke-test.sh

evidence:
	bash scripts/collect-evidence.sh manual

restore-drill:
	bash scripts/verify-backup-restore.sh

configure-production:
	bash scripts/configure-production.sh

release-gate:
	bash scripts/release-gate.sh
