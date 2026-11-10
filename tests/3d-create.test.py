"""Keyless checks for the portable adapter's revision, routing and process handoff."""
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
SCRIPT = Path(__file__).resolve().parents[1] / 'claude-code/paean-3d-create/scripts/3d.py'
spec = importlib.util.spec_from_file_location('paean_3d', SCRIPT)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTest(unittest.TestCase):
    def test_wrong_revision_and_local_edits_stop_before_engine_execution(self):
        for results in [
            [subprocess.CompletedProcess([], 0, 'other\n')],
            [subprocess.CompletedProcess([], 0, adapter.REVISION + '\n'),
             subprocess.CompletedProcess([], 0, ' M harness/codeverse3d/cli.py\n')],
        ]:
            with patch.object(adapter.subprocess, 'run', side_effect=results):
                with self.assertRaises(ValueError):
                    adapter.checkout_path('/unused')

    def test_guides_select_one_language_without_loading_other_languages(self):
        with tempfile.TemporaryDirectory(prefix='paean-3d-guide-') as directory:
            root = Path(directory)
            expected = ['harness/skills/3dcodeverse/references/plan-scene.md',
                        'harness/skills/3d-lang-scene-threejs/SKILL.md',
                        'harness/skills/3d-lang-scene-threejs/references/interface.md']
            for relative in expected:
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('guide', encoding='utf-8')
            self.assertEqual(adapter.guide_paths(root, 'scene_threejs'), [str(root / p) for p in expected])
            with self.assertRaises(ValueError):
                adapter.guide_paths(root, 'blender')

    def test_git_writing_judge_and_implicit_workspace_are_rejected(self):
        for args in [['judge'], ['check'], ['check', '--workspace=/somewhere']]:
            with self.assertRaises(ValueError):
                adapter.runtime_command(Path('/engine'), sys.executable, None, args)

    def test_spaced_paths_and_arguments_are_preserved_without_a_shell(self):
        executable, args = adapter.runtime_command(Path('/engine with space'), sys.executable,
                                                    '/project with space', ['init', '--prompt', 'A $(not-a-command) sculpture'])
        self.assertEqual(args[0], executable)
        self.assertEqual(args[1], '-I')
        self.assertIn('/engine with space/harness', args)
        self.assertIn('A $(not-a-command) sculpture', args)
        self.assertEqual(args[-2:], ['--workspace', '/project with space'])

    def test_help_works_without_python_engine_dependencies(self):
        result = subprocess.run([sys.executable, str(SCRIPT), '--help'], capture_output=True, text=True, check=True)
        self.assertIn('checkout', result.stdout)
        self.assertEqual(result.stderr, '')


if __name__ == '__main__':
    unittest.main()
