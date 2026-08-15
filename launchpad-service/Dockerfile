FROM golang:1.22-alpine AS build
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/launchpad-service ./cmd/launchpad

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/launchpad-service /launchpad-service
USER nonroot:nonroot
EXPOSE 50054
ENTRYPOINT ["/launchpad-service"]
