import glob
import re


def fix_file(filepath):
    with open(filepath, "r", encoding="utf-8") as f:
        original = f.read()

    # Fix markdown links whose text and URL are the same dotted identifier.
    # Only when URL matches link text exactly (guaranteed corruption).
    pattern = re.compile(
        r"\[([a-zA-Z_$][a-zA-Z0-9_$]*(?:\.[a-zA-Z_$][a-zA-Z0-9_$]*)+)\]"
        r"\(https?://\1\)"
    )
    fixed = pattern.sub(r"\1", original)

    if fixed != original:
        count = len(pattern.findall(original))
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(fixed)
        print(f"Fixed {count} in: {filepath}")
        return count
    return 0


total = 0
patterns = [
    "app/**/*.tsx",
    "app/**/*.ts",
    "components/**/*.tsx",
    "components/**/*.ts",
    "lib/**/*.ts",
    "lib/**/*.tsx",
    "hooks/**/*.ts",
    "hooks/**/*.tsx",
]
for p in patterns:
    for fp in glob.glob(p, recursive=True):
        if ".next" not in fp and "node_modules" not in fp:
            total += fix_file(fp)

print(f"\nTotal fixed: {total}")
