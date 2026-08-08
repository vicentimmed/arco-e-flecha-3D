class_name ArcherController
extends CharacterBody3D

var terrain: TerrainField
var arrow_manager: Node
var hud: Node
var target: Node

var yaw: float = 0.0
var pitch: float = 0.03
var drawing: bool = false
var draw_time: float = 0.0
var mouse_captured: bool = true

@onready var bow: Bow = $Bow
@onready var camera_rig: CameraRig = $CameraRig

var visual: Node3D
var front_arm: MeshInstance3D
var rear_arm: MeshInstance3D
var front_leg: MeshInstance3D
var rear_leg: MeshInstance3D

func configure(
	terrain_field: TerrainField,
	manager: Node,
	hud_node: Node,
	target_node: Node
) -> void:
	terrain = terrain_field
	arrow_manager = manager
	hud = hud_node
	target = target_node

func _ready() -> void:
	collision_layer = 2
	collision_mask = 1
	floor_snap_length = 0.45
	floor_max_angle = deg_to_rad(48.0)
	floor_stop_on_slope = true
	add_to_group("player")
	_build_visual()
	camera_rig.configure(self)
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	mouse_captured = true

func _physics_process(delta: float) -> void:
	if terrain == null:
		return
	_handle_movement(delta)
	_handle_bow(delta)
	_update_pose()

func _process(_delta: float) -> void:
	if hud != null:
		hud.call("set_debug_values", {
			"speed": Vector2(velocity.x, velocity.z).length(),
			"wind": arrow_manager.get("wind_speed") if arrow_manager != null else 0.0,
			"draw": GameConfig.draw_fraction(draw_time),
			"position": global_position
		})

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and mouse_captured:
		var motion := event as InputEventMouseMotion
		yaw -= motion.relative.x * 0.0025
		pitch = clampf(pitch - motion.relative.y * 0.0025, -0.55, 0.50)
	elif event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT and button.pressed:
			_capture_mouse()
	elif event is InputEventKey and event.pressed and not event.echo:
		var key := event as InputEventKey
		var key_code: Key = key.physical_keycode if key.physical_keycode != KEY_NONE else key.keycode
		match key_code:
			KEY_ESCAPE:
				_release_mouse()
			KEY_C:
				camera_rig.toggle_first_person()
			KEY_R:
				if arrow_manager != null:
					arrow_manager.call("reset_arrows")
				if target != null:
					target.call("reset_target")
			KEY_F3:
				if hud != null:
					hud.call("toggle_debug")

func _handle_movement(delta: float) -> void:
	var forward_input: float = (
		float(Input.is_physical_key_pressed(KEY_W))
		- float(Input.is_physical_key_pressed(KEY_S))
	)
	var side_input: float = (
		float(Input.is_physical_key_pressed(KEY_D))
		- float(Input.is_physical_key_pressed(KEY_A))
	)
	var movement := Vector2(side_input, forward_input)
	if movement.length_squared() > 1.0:
		movement = movement.normalized()

	var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	var direction: Vector3 = right * movement.x + forward * movement.y
	var speed: float = (
		GameConfig.RUN_SPEED
		if Input.is_physical_key_pressed(KEY_SHIFT)
		else GameConfig.WALK_SPEED
	)
	var desired_velocity: Vector3 = direction * speed
	velocity.x = move_toward(velocity.x, desired_velocity.x, 18.0 * delta)
	velocity.z = move_toward(velocity.z, desired_velocity.z, 18.0 * delta)

	if is_on_floor():
		velocity.y = -0.2
	else:
		velocity.y += GameConfig.GRAVITY * delta
	if Input.is_physical_key_pressed(KEY_SPACE) and is_on_floor():
		velocity.y = GameConfig.JUMP_SPEED
	rotation.y = yaw
	move_and_slide()

func _handle_bow(delta: float) -> void:
	var left_button: bool = mouse_captured and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
	if left_button:
		drawing = true
		draw_time = minf(draw_time + delta, GameConfig.BOW_FULL_DRAW_TIME + 2.0)
	elif drawing:
		_release_arrow()
		drawing = false
		draw_time = 0.0

	var fraction: float = GameConfig.draw_fraction(draw_time)
	bow.set_draw(fraction)
	if hud != null:
		hud.call("set_draw_state", fraction, GameConfig.draw_speed(draw_time), drawing)

func _release_arrow() -> void:
	if arrow_manager == null:
		return
	var muzzle: Vector3 = bow.get_muzzle_global()
	var aim_point: Vector3 = camera_rig.get_aim_point()
	var direction: Vector3 = (aim_point - muzzle).normalized()
	if direction.length_squared() < 0.001:
		return
	arrow_manager.call("shoot", muzzle, direction, GameConfig.draw_speed(draw_time))
	bow.set_arrow_visible(false)
	await get_tree().create_timer(GameConfig.BOW_RELOAD_TIME).timeout
	if is_instance_valid(bow):
		bow.set_arrow_visible(true)

func _capture_mouse() -> void:
	Input.set_mouse_mode(Input.MOUSE_MODE_CAPTURED)
	mouse_captured = true

func _release_mouse() -> void:
	Input.set_mouse_mode(Input.MOUSE_MODE_VISIBLE)
	mouse_captured = false
	drawing = false
	draw_time = 0.0

func _update_pose() -> void:
	bow.position = Vector3(0.30, 1.36, -0.38)
	bow.rotation = Vector3(pitch, 0.0, 0.0)
	var front_shoulder: Vector3 = to_global(Vector3(0.27, 1.40, -0.08))
	var rear_shoulder: Vector3 = to_global(Vector3(-0.25, 1.40, 0.02))
	_place_segment(front_arm, front_shoulder, bow.get_grip_global())
	_place_segment(rear_arm, rear_shoulder, bow.get_nock_global())

func _build_visual() -> void:
	visual = Node3D.new()
	visual.name = "ArcherVisual"
	add_child(visual)
	var cloth := _make_material(Color(0.10, 0.15, 0.22, 1.0), 0.9, 0.0)
	var leather := _make_material(Color(0.23, 0.13, 0.07, 1.0), 0.9, 0.0)
	var skin := _make_material(Color(0.62, 0.34, 0.20, 1.0), 0.88, 0.0)
	var metal := _make_material(Color(0.32, 0.35, 0.40, 1.0), 0.35, 0.65)

	var torso := MeshInstance3D.new()
	var torso_mesh := CylinderMesh.new()
	torso_mesh.top_radius = 0.20
	torso_mesh.bottom_radius = 0.29
	torso_mesh.height = 0.72
	torso_mesh.radial_segments = 12
	torso.mesh = torso_mesh
	torso.material_override = cloth
	torso.position = Vector3(0.0, 1.06, 0.0)
	visual.add_child(torso)

	var belt := MeshInstance3D.new()
	var belt_mesh := TorusMesh.new()
	belt_mesh.inner_radius = 0.25
	belt_mesh.outer_radius = 0.29
	belt_mesh.rings = 8
	belt_mesh.ring_segments = 16
	belt.mesh = belt_mesh
	belt.material_override = leather
	belt.position = Vector3(0.0, 0.78, 0.0)
	belt.rotation.x = PI * 0.5
	visual.add_child(belt)

	var head := MeshInstance3D.new()
	var head_mesh := SphereMesh.new()
	head_mesh.radius = 0.19
	head_mesh.height = 0.38
	head.mesh = head_mesh
	head.material_override = skin
	head.position = Vector3(0.0, 1.63, 0.0)
	visual.add_child(head)

	var hood := MeshInstance3D.new()
	var hood_mesh := SphereMesh.new()
	hood_mesh.radius = 0.25
	hood_mesh.height = 0.24
	hood.mesh = hood_mesh
	hood.material_override = leather
	hood.position = Vector3(0.0, 1.76, 0.02)
	visual.add_child(hood)

	front_arm = _make_segment(0.055, skin)
	rear_arm = _make_segment(0.055, skin)
	visual.add_child(front_arm)
	visual.add_child(rear_arm)
	front_leg = _make_segment(0.085, cloth)
	rear_leg = _make_segment(0.085, cloth)
	visual.add_child(front_leg)
	visual.add_child(rear_leg)

	var quiver := MeshInstance3D.new()
	var quiver_mesh := CylinderMesh.new()
	quiver_mesh.top_radius = 0.075
	quiver_mesh.bottom_radius = 0.10
	quiver_mesh.height = 0.62
	quiver_mesh.radial_segments = 8
	quiver.mesh = quiver_mesh
	quiver.material_override = leather
	quiver.position = Vector3(-0.28, 1.0, 0.18)
	quiver.rotation.x = -0.25
	visual.add_child(quiver)

	_place_segment(front_leg, to_global(Vector3(0.12, 0.78, 0.0)), to_global(Vector3(0.13, 0.05, -0.08)))
	_place_segment(rear_leg, to_global(Vector3(-0.12, 0.78, 0.0)), to_global(Vector3(-0.16, 0.05, 0.08)))

	# Pequeno medalhão metálico para deixar a silhueta legível contra o terreno.
	var buckle := MeshInstance3D.new()
	var buckle_mesh := BoxMesh.new()
	buckle_mesh.size = Vector3(0.09, 0.08, 0.025)
	buckle.mesh = buckle_mesh
	buckle.material_override = metal
	buckle.position = Vector3(0.0, 0.79, -0.27)
	visual.add_child(buckle)

func _make_segment(radius: float, material: StandardMaterial3D) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := CapsuleMesh.new()
	mesh.radius = radius
	mesh.height = 1.0
	mesh.radial_segments = 8
	mesh.rings = 4
	node.mesh = mesh
	node.material_override = material
	return node

func _place_segment(node: MeshInstance3D, point_a: Vector3, point_b: Vector3) -> void:
	var delta: Vector3 = point_b - point_a
	var length: float = delta.length()
	if length < 0.0001:
		node.visible = false
		return
	node.visible = true
	node.global_position = (point_a + point_b) * 0.5
	node.global_basis = Basis(Quaternion(Vector3.UP, delta / length))
	node.scale = Vector3(1.0, length, 1.0)

func _make_material(color: Color, roughness: float, metallic: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	return material
