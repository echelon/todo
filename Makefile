# Convenience targets. Tauri CLI resolves the project from crates/todo-app.
APP_DIR := crates/todo-app

.PHONY: dev build run test check icons clean

dev:            ## run with hot-reload of the UI folder
	cd $(APP_DIR) && cargo tauri dev

build:          ## release build + installers in target/release/bundle
	cd $(APP_DIR) && cargo tauri build

run:            ## fast debug binary, no bundling
	cargo run -p todo-app

test:
	cargo test --workspace

check:
	cargo clippy --workspace --all-targets -- -D warnings
	cargo fmt --all -- --check

icons:          ## regenerate icons from the SVG sources
	cd $(APP_DIR) && cargo tauri icon icons-src/app-icon.svg -o icons && rm -rf icons/android icons/ios
	cd $(APP_DIR) && cargo tauri icon icons-src/tray.svg -o /tmp/todo-tray -p 64 && cp /tmp/todo-tray/64x64.png icons/tray.png

clean:
	cargo clean
