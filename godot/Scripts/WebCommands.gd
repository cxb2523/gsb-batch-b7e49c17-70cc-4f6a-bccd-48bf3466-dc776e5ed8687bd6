extends Node

# Dictionary to store all registered commands
# Format: { "command_name": { "method": method_ref, "category": str, "description": str, "params": [] } }
var _commands = {}
# Sorted structure for categories and commands
# Format: { category: [sorted_command_names] }
var _sorted_commands = {}

var _my_js_callback
var externalator

# Human-readable names for the Variant types that can arrive from the browser
const _TYPE_NAMES := {
	TYPE_NIL: "null",
	TYPE_BOOL: "bool",
	TYPE_INT: "int",
	TYPE_FLOAT: "float",
	TYPE_STRING: "String",
	TYPE_STRING_NAME: "StringName",
	TYPE_VECTOR2: "Vector2",
	TYPE_VECTOR3: "Vector3",
	TYPE_COLOR: "Color",
	TYPE_OBJECT: "Object",
	TYPE_CALLABLE: "Callable",
	TYPE_SIGNAL: "Signal",
	TYPE_DICTIONARY: "Dictionary",
	TYPE_ARRAY: "Array",
	TYPE_PACKED_BYTE_ARRAY: "PackedByteArray",
	TYPE_PACKED_STRING_ARRAY: "PackedStringArray",
	TYPE_NODE_PATH: "NodePath",
}

func _ready():
	if OS.has_feature("web"):
		# The externalator interface is only defined in the Develop template
		if not JavaScriptBridge.eval("typeof externalator !== 'undefined'", true):
			return

		_my_js_callback = JavaScriptBridge.create_callback(commandCallback)
		externalator = JavaScriptBridge.get_interface("externalator")
		externalator.addGodotFunction('runCommand', _my_js_callback)

		# Register built-in commands
		register_command("help", "System", help, "Shows all available commands")
		# Add more built-in commands here

		print("Godot WebCommands ready -> Run 'runCommand(\"help\")' in browser console to see usage")

func register_command(commandName: String, category: String, method: Callable, description: String, params: Array = []):
	commandName = commandName.to_lower()

	# Re-registering a command overwrites the old definition. Remove the old
	# entry from the sorted structure first, so every command is listed once.
	if _commands.has(commandName):
		_remove_from_sorted_structure(commandName)

	# Store command in main dictionary
	_commands[commandName] = {
		"method": method,
		"category": category,
		"description": description,
		"params": params
	}

	# Update sorted structure
	if not _sorted_commands.has(category):
		_sorted_commands[category] = []

	# Insert command name in sorted position
	var commands = _sorted_commands[category]
	var insert_pos = 0
	for existing_command in commands:
		if commandName < existing_command:
			break
		insert_pos += 1
	commands.insert(insert_pos, commandName)

func _remove_from_sorted_structure(commandName: String) -> void:
	for category in _sorted_commands.keys():
		var commands = _sorted_commands[category]
		var index = commands.find(commandName)
		if index != -1:
			commands.remove_at(index)
			# Drop empty categories, so no empty category headers are shown
			if commands.is_empty():
				_sorted_commands.erase(category)
			return

func commandCallback(args):
	# Handle both string and array inputs
	var command_name: String
	var command_args = []

	if args is String:
		command_name = args
	elif args is Array and args.size() > 0:
		command_name = args[0]
		command_args = args.slice(1)
	else:
		push_error("Invalid command format")
		return

	# change command name to be always lower case
	command_name = command_name.to_lower()

	if not _commands.has(command_name):
		push_error("Command not found: " + command_name)
		return

	var command = _commands[command_name]

	var validation_result = _validate_arguments(command_name, command.params, command_args)
	if not validation_result["ok"]:
		push_error(validation_result["message"])
		return

	# Validation passed: call the handler the same way as before, using the
	# converted arguments (e.g. a "2.5" string becomes a 2.5 float).
	command.method.callv(validation_result["arguments"])

# Validates the received arguments against the registered parameter specs.
# Returns { "ok": bool, "arguments": Array, "message": String }.
# The handler is only meant to be called when "ok" is true.
func _validate_arguments(command_name: String, param_specs: Array, received_args: Array) -> Dictionary:
	var expected_count = param_specs.size()
	var received_count = received_args.size()

	if received_count != expected_count:
		return {
			"ok": false,
			"arguments": [],
			"message": _build_usage_error(command_name, param_specs, received_args,
				"Wrong number of arguments: expected %d but got %d" % [expected_count, received_count])
		}

	var converted_args = []
	for index in range(expected_count):
		var spec = param_specs[index]
		var declared_type = _parse_param_type(spec)
		var conversion = _convert_argument(received_args[index], declared_type)
		if not conversion["ok"]:
			return {
				"ok": false,
				"arguments": [],
				"message": _build_usage_error(command_name, param_specs, received_args,
					"Argument %d (%s) cannot be converted to declared type '%s': got %s" % [
						index + 1, str(spec), declared_type, _describe_value(received_args[index])
					])
			}
		converted_args.append(conversion["value"])

	return {
		"ok": true,
		"arguments": converted_args,
		"message": ""
	}

# Extracts the declared type from a spec such as "scale: float".
# Falls back to the raw spec when it does not follow the "name: type" format.
func _parse_param_type(param_spec) -> String:
	var spec_text = str(param_spec)
	if spec_text.contains(":"):
		return spec_text.split(":", true, 1)[1].strip_edges()
	return spec_text.strip_edges()

# Converts a single received argument to the declared type.
# float and String are actively validated; unknown types are passed through.
func _convert_argument(value, declared_type: String) -> Dictionary:
	var normalized_type = declared_type.to_lower()

	if normalized_type == "float":
		if value is float or value is int:
			return { "ok": true, "value": float(value) }
		if value is String:
			if value.is_valid_float():
				return { "ok": true, "value": value.to_float() }
		return { "ok": false, "value": null }

	if normalized_type == "string":
		if value is String:
			return { "ok": true, "value": value }
		if value is float or value is int or value is bool:
			return { "ok": true, "value": str(value) }
		return { "ok": false, "value": null }

	# Unknown declared type: no conversion rule available, pass the value through unchanged
	return { "ok": true, "value": value }

func _build_usage_error(command_name: String, param_specs: Array, received_args: Array, reason: String) -> String:
	return "Invalid call to command '%s': %s.\n  Expected: %s\n  Received: runCommand(\"%s\"%s)" % [
		command_name,
		reason,
		_format_usage(command_name, param_specs),
		command_name,
		_format_arguments(received_args)
	]

func _format_usage(command_name: String, param_specs: Array) -> String:
	var usage = "runCommand(\"%s\"" % command_name
	for param in param_specs:
		usage += ", " + str(param)
	usage += ")"
	return usage

func _format_arguments(received_args: Array) -> String:
	var formatted = ""
	for arg in received_args:
		formatted += ", " + _describe_value(arg)
	return formatted

func _describe_value(value) -> String:
	if value == null:
		return "null"
	var type_name = _TYPE_NAMES.get(typeof(value), "type %d" % typeof(value))
	return "%s (%s)" % [str(value), type_name]

func get_help_text() -> String:
	var help_text = ""

	# Display commands using pre-sorted structure
	for category in _sorted_commands:
		help_text += "[b]%s[/b]\n" % category

		for command_name in _sorted_commands[category]:
			var command = _commands[command_name]
			var params_str = ""
			for param in command.params:
				params_str += ", " + str(param)

			help_text += "  runCommand(\"%s\"%s) -> %s\n" % [
				command_name,
				params_str,
				command.description
			]

	# Strip all newlines and spaces before and after the text
	return help_text.strip_edges()

func help():
	print(get_help_text())
