vault_plugins := "/Users/josh/iCloud~md~obsidian/Documents/Notes/.obsidian/plugins/webp-paste"

setup:
    prek install --install-hooks

build:
	bun run build

install: build
	mkdir -p "{{vault_plugins}}"
	cp main.js manifest.json "{{vault_plugins}}/"

pc:
	prek run --all-files

release version:
	tmp=$(mktemp) && jq '.version = "{{version}}"' manifest.json > "$tmp" && mv "$tmp" manifest.json
	tmp=$(mktemp) && jq '.version = "{{version}}"' package.json > "$tmp" && mv "$tmp" package.json
	git add manifest.json package.json
	git commit -m "{{version}}"
	git tag -a "{{version}}" -m "{{version}}"
	git push origin main "{{version}}"
