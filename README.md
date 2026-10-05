# E-Property

**Үл хөдлөх хөрөнгө үүсэхээс өмчлөх хүртэл.**

Digital Property Platform for Mongolia — a private distribution of
[Gerege Nexus](https://github.com/gerege-systems/nexus-gerege-private).

- Repository: https://github.com/gerege-systems/e-property-mn
- Target production origin: https://e-property.mn
- Core: `backend/v1.20.2`, exact source commit recorded in [core.lock](core.lock).
- Distribution entry point: [main.go](main.go); the core remains an upstream Go dependency.
- Branding: [brand/](brand/), applied through Nexus runtime brand settings.

This first release provides the Nexus platform foundation: authentication,
organizations, membership and permissions. Property projects, units, reservations,
contracts, payments and registry integrations are planned product modules;
they are not implemented by this initial distribution.

## Build and validate

Requires Go 1.26 (the module selects its patch toolchain), GitHub access to the
private core, and Docker Buildx. Frontend dependencies use the core's lockfile.

```sh
gh auth setup-git
export GOPRIVATE=github.com/gerege-systems/nexus-gerege-private
go build -o bin/e-property .
go vet ./...
go test -race ./...
python3 deploy/check-config.py
bash deploy/prepare-core.sh
```

CI checks the Go distribution and production configuration, tests/lints the pinned
frontend, then builds both container images. Successful main builds publish
immutable commit-SHA tags to `ghcr.io/gerege-systems/e-property-mn`.
The shared security workflow runs on changes and every Monday.

## Production

See [deployment instructions](docs/deployment.mn.md). Application ports bind only
to loopback; Postgres and Redis have no host ports. Nginx terminates TLS. Operator
console access stays disabled until an operator host and allowlist are provisioned.

Automatic deployment is gated by the repository variable `DEPLOY_ENABLED=true`
and successful CI for the current main commit. This switch remains off until the
production server and pinned SSH host key have been provisioned. A configured
pipeline is not evidence of a live deployment.

## Product planning

- [Product and architecture blueprint](docs/platform-blueprint.mn.md)
- [Brand and landing brief](docs/brand-and-landing.mn.md)
- [Original project brief](docs/initial-project-brief.mn.md)
- [Improvements and 3D visualization strategy](docs/improvements-and-3d.mn.md)
- [Mobile app build prompt](docs/mobile-app-prompt.mn.md)

These planning documents describe future scope. The user-selected product name
for this distribution is **E-Property** (docs/brand-and-landing.mn.md).

Private project. Upstream Gerege Systems copyright and rights remain applicable.
