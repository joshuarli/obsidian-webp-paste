.PHONY: build package install install-remote release

VAULT_PLUGINS := /Users/josh/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/webp-paste
PACKAGE := webp-paste.zip
PACKAGE_FILES := main.js manifest.json

build:
	deno task build

package: build
	rm -f "$(PACKAGE)"
	zip -j "$(PACKAGE)" $(PACKAGE_FILES)

install: build
	mkdir -p "$(VAULT_PLUGINS)"
	cp main.js manifest.json "$(VAULT_PLUGINS)/"

install-remote:
	@set -eu; \
	command -v gh >/dev/null || { echo "install-remote requires the GitHub CLI (gh)" >&2; exit 1; }; \
	command -v unzip >/dev/null || { echo "install-remote requires unzip" >&2; exit 1; }; \
	remote_dir="$$(mktemp -d)"; \
	trap 'rm -rf "$$remote_dir"' EXIT; \
	tag="$$(gh release list --exclude-drafts --limit 100 --json tagName,isPrerelease,publishedAt --jq 'map(select(.isPrerelease)) | sort_by(.publishedAt) | reverse | .[0].tagName // empty')"; \
	test -n "$$tag" || { echo "No prerelease release found" >&2; exit 1; }; \
	echo "Downloading WebP Paste $$tag..."; \
	gh release download "$$tag" --pattern "$(PACKAGE)" --dir "$$remote_dir"; \
	unzip -q "$$remote_dir/$(PACKAGE)" -d "$$remote_dir/plugin"; \
	mkdir -p "$(VAULT_PLUGINS)"; \
	cp "$$remote_dir/plugin/main.js" "$$remote_dir/plugin/manifest.json" "$(VAULT_PLUGINS)/"

release:
	@test -n "$(VERSION)" || { echo "Usage: make release VERSION=x.y.z" >&2; exit 1; }
	tmp=$$(mktemp) && jq '.version = "$(VERSION)"' manifest.json > "$$tmp" && mv "$$tmp" manifest.json
	tmp=$$(mktemp) && jq '.version = "$(VERSION)"' package.json > "$$tmp" && mv "$$tmp" package.json
	git add manifest.json package.json
	git commit -m "$(VERSION)"
	git tag -a "$(VERSION)" -m "$(VERSION)"
	git push origin main "$(VERSION)"
