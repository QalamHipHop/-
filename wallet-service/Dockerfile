FROM golang:1.22-alpine AS build
WORKDIR /app
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/wallet-service ./...

FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=build /out/wallet-service /wallet-service
USER nonroot:nonroot
EXPOSE 50053
ENTRYPOINT ["/wallet-service"]
