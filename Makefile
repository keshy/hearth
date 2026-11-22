.PHONY: build test vet dev install

build:
	go build -o bin/appshome ./cmd/appshome

test:
	go test ./...

vet:
	go vet ./...

dev:
	scripts/dev.sh

install:
	scripts/install.sh
