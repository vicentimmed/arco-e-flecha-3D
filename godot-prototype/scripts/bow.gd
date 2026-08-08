class_name Bow
extends Node3D

const BRACE_HEIGHT: float = 0.09
const DRAW_LENGTH: float = 0.52
const LIMB_PIVOT_Y: float = 0.15

var draw: float = 0.0
var nock_point: Vector3
var rest_point: Vector3 = Vector3(0.018, 0.052, -0.02)
var upper_limb: MeshInstance3D
var lower_limb: MeshInstance3D
var string_top: MeshInstance3D
var string_bottom: MeshInstance3D
var nocked_arrow: Node3D
var built: bool = false

func _ready() -> void:
	build()

func build() -> void:
	if built:
		return
	built = true
	var black := _make_material(Color(0.055, 0.06, 0.075, 1.0), 0.3, 0.7)
	var grip := _make_material(Color(0.16, 0.11, 0.065, 1.0), 0.92, 0.0)
	var string_material := _make_material(Color(0.75, 0.70, 0.58, 1.0), 0.65, 0.0)

	var riser := MeshInstance3D.new()
	var riser_mesh := BoxMesh.new()
	riser_mesh.size = Vector3(0.09, 0.36, 0.12)
	riser.mesh = riser_mesh
	riser.material_override = black
	riser.position = Vector3(0.0, 0.0, -0.04)
	add_child(riser)

	var handle := MeshInstance3D.new()
	var handle_mesh := CapsuleMesh.new()
	handle_mesh.radius = 0.045
	handle_mesh.height = 0.22
	handle.mesh = handle_mesh
	handle.material_override = grip
	handle.position = Vector3(0.0, -0.05, -0.04)
	add_child(handle)

	upper_limb = _make_segment(0.022, black)
	lower_limb = _make_segment(0.022, black)
	add_child(upper_limb)
	add_child(lower_limb)

	string_top = _make_segment(0.005, string_material)
	string_bottom = _make_segment(0.005, string_material)
	add_child(string_top)
	add_child(string_bottom)

	nocked_arrow = _build_nocked_arrow()
	add_child(nocked_arrow)
	set_draw(0.0)

func set_draw(value: float) -> void:
	draw = clampf(value, 0.0, 1.0)
	nock_point = Vector3(0.012, 0.02, BRACE_HEIGHT + DRAW_LENGTH * draw)
	var bend: float = draw * 0.19
	var upper_pivot := Vector3(0.0, LIMB_PIVOT_Y, -0.03)
	var lower_pivot := Vector3(0.0, -LIMB_PIVOT_Y, -0.03)
	var upper_tip := Vector3(0.0, LIMB_PIVOT_Y + 0.60, -0.03 + 0.14 + bend * 0.15)
	var lower_tip := Vector3(0.0, -LIMB_PIVOT_Y - 0.60, -0.03 + 0.14 + bend * 0.15)
	_place_segment(upper_limb, to_global(upper_pivot), to_global(upper_tip))
	_place_segment(lower_limb, to_global(lower_pivot), to_global(lower_tip))
	_place_segment(string_top, to_global(upper_tip), to_global(nock_point))
	_place_segment(string_bottom, to_global(lower_tip), to_global(nock_point))
	nocked_arrow.position = nock_point

func set_arrow_visible(visible: bool) -> void:
	if is_instance_valid(nocked_arrow):
		nocked_arrow.visible = visible

func get_muzzle_global() -> Vector3:
	return to_global(rest_point)

func get_nock_global() -> Vector3:
	return to_global(nock_point)

func get_grip_global() -> Vector3:
	return to_global(Vector3.ZERO)

func _make_segment(radius: float, material: StandardMaterial3D) -> MeshInstance3D:
	var node := MeshInstance3D.new()
	var mesh := CylinderMesh.new()
	mesh.top_radius = radius
	mesh.bottom_radius = radius
	mesh.height = 1.0
	mesh.radial_segments = 8
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

func _build_nocked_arrow() -> Node3D:
	var group := Node3D.new()
	var shaft_material := _make_material(Color(0.65, 0.49, 0.27, 1.0), 0.65, 0.0)
	var tip_material := _make_material(Color(0.45, 0.47, 0.50, 1.0), 0.3, 0.7)
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
	group.add_child(shaft)

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
	group.add_child(tip)
	return group

func _make_material(color: Color, roughness: float, metallic: float) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.roughness = roughness
	material.metallic = metallic
	return material
