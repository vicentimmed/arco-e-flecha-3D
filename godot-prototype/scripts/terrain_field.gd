class_name TerrainField
extends RefCounted

## Campo escalar compartilhado pela malha visual, colisão e gameplay.

var noise: ValueNoise2D
var center_z: float
var half_z: float

func _init(seed_value: int = 20260731) -> void:
	noise = ValueNoise2D.new(seed_value)
	center_z = (GameConfig.ARENA_Z_BACK + GameConfig.ARENA_Z_FRONT) * 0.5
	half_z = (GameConfig.ARENA_Z_BACK - GameConfig.ARENA_Z_FRONT) * 0.5

static func path_center_x(z: float) -> float:
	return 3.0 * sin(z * 0.016) + 1.6 * sin(z * 0.0052 + 1.1)

func arena_distance(x: float, z: float) -> float:
	var qx: float = absf(x) - GameConfig.ARENA_HALF_X
	var qz: float = absf(z - center_z) - half_z
	var ox: float = maxf(qx, 0.0)
	var oz: float = maxf(qz, 0.0)
	var box: float = sqrt(ox * ox + oz * oz) + minf(maxf(qx, qz), 0.0)
	return box + GameConfig.ARENA_EDGE_NOISE * noise.fbm_2d(x * 0.0072, z * 0.0072, 3)

func height_at(x: float, z: float) -> float:
	var distance_to_path: float = absf(x - path_center_x(z))
	var height: float = (
		0.52 * noise.fbm_2d(x * 0.021, z * 0.021, 3)
		+ 0.19 * noise.fbm_2d(x * 0.082, z * 0.082, 2)
	)
	var on_path: float = 1.0 - GameConfig.smooth_step(3.0, 7.5, distance_to_path)
	height *= 1.0 - 0.8 * on_path
	height -= 0.14 * on_path

	var arena_dist: float = arena_distance(x, z)
	if arena_dist <= -GameConfig.ARENA_FOOT_BAND:
		return height

	height += GameConfig.ARENA_FOOT_HEIGHT * GameConfig.smooth_step(
		-GameConfig.ARENA_FOOT_BAND,
		GameConfig.ARENA_FOOT_BAND * 0.5,
		arena_dist
	)

	var wall_distance: float = arena_dist - GameConfig.ARENA_WALL_START
	if wall_distance <= 0.0:
		return height

	var warped_x: float = x + 30.0 * noise.fbm_2d(x * 0.0052 + 5.2, z * 0.0052 - 2.1, 2)
	var warped_z: float = z + 30.0 * noise.fbm_2d(x * 0.0052 - 8.7, z * 0.0052 + 4.4, 2)
	var ridge_a: float = 0.5 + 0.5 * noise.ridged_2d(warped_x * 0.0068, warped_z * 0.0068, 3)
	var ridge_b: float = 0.5 + 0.5 * noise.ridged_2d(warped_x * 0.018, warped_z * 0.018, 3)
	var ridge_c: float = 0.5 + 0.5 * noise.ridged_2d(warped_x * 0.044, warped_z * 0.044, 2)
	var ridge: float = pow(0.6 * ridge_a + 0.27 * ridge_b + 0.13 * ridge_c, 1.5)
	var massif: float = 0.55 + 0.7 * (
		0.5 + 0.5 * noise.fbm_2d(x * 0.0036 - 17.3, z * 0.0036 + 9.1, 2)
	)
	var rise: float = 1.0 - exp(-wall_distance / GameConfig.ARENA_RAMP_LENGTH)
	height += GameConfig.ARENA_PEAK * massif * rise * (0.22 + 0.9 * ridge)

	var bench: float = minf(1.0, wall_distance / 14.0) * (
		1.0 - GameConfig.smooth_step(0.55, 1.0, height / (GameConfig.ARENA_PEAK * 1.15))
	)
	height += 1.5 * bench * sin(height * 0.32 + noise.noise_2d(x * 0.03, z * 0.03) * 2.4)
	height += 2.2 * noise.fbm_2d(x * 0.075, z * 0.075, 3) * (
		minf(1.0, wall_distance / 8.0) * exp(-wall_distance / 90.0)
	)
	return height

func normal_at(x: float, z: float, epsilon: float = 0.6) -> Vector3:
	var h_left: float = height_at(x - epsilon, z)
	var h_right: float = height_at(x + epsilon, z)
	var h_down: float = height_at(x, z - epsilon)
	var h_up: float = height_at(x, z + epsilon)
	var normal := Vector3(h_left - h_right, 2.0 * epsilon, h_down - h_up)
	return normal.normalized()

func slope_at(x: float, z: float, epsilon: float = 0.6) -> float:
	return normal_at(x, z, epsilon).y

func is_walkable(x: float, z: float) -> bool:
	if x <= GameConfig.WORLD_MIN_X + 1.0 or x >= GameConfig.WORLD_MAX_X - 1.0:
		return false
	if z <= GameConfig.WORLD_MIN_Z + 1.0 or z >= GameConfig.WORLD_MAX_Z - 1.0:
		return false
	return true

func is_flat_ground(
	x: float,
	z: float,
	margin: float = GameConfig.ARENA_FOOT_BAND,
	minimum_slope: float = 0.94
) -> bool:
	return is_walkable(x, z) and arena_distance(x, z) <= -margin and slope_at(x, z, 1.0) >= minimum_slope
