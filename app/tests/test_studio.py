"""Local-only regression tests. No agent credentials or model requests required."""
import asyncio
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lib import studio_core as core


class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        (self.root / "main.py").write_text("print('hello')\n")
        self.studio = core.Studio(Path(self.temp.name) / "state")

    def test_registration_deduplicates_and_rejects_broad_roots(self):
        first = self.studio.register(str(self.root), "Project")
        self.assertEqual(first, self.studio.register(str(self.root), "Renamed"))
        for root in ["relative", str(Path.home()), str(Path(self.root.anchor))]:
            with self.assertRaises(core.StudioError):
                self.studio.register(root, "")

    def test_paths_cannot_traverse_or_open_secrets(self):
        for path in ["../main.py", "/etc/passwd", "a/../main.py", "C:\\main.py", ".env", ".env.local", "credentials.json", "a/key.pem", ".git/config"]:
            with self.subTest(path=path), self.assertRaises(core.StudioError):
                core.read_file(self.root, path)

    @unittest.skipIf(os.name == "nt", "Symlink creation requires privileges on Windows")
    def test_symlinks_excluded_even_within_workspace(self):
        (self.root / "alias.py").symlink_to(self.root / "main.py")
        with self.assertRaises(core.StudioError):
            core.read_file(self.root, "alias.py")
        self.assertEqual([f['path'] for f in core.file_tree(self.root)['files']], ["main.py"])

    def test_tree_filters_generated_and_sensitive_files(self):
        for name in ["node_modules", ".git", ".venv"]:
            (self.root / name).mkdir()
            (self.root / name / "hidden.txt").write_text("hidden")
        (self.root / ".env").write_text("secret")
        (self.root / "secret.json").write_text("secret")
        self.assertEqual([f['path'] for f in core.file_tree(self.root)['files']], ["main.py"])

    def test_atomic_save_conflict_keeps_external_edits(self):
        original = core.read_file(self.root, "main.py")
        saved = core.save_file(self.root, "main.py", "first edit\n", original['digest'])
        self.assertNotEqual(saved['digest'], original['digest'])
        (self.root / "main.py").write_text("external edit\n")
        with self.assertRaises(core.StudioError) as error:
            core.save_file(self.root, "main.py", "overwrite", saved['digest'])
        self.assertEqual(error.exception.status, 409)
        self.assertEqual((self.root / "main.py").read_text(), "external edit\n")
        self.assertFalse(list(self.root.glob(".studio-save-*")))

    def test_binary_and_large_files_rejected(self):
        for data, status in [(b"a\x00b", 415), (b"\xff", 415), (b"a" * (core.MAX_FILE + 1), 413)]:
            (self.root / "data.txt").write_bytes(data)
            with self.assertRaises(core.StudioError) as error:
                core.read_file(self.root, "data.txt")
            self.assertEqual(error.exception.status, status)

    def test_checks_only_use_existing_manifest_keys(self):
        (self.root / "package.json").write_text(json.dumps({"scripts": {"test": "node test.js", "test:unit": "node unit.js", "deploy": "echo deploy", "test;echo": "echo bad"}}))
        self.assertEqual(core.test_scripts(self.root), ["test", "test:unit"])
        with self.assertRaises(core.StudioError):
            core.run_command(self.root, "test", "", "", "test;echo")

    def test_runtime_prompts_are_single_arguments_without_permission_bypass(self):
        prompt = "Review; $(echo never-run-by-shell)"
        with patch.object(core, 'executable', return_value='/usr/bin/runtime'), patch.dict(os.environ, {}, clear=True):
            for provider in ['copilot', 'claude', 'nemo']:
                command = core.run_command(self.root, 'agent', provider, prompt, '')
                self.assertIn(prompt, command)
                self.assertEqual(command.count(prompt), 1)
                self.assertFalse(any('bypass' in arg or 'allow-all' in arg or 'yolo' in arg for arg in command))

    @unittest.skipUnless(shutil.which("git"), "Git required")
    def test_git_reports_staged_and_working_changes(self):
        def git(*args):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        git("init")
        git("add", "main.py")
        git("-c", "user.name=Studio Test", "-c", "user.email=studio@example.invalid", "commit", "-m", "fixture")
        (self.root / "main.py").write_text("staged\n")
        git("add", "main.py")
        (self.root / "main.py").write_text("working\n")
        result = core.git_info(self.root)
        self.assertTrue(result['available'])
        self.assertIn("# Staged", result['diff'])
        self.assertIn("+working", result['diff'])
        nested = self.root / "nested"
        nested.mkdir()
        self.assertFalse(core.git_info(nested)['available'])

    def test_restart_marks_unknown_runs_interrupted(self):
        workspace = self.studio.register(str(self.root), "")
        with self.studio.db() as db:
            db.execute("INSERT INTO runs VALUES(?,?,?,?,?,?,?,?,?,?)", ("old", workspace['id'], "inspect", "", "", "", "running", 1, None, None))
        reopened = core.Studio(self.studio.state)
        self.assertEqual(reopened.run("old")['status'], "interrupted")


class RunTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "project"
        self.root.mkdir()
        self.studio = core.Studio(Path(self.temp.name) / "state")
        self.workspace = self.studio.register(str(self.root), "Project")['id']

    async def asyncTearDown(self):
        await self.studio.close()
        self.temp.cleanup()

    def submit_process(self, code):
        with patch.object(core, 'run_command', return_value=[sys.executable, '-u', '-c', code]):
            return self.studio.submit(self.workspace, "test", "", "", "test")

    async def test_inspection_persists_receipt(self):
        run = self.studio.submit(self.workspace, "inspect", "", "", "")
        await self.studio.tasks[run['id']]
        reopened = core.Studio(self.studio.state)
        receipt = reopened.run(run['id'])
        self.assertEqual(receipt['status'], 'succeeded')
        self.assertIn('No model was called', receipt['output'])
        self.assertEqual(receipt['exit_code'], 0)

    async def test_exit_code_and_output_are_real(self):
        for code, status in [(0, 'succeeded'), (7, 'failed')]:
            run = self.submit_process(f"print('actual process output'); raise SystemExit({code})")
            await self.studio.tasks[run['id']]
            receipt = self.studio.run(run['id'])
            self.assertEqual(receipt['status'], status)
            self.assertEqual(receipt['exit_code'], code)
            self.assertIn('actual process output', receipt['output'])

    async def test_only_one_active_task_and_queued_cancel(self):
        run = self.submit_process("import time; time.sleep(60)")
        with self.assertRaises(core.StudioError) as error:
            self.studio.submit(self.workspace, "inspect", "", "", "")
        self.assertEqual(error.exception.status, 409)
        receipt = await self.studio.cancel(run['id'])
        self.assertEqual(receipt['status'], 'cancelled')
        self.assertFalse(self.studio.processes)

    async def test_missing_runtime_does_not_create_run(self):
        with patch.object(core, 'executable', return_value=None):
            with self.assertRaises(core.StudioError):
                self.studio.submit(self.workspace, "agent", "claude", "Review", "")
        self.assertEqual(self.studio.runs(self.workspace), [])

    async def test_output_limit_stops_run(self):
        with patch.object(core, 'MAX_LOG', 1024):
            run = self.submit_process("print('x' * 4096)")
            await self.studio.tasks[run['id']]
        self.assertEqual(self.studio.run(run['id'])['status'], 'failed')
        self.assertIn('Output exceeded', self.studio.run(run['id'])['output'])

    @unittest.skipIf(os.name == 'nt', 'POSIX process-group regression')
    async def test_cancel_reaps_child_after_parent_exit(self):
        child = "import signal,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); print('child ready',flush=True); time.sleep(60)"
        code = f"import subprocess,sys; p=subprocess.Popen([sys.executable,'-u','-c',{child!r}]); print(p.pid,flush=True)"
        run = self.submit_process(code)
        for _ in range(100):
            if 'child ready' in self.studio.run(run['id'])['output']:
                break
            await asyncio.sleep(.02)
        self.assertIn('child ready', self.studio.run(run['id'])['output'])
        receipt = await asyncio.wait_for(self.studio.cancel(run['id']), 5)
        self.assertEqual(receipt['status'], 'cancelled')
        self.assertFalse(self.studio.processes)


class ApiTests(unittest.TestCase):
    def test_http_workspace_edit_and_origin_boundary(self):
        from fastapi import FastAPI, Request
        from fastapi.responses import JSONResponse
        from fastapi.testclient import TestClient
        from lib.studio_api import create_studio_router
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            (root / 'hello.txt').write_text('before')
            app = FastAPI()
            router, studio = create_studio_router(root, Path(directory) / 'state')
            app.include_router(router)
            @app.exception_handler(core.StudioError)
            async def errors(request: Request, error: core.StudioError):
                return JSONResponse(status_code=error.status, content={'detail': str(error)})
            with TestClient(app, base_url='http://localhost') as client:
                self.assertEqual(client.get('/api/studio/bootstrap', headers={'Host': 'evil.example'}).status_code, 403)
                self.assertEqual(client.get('/api/studio/bootstrap', headers={'Origin': 'https://evil.example'}).status_code, 403)
                token = client.get('/api/studio/bootstrap').json()['token']
                self.assertEqual(client.post('/api/studio/workspaces', json={'root': str(root)}).status_code, 403)
                client.headers['X-Studio-Token'] = token
                workspace = client.post('/api/studio/workspaces', json={'root': str(root)}).json()
                url = f"/api/studio/workspaces/{workspace['id']}/file"
                file = client.get(url, params={'path': 'hello.txt'}).json()
                file['content'] = 'after'
                self.assertEqual(client.put(url, json=file).status_code, 200)
                self.assertEqual(client.put(url, json=file).status_code, 409)
                self.assertEqual((root / 'hello.txt').read_text(), 'after')
                self.assertEqual(client.get(url, params={'path': '../state/studio.sqlite'}).status_code, 403)


if __name__ == '__main__':
    unittest.main()
