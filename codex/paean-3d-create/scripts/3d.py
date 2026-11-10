#!/usr/bin/env python3
"""Run pinned 3DCodeVerse instruments through the host agent's shell permissions."""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REVISION = "69c1cb98035cf947fabf5e14c69cf6fa5f367242"
LANGUAGES = {
    "threejs": "static", "blender": "static", "cadquery": "static",
    "scene_threejs": "scene", "scene_blender": "scene",
    "urdf_blender": "articulated", "glsl_shader": "graphics", "opengl_python": "graphics",
}


def checkout_path(value):
    """Refuse a missing, different, or locally modified engine checkout."""
    root = Path(value).expanduser().resolve()
    for args in (["rev-parse", "HEAD"], ["status", "--porcelain", "--untracked-files=no", "--", "harness"]):
        result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, check=True)
        if args[0] == "rev-parse" and result.stdout.strip() != REVISION:
            raise ValueError("3DCodeVerse revision differs from the supported pin; use a separate pinned checkout.")
        if args[0] == "status" and result.stdout.strip():
            raise ValueError("3DCodeVerse harness has local edits; preserve them and use a clean pinned checkout.")
    if not (root / "harness/codeverse3d/cli.py").is_file():
        raise ValueError("The checkout is missing harness/codeverse3d/cli.py.")
    return root


def guide_paths(root, language):
    """Return only the selected track and language references, without loading all skills."""
    skills = root / "harness/skills"
    language_dir = skills / ("3d-lang-" + language.replace("_", "-"))
    paths = [skills / "3dcodeverse/references" / ("plan-" + LANGUAGES[language] + ".md"),
             language_dir / "SKILL.md", language_dir / "references/interface.md"]
    if not all(p.is_file() for p in paths):
        raise ValueError("Pinned language references are incomplete; repair the checkout before authoring.")
    return [str(p) for p in paths]


def runtime_command(root, python, workspace, arguments):
    """Build an isolated Python invocation; the upstream verdict and exit code are preserved."""
    if not arguments:
        raise ValueError("Name an instrument, for example: run --workspace /absolute/project check")
    tool = arguments[0].replace("_", "-")
    if tool == "judge":
        raise ValueError("Use check, then judge-pack and score. Upstream judge creates Git commits and tags.")
    if any(a in ("--workspace", "-w") or a.startswith("--workspace=") or a.startswith("-w=")
           for a in arguments[1:]):
        raise ValueError("Put --workspace before the instrument name so its output directory is explicit.")
    if tool not in ("doctor", "list", "--help", "--version") and workspace is None:
        raise ValueError("This instrument requires an explicit --workspace before its name.")
    executable = shutil.which(python)
    if executable is None:
        raise ValueError("Python executable not found; follow references/setup.md and pass --python.")
    # -I excludes the caller's Python startup hooks; only the verified engine is prepended.
    entry = ("import sys; "
             "sys.version_info >= (3,13) or sys.exit('3DCodeVerse requires Python 3.13 or newer'); "
             "sys.path.insert(0, sys.argv.pop(1)); "
             "from codeverse3d.cli import main; sys.exit(main())")
    argv = [executable, "-I", "-c", entry, str(root / "harness"), *arguments]
    if workspace is not None:
        argv += ["--workspace", str(Path(workspace).expanduser().resolve())]
    return executable, argv


def main():
    """Resolve an explicit engine and either locate guides or replace this process with its CLI."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True, help="checkout pinned to " + REVISION)
    parser.add_argument("--python", default=sys.executable, help="isolated Python 3.13+ environment")
    sub = parser.add_subparsers(dest="command", required=True)
    guide = sub.add_parser("guides", help="locate the selected language's authoring references")
    guide.add_argument("language", choices=LANGUAGES)
    run = sub.add_parser("run", help="run an instrument; read PASS/FAIL/ERROR, not just the exit code")
    run.add_argument("--workspace")
    run.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    try:
        root = checkout_path(args.checkout)
        if args.command == "guides":
            print(json.dumps({"revision": REVISION, "files": guide_paths(root, args.language)}, indent=2))
            return 0
        executable, argv = runtime_command(root, args.python, args.workspace, args.arguments)
        env = {**os.environ, "C3D_RUNTIME_JS": str(root / "harness/runtime_js")}
        os.execve(executable, argv, env)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        print("ERROR: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
