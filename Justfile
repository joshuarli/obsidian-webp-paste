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
