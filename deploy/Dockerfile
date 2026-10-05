# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build
RUN apk add --no-cache git
ENV GOPRIVATE=github.com/gerege-systems/nexus-gerege-private GOTOOLCHAIN=auto
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=secret,id=github_token \
    token="$(cat /run/secrets/github_token)" && \
    GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=url.https://x-access-token:${token}@github.com/.insteadOf \
    GIT_CONFIG_VALUE_0=https://github.com/ go mod download
COPY main.go ./
ARG VERSION=1.28.0
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w -X github.com/gerege-systems/nexus-gerege-private/backend/internal/kernel/config.PlatformVersion=${VERSION}" -o /out/api .
RUN CGO_ENABLED=0 go build -trimpath -o /out/migrate github.com/gerege-systems/nexus-gerege-private/backend/cmd/migrate && \
    CGO_ENABLED=0 go build -trimpath -o /out/operator-bootstrap github.com/gerege-systems/nexus-gerege-private/backend/cmd/operator-bootstrap && \
    CGO_ENABLED=0 go build -trimpath -o /out/tenant-bootstrap github.com/gerege-systems/nexus-gerege-private/backend/cmd/tenant-bootstrap
RUN core=$(go list -m -f '{{.Dir}}' github.com/gerege-systems/nexus-gerege-private/backend) && cp -R "$core/db" /out/db
FROM alpine:3.24
RUN apk add --no-cache ca-certificates tzdata && addgroup -S app && adduser -S -G app app && mkdir -p /var/lib/nexus && chown app:app /var/lib/nexus
ENV TZ=Asia/Ulaanbaatar
WORKDIR /app
COPY --from=build /out/ ./
COPY --from=core catalog/ ./catalog/
USER app
EXPOSE 8080
CMD ["/app/api"]
