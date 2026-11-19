# Makefile for Webhook Integration Service

.PHONY: help test lint start dev clean

help:
	@echo "Available commands:"
	@echo "  test    - Run tests"
	@echo "  lint    - Run lint check"
	@echo "  start   - Start production server"
	@echo "  dev     - Start development server (with nodemon)"
	@echo "  clean   - Remove temporary files"

test:
	npm test

lint:
	npm run lint

start:
	npm start

dev:
	npm run dev || echo "Dev script not configured, use: node --watch src/index.js"

clean:
	rm -rf node_modules coverage .nyc_output

# Docker commands
docker-build:
	docker build -t webhook-service:latest .

docker-run:
	docker run -p 3000:3000 \
		-e WEBHOOK_SECRET=$${WEBHOOK_SECRET} \
		-e NOTIFY_SECRET=$${NOTIFY_SECRET} \
		webhook-service:latest

docker-compose-up:
	docker-compose up -d

docker-compose-down:
	docker-compose down