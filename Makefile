.PHONY: build install release

VAULT_PLUGINS := /Users/josh/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/webp-paste

build:
	deno task build

install: build
	mkdir -p "$(VAULT_PLUGINS)"
	cp main.js manifest.json "$(VAULT_PLUGINS)/"

release:
	@test -n "$(VERSION)" || { echo "Usage: make release VERSION=x.y.z" >&2; exit 1; }
	tmp=$$(mktemp) && jq '.version = "$(VERSION)"' manifest.json > "$$tmp" && mv "$$tmp" manifest.json
	tmp=$$(mktemp) && jq '.version = "$(VERSION)"' package.json > "$$tmp" && mv "$$tmp" package.json
	git add manifest.json package.json
	git commit -m "$(VERSION)"
	git tag -a "$(VERSION)" -m "$(VERSION)"
	git push origin main "$(VERSION)"
