class_name CameraRig
extends Node3D

@onready var camera: Camera3D = $Camera3D

var archer: Node3D
var first_person: bool = false

func configure(player: Node3D) -> void:
	archer = player
	camera.fov = GameConfig.CAMERA_FOV
	camera.current = true

func _physics_process(_delta: float) -> void:
	if not is_instance_valid(archer):
		return
	var yaw: float = float(archer.get("yaw"))
	var pitch: float = float(archer.get("pitch"))
	var forward := Vector3(-sin(yaw), 0.0, -cos(yaw))
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	var eye: Vector3 = archer.global_position + Vector3.UP * 1.52
	var focus: Vector3 = eye + forward * GameConfig.CAMERA_CONVERGENCE + Vector3.UP * sin(pitch) * 4.0

	if first_person:
		camera.global_position = eye + right * 0.24 + forward * 0.08
	else:
		camera.global_position = (
			archer.global_position
			+ right * GameConfig.CAMERA_RIGHT
			+ Vector3.UP * GameConfig.CAMERA_UP
			- forward * GameConfig.CAMERA_DISTANCE
		)
	camera.look_at(focus, Vector3.UP)

func get_aim_point(max_range: float = GameConfig.AIM_MAX_RANGE) -> Vector3:
	if not is_instance_valid(camera):
		return Vector3.ZERO
	var viewport_size: Vector2 = get_viewport().get_visible_rect().size
	var screen_center: Vector2 = viewport_size * 0.5
	var origin: Vector3 = camera.project_ray_origin(screen_center)
	var direction: Vector3 = camera.project_ray_normal(screen_center)
	var query := PhysicsRayQueryParameters3D.create(
		origin,
		origin + direction * max_range,
		1
	)
	if is_instance_valid(archer):
		query.exclude = [archer.get_rid()]
	var hit: Dictionary = get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return origin + direction * max_range
	return hit["position"]

func toggle_first_person() -> bool:
	first_person = not first_person
	return first_person
