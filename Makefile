.PHONY: build test vet check dev install release

build:
	go build -o bin/appshome ./cmd/appshome

test:
	go test ./...

vet:
	go vet ./...

check:
	go run ./cmd/appshome check

dev:
	scripts/dev.sh

release:
	scripts/release.sh $(or $(VERSION),dev)

install:
	scripts/install.sh
