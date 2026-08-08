extends SceneTree

const MAIN_SCENE: PackedScene = preload("res://scenes/Main.tscn")

var failures: Array[String] = []

func _init() -> void:
	call_deferred("_run")

func _run() -> void:
	var main := MAIN_SCENE.instantiate()
	get_root().add_child(main)
	await process_frame
	await process_frame
	for _step in range(12):
		await physics_frame

	var archer := main.get("archer") as ArcherController
	var terrain := main.get("terrain") as TerrainWorld
	var target := main.get("target") as StandingTarget
	var arrows := main.get("arrows") as ArrowManager
	if archer == null or terrain == null or target == null or arrows == null:
		failures.append("A cena principal não inicializou seus componentes")
	else:
		var ground_y: float = terrain.field.height_at(archer.global_position.x, archer.global_position.z)
		var height_error: float = absf(archer.global_position.y - ground_y)
		var collision_shape := terrain.ground_body.get_child(0) as CollisionShape3D
		var terrain_shape := collision_shape.shape as HeightMapShape3D
		var ray_query := PhysicsRayQueryParameters3D.create(
			Vector3(archer.global_position.x, 5.0, archer.global_position.z),
			Vector3(archer.global_position.x, -5.0, archer.global_position.z),
			1
		)
		var ray_hit: Dictionary = archer.get_world_3d().direct_space_state.intersect_ray(ray_query)
		print(
			"SMOKE player: posição=%s chão=%.3f erro=%.3f no_chão=%s pontos=%d ray=%s"
			% [archer.global_position, ground_y, height_error, archer.is_on_floor(), terrain_shape.map_data.size(), ray_hit]
		)
		if height_error > 0.20 or not archer.is_on_floor():
			failures.append("A arqueira não está apoiada no terreno")

		var muzzle: Vector3 = archer.bow.get_muzzle_global()
		var target_point: Vector3 = target.to_global(Vector3(0.0, 1.25, 0.06))
		print("SMOKE shot: muzzle=%s target=%s" % [muzzle, target_point])
		arrows.shoot(muzzle, (target_point - muzzle).normalized(), GameConfig.BOW_MAX_SPEED)
		for _step in range(180):
			await physics_frame
		var smoke_arrow := arrows.arrows[0] as BallisticArrow
		print(
			"SMOKE arrow: flechas=%d acertos=%d preso=%s posição=%s pai=%s"
			% [arrows.arrows.size(), target.hits, smoke_arrow.stuck, smoke_arrow.global_position, smoke_arrow.get_parent().name]
		)
		if target.hits < 1:
			failures.append("A flecha de smoke test não atingiu o alvo")

	main.queue_free()
	if failures.is_empty():
		print("RUNTIME SMOKE PASS")
		quit(0)
	else:
		for failure in failures:
			push_error(failure)
		print("RUNTIME SMOKE FAIL")
		quit(1)
