# Convenience targets. Tauri CLI resolves the project from crates/todo-app.
APP_DIR := crates/todo-app

.PHONY: dev build run test check icons clean ui ui-check ui-test harness

dev:            ## run with hot-reload of the UI folder
	cd $(APP_DIR) && cargo tauri dev

build:          ## release build + installers in target/release/bundle
	cd $(APP_DIR) && cargo tauri build

run:            ## fast debug binary, no bundling
	cargo run -p todo-app

test: ui-test  ## Rust + TypeScript unit tests
	cargo test --workspace

check: ui-check  ## lints and type checks
	cargo clippy --workspace --all-targets -- -D warnings
	cargo fmt --all -- --check

ui:             ## compile web/src (TypeScript) into ui/app.js, ui/vendor/editor.js, tools/harness/harness.js
	cd web && npm install --no-audit --no-fund && npm run build

ui-check:
	cd web && npm run typecheck

ui-test:
	cd web && npm test

harness:        ## run the browser scenario suite in headless Chrome (macOS path; adjust for your OS)
	@(python3 -m http.server 8765 --bind 127.0.0.1 >/dev/null 2>&1 & echo $$! > /tmp/todo-harness.pid); sleep 1; \
	"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
	  --window-size=470,630 --virtual-time-budget=30000 --dump-dom "http://127.0.0.1:8765/tools/harness/harness.html?autotest" 2>/dev/null \
	  | python3 -c 'import sys,re,html; d=sys.stdin.read(); m=re.search(r"<pre id=\"results\">(.*?)</pre>",d,re.S); print(html.unescape(m.group(1)) if m else "NO RESULTS")'; \
	kill $$(cat /tmp/todo-harness.pid)

icons:          ## regenerate icons from the SVG sources
	cd $(APP_DIR) && cargo tauri icon icons-src/app-icon.svg -o icons && rm -rf icons/android icons/ios
	cd $(APP_DIR) && cargo tauri icon icons-src/tray.svg -o /tmp/todo-tray -p 64 && cp /tmp/todo-tray/64x64.png icons/tray.png

clean:
	cargo clean
