# Engine setup

The adapter supports [3DCodeVerse](https://github.com/gaoypeng/3dcodeverse) 0.0.15 at commit `69c1cb98035cf947fabf5e14c69cf6fa5f367242`. Code is Apache-2.0; the separately licensed dataset is not part of this skill. This skill contains an integration adapter and original workflow guidance, not the upstream engine or dataset. Retain upstream license notices when distributing its code.

Use Git, Python 3.13+ and, for Three.js, Node 20.6+ with npm. The helper itself supports Python 3.9+. On Windows use `py -3.13` to create the environment and its `Scripts/python.exe` afterward. On macOS/Linux use the selected Python executable and `bin/python`. Do not modify system Python, proxies or VPN settings.

Pick a new engine directory outside signed applications, installed skills and the creative project. The following POSIX commands create a sparse checkout containing only the engine and license; use equivalent paths in PowerShell. Stop if the target already exists rather than resetting it.

```sh
ENGINE="$HOME/.local/share/paean/3dcodeverse-69c1cb98035c"
git clone --filter=blob:none --no-checkout https://github.com/gaoypeng/3dcodeverse.git "$ENGINE"
git -C "$ENGINE" sparse-checkout set --no-cone /harness/ /LICENSE /LICENSE.md
git -C "$ENGINE" checkout --detach 69c1cb98035cf947fabf5e14c69cf6fa5f367242
python3.13 -m venv "$ENGINE/.venv"
PYTHON="$ENGINE/.venv/bin/python"
"$PYTHON" -m pip install "$ENGINE/harness"
```

Only install extras required by the selected route: `"$ENGINE/harness[cad]"`, `[urdf]`, `[graphics]` or `[mesh]`. Base requirements include native geometry dependencies; if a wheel is unavailable, report the platform/toolchain error rather than modifying the engine or disabling a check. The engine pin fixes source and the JavaScript lockfile; Python dependency ranges are upstream's, so save `pip freeze` with test evidence for reproducibility.

For Three.js or browser-rendered shaders:

```sh
PUPPETEER_SKIP_DOWNLOAD=true npm --prefix "$ENGINE/harness/runtime_js" ci
```

Use an existing compatible Chrome with process-level `PUPPETEER_EXECUTABLE_PATH`, or explicitly download Puppeteer's matching Chrome when rendering is required:

```sh
cd "$ENGINE/harness/runtime_js"
npx --no-install puppeteer browsers install chrome
```

Blender routes require Blender 5.2+ and its matching Python packages; follow the pinned engine's `harness/docs/INSTALL.md`. Select its executable with process-level `C3D_BINARIES__BLENDER`. Do not install all optional renderers just to make every `doctor` row green.

The adapter verifies the source commit and tracked engine edits before each invocation, sets `C3D_RUNTIME_JS` to that checkout, and runs the selected interpreter in isolated mode. It preserves `C3D_*` tuning and process network settings. It replaces its own process rather than creating a background supervisor; the host shell owns cancellation. Upstream instruments may create renderer children and write source/artifacts in the explicit project. This is version checking, not a security sandbox or a dependency signature guarantee.

Keep authored source in the project, not the engine checkout. Review and test a newer engine before changing the pin in `scripts/3d.py` and this document together.
