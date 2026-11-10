# Routes and delivery

| Request | Track / language | Dependencies and output |
|---|---|---|
| Web game object or prop | `static_object` / `threejs` | Python base, Three.js; GLB and editable JS; browser renderer for previews |
| Composed web scene | `scene` / `scene_threejs` | Python base, Three.js and Chrome; authored JS scene, cameras and previews |
| Blender asset or scene | `static_object` / `blender`, `scene` / `scene_blender` | Blender 5.2+, engine base packages; Blender source and rendered/exported assets |
| Dimensioned CAD part | `static_object` / `cadquery` | Python `[cad]`; CAD source and geometry exports |
| Articulated mechanism | `articulated_object` / `urdf_blender` | Blender, Python `[urdf]`; named links, joints and pose checks |
| Fragment shader | `graphics` / `glsl_shader` | Node/Chrome WebGL; GLSL source and sampled frames |
| Python graphics | `graphics` / `opengl_python` | Python `[graphics]` and a working OpenGL context; Python source and sampled frames |

Run `guides LANGUAGE` to find the matching plan and interface files in the pinned checkout. Read only the chosen language. Check the initialized specification for output paths; not every route emits a GLB or a self-contained HTML game.

For Three.js, `src/object.js` exports `build(THREE)` for an asset. Its root contains objects named after plan parts. A `scene_threejs` project has a different runtime interface and camera requirements: read its own interface rather than reusing the asset entry. The engine owns `src/lib/` where present; modify authored scene modules instead of patching that runtime to make checks pass.

Bounding boxes and contact checks complement visual inspection. They do not establish gameplay, mobile performance, watertight printable geometry or mechanical safety. Validate the actual target application before claiming those properties. Imported reference images and assets retain their own licensing requirements.
