# syntax=docker/dockerfile:1.7
FROM golang:1.22-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/wallet-service ./cmd/wallet

FROM alpine:3.20
RUN apk add --no-cache ca-certificates wget tini && addgroup -S rial && adduser -S rial -G rial
COPY --from=build /out/wallet-service /usr/local/bin/wallet-service
USER rial
EXPOSE 8081 9091
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8081/healthz || exit 1
ENTRYPOINT ["/sbin/tini","--"]
CMD ["wallet-service"]
