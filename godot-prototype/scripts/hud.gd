class_name PrototypeHUD
extends CanvasLayer

var draw_bar: ProgressBar
var draw_label: Label
var status_label: Label
var message_label: Label
var debug_label: Label
var debug_panel: ColorRect
var wind_label: Label
var message_time: float = 0.0
var impact_time: float = 0.0
var current_wind: Vector3 = Vector3.ZERO

func _ready() -> void:
	_build_ui()

func _process(delta: float) -> void:
	message_time = maxf(message_time - delta, 0.0)
	impact_time = maxf(impact_time - delta, 0.0)
	if message_time <= 0.0 and impact_time <= 0.0:
		message_label.text = ""
		if status_label.text.begins_with("ACERTO"):
			status_label.text = "Pronto"

func set_draw_state(fraction: float, speed: float, is_drawing: bool) -> void:
	if draw_bar == null:
		return
	draw_bar.value = fraction * 100.0
	draw_label.text = (
		"Tensionando  ·  %03d m/s" % roundi(speed)
		if is_drawing
		else "Clique e segure para tensionar"
	)

func set_wind(wind: Vector3) -> void:
	current_wind = wind
	if wind_label != null:
		wind_label.text = "Vento  %+.1f  /  %+.1f m/s" % [wind.x, wind.z]

func set_debug_values(values: Dictionary) -> void:
	if debug_label == null:
		return
	var position: Vector3 = values.get("position", Vector3.ZERO)
	debug_label.text = (
		"DIAGNÓSTICO\n"
		+ "velocidade: %.2f m/s\n" % float(values.get("speed", 0.0))
		+ "tensão:     %3.0f %%\n" % (float(values.get("draw", 0.0)) * 100.0)
		+ "posição:    %6.1f, %5.1f, %6.1f\n" % [position.x, position.y, position.z]
		+ "vento:      %.2f m/s\n" % float(values.get("wind", 0.0))
		+ "F3 oculta este painel"
	)

func show_message(message: String, duration: float = 1.2) -> void:
	message_label.text = message
	message_time = duration

func show_impact(score: int, radius: float) -> void:
	if score > 0:
		status_label.text = "ACERTO  ·  %d pontos" % score
		message_label.text = "Distância do centro: %.2f m" % radius
	else:
		status_label.text = "Atingiu o alvo fora da face"
		message_label.text = "Tente alinhar a mira com o círculo frontal"
	impact_time = 2.4
	message_time = 2.4

func toggle_debug() -> void:
	if debug_panel != null:
		debug_panel.visible = not debug_panel.visible

func _build_ui() -> void:
	var root := Control.new()
	root.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(root)

	var title := Label.new()
	title.text = "ARCO & FLECHA  ·  PROTÓTIPO GODOT"
	title.position = Vector2(24.0, 20.0)
	title.add_theme_font_size_override("font_size", 18)
	title.add_theme_color_override("font_color", Color(0.92, 0.86, 0.70, 1.0))
	root.add_child(title)

	status_label = Label.new()
	status_label.text = "Pronto"
	status_label.position = Vector2(24.0, 48.0)
	status_label.add_theme_font_size_override("font_size", 24)
	status_label.add_theme_color_override("font_color", Color(1.0, 0.90, 0.62, 1.0))
	root.add_child(status_label)

	wind_label = Label.new()
	wind_label.position = Vector2(24.0, 84.0)
	wind_label.add_theme_font_size_override("font_size", 14)
	wind_label.add_theme_color_override("font_color", Color(0.65, 0.80, 0.88, 1.0))
	root.add_child(wind_label)
	set_wind(Vector3.ZERO)

	var reticle := Label.new()
	reticle.text = "·"
	reticle.set_anchors_preset(Control.PRESET_CENTER)
	reticle.position = Vector2(-5.0, -19.0)
	reticle.size = Vector2(10.0, 35.0)
	reticle.add_theme_font_size_override("font_size", 32)
	reticle.add_theme_color_override("font_color", Color(1.0, 0.91, 0.66, 0.92))
	root.add_child(reticle)

	draw_bar = ProgressBar.new()
	draw_bar.position = Vector2(24.0, 112.0)
	draw_bar.size = Vector2(300.0, 18.0)
	draw_bar.min_value = 0.0
	draw_bar.max_value = 100.0
	draw_bar.value = 0.0
	draw_bar.show_percentage = false
	root.add_child(draw_bar)

	draw_label = Label.new()
	draw_label.text = "Clique e segure para tensionar"
	draw_label.position = Vector2(24.0, 134.0)
	draw_label.add_theme_font_size_override("font_size", 13)
	root.add_child(draw_label)

	message_label = Label.new()
	message_label.position = Vector2(24.0, 168.0)
	message_label.add_theme_font_size_override("font_size", 16)
	message_label.add_theme_color_override("font_color", Color(0.95, 0.95, 0.88, 1.0))
	root.add_child(message_label)

	var help := Label.new()
	help.text = "WASD mover  ·  Shift correr  ·  C câmera  ·  R reiniciar  ·  Esc liberar mouse"
	help.position = Vector2(24.0, 678.0)
	help.add_theme_font_size_override("font_size", 13)
	help.add_theme_color_override("font_color", Color(0.70, 0.74, 0.76, 1.0))
	root.add_child(help)

	debug_panel = ColorRect.new()
	debug_panel.color = Color(0.02, 0.03, 0.05, 0.78)
	debug_panel.position = Vector2(1010.0, 20.0)
	debug_panel.size = Vector2(245.0, 180.0)
	root.add_child(debug_panel)

	debug_label = Label.new()
	debug_label.position = Vector2(12.0, 10.0)
	debug_label.add_theme_font_size_override("font_size", 13)
	debug_label.add_theme_color_override("font_color", Color(0.70, 0.90, 0.80, 1.0))
	debug_panel.add_child(debug_label)
