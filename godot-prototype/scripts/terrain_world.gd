class_name TerrainWorld
extends Node3D

const SEGMENTS_X: int = 96
const SEGMENTS_Z: int = 112

var field: TerrainField
var ground_body: StaticBody3D
var built: bool = false

func _ready() -> void:
	build()

func build() -> void:
	if built:
		return
	built = true
	field = TerrainField.new(20260731)

	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var faces := PackedVector3Array()
	var step_x: float = (GameConfig.WORLD_MAX_X - GameConfig.WORLD_MIN_X) / float(SEGMENTS_X)
	var step_z: float = (GameConfig.WORLD_MAX_Z - GameConfig.WORLD_MIN_Z) / float(SEGMENTS_Z)

	for z_index in range(SEGMENTS_Z):
		var z0: float = GameConfig.WORLD_MIN_Z + float(z_index) * step_z
		var z1: float = z0 + step_z
		for x_index in range(SEGMENTS_X):
			var x0: float = GameConfig.WORLD_MIN_X + float(x_index) * step_x
			var x1: float = x0 + step_x
			var p00 := Vector3(x0, field.height_at(x0, z0), z0)
			var p10 := Vector3(x1, field.height_at(x1, z0), z0)
			var p01 := Vector3(x0, field.height_at(x0, z1), z1)
			var p11 := Vector3(x1, field.height_at(x1, z1), z1)

			_add_vertex(surface, p00)
			faces.append(p00)
			_add_vertex(surface, p01)
			faces.append(p01)
			_add_vertex(surface, p10)
			faces.append(p10)
			_add_vertex(surface, p10)
			faces.append(p10)
			_add_vertex(surface, p01)
			faces.append(p01)
			_add_vertex(surface, p11)
			faces.append(p11)

	surface.generate_normals()
	var terrain_mesh := surface.commit()
	var mesh_instance := MeshInstance3D.new()
	mesh_instance.name = "TerrainMesh"
	mesh_instance.mesh = terrain_mesh
	mesh_instance.material_override = _make_terrain_material()
	add_child(mesh_instance)

	ground_body = StaticBody3D.new()
	ground_body.name = "TerrainCollision"
	ground_body.collision_layer = 1
	ground_body.collision_mask = 2 | 4
	ground_body.add_to_group("terrain")
	var collision_shape := CollisionShape3D.new()
	var heightmap := HeightMapShape3D.new()
	heightmap.map_width = SEGMENTS_X + 1
	heightmap.map_depth = SEGMENTS_Z + 1
	var collision_step: float = (
		GameConfig.WORLD_MAX_X - GameConfig.WORLD_MIN_X
	) / float(SEGMENTS_X)
	var collision_data := PackedFloat32Array()
	collision_data.resize((SEGMENTS_X + 1) * (SEGMENTS_Z + 1))
	var collision_center_z: float = (GameConfig.WORLD_MIN_Z + GameConfig.WORLD_MAX_Z) * 0.5
	for z_index in range(SEGMENTS_Z + 1):
		var collision_z: float = collision_center_z + (
			float(z_index) - float(SEGMENTS_Z) * 0.5
		) * collision_step
		for x_index in range(SEGMENTS_X + 1):
			var collision_x: float = GameConfig.WORLD_MIN_X + float(x_index) * collision_step
			collision_data[z_index * (SEGMENTS_X + 1) + x_index] = (
				field.height_at(collision_x, collision_z) / collision_step
			)
	heightmap.map_data = collision_data
	collision_shape.shape = heightmap
	collision_shape.position = Vector3(
		(GameConfig.WORLD_MIN_X + GameConfig.WORLD_MAX_X) * 0.5,
		0.0,
		collision_center_z
	)
	collision_shape.scale = Vector3.ONE * collision_step
	ground_body.add_child(collision_shape)
	add_child(ground_body)

	_add_scenery()

func height_at(x: float, z: float) -> float:
	if field == null:
		field = TerrainField.new(20260731)
	return field.height_at(x, z)

func _add_vertex(surface: SurfaceTool, point: Vector3) -> void:
	surface.set_color(_terrain_color(point.y))
	surface.add_vertex(point)

func _terrain_color(height: float) -> Color:
	if height < 2.0:
		return Color(0.25, 0.48, 0.14, 1.0)
	if height < 10.0:
		return Color(0.34, 0.53, 0.18, 1.0)
	if height < 28.0:
		return Color(0.38, 0.40, 0.22, 1.0)
	return Color(0.50, 0.48, 0.39, 1.0)

func _make_terrain_material() -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.28, 0.52, 0.18, 1.0)
	material.vertex_color_use_as_albedo = true
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.roughness = 0.96
	material.metallic = 0.0
	return material

func _add_scenery() -> void:
	# Alguns marcadores de escala mantêm o protótipo legível sem depender de assets.
	for z in [-8.0, -18.0, -42.0, -64.0]:
		var x: float = TerrainField.path_center_x(z) - 4.5
		var tree := MeshInstance3D.new()
		var trunk := CylinderMesh.new()
		trunk.top_radius = 0.12
		trunk.bottom_radius = 0.18
		trunk.height = 2.4
		trunk.radial_segments = 8
		tree.mesh = trunk
		tree.material_override = _make_scenery_material(Color(0.22, 0.12, 0.055, 1.0))
		tree.position = Vector3(x, field.height_at(x, z) + 1.2, z)
		add_child(tree)

		var crown := MeshInstance3D.new()
		var crown_mesh := SphereMesh.new()
		crown_mesh.radius = 1.0
		crown_mesh.height = 1.8
		crown.mesh = crown_mesh
		crown.material_override = _make_scenery_material(Color(0.10, 0.24, 0.10, 1.0))
		crown.position = Vector3(x, field.height_at(x, z) + 2.5, z)
		add_child(crown)

func _make_scenery_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = 0.9
	return material
