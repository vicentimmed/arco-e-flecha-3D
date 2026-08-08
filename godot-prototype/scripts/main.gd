extends Node3D

const TERRAIN_SCENE: PackedScene = preload("res://scenes/TerrainWorld.tscn")
const ARCHER_SCENE: PackedScene = preload("res://scenes/Archer.tscn")
const TARGET_SCENE: PackedScene = preload("res://scenes/StandingTarget.tscn")
const ARROW_MANAGER_SCRIPT: Script = preload("res://scripts/arrow_manager.gd")
const HUD_SCENE: PackedScene = preload("res://scenes/HUD.tscn")

var terrain: TerrainWorld
var archer: ArcherController
var target: StandingTarget
var arrows: ArrowManager
var hud: PrototypeHUD

func _ready() -> void:
	_setup_rendering()
	_build_prototype()

func _build_prototype() -> void:
	terrain = TERRAIN_SCENE.instantiate() as TerrainWorld
	add_child(terrain)
	terrain.build()

	hud = HUD_SCENE.instantiate() as PrototypeHUD
	add_child(hud)

	var target_z: float = -GameConfig.TARGET_DISTANCE
	var target_x: float = TerrainField.path_center_x(target_z)
	var target_location := Vector3(target_x, terrain.field.height_at(target_x, target_z), target_z)
	target = TARGET_SCENE.instantiate() as StandingTarget
	target.configure(terrain.field, target_location)
	add_child(target)

	var arrow_node := Node3D.new()
	arrow_node.set_script(ARROW_MANAGER_SCRIPT)
	arrows = arrow_node as ArrowManager
	add_child(arrow_node)
	arrows.configure(terrain, target, hud)

	archer = ARCHER_SCENE.instantiate() as ArcherController
	var player_z: float = 10.0
	var player_x: float = TerrainField.path_center_x(player_z)
	archer.position = Vector3(player_x, terrain.field.height_at(player_x, player_z), player_z)
	archer.configure(terrain.field, arrows, hud, target)
	add_child(archer)

	hud.call("show_message", "Mire no alvo e segure o botão esquerdo", 4.0)

func _setup_rendering() -> void:
	RenderingServer.set_default_clear_color(Color(0.075, 0.12, 0.18, 1.0))
	var world_environment := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color(0.075, 0.12, 0.18, 1.0)
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.58, 0.68, 0.58, 1.0)
	environment.ambient_light_energy = 1.0
	environment.reflected_light_source = Environment.REFLECTION_SOURCE_DISABLED
	world_environment.environment = environment
	add_child(world_environment)

	var sun := DirectionalLight3D.new()
	sun.name = "Sun"
	sun.rotation_degrees = Vector3(-48.0, -32.0, 0.0)
	sun.light_color = Color(1.0, 0.87, 0.67, 1.0)
	sun.light_energy = 1.35
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 180.0
	add_child(sun)

	var fill := DirectionalLight3D.new()
	fill.name = "SkyFill"
	fill.rotation_degrees = Vector3(-25.0, 145.0, 0.0)
	fill.light_color = Color(0.45, 0.58, 0.85, 1.0)
	fill.light_energy = 0.28
	add_child(fill)
