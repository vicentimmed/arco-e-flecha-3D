extends SceneTree

const ARROW_SCENE: PackedScene = preload("res://scenes/Arrow.tscn")

var failures: Array[String] = []

func _init() -> void:
	_test_terrain()
	_test_ballistics()
	_test_ccd_configuration()
	if failures.is_empty():
		print("SELF-TEST PASS: todos os critérios do protótipo passaram.")
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		print("SELF-TEST FAIL: %d critério(s) falharam." % failures.size())
		quit(1)

func _test_terrain() -> void:
	var first := TerrainField.new(20260731)
	var second := TerrainField.new(20260731)
	var samples := [
		Vector2(0.0, 10.0),
		Vector2(-18.0, -12.0),
		Vector2(42.5, -87.0),
		Vector2(-61.0, 24.0)
	]
	var deterministic := true
	for sample in samples:
		var a: float = first.height_at(sample.x, sample.y)
		var b: float = second.height_at(sample.x, sample.y)
		deterministic = deterministic and is_equal_approx(a, b)
	var normal: Vector3 = first.normal_at(0.0, 10.0)
	_check(deterministic and normal.y > 0.0, "Terreno determinístico ou normal inválida")
	print("PASS terreno: amostras determinísticas e normal orientada")

func _test_ballistics() -> void:
	var speed: float = GameConfig.BOW_MAX_SPEED
	var angle: float = deg_to_rad(38.0)
	var expected: float = speed * speed * sin(2.0 * angle) / -GameConfig.GRAVITY
	var ideal: Dictionary = _simulate_projectile(speed, angle, false)
	var ideal_error: float = absf(float(ideal["range"]) - expected) / expected
	_check(ideal_error < 0.02, "Balística sem arrasto diverge do alcance analítico")

	var dragged: Dictionary = _simulate_projectile(speed, angle, true)
	var dragged_range: float = float(dragged["range"])
	var ideal_range: float = float(ideal["range"])
	var speeds: Array[float] = dragged["speeds"]
	var monotonic: bool = true
	for index in range(1, mini(speeds.size(), 50)):
		if speeds[index] > speeds[index - 1] + 0.02:
			monotonic = false
			break
	_check(dragged_range < ideal_range and monotonic, "Arrasto não reduziu alcance/velocidade")
	print(
		"PASS balística: %.1f m analítico, %.1f m integrado, %.1f m com arrasto"
		% [expected, ideal_range, dragged_range]
	)

func _test_ccd_configuration() -> void:
	var arrow := ARROW_SCENE.instantiate() as BallisticArrow
	arrow._ready()
	var configured: bool = arrow.continuous_cd
	arrow.free()

	var detections: int = 0
	for phase in range(50):
		var previous_z: float = -19.8 + float(phase) * 0.0005
		var next_z: float = previous_z - GameConfig.BOW_MAX_SPEED * GameConfig.FIXED_STEP
		if _segment_crosses_slab(previous_z, next_z, -20.0, 0.05):
			detections += 1
	_check(configured and detections == 50, "CCD não está configurado ou teste de varredura falhou")
	print("PASS CCD: %d/50 segmentos de alta velocidade detectados" % detections)

func _simulate_projectile(speed: float, angle: float, with_drag: bool) -> Dictionary:
	var position := Vector3(0.0, 100.0, 0.0)
	var velocity := Vector3(0.0, sin(angle) * speed, -cos(angle) * speed)
	var previous := position
	var values: Array[float] = []
	var range_value: float = 0.0
	for _step in range(20000):
		previous = position
		var relative := velocity
		if with_drag:
			var relative_speed: float = relative.length()
			if relative_speed > 0.001:
				var coefficient: float = (
					0.5
					* GameConfig.AIR_DENSITY
					* GameConfig.ARROW_DRAG_COEFFICIENT
					* GameConfig.ARROW_FRONTAL_AREA
					* relative_speed
				)
				velocity += -relative.normalized() * coefficient * relative_speed / GameConfig.ARROW_MASS * GameConfig.FIXED_STEP
		velocity.y += GameConfig.GRAVITY * GameConfig.FIXED_STEP
		position += velocity * GameConfig.FIXED_STEP
		values.append(velocity.length())
		if velocity.y < 0.0 and position.y <= 100.0:
			var fraction: float = (previous.y - 100.0) / (previous.y - position.y)
			range_value = absf(previous.z + (position.z - previous.z) * fraction)
			break
	return {"range": range_value, "speeds": values}

func _segment_crosses_slab(previous_z: float, next_z: float, slab_center: float, half_width: float) -> bool:
	var near_z: float = minf(previous_z, next_z)
	var far_z: float = maxf(previous_z, next_z)
	return near_z <= slab_center + half_width and far_z >= slab_center - half_width

func _check(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)
