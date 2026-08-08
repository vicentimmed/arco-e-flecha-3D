class_name ValueNoise2D
extends RefCounted

## Ruído de valor determinístico, sem dependências externas.

var seed_value: int

func _init(seed_input: int = 20260731) -> void:
	seed_value = seed_input

func noise_2d(x: float, y: float) -> float:
	var xi: int = floori(x)
	var yi: int = floori(y)
	var xf: float = x - float(xi)
	var yf: float = y - float(yi)
	var u: float = xf * xf * (3.0 - 2.0 * xf)
	var v: float = yf * yf * (3.0 - 2.0 * yf)

	var a: float = _hash_to_unit(xi, yi)
	var b: float = _hash_to_unit(xi + 1, yi)
	var c: float = _hash_to_unit(xi, yi + 1)
	var d: float = _hash_to_unit(xi + 1, yi + 1)
	var top: float = lerpf(a, b, u)
	var bottom: float = lerpf(c, d, u)
	return lerpf(top, bottom, v)

func noise_1d(x: float) -> float:
	return noise_2d(x, 0.371)

func fbm_2d(
	x: float,
	y: float,
	octaves: int = 4,
	lacunarity: float = 2.03,
	gain: float = 0.5
) -> float:
	var total: float = 0.0
	var amplitude: float = 1.0
	var normalization: float = 0.0
	var fx: float = x
	var fy: float = y
	for _i in range(octaves):
		total += noise_2d(fx, fy) * amplitude
		normalization += amplitude
		amplitude *= gain
		fx *= lacunarity
		fy *= lacunarity
	return total / maxf(normalization, 0.0001)

func ridged_2d(
	x: float,
	y: float,
	octaves: int = 4,
	lacunarity: float = 2.11,
	gain: float = 0.5
) -> float:
	var total: float = 0.0
	var amplitude: float = 1.0
	var normalization: float = 0.0
	var fx: float = x
	var fy: float = y
	for _i in range(octaves):
		total += (1.0 - absf(noise_2d(fx, fy))) * amplitude
		normalization += amplitude
		amplitude *= gain
		fx *= lacunarity
		fy *= lacunarity
	return (total / maxf(normalization, 0.0001)) * 2.0 - 1.0

func _hash_to_unit(x: int, y: int) -> float:
	var value: int = x * 374761393 + y * 668265263 + seed_value * 1442695041
	value = (value ^ (value >> 13)) * 1274126177
	value = value ^ (value >> 16)
	var positive: int = value & 0x7fffffff
	return float(positive) / 1073741823.5 - 1.0
