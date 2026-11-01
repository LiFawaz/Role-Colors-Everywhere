#!/usr/bin/env python3
import json, pathlib, sys, zipfile
def main():
    if len(sys.argv) != 2: print("usage: python3 scripts/check_zip.py <file.zip>"); return 2
    path = pathlib.Path(sys.argv[1])
    if not path.is_file() or not zipfile.is_zipfile(path): print(f"FAIL {path} is missing or not a ZIP"); return 1
    with zipfile.ZipFile(path) as zf:
        names = zf.namelist()
        if "manifest.json" not in names: print("FAIL no root manifest.json"); return 1
        try: manifest = json.loads(zf.read("manifest.json").decode("utf-8"))
        except Exception as err: print(f"FAIL invalid manifest: {err}"); return 1
        script = manifest.get("dist", {}).get("script")
        if manifest.get("format") != 1 or not manifest.get("id") or not manifest.get("version") or not script or script not in names:
            print("FAIL manifest metadata or bundle entry is invalid"); return 1
        if sorted(names) != sorted(["manifest.json", script]): print(f"FAIL unexpected ZIP entries: {names}"); return 1
        print(f"OK {path.name}: {manifest['id']} {manifest['version']}")
    return 0
if __name__ == "__main__": sys.exit(main())
