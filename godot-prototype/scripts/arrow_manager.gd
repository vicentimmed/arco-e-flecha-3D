class_name ArrowManager
extends Node3D

const ARROW_SCENE: PackedScene = preload("res://scenes/Arrow.tscn")

var terrain: TerrainWorld
var target: StandingTarget
var hud: Node
var wind: WindField = WindField.new()
var arrows: Array[BallisticArrow] = []
var wind_speed: float = 0.0

func configure(
	terrain_world: TerrainWorld,
	target_node: StandingTarget,
	hud_node: Node
) -> void:
	terrain = terrain_world
	target = target_node
	hud = hud_node

func _ready() -> void:
	add_to_group("arrow_manager")

func _process(delta: float) -> void:
	wind.advance(delta)
	wind_speed = wind.velocity_at(Vector3.ZERO).length()
	for index in range(arrows.size() - 1, -1, -1):
		if not is_instance_valid(arrows[index]):
			arrows.remove_at(index)
	if hud != null:
		hud.call("set_wind", wind.velocity_at(Vector3.ZERO))

func shoot(origin: Vector3, direction: Vector3, speed: float) -> void:
	if not is_inside_tree():
		return
	var arrow := ARROW_SCENE.instantiate() as BallisticArrow
	if arrow == null:
		return
	add_child(arrow)
	arrow.configure(self, wind)
	arrow.impact.connect(_on_arrow_impact)
	arrow.launch(origin, direction, clampf(speed, GameConfig.BOW_MIN_SPEED, GameConfig.BOW_MAX_SPEED))
	arrows.append(arrow)
	if hud != null:
		hud.call("show_message", "Flecha disparada · %.0f m/s" % speed, 1.4)

func reset_arrows() -> void:
	for arrow in arrows:
		if is_instance_valid(arrow):
			arrow.queue_free()
	arrows.clear()
	if hud != null:
		hud.call("show_message", "Flechas removidas", 1.0)

func _on_arrow_impact(arrow: BallisticArrow, body: Node3D, point: Vector3) -> void:
	if not is_instance_valid(arrow):
		return
	if is_instance_valid(body) and body.is_in_group("target"):
		var result: Dictionary = body.call("register_hit", point, arrow.linear_velocity)
		var score: int = int(result.get("score", 0))
		if hud != null:
			hud.call("show_impact", score, result.get("radius", 0.0))
		arrow.stick(body, point)
	else:
		if hud != null:
			hud.call("show_message", "Impacto no terreno", 1.0)
		arrow.stick(self, point)
