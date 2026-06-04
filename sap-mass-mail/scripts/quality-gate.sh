#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

python3 - <<'PY'
import json
import xml.etree.ElementTree as ET
from pathlib import Path

for file_name in ["webapp/view/Main.view.xml", "webapp/view/DocumentLinkDialog.fragment.xml"]:
    ET.parse(file_name)
    print(f"xml-ok {file_name}")

json.loads(Path("webapp/manifest.json").read_text())
print("json-ok webapp/manifest.json")
PY

while IFS= read -r file_name; do
    echo "js-ok $file_name"
    node --check "$file_name" >/dev/null
done < <(find webapp -name '*.js' -type f | sort)

if find . -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \) | grep -q .; then
    echo "binary screenshot artifacts are not allowed" >&2
    exit 1
fi

if rg -n "_getServicePathFromManifest|mock/screenshots|visible=\"false\"|display:\s*none|sapMFileUploader|getRouter\(\)\.initialize|sap\.ui\.model\.json\.JSONModel" webapp abap README.md >/tmp/massmail_fragile_hits.txt; then
    cat /tmp/massmail_fragile_hits.txt >&2
    exit 1
fi
