# Device WASM and i64 compatibility

A simulator boot does not validate the phone's WASM engine or its JavaScript interface. Both case games initially failed on a user's phone in this order: `Can't find variable: Buffer`, then `invalid wasm file`, then `Invalid argument type in ToBigInt operation`. All three failures happened in the shared adapter before the original game could run. Keep these distinct from engine, gameplay or shader faults.

The Base64 import-time fix is described in `actual-runtime.md`. The other two boundaries require both changes below.

## Compile the same layout source to MVP

The npm `taffy-layout@4.0.0` binary uses reference-types, multivalue, bulk-memory, sign-extension and nontrapping float conversion. A validator with those extensions disabled rejects it at the first externref parameter. Rebuild the exact upstream v4.0.0 commit `69d768736c2deacc1de41b029931997549c46ba5`, retaining Taffy 0.15.1 and Cargo.lock. This changes the binary feature profile, not the layout implementation.

The skill ships the rebuilt WASM and generated JS in `assets/adapter/vendor/taffy-wechat/`, with the upstream MIT license and artifact hashes. Routine builds need only `npm ci`; Rust and Binaryen are needed only to reproduce this vendor artifact. `verify-vendor.mjs` rejects mismatched WASM/binding/ABI files before packaging.

Use Rust 1.92.0, wasm-bindgen CLI 0.2.106, Binaryen 132 and WABT 1.0.39. Rebuild `std` too: disabling features only on the final crate can leave newer instructions in precompiled dependencies. Pin the actual `RUSTC` path; on this Mac a Homebrew rustc otherwise overrode the intended rustup compiler.

The script uses these per-process flags:

```text
RUSTC_BOOTSTRAP=1
RUSTFLAGS=-C target-cpu=mvp -C target-feature=-reference-types,-multivalue,-bulk-memory,-nontrapping-fptoint,-sign-ext
cargo build --release --locked --target wasm32-unknown-unknown -Z build-std=std,panic_abort
```

It runs wasm-bindgen with `--target web`, Binaryen `-O2 --mvp-features --strip-debug --strip-producers`, then legalizes the JS interface and validates the final MVP binary. It does not change rustup's default toolchain or system network settings.

## Preserve all 64 bits at the native boundary

MVP validation alone did not fix the phone. The rebuilt binding still passed `i64` parameters directly between JavaScript and WASM; the phone raised a ToBigInt error. Treat support for JS BigInt, internal WASM i64 instructions, and native JS/WASM i64 integration as separate capabilities.

`legalize-wasm.mjs` reads the original typed import/export signatures and applies Binaryen's `legalize-js-interface` pass. It asserts no i64 parameters/results remain at that interface. The current binding returns 64-bit node IDs through linear memory; an upstream change to direct i64 results deliberately fails the builder until its return ABI is implemented and tested.

`wasm-abi.js` uses the generated `i64-abi.json`: outgoing BigInts become signed low/high i32 words; incoming words become an exact signed 64-bit BigInt, with the original binding still performing unsigned conversion where required. Original node IDs and layout math remain unchanged. Never coerce the entire ID through `Number`, truncate it to 32 bits, or replace IDs with unrelated counters. The native boundary carries numbers while the original JS binding retains BigInts.

Generated JS has only two checked ABI seams: import construction and instance-export assignment. Separately, the port builder redirects WASM loading to `WXWebAssembly.instantiate` with a package path and supplies the explicit packaged fallback filename. The [official Mini Game WASM guide](https://developers.weixin.qq.com/minigame/dev/guide/performance/perf-webassembly.html) documents package-path loading; it does not establish that every browser-generated binary or JS interface will work on every phone.

## Reproduce and verify

Prepare a clean checkout of the pinned upstream tag, install the indicated Rust target and rust-src for 1.92.0, and obtain the matching wasm-bindgen binary from its official release (verify its published SHA-256). Install `binaryen@132.0.0` and `wabt@1.0.39` in an isolated tooling directory. Then, from the copied adapter directory:

```sh
node rebuild-taffy.mjs \
  --source /absolute/clean/taffy-layout \
  --out /absolute/empty/generated-output \
  --bindgen /absolute/wasm-bindgen \
  --opt /absolute/tools/node_modules/.bin/wasm-opt \
  --binaryen /absolute/tools/node_modules/binaryen/index.js \
  --validate /absolute/tools/node_modules/.bin/wasm-validate
```

Review all generated files together before replacing `vendor/taffy-wechat/`. Provenance records hashes of the resulting artifacts; compiler build paths can affect byte hashes across builds. Run `npm test`, build both real sources, run `scripts/check-built-runtime.cjs` on both final packages, then verify the exact final output in DevTools and on the affected phone.

The regression suite compares the compatible module against the npm module for the exported API and 24 flex/grid scenes. It checks exact low/high-word round trips including values above 2^53 and signed/unsigned 64-bit boundaries, and tests every mapped import/export signature. Existing DOM/WASM tests exercise text measurement, hidden UI, SVG sizing, touch cancellation and hide/show scheduling.

Current acceptance: both case bundles boot and preserve gameplay entry in DevTools after the i64 bridge; a new temporary phone preview has been supplied and its result is pending. The earlier user-reported failures remain evidence against claiming device success for the earlier previews. No full feature, visual, audio, performance or service parity claim follows from these regressions.
