#!/usr/bin/env python3
import json, pathlib, re, sys, zipfile
ROOT = pathlib.Path(__file__).resolve().parent.parent
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
def fail(message):
    print(f"ERROR: {message}", file=sys.stderr); sys.exit(1)
def main():
    if len(sys.argv) != 2: fail("usage: python3 scripts/package_plugin.py <plugin-folder-name>")
    name = sys.argv[1]; folder = ROOT / "plugins" / name; manifest_path = folder / "manifest.json"
    if not manifest_path.is_file(): fail(f"{manifest_path.relative_to(ROOT)} not found")
    try: manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err: fail(f"manifest.json is invalid: {err}")
    for key in ("format", "id", "version", "dist"):
        if key not in manifest: fail(f"manifest.json is missing {key}")
    if manifest["format"] != 1: fail("manifest format must be 1")
    if not ID_RE.match(str(manifest["id"])): fail("invalid plugin id")
    script = manifest["dist"].get("script")
    if not script or "/" in script or "\\" in script: fail("dist.script must be a plain file name")
    bundle = folder / "build" / "js" / "index.js"
    if not bundle.is_file(): fail("bundle missing; run the Valenced CLI build first")
    out_dir = ROOT / "dist"; out_dir.mkdir(exist_ok=True)
    out = out_dir / f"{manifest['id']}@{manifest['version']}.zip"
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.write(manifest_path, arcname="manifest.json"); zf.write(bundle, arcname=script)
    with zipfile.ZipFile(out) as zf:
        if sorted(zf.namelist()) != sorted(["manifest.json", script]): fail("unexpected ZIP contents")
    print(f"OK {out}")
if __name__ == "__main__": main()
