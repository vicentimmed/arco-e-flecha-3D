class_name GameConfig
extends RefCounted

## Valores do vertical slice. Uma unidade Godot equivale a um metro.

const FIXED_STEP: float = 1.0 / 120.0
const GRAVITY: float = -9.81
const AIR_DENSITY: float = 1.225

const WALK_SPEED: float = 3.2
const RUN_SPEED: float = 9.6
const PLAYER_HEIGHT: float = 1.72
const PLAYER_RADIUS: float = 0.35
const JUMP_SPEED: float = 4.2

const BOW_MIN_SPEED: float = 30.0
const BOW_MAX_SPEED: float = 120.0
const BOW_FULL_DRAW_TIME: float = 1.7
const BOW_HOLD_BEFORE_SHAKE: float = 3.0
const BOW_RELOAD_TIME: float = 1.0

const ARROW_MASS: float = 0.025
const ARROW_LENGTH: float = 0.75
const ARROW_RADIUS: float = 0.004
const ARROW_DRAG_COEFFICIENT: float = 2.0
const ARROW_SIDE_AREA_FACTOR: float = 55.0
const ARROW_CENTER_OF_PRESSURE_OFFSET: float = 0.13
const ARROW_ANGULAR_DAMPING: float = 1.1
const ARROW_MAX_LIFETIME: float = 25.0
const ARROW_MAX_ALTITUDE: float = 400.0
const ARROW_FRONTAL_AREA: float = 3.14159265359 * ARROW_RADIUS * ARROW_RADIUS

const WORLD_MIN_X: float = -85.0
const WORLD_MAX_X: float = 85.0
const WORLD_MIN_Z: float = -150.0
const WORLD_MAX_Z: float = 45.0
const ARENA_HALF_X: float = 30.0
const ARENA_Z_BACK: float = 28.0
const ARENA_Z_FRONT: float = -120.0
const ARENA_EDGE_NOISE: float = 8.0
const ARENA_FOOT_BAND: float = 14.0
const ARENA_FOOT_HEIGHT: float = 8.5
const ARENA_WALL_START: float = 10.0
const ARENA_RAMP_LENGTH: float = 34.0
const ARENA_PEAK: float = 70.0

const TARGET_DISTANCE: float = 30.0
const TARGET_RADIUS: float = 0.5
const TARGET_THICKNESS: float = 0.12
const TARGET_RINGS: int = 10
const TARGET_MASS: float = 2.5

const AIM_MAX_RANGE: float = 400.0
const CAMERA_FOV: float = 58.0
const CAMERA_DISTANCE: float = 4.15
const CAMERA_RIGHT: float = 1.25
const CAMERA_UP: float = 1.9
const CAMERA_CONVERGENCE: float = 40.0

static func draw_fraction(draw_time: float) -> float:
	return clampf(draw_time / BOW_FULL_DRAW_TIME, 0.0, 1.0)

static func draw_speed(draw_time: float) -> float:
	var t: float = draw_fraction(draw_time)
	var eased: float = 1.0 - pow(1.0 - t, 1.7)
	return BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * eased

static func smooth_step(edge_a: float, edge_b: float, value: float) -> float:
	var t: float = clampf((value - edge_a) / (edge_b - edge_a), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)
