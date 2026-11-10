"""Opt-in real-engine regression: build a contact fixture, then detect 50 mm geometry defects."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--checkout', required=True)
parser.add_argument('--python', required=True)
parser.add_argument('--render', action='store_true', help='also exercise the configured browser renderer')
args = parser.parse_args()
script = Path(__file__).resolve().parents[1] / 'claude-code/paean-3d-create/scripts/3d.py'
with tempfile.TemporaryDirectory(prefix='paean-3d-integration-') as directory:
    workspace = Path(directory) / 'project with spaces'

    def run(*command):
        completed = subprocess.run([args.python, str(script), '--checkout', args.checkout, '--python', args.python,
                                    'run', '--workspace', str(workspace), *command, '--json'],
                                   capture_output=True, text=True, check=True)
        observation = json.loads(completed.stdout)
        assert observation['failed'] is False, observation
        return observation

    run('init', '--track', 'static_object', '--language', 'threejs', '--prompt', 'Two contacting cylindrical test parts')
    parts = [
        {'name': 'Base', 'role': 'support', 'description': 'Cylinder, radius 0.2 m and height 0.2 m.',
         'bbox': {'center': [0, 0.1, 0], 'extents': [0.4, 0.2, 0.4]}, 'material': 'matte blue'},
        {'name': 'Top', 'role': 'upper part', 'description': 'Cylinder, radius 0.1 m and height 0.2 m.',
         'bbox': {'center': [0, 0.3, 0], 'extents': [0.2, 0.2, 0.2]}, 'attach_to': 'Base', 'material': 'matte teal'},
    ]
    (workspace / 'plan.json').write_text(json.dumps({
        'object_name': 'ContactProbe', 'summary': 'Two contacting cylinders, 0.4 m wide and tall.',
        'overall_bbox': {'center': [0, 0.2, 0], 'extents': [0.4, 0.4, 0.4]},
        'style_notes': 'Blue and teal.', 'parts': parts,
        'acceptance': [{'id': 'a1', 'text': 'Two parts contact.', 'how': 'measure', 'priority': 'must'}],
    }), encoding='utf-8')
    assert run('validate-plan')['ok'] is True
    results = []
    for label, gap in [('contact', 0), ('floating_50mm', 0.05), ('penetration_50mm', -0.05)]:
        (workspace / 'src/object.js').write_text('''export function build(THREE) {
          const root = new THREE.Group(); root.name = 'ContactProbe';
          for (const [name, radius, height, y, color] of [
            ['Base', 0.2, 0.2, 0.1, 0x23477d], ['Top', 0.1, 0.2, %s, 0x43b5a4]
          ]) {
            const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 96),
              new THREE.MeshStandardMaterial({color}));
            mesh.name = name; mesh.position.y = y; root.add(mesh);
          }
          return root;
        }
        ''' % (0.3 + gap), encoding='utf-8')
        result = run('check')
        assert result['ok'] == (gap == 0), result
        assert result['numbers']['gates']['connectivity'] == (gap == 0), result
        assert (workspace / 'artifacts/object.glb').stat().st_size > 0
        results.append({'case': label, 'ok': result['ok'], 'connectivity': result['numbers']['gates']['connectivity']})
        if gap == 0 and args.render:
            rendered = run('render-views', '--size', '256')
            assert rendered['ok'] is True, rendered
            assert len(rendered['images']) >= 5, rendered
            assert all(Path(p).stat().st_size > 100 for p in rendered['images'])
    print(json.dumps({'cases': results, 'rendered': args.render}, indent=2))
