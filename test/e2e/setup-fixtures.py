"""
Builds the fixtures for the real-VS-Code end-to-end suite (test/e2e).

Run it with the CodePulse BACKEND's Python (the one with `codepulse` installed), e.g.

    C:\\path\\to\\CodePulse\\.venv\\Scripts\\python.exe test\\e2e\\setup-fixtures.py \\
        --test-repo C:\\path\\to\\Test_Repo --test-repo-other C:\\path\\to\\Test_Repo_Other

What it creates under <workdir>/fixtures (default: <extension repo>/.e2e/fixtures), all disposable:
  - copies of the two sample projects (never indexes or writes to the originals),
  - a folder that is never indexed (NotIndexed/),
  - a two-folder multi-root workspace file,
  - a fresh database with both sample projects indexed, and a codepulse.toml in Test_Repo
    pinning that database (so a server the extension launches from that folder finds it),
  - an admin API key scoped to both repositories (key.txt), and fixtures.json.

The real codepulse.db is never touched; the database lives in the fixtures folder.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def main() -> int:
    ext_root = Path(__file__).resolve().parents[2]
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--test-repo", required=True, help="the main sample project (indexed as repository 1)")
    parser.add_argument("--test-repo-other", required=True, help="a second, small sample project (repository 2)")
    parser.add_argument("--workdir", default=str(ext_root / ".e2e"), help="where fixtures are built")
    parser.add_argument("--port", type=int, default=8200, help="port the test server will use")
    args = parser.parse_args()

    workdir = Path(args.workdir).resolve()
    fixtures = workdir / "fixtures"
    if fixtures.exists():
        if fixtures.name != "fixtures" or workdir not in fixtures.parents:
            raise SystemExit(f"refusing to delete {fixtures}")
        shutil.rmtree(fixtures)
    fixtures.mkdir(parents=True)

    skip = shutil.ignore_patterns("codepulse.db", "codepulse.toml", ".venv", "node_modules", "__pycache__", ".pytest_cache")
    for src, name in ((args.test_repo, "Test_Repo"), (args.test_repo_other, "Test_Repo_Other")):
        shutil.copytree(src, fixtures / name, ignore=skip)

    (fixtures / "NotIndexed").mkdir()
    (fixtures / "NotIndexed" / "lonely.py").write_text("def lonely():\n    return 1\n", encoding="utf-8")
    (fixtures / "two.code-workspace").write_text(
        json.dumps({"folders": [{"path": "Test_Repo"}, {"path": "Test_Repo_Other"}], "settings": {}}), encoding="utf-8"
    )

    db_path = fixtures / "cliq.db"
    db_url = f"sqlite:///{db_path.as_posix()}"
    (fixtures / "Test_Repo" / "codepulse.toml").write_text(f'db_url = "{db_url}"\n', encoding="utf-8")

    from codepulse.auth import create_api_key
    from codepulse.indexer.engine import IndexingEngine
    from codepulse.storage.db import StorageManager

    storage = StorageManager(db_url=db_url)
    engine = IndexingEngine(storage=storage)
    ids = []
    for name in ("Test_Repo", "Test_Repo_Other"):
        folder = (fixtures / name).resolve()
        result = engine.index_directory(str(folder), repo_name=name, repo_url=str(folder))
        ids.append(result["repository_id"])
        print(f"indexed {name}: id {result['repository_id']}, {result['total_files']} files, {result['total_symbols']} symbols")
    key = create_api_key(storage, "e2e", repository_ids=ids, role="admin")
    (fixtures / "key.txt").write_text(key.raw_key, encoding="utf-8")
    storage.engine.dispose()

    (fixtures / "fixtures.json").write_text(
        json.dumps({"port": args.port, "binDir": os.path.dirname(sys.executable), "dbUrl": db_url, "repositoryIds": ids}, indent=2),
        encoding="utf-8",
    )
    print(f"fixtures ready in {fixtures}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
