"""Build and render one volumetric female mannequin with six skeletal actions.

Run with Blender 4.5 LTS:
  blender.exe --background --python build_and_render.py
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path

import bpy
from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "mp4"
OUT.mkdir(exist_ok=True)
MOTIONS = ("abduction", "elbow", "hip", "knee", "foot", "head")
FPS, FRAME_END = 30, 96


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials,
                       bpy.data.cameras, bpy.data.lights, bpy.data.armatures):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material(name, color, metallic=0.0, roughness=0.48):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Specular IOR Level"].default_value = 0.32
    return mat


def smooth(obj):
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True
        bevel = obj.modifiers.new("Soft anatomical edges", "BEVEL")
        bevel.width = 0.015
        bevel.segments = 2
    return obj


def keep_bone_parent(obj, arm, bone):
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = "BONE"
    obj.parent_bone = bone
    obj.matrix_world = world
    obj["rig_part"] = bone
    return obj


def uv(name, location, scale, mat, arm=None, bone=None, segments=40, rings=24):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    if arm and bone:
        keep_bone_parent(obj, arm, bone)
    return obj


def segment(name, a, b, r1, r2, mat, arm, bone):
    a, b = Vector(a), Vector(b)
    vec = b - a
    mid = (a + b) * 0.5
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=r1, radius2=r2, depth=vec.length, location=mid)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(vec.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    smooth(obj)
    keep_bone_parent(obj, arm, bone)
    return obj


def torus(name, location, major, minor, mat, arm, bone, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor,
                                    major_segments=40, minor_segments=12,
                                    location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    smooth(obj)
    keep_bone_parent(obj, arm, bone)
    return obj


def add_bone(arm_data, name, head, tail, parent=None, connected=False):
    bone = arm_data.edit_bones.new(name)
    bone.head, bone.tail = head, tail
    if parent:
        bone.parent = arm_data.edit_bones[parent]
        bone.use_connect = connected
    return bone


def create_rig():
    data = bpy.data.armatures.new("FemaleAnatomyArmature")
    arm = bpy.data.objects.new("Female anatomy mannequin — one rig", data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    arm.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    add_bone(data, "root", (0, 0, 0.05), (0, 0, 0.55))
    add_bone(data, "pelvis", (0, 0, 1.90), (0, 0, 2.38), "root")
    add_bone(data, "spine", (0, 0, 2.28), (0, 0, 3.18), "pelvis")
    add_bone(data, "chest", (0, 0, 3.08), (0, 0, 3.82), "spine")
    add_bone(data, "neck", (0, 0, 3.80), (0, 0, 4.12), "chest")
    add_bone(data, "head", (0, 0, 4.10), (0, 0, 4.65), "neck")

    add_bone(data, "upper_arm.L", (-0.68, 0, 3.70), (-0.83, 0, 2.80), "chest")
    add_bone(data, "forearm.L", (-0.83, 0, 2.80), (-0.97, 0, 2.00), "upper_arm.L", True)
    add_bone(data, "hand.L", (-0.97, 0, 2.00), (-1.00, -0.02, 1.72), "forearm.L", True)
    add_bone(data, "upper_arm.R", (0.68, 0, 3.70), (0.83, 0, 2.80), "chest")
    add_bone(data, "forearm.R", (0.83, 0, 2.80), (0.97, 0, 2.00), "upper_arm.R", True)
    add_bone(data, "hand.R", (0.97, 0, 2.00), (1.00, -0.02, 1.72), "forearm.R", True)

    add_bone(data, "thigh.L", (-0.33, 0, 2.10), (-0.33, 0, 1.10), "pelvis")
    add_bone(data, "shin.L", (-0.33, 0, 1.10), (-0.33, 0, 0.22), "thigh.L", True)
    add_bone(data, "foot.L", (-0.33, 0, 0.22), (-0.33, -0.48, 0.13), "shin.L", True)
    add_bone(data, "thigh.R", (0.33, 0, 2.10), (0.33, 0, 1.10), "pelvis")
    add_bone(data, "shin.R", (0.33, 0, 1.10), (0.33, 0, 0.22), "thigh.R", True)
    add_bone(data, "foot.R", (0.33, 0, 0.22), (0.33, -0.48, 0.13), "shin.R", True)

    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.show_in_front = False
    arm.hide_render = True
    return arm


def build_woman(arm):
    skin = material("Warm neutral skin", (0.63, 0.30, 0.19), roughness=0.58)
    skin_light = material("Face accent", (0.74, 0.40, 0.27), roughness=0.55)
    cloth = material("Graphite sportswear", (0.10, 0.14, 0.17), roughness=0.40)
    cloth_2 = material("Sportswear side panels", (0.20, 0.29, 0.32), roughness=0.36)
    hair = material("Dark brown hair", (0.055, 0.025, 0.018), roughness=0.72)
    eye = material("Eyes", (0.025, 0.035, 0.035), roughness=0.30)
    joint = material("Joint marker", (0.02, 0.52, 0.56), metallic=0.10, roughness=0.25)

    # Torso and sportswear: curved volumes, not cards or sprites.
    uv("Abdomen", (0, 0, 2.76), (0.43, 0.27, 0.66), skin, arm, "spine")
    uv("Sports bra torso", (0, -0.005, 3.40), (0.64, 0.34, 0.58), cloth, arm, "chest")
    uv("Sports bra left cup", (-0.19, -0.245, 3.42), (0.22, 0.145, 0.20), cloth_2, arm, "chest")
    uv("Sports bra right cup", (0.19, -0.245, 3.42), (0.22, 0.145, 0.20), cloth_2, arm, "chest")
    uv("Shorts and pelvis", (0, 0, 2.18), (0.53, 0.35, 0.43), cloth, arm, "pelvis")
    uv("Left hip panel", (-0.39, -0.03, 2.18), (0.17, 0.32, 0.34), cloth_2, arm, "pelvis")
    uv("Right hip panel", (0.39, -0.03, 2.18), (0.17, 0.32, 0.34), cloth_2, arm, "pelvis")

    # Head, face, ears and hair are all bone-parented so head rotation is rigid.
    uv("Neck volume", (0, 0, 3.98), (0.16, 0.16, 0.30), skin, arm, "neck")
    uv("Head", (0, -0.015, 4.48), (0.31, 0.27, 0.40), skin_light, arm, "head")
    uv("Hair cap", (0, 0.055, 4.59), (0.322, 0.285, 0.33), hair, arm, "head")
    uv("Hair bun", (0, 0.285, 4.68), (0.18, 0.16, 0.18), hair, arm, "head")
    uv("Nose", (0, -0.294, 4.50), (0.052, 0.09, 0.075), skin_light, arm, "head", 28, 16)
    uv("Eye L", (-0.105, -0.265, 4.58), (0.027, 0.018, 0.026), eye, arm, "head", 20, 12)
    uv("Eye R", (0.105, -0.265, 4.58), (0.027, 0.018, 0.026), eye, arm, "head", 20, 12)
    uv("Ear L", (-0.31, -0.005, 4.50), (0.045, 0.035, 0.085), skin_light, arm, "head", 24, 14)
    uv("Ear R", (0.31, -0.005, 4.50), (0.045, 0.035, 0.085), skin_light, arm, "head", 24, 14)

    # Arms and hands.
    for side, x in (("L", -1), ("R", 1)):
        sh = (0.68*x, 0, 3.70); el = (0.83*x, 0, 2.80); wr = (0.97*x, 0, 2.00)
        segment(f"Upper arm {side}", sh, el, 0.145, 0.115, skin, arm, f"upper_arm.{side}")
        uv(f"Shoulder {side}", sh, (0.17, 0.17, 0.18), skin, arm, f"upper_arm.{side}")
        segment(f"Forearm {side}", el, wr, 0.115, 0.075, skin, arm, f"forearm.{side}")
        uv(f"Elbow {side}", el, (0.125, 0.12, 0.125), skin, arm, f"upper_arm.{side}")
        uv(f"Hand {side}", (1.0*x, -0.02, 1.83), (0.10, 0.075, 0.22), skin_light, arm, f"hand.{side}")

    # Legs and feet.
    for side, x in (("L", -1), ("R", 1)):
        hp = (0.33*x, 0, 2.10); kn = (0.33*x, 0, 1.10); an = (0.33*x, 0, 0.22); to = (0.33*x, -0.48, 0.13)
        segment(f"Thigh {side}", hp, kn, 0.205, 0.155, skin, arm, f"thigh.{side}")
        segment(f"Shin {side}", kn, an, 0.15, 0.095, skin, arm, f"shin.{side}")
        uv(f"Knee {side}", kn, (0.16, 0.15, 0.16), skin, arm, f"thigh.{side}")
        segment(f"Foot core {side}", an, to, 0.105, 0.13, skin_light, arm, f"foot.{side}")
        uv(f"Foot/toes {side}", to, (0.14, 0.21, 0.085), skin_light, arm, f"foot.{side}")

    # A constant joint marker object per target. Visibility is switched by action.
    markers = {}
    marker_specs = {
        "abduction": ((0.68, 0, 3.70), 0.22, "upper_arm.R", (math.pi/2, 0, 0)),
        "elbow": ((0.83, 0, 2.80), 0.17, "upper_arm.R", (math.pi/2, 0, 0)),
        "hip": ((0.33, 0, 2.10), 0.23, "thigh.R", (math.pi/2, 0, 0)),
        "knee": ((0.33, 0, 1.10), 0.19, "thigh.R", (math.pi/2, 0, 0)),
        "foot": ((0.33, 0, 0.22), 0.15, "shin.R", (math.pi/2, 0, 0)),
        "head": ((0, 0, 4.10), 0.19, "neck", (0, 0, 0)),
    }
    for motion, (loc, major, bone, rotation) in marker_specs.items():
        markers[motion] = torus(f"Marker.{motion}", loc, major, 0.026, joint, arm, bone, rotation)
    return markers


def rest_geometry(arm):
    return {b.name: (b.head_local.copy(), b.tail_local.copy(), b.matrix_local.copy()) for b in arm.data.bones}


def desired_matrix(rest, name, head, tail, twist=0.0):
    rhead, rtail, rmatrix = rest[name]
    original = (rtail - rhead).normalized()
    desired = (Vector(tail) - Vector(head)).normalized()
    swing = original.rotation_difference(desired).to_matrix()
    rotation = swing @ rmatrix.to_3x3()
    if twist:
        rotation = rotation @ Matrix.Rotation(twist, 3, "Y")
    matrix = rotation.to_4x4()
    matrix.translation = Vector(head)
    return matrix


def skeleton_pose(motion, amount):
    shoulder_l, shoulder_r = Vector((-0.68,0,3.70)), Vector((0.68,0,3.70))
    hip_l, hip_r = Vector((-0.33,0,2.10)), Vector((0.33,0,2.10))
    arm10_l = Vector((-math.sin(math.radians(10)),0,-math.cos(math.radians(10))))
    arm10_r = Vector(( math.sin(math.radians(10)),0,-math.cos(math.radians(10))))
    elbow_l = shoulder_l + arm10_l*0.912
    wrist_l = elbow_l + arm10_l*0.812
    elbow_r = shoulder_r + arm10_r*0.912
    wrist_r = elbow_r + arm10_r*0.812
    if motion == "abduction":
        a = math.radians(10 + 70*amount)
        d = Vector((math.sin(a),0,-math.cos(a)))
        elbow_r, wrist_r = shoulder_r+d*0.912, shoulder_r+d*1.724
    elif motion == "elbow":
        a = math.radians(10 + 95*amount)
        fore = arm10_r*math.cos(a) + Vector((0,-1,0))*math.sin(a)
        wrist_r = elbow_r + fore*0.812

    knee_l, ankle_l, toe_l = Vector((-0.33,0,1.10)), Vector((-0.33,0,0.22)), Vector((-0.33,-0.48,0.13))
    knee_r, ankle_r, toe_r = Vector((0.33,0,1.10)), Vector((0.33,0,0.22)), Vector((0.33,-0.48,0.13))
    if motion == "hip":
        a = math.radians(55*amount)
        d = Vector((0,-math.sin(a),-math.cos(a)))
        knee_r, ankle_r = hip_r+d*1.0, hip_r+d*1.88
        foot = Matrix.Rotation(-a,4,"X") @ Vector((0,-0.48,-0.09))
        toe_r = ankle_r + foot
    elif motion == "knee":
        knee_r = hip_r + Vector((0,-1.0,0))
        a = math.radians(90-80*amount)
        d = Vector((0,-math.cos(a),-math.sin(a)))
        ankle_r = knee_r + d*0.88
        toe_r = ankle_r + Vector((0,-0.48,-0.09))
    elif motion == "foot":
        # Lift the demonstrated ankle clear of the floor while keeping pelvis and
        # the complete shin segment fixed throughout the clip.
        lift = math.radians(45)
        knee_r = hip_r + Vector((0,-math.sin(lift),-math.cos(lift)))
        ankle_r = knee_r + Vector((0,0,-0.88))
        a = math.radians(28*amount)
        toe_r = ankle_r + Matrix.Rotation(a,4,"X") @ Vector((0,-0.48,-0.09))

    return {
        "root": (Vector((0,0,.05)), Vector((0,0,.55)), 0),
        "pelvis": (Vector((0,0,1.90)), Vector((0,0,2.38)), 0),
        "spine": (Vector((0,0,2.28)), Vector((0,0,3.18)), 0),
        "chest": (Vector((0,0,3.08)), Vector((0,0,3.82)), 0),
        "neck": (Vector((0,0,3.80)), Vector((0,0,4.12)), 0),
        "head": (Vector((0,0,4.10)), Vector((0,0,4.65)), math.radians(45*amount) if motion=="head" else 0),
        "upper_arm.L": (shoulder_l, elbow_l, 0), "forearm.L": (elbow_l,wrist_l,0), "hand.L": (wrist_l,wrist_l+arm10_l*.28,0),
        "upper_arm.R": (shoulder_r, elbow_r, 0), "forearm.R": (elbow_r,wrist_r,0), "hand.R": (wrist_r,wrist_r+(wrist_r-elbow_r).normalized()*.28,0),
        "thigh.L": (hip_l,knee_l,0), "shin.L": (knee_l,ankle_l,0), "foot.L": (ankle_l,toe_l,0),
        "thigh.R": (hip_r,knee_r,0), "shin.R": (knee_r,ankle_r,0), "foot.R": (ankle_r,toe_r,0),
    }


def key_action(arm, rest, motion):
    action = bpy.data.actions.new(f"ACTION_{motion}")
    action.use_fake_user = True
    arm.animation_data_create()
    arm.animation_data.action = action
    keys = ((1,0.0),(9,0.0),(41,1.0),(56,1.0),(88,0.0),(96,0.0))
    for frame, amount in keys:
        bpy.context.scene.frame_set(frame)
        pose = skeleton_pose(motion, amount)
        # Reset the whole rig, then rotate only the explicitly demonstrated chain.
        # Children left at identity inherit the parent transform rigidly. This is the
        # key guarantee that a straight arm/leg cannot acquire an accidental bend.
        for pb in arm.pose.bones:
            pb.matrix_basis = Matrix.Identity(4)
        targets = {
            "abduction": ("upper_arm.R",),
            "elbow": ("forearm.R",),
            "hip": ("thigh.R",),
            # Keep the foot in a neutral world orientation; otherwise inheriting
            # the near-horizontal shin makes the foot point upward and visually
            # reads as a falsely flexed lower leg.
            "knee": ("thigh.R", "shin.R", "foot.R"),
            "foot": ("thigh.R", "shin.R", "foot.R"),
            "head": ("head",),
        }[motion]
        for name in targets:
            head, tail, twist = pose[name]
            arm.pose.bones[name].matrix = desired_matrix(rest, name, head, tail, twist)
            # Connected child matrices must be solved against the freshly posed
            # parent, not the dependency-graph state from the preceding key.
            bpy.context.view_layer.update()
        for name, pb in arm.pose.bones.items():
            pb.keyframe_insert("location", frame=frame, group=name)
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=name)
            pb.keyframe_insert("scale", frame=frame, group=name)
    for fcurve in action.fcurves:
        for kp in fcurve.keyframe_points:
            kp.interpolation = "BEZIER"
            kp.handle_left_type = "AUTO_CLAMPED"
            kp.handle_right_type = "AUTO_CLAMPED"
    return action


def setup_scene():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.frame_start, scene.frame_end = 1, FRAME_END
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
    scene.render.ffmpeg.ffmpeg_preset = "GOOD"
    scene.render.ffmpeg.audio_codec = "NONE"
    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.world.color = (0.055, 0.075, 0.08)
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.73, 0.88, 0.88, 1)
    bg.inputs["Strength"].default_value = 0.65
    scene.view_settings.look = "AgX - Medium High Contrast"

    ground_mat = material("Studio floor", (0.62, 0.78, 0.77), roughness=0.72)
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0,0,0))
    ground = bpy.context.object
    ground.name = "Matte studio floor"
    ground.data.materials.append(ground_mat)
    bevel = ground.modifiers.new("Floor bevel", "BEVEL")
    bevel.width = 0.05

    bpy.ops.object.light_add(type="AREA", location=(-4,-5,7))
    key = bpy.context.object
    key.name = "Fixed key light"
    key.data.energy, key.data.shape, key.data.size = 1150, "DISK", 4.0
    key.data.color = (1.0, 0.86, 0.76)
    bpy.ops.object.light_add(type="AREA", location=(4,-1,4.8))
    fill = bpy.context.object
    fill.name = "Fixed fill light"
    fill.data.energy, fill.data.size = 650, 3.0
    fill.data.color = (0.58, 0.80, 1.0)
    bpy.ops.object.light_add(type="AREA", location=(0,4,5.8))
    rim = bpy.context.object
    rim.name = "Fixed rim light"
    rim.data.energy, rim.data.size = 950, 2.5
    rim.data.color = (0.75, 0.95, 1.0)

    # View from the mannequin's left-front quarter. The demonstrated right leg
    # therefore moves visually away from the midline while remaining x-constant
    # in the true sagittal plane.
    bpy.ops.object.camera_add(location=(-5.25,-12.2,2.75))
    camera = bpy.context.object
    camera.name = "FIXED_CAMERA_ALL_MOTIONS"
    camera.data.lens = 62
    camera.data.sensor_width = 36
    target = Vector((0,0,2.45))
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z","Y").to_euler()
    scene.camera = camera
    return scene


def sha256(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1024*1024), b""):
            h.update(chunk)
    return h.hexdigest()


def render_all(scene, arm, actions, markers):
    manifest = {
        "pipeline":"Blender 4.5.13 LTS / Eevee Next / one rig",
        "model":"volumetric procedural female mannequin",
        "resolution":[640,640], "fps":30, "frames":96, "duration_seconds":3.2,
        "camera":"single fixed perspective camera, 62 mm",
        "lighting":"three fixed area lights plus static world light",
        "interpolation":"Bezier Auto Clamped; no overshoot",
        "clips":{},
    }
    selected = tuple(x for x in os.environ.get("MOTION_ONLY", "").split(",") if x) or MOTIONS
    for motion in selected:
        arm.animation_data.action = actions[motion]
        for key, obj in markers.items():
            obj.hide_render = key != motion
            obj.hide_viewport = key != motion
        scene.frame_set(1)
        scene.render.filepath = str(OUT / f"{motion}.mp4")
        bpy.ops.render.render(animation=True)
        path = OUT / f"{motion}.mp4"
        manifest["clips"][path.name] = {"bytes":path.stat().st_size,"sha256":sha256(path)}
    # A partial render is intended only for rapid QA. Re-index every existing MP4
    # so the manifest remains complete and cannot retain stale hashes.
    for motion in MOTIONS:
        path = OUT / f"{motion}.mp4"
        if path.exists():
            manifest["clips"][path.name] = {"bytes":path.stat().st_size,"sha256":sha256(path)}
    (ROOT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def main():
    clear_scene()
    scene = setup_scene()
    arm = create_rig()
    markers = build_woman(arm)
    rest = rest_geometry(arm)
    actions = {motion:key_action(arm,rest,motion) for motion in MOTIONS}
    arm.animation_data.action = actions["abduction"]
    for key,obj in markers.items():
        obj.hide_render = key != "abduction"
        obj.hide_viewport = key != "abduction"
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/"female-anatomy-rig.blend"))
    render_all(scene,arm,actions,markers)


if __name__ == "__main__":
    main()
