VERSION?=patch

.PHONY: release clean build

release:
	npm version $(VERSION)
	npm run clean
	npm install
	npm run compile
	npx vsce publish

clean:
	npm run clean

build:
	npm run compile
