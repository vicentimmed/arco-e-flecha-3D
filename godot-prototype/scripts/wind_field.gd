class_name WindField
extends RefCounted

var noise: ValueNoise2D = ValueNoise2D.new(8128)
var time: float = 0.0

func advance(delta: float) -> void:
	time += delta

func velocity_at(position: Vector3) -> Vector3:
	var phase: float = time * 0.08
	var gust: float = noise.noise_2d(position.z * 0.012 + phase, position.x * 0.009)
	var cross: float = noise.noise_2d(position.x * 0.018 - phase * 0.7, position.z * 0.014)
	return Vector3(2.6 + gust * 1.8, 0.0, 0.7 + cross * 1.2)
