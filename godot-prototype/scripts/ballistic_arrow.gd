class_name BallisticArrow
extends RigidBody3D

signal impact(arrow: BallisticArrow, body: Node3D, point: Vector3)

var manager: Node
var wind: WindField
var flight_time: float = 0.0
var stuck: bool = false
var launched: bool = false
var built: bool = false

func configure(owner_manager: Node, wind_field: WindField) -> void:
	manager = owner_manager
	wind = wind_field

func _ready() -> void:
	mass = GameConfig.ARROW_MASS
	gravity_scale = 0.0
	linear_damp = 0.0
	angular_damp = GameConfig.ARROW_ANGULAR_DAMPING
	continuous_cd = true
	custom_integrator = true
	collision_layer = 4
	collision_mask = 1
	contact_monitor = true
	max_contacts_reported = 4
	body_entered.connect(_on_body_entered)
	_build_visual()

func launch(origin: Vector3, direction: Vector3, speed: float) -> void:
	global_position = origin
	linear_velocity = direction.normalized() * speed
	angular_velocity = Vector3.ZERO
	flight_time = 0.0
	stuck = false
	launched = true
	freeze = false
	sleeping = false
	collision_layer = 4
	collision_mask = 1
	orient_to_velocity()

func _integrate_forces(state: PhysicsDirectBodyState3D) -> void:
	if not launched or stuck:
		return
	var velocity: Vector3 = state.linear_velocity
	var position: Vector3 = state.transform.origin
	var wind_velocity: Vector3 = wind.velocity_at(position) if wind != null else Vector3.ZERO
	var relative_velocity: Vector3 = velocity - wind_velocity
	var relative_speed: float = relative_velocity.length()
	var drag_force := Vector3.ZERO
	if relative_speed > 0.001:
		var drag_scale: float = 0.5 * GameConfig.AIR_DENSITY * GameConfig.ARROW_DRAG_COEFFICIENT * GameConfig.ARROW_FRONTAL_AREA * relative_speed
		drag_force = -relative_velocity.normalized() * drag_scale * relative_speed
		var arrow_axis: Vector3 = (state.transform.basis * Vector3(0.0, 0.0, -1.0)).normalized()
		var side_factor: float = 1.0 - absf(arrow_axis.dot(relative_velocity.normalized()))
		drag_force += -relative_velocity.normalized() * drag_scale * side_factor * GameConfig.ARROW_SIDE_AREA_FACTOR * 0.018
		var torque: Vector3 = (
			arrow_axis.cross(relative_velocity.normalized()) * relative_speed * relative_speed * 0.00008
			- state.angular_velocity * GameConfig.ARROW_ANGULAR_DAMPING
		)
		state.apply_torque(torque)
	state.apply_central_force(Vector3(0.0, GameConfig.GRAVITY * mass, 0.0) + drag_force)

func _physics_process(delta: float) -> void:
	if not launched or stuck:
		return
	flight_time += delta
	if flight_time > GameConfig.ARROW_MAX_LIFETIME or global_position.y > GameConfig.ARROW_MAX_ALTITUDE:
		queue_free()
		return
	orient_to_velocity()

func orient_to_velocity() -> void:
	if linear_velocity.length_squared() > 0.04:
		look_at(global_position + linear_velocity.normalized(), Vector3.UP)

func stick(parent_node: Node3D, point: Vector3) -> void:
	if stuck:
		return
	var flight_direction: Vector3 = linear_velocity.normalized()
	if flight_direction.length_squared() < 0.001:
		flight_direction = -global_basis.z
	stuck = true
	launched = false
	# `point` é a ponta que tocou o obstáculo; o corpo do nó fica no nock.
	global_position = point - flight_direction * GameConfig.ARROW_LENGTH
	freeze = true
	sleeping = true
	linear_velocity = Vector3.ZERO
	angular_velocity = Vector3.ZERO
	collision_layer = 0
	collision_mask = 0
	if is_instance_valid(parent_node) and parent_node != self:
		call_deferred("_reparent_after_impact", parent_node)

func _reparent_after_impact(parent_node: Node3D) -> void:
	if is_instance_valid(parent_node) and is_inside_tree():
		reparent(parent_node, true)

func _on_body_entered(body: Node3D) -> void:
	if stuck or not launched:
		return
	var flight_direction: Vector3 = linear_velocity.normalized()
	if flight_direction.length_squared() < 0.001:
		flight_direction = -global_basis.z
	var impact_point: Vector3 = global_position + flight_direction * GameConfig.ARROW_LENGTH
	impact.emit(self, body, impact_point)

func _build_visual() -> void:
	if built:
		return
	built = true
	var visual := Node3D.new()
	visual.name = "ArrowVisual"
	add_child(visual)
	var shaft_material := _make_material(Color(0.65, 0.49, 0.27, 1.0), 0.65, 0.0)
	var tip_material := _make_material(Color(0.45, 0.47, 0.50, 1.0), 0.3, 0.7)
	var feather_material := _make_material(Color(0.72, 0.10, 0.07, 1.0), 0.88, 0.0)

	var shaft := MeshInstance3D.new()
	var shaft_mesh := CylinderMesh.new()
	shaft_mesh.top_radius = 0.006
	shaft_mesh.bottom_radius = 0.006
	shaft_mesh.height = GameConfig.ARROW_LENGTH
	shaft_mesh.radial_segments = 6
	shaft.mesh = shaft_mesh
	shaft.material_override = shaft_material
	shaft.rotation.x = PI * 0.5
	shaft.position.z = -GameConfig.ARROW_LENGTH * 0.5
	visual.add_child(shaft)

	var tip := MeshInstance3D.new()
	var tip_mesh := CylinderMesh.new()
	tip_mesh.top_radius = 0.0
	tip_mesh.bottom_radius = 0.014
	tip_mesh.height = 0.07
	tip_mesh.radial_segments = 6
	tip.mesh = tip_mesh
	tip.material_override = tip_material
	tip.rotation.x = -PI * 0.5
	tip.position.z = -GameConfig.ARROW_LENGTH - 0.035
	visual.add_child(tip)

	for index in range(3):
		var feather := MeshInstance3D.new()
		var feather_mesh := BoxMesh.new()
		feather_mesh.size = Vector3(0.008, 0.06, 0.022)
		feather.mesh = feather_mesh
		feather.material_override = feather_material
		feather.position = Vector3(0.0, 0.0, -0.06)
		feather.rotation.z = float(index) * TAU / 3.0
		visual.add_child(feather)

	var collision := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.008
	capsule.height = GameConfig.ARROW_LENGTH
	collision.shape = capsule
	collision.position = Vector3(0.0, 0.0, -GameConfig.ARROW_LENGTH * 0.5)
	collision.rotation.x = PI * 0.5
	add_child(collision)

func _make_material(color: Color, roughness: float, metallic: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	return material
