class_name StandingTarget
extends RigidBody3D

var terrain: TerrainField
var initial_position: Vector3
var face_center_local: Vector3 = Vector3(0.0, 1.25, 0.06)
var hits: int = 0
var last_score: int = 0
var built: bool = false

func configure(terrain_field: TerrainField, location: Vector3) -> void:
	terrain = terrain_field
	initial_position = location
	position = location

func _ready() -> void:
	mass = GameConfig.TARGET_MASS
	linear_damp = 0.25
	angular_damp = 0.35
	contact_monitor = true
	max_contacts_reported = 8
	collision_layer = 1
	collision_mask = 1 | 4
	add_to_group("target")
	_build_target()

func _build_target() -> void:
	if built:
		return
	built = true
	var straw := _make_material(Color(0.72, 0.56, 0.31, 1.0), 0.95)
	var wood := _make_material(Color(0.32, 0.18, 0.08, 1.0), 0.9)
	var strap := _make_material(Color(0.10, 0.065, 0.04, 1.0), 0.9)
	_add_face(straw)
	_add_stand(wood, strap)
	_add_collision_shapes()

func register_hit(world_point: Vector3, incoming_velocity: Vector3) -> Dictionary:
	var local: Vector3 = to_local(world_point)
	var radial: float = Vector2(local.x, local.y - face_center_local.y).length()
	var front_distance: float = absf(local.z - face_center_local.z)
	var on_face: bool = radial <= GameConfig.TARGET_RADIUS and front_distance <= 0.22
	var score: int = 0
	if on_face:
		var ring: int = mini(
			GameConfig.TARGET_RINGS - 1,
			floori(radial / (GameConfig.TARGET_RADIUS / float(GameConfig.TARGET_RINGS)))
		)
		score = maxi(1, GameConfig.TARGET_RINGS - ring)
		hits += 1
		last_score = score
		var impulse: Vector3 = incoming_velocity.normalized() * minf(incoming_velocity.length() * 0.0025, 8.0)
		apply_impulse(impulse, world_point - global_position)
	return {
		"score": score,
		"radius": radial,
		"on_face": on_face,
		"hits": hits,
		"target": self
	}

func reset_target() -> void:
	global_transform = Transform3D(Basis.IDENTITY, initial_position)
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	sleeping = false
	hits = 0
	last_score = 0

func set_active(active: bool) -> void:
	visible = active
	freeze = not active
	collision_layer = 1 if active else 0
	collision_mask = (1 | 4) if active else 0

func _add_face(straw: StandardMaterial3D) -> void:
	var drum := MeshInstance3D.new()
	var drum_mesh := CylinderMesh.new()
	drum_mesh.top_radius = GameConfig.TARGET_RADIUS
	drum_mesh.bottom_radius = GameConfig.TARGET_RADIUS
	drum_mesh.height = GameConfig.TARGET_THICKNESS
	drum_mesh.radial_segments = 48
	drum.mesh = drum_mesh
	drum.material_override = straw
	drum.position = Vector3(0.0, 1.25, 0.0)
	drum.rotation.x = PI * 0.5
	add_child(drum)

	var colors := [
		Color(0.91, 0.88, 0.79, 1.0),
		Color(0.08, 0.08, 0.09, 1.0),
		Color(0.18, 0.39, 0.68, 1.0),
		Color(0.74, 0.15, 0.10, 1.0),
		Color(0.92, 0.68, 0.12, 1.0)
	]
	var radii := [0.50, 0.40, 0.30, 0.20, 0.10]
	for index in range(radii.size()):
		var disc := MeshInstance3D.new()
		var disc_mesh := CylinderMesh.new()
		disc_mesh.top_radius = radii[index]
		disc_mesh.bottom_radius = radii[index]
		disc_mesh.height = 0.012
		disc_mesh.radial_segments = 48
		disc.mesh = disc_mesh
		disc.material_override = _make_material(colors[index], 0.82)
		disc.position = Vector3(0.0, 1.25, 0.067 + float(index) * 0.002)
		disc.rotation.x = PI * 0.5
		add_child(disc)

func _add_stand(wood: StandardMaterial3D, strap: StandardMaterial3D) -> void:
	var top := Vector3(0.0, 1.38, -0.08)
	var feet := [
		Vector3(0.42, 0.0, 0.26),
		Vector3(-0.42, 0.0, 0.26),
		Vector3(0.0, 0.0, -0.50)
	]
	for foot in feet:
		var leg := MeshInstance3D.new()
		var leg_mesh := CylinderMesh.new()
		leg_mesh.top_radius = 0.04
		leg_mesh.bottom_radius = 0.055
		leg_mesh.height = 1.4
		leg_mesh.radial_segments = 8
		leg.mesh = leg_mesh
		leg.material_override = wood
		var delta: Vector3 = foot - top
		leg.position = top + delta * 0.5
		leg.quaternion = Quaternion(Vector3.UP, delta.normalized())
		add_child(leg)

	var strap_mesh := BoxMesh.new()
	strap_mesh.size = Vector3(0.05, 0.9, 0.025)
	for side in [-1.0, 1.0]:
		var strap_node := MeshInstance3D.new()
		strap_node.mesh = strap_mesh
		strap_node.material_override = strap
		strap_node.position = Vector3(0.26 * side, 1.70, 0.0)
		strap_node.rotation.z = -0.16 * side
		add_child(strap_node)

func _add_collision_shapes() -> void:
	var face_shape := CollisionShape3D.new()
	var face_box := BoxShape3D.new()
	face_box.size = Vector3(1.0, 1.0, GameConfig.TARGET_THICKNESS)
	face_shape.shape = face_box
	face_shape.position = Vector3(0.0, 1.25, 0.0)
	add_child(face_shape)

	var feet := [
		Vector3(0.42, 0.68, 0.26),
		Vector3(-0.42, 0.68, 0.26),
		Vector3(0.0, 0.68, -0.42)
	]
	for foot in feet:
		var leg_shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(0.10, 1.36, 0.10)
		leg_shape.shape = box
		leg_shape.position = foot
		add_child(leg_shape)

func _make_material(color: Color, roughness: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	return material
