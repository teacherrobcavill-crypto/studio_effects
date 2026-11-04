#!/usr/bin/env python3
"""
Stage 6: Headless Blender 4.x Python Procedural Generator for the EMT-140/240 Plate Reverb Chassis.
Usage:
    blender --background --python scripts/generate_plate_reverb.py

Generates the complete hierarchical 3D scene:
  - Root_Chassis
  - Frame_Outer (with procedural Voronoi Hammerite paint shader)
  - Plate_Mesh (128x128 subdivided sheet metal with Anisotropic Brushed Steel PBR shader)
  - Damper_Bar (mechanical felt damping pad assembly)
  - Spring_Corner_TL, Spring_Corner_TR, Spring_Corner_BL, Spring_Corner_BR (helical curve tubes)
  - Transducer_Driver, Pickup_Left, Pickup_Right

Exports binary glTF 2.0 to: assets/plate_reverb.glb
"""

import os
import math
import bpy
import bmesh
from mathutils import Vector


def clear_scene():
    """Remove all default objects, meshes, materials, and curves from the scene."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def set_principled_input(bsdf, names, value):
    """Blender 3.x / 4.x safe helper for setting Principled BSDF socket values."""
    for name in names:
        if name in bsdf.inputs:
            bsdf.inputs[name].default_value = value
            return


def create_hammerite_frame_material():
    """Create procedural Voronoi Hammerite enamelled steel shader for Frame_Outer."""
    mat = bpy.data.materials.new(name="Mat_Hammerite_Frame")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out_node = nodes.new(type="ShaderNodeOutputMaterial")
    out_node.location = (600, 0)

    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (280, 0)
    set_principled_input(bsdf, ["Base Color"], (0.14, 0.17, 0.21, 1.0))
    set_principled_input(bsdf, ["Metallic"], 0.82)
    set_principled_input(bsdf, ["Roughness"], 0.42)

    tex_coord = nodes.new(type="ShaderNodeTexCoord")
    tex_coord.location = (-520, 0)

    voronoi = nodes.new(type="ShaderNodeTexVoronoi")
    voronoi.location = (-260, 0)
    if "Scale" in voronoi.inputs:
        voronoi.inputs["Scale"].default_value = 48.0

    bump = nodes.new(type="ShaderNodeBump")
    bump.location = (40, -140)
    if "Strength" in bump.inputs:
        bump.inputs["Strength"].default_value = 0.15
    if "Distance" in bump.inputs:
        bump.inputs["Distance"].default_value = 0.004

    links.new(tex_coord.outputs["Object"], voronoi.inputs["Vector"])
    links.new(voronoi.outputs["Distance"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    return mat


def create_anisotropic_plate_material():
    """Create procedural anisotropic cold-rolled brushed steel PBR shader for Plate_Mesh."""
    mat = bpy.data.materials.new(name="Mat_Anisotropic_Plate")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()

    out_node = nodes.new(type="ShaderNodeOutputMaterial")
    out_node.location = (600, 0)

    bsdf = nodes.new(type="ShaderNodeBsdfPrincipled")
    bsdf.location = (260, 0)
    set_principled_input(bsdf, ["Base Color"], (0.69, 0.77, 0.87, 1.0))
    set_principled_input(bsdf, ["Metallic"], 0.92)
    set_principled_input(bsdf, ["Roughness"], 0.32)
    set_principled_input(bsdf, ["Anisotropic"], 0.65)
    set_principled_input(bsdf, ["Coat Weight", "Clearcoat"], 0.15)

    tex_coord = nodes.new(type="ShaderNodeTexCoord")
    tex_coord.location = (-540, 0)

    mapping = nodes.new(type="ShaderNodeMapping")
    mapping.location = (-340, 0)
    if "Scale" in mapping.inputs:
        mapping.inputs["Scale"].default_value = (120.0, 8.0, 1.0)

    noise = nodes.new(type="ShaderNodeTexNoise")
    noise.location = (-120, 0)
    if "Scale" in noise.inputs:
        noise.inputs["Scale"].default_value = 35.0
    if "Detail" in noise.inputs:
        noise.inputs["Detail"].default_value = 8.0

    bump = nodes.new(type="ShaderNodeBump")
    bump.location = (70, -140)
    if "Strength" in bump.inputs:
        bump.inputs["Strength"].default_value = 0.04

    links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], out_node.inputs["Surface"])

    return mat


def create_simple_pbr_material(name, color, metallic, roughness):
    """Create a clean Principled BSDF material."""
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        set_principled_input(bsdf, ["Base Color"], color)
        set_principled_input(bsdf, ["Metallic"], metallic)
        set_principled_input(bsdf, ["Roughness"], roughness)
    return mat


def build_outer_frame(root_obj, frame_mat):
    """Construct Frame_Outer (2.4 x 1.2 x 0.3 m tubular steel frame + corner gussets)."""
    bm = bmesh.new()
    frame_w = 2.4
    frame_h = 1.2
    z_offsets = [-0.11, 0.11]

    # Build tubular frame bars via bmesh primitives
    for z_pos in z_offsets:
        # Top and bottom horizontal rails
        for y_pos in [-frame_h * 0.5, frame_h * 0.5]:
            ret = bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=False,
                segments=20,
                radius1=0.028,
                radius2=0.028,
                depth=frame_w
            )
            bmesh.ops.rotate(
                bm,
                verts=ret["verts"],
                cent=(0, 0, 0),
                matrix=Vector((0, 1, 0)).to_track_quat('Z', 'X').to_matrix()
            )
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(0.0, y_pos, z_pos))

        # Left and right vertical rails
        for x_pos in [-frame_w * 0.5, frame_w * 0.5]:
            ret = bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=False,
                segments=20,
                radius1=0.028,
                radius2=0.028,
                depth=frame_h
            )
            bmesh.ops.rotate(
                bm,
                verts=ret["verts"],
                cent=(0, 0, 0),
                matrix=Vector((0, 0, 1)).to_track_quat('Y', 'X').to_matrix()
            )
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(x_pos, 0.0, z_pos))

    # Corner depth struts
    for cx in [-frame_w * 0.5, frame_w * 0.5]:
        for cy in [-frame_h * 0.5, frame_h * 0.5]:
            ret = bmesh.ops.create_cone(
                bm,
                cap_ends=True,
                cap_tris=False,
                segments=16,
                radius1=0.032,
                radius2=0.032,
                depth=0.30
            )
            bmesh.ops.translate(bm, verts=ret["verts"], vec=(cx, cy, 0.0))

    mesh = bpy.data.meshes.new("Frame_Outer_Mesh")
    bm.to_mesh(mesh)
    bm.free()

    frame_obj = bpy.data.objects.new("Frame_Outer", mesh)
    frame_obj.data.materials.append(frame_mat)
    frame_obj.parent = root_obj
    bpy.context.collection.objects.link(frame_obj)
    return frame_obj


def build_plate_mesh(root_obj, plate_mat):
    """Construct Plate_Mesh: 2.0 x 1.0 m grid with 128 x 128 subdivisions for modal displacement."""
    bpy.ops.mesh.primitive_grid_add(
        x_subdivisions=128,
        y_subdivisions=128,
        size=1.0,
        location=(0.0, 0.0, 0.0)
    )
    plate_obj = bpy.context.active_object
    plate_obj.name = "Plate_Mesh"
    plate_obj.scale = (2.0, 1.0, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    plate_obj.data.materials.append(plate_mat)
    plate_obj.parent = root_obj
    return plate_obj


def build_helical_spring(name, start_pt, end_pt, root_obj, spring_mat):
    """Construct a 3D helical spring curve converted to a mesh along the corner vector."""
    curve_data = bpy.data.curves.new(name=f"{name}_Curve", type="CURVE")
    curve_data.dimensions = "3D"
    curve_data.resolution_u = 12
    curve_data.bevel_depth = 0.006
    curve_data.bevel_resolution = 4

    polyline = curve_data.splines.new("POLY")
    num_pts = 64
    turns = 7.0
    radius = 0.022
    polyline.points.add(num_pts - 1)

    v_start = Vector(start_pt)
    v_end = Vector(end_pt)

    for i in range(num_pts):
        t = i / float(num_pts - 1)
        pos = v_start.lerp(v_end, t)
        env = math.sin(math.pi * t)
        angle = t * math.pi * 2.0 * turns
        pos.z += math.cos(angle) * radius * env
        pos.y += math.sin(angle) * radius * 0.5 * env
        polyline.points[i].co = (pos.x, pos.y, pos.z, 1.0)

    curve_obj = bpy.data.objects.new(name, curve_data)
    bpy.context.collection.objects.link(curve_obj)
    bpy.context.view_layer.objects.active = curve_obj
    curve_obj.select_set(True)
    bpy.ops.object.convert(target="MESH")
    curve_obj.data.materials.append(spring_mat)
    curve_obj.parent = root_obj
    curve_obj.select_set(False)
    return curve_obj


def build_damper_bar(root_obj, felt_mat):
    """Construct Damper_Bar: Mechanical damping felt pad assembly."""
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, -0.10))
    damper_obj = bpy.context.active_object
    damper_obj.name = "Damper_Bar"
    damper_obj.scale = (1.75, 0.82, 0.024)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    damper_obj.data.materials.append(felt_mat)
    damper_obj.parent = root_obj
    return damper_obj


def build_transducer(name, location, radius, depth, root_obj, mat):
    """Construct voice-coil driver or piezo pickup cylinder."""
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=28,
        radius=radius,
        depth=depth,
        location=location
    )
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    obj.parent = root_obj
    return obj


def main():
    clear_scene()

    # Create Root_Chassis Empty
    root_obj = bpy.data.objects.new("Root_Chassis", None)
    bpy.context.collection.objects.link(root_obj)

    # Create Procedural PBR Materials
    frame_mat = create_hammerite_frame_material()
    plate_mat = create_anisotropic_plate_material()
    spring_mat = create_simple_pbr_material("Mat_Spring_Steel", (0.80, 0.84, 0.90, 1.0), 0.92, 0.25)
    felt_mat = create_simple_pbr_material("Mat_Damping_Felt", (0.50, 0.11, 0.11, 1.0), 0.05, 0.92)
    driver_mat = create_simple_pbr_material("Mat_Driver_Copper", (0.72, 0.33, 0.05, 1.0), 0.88, 0.32)
    pickup_mat = create_simple_pbr_material("Mat_Pickup_Brass", (0.85, 0.52, 0.08, 1.0), 0.90, 0.28)

    # Build Hierarchy
    build_outer_frame(root_obj, frame_mat)
    build_plate_mesh(root_obj, plate_mat)
    build_damper_bar(root_obj, felt_mat)

    # Build 4 Helical Corner Tension Springs
    build_helical_spring("Spring_Corner_TL", (-1.0, 0.5, 0.0), (-1.16, 0.56, 0.0), root_obj, spring_mat)
    build_helical_spring("Spring_Corner_TR", (1.0, 0.5, 0.0), (1.16, 0.56, 0.0), root_obj, spring_mat)
    build_helical_spring("Spring_Corner_BL", (-1.0, -0.5, 0.0), (-1.16, -0.56, 0.0), root_obj, spring_mat)
    build_helical_spring("Spring_Corner_BR", (1.0, -0.5, 0.0), (1.16, -0.56, 0.0), root_obj, spring_mat)

    # Build Voice-Coil Driver & Dual Piezo Pickups
    build_transducer("Transducer_Driver", (-0.35, 0.08, 0.07), 0.11, 0.14, root_obj, driver_mat)
    build_transducer("Pickup_Left", (0.45, 0.22, 0.045), 0.048, 0.08, root_obj, pickup_mat)
    build_transducer("Pickup_Right", (0.52, -0.24, 0.045), 0.048, 0.08, root_obj, pickup_mat)

    # Export to assets/plate_reverb.glb
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(script_dir)
    assets_dir = os.path.join(project_root, "assets")
    os.makedirs(assets_dir, exist_ok=True)
    out_path = os.path.join(assets_dir, "plate_reverb.glb")

    bpy.ops.export_scene.gltf(
        filepath=out_path,
        export_format="GLB",
        export_apply=True
    )
    print(f"[SUCCESS] Exported Plate Reverb 3D Chassis asset to: {out_path}")


if __name__ == "__main__":
    main()
