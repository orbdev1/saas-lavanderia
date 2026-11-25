FROM golang:1.27.4-bookworm AS build
WORKDIR /src
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/lavanda ./cmd/api

FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* && useradd -u 10001 -m app
COPY --from=build /out/lavanda /usr/local/bin/lavanda
COPY apps/api/migrations /app/apps/api/migrations
WORKDIR /app/apps/server
USER app
ENV NODE_ENV=production GO_LISTEN_ADDR=0.0.0.0:3000
EXPOSE 3000
CMD ["lavanda"]
