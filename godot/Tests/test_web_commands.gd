extends SceneTree
## Headless test suite for WebCommands.
##
## Runs without a browser or Web export, since WebCommands only touches
## JavaScriptBridge inside _ready() and the tests call register_command()
## and commandCallback() directly.
##
## Run with:
##   godot --headless --path godot --script Tests/test_web_commands.gd
## or simply:
##   Tests/run_tests.sh

const WebCommandsScript = preload("res://Scripts/WebCommands.gd")
const CommonWebCommandsScript = preload("res://Scripts/CommonWebCommands.gd")

var _web_commands: Node
var _common_commands: Node
var _failures: Array = []
var _checks_run: int = 0

# Probe state used by the locally registered test commands.
var probe_calls: int = 0
var probe_last_args: Array = []
var probe_last_value = null


func _init() -> void:
	# The scene tree (autoloads, root window) is not active inside _init(), so
	# absolute node paths do not resolve yet. Defer the whole suite to the
	# idle frame once the tree is fully initialized.
	call_deferred("_run_tests")


func _run_tests() -> void:
	print("=== WebCommands tests ===")
	_setup()
	_test_normal_calls()
	_test_too_few_arguments()
	_test_unconvertible_argument()
	_test_too_many_arguments()
	_test_duplicate_registration()
	_teardown()

	if _failures.is_empty():
		print("All %d checks passed." % _checks_run)
		quit(0)
	else:
		push_error("%d of %d checks failed:" % [_failures.size(), _checks_run])
		for failure in _failures:
			push_error("  FAIL: " + failure)
		quit(1)


func _setup() -> void:
	# Reuse the WebCommands autoload when the project instantiated it;
	# otherwise build a standalone instance (keeps the suite self-contained).
	var existing = root.get_node_or_null("/root/WebCommands")
	if existing != null:
		_web_commands = existing
	else:
		_web_commands = Node.new()
		_web_commands.name = "TestWebCommands"
		_web_commands.set_script(WebCommandsScript)
		root.add_child(_web_commands)

	# Register the real built-in common commands (set_time_scale, print_rich, ...).
	# CommonWebCommands._ready() resolves the "/root/WebCommands" autoload path,
	# which only works once the tree is active.
	_common_commands = Node.new()
	_common_commands.set_script(CommonWebCommandsScript)
	root.add_child(_common_commands)
	_common_commands._ready()


func _teardown() -> void:
	_common_commands.queue_free()
	# A test-created WebCommands node is discarded with the scene tree on quit();
	# the project autoload singleton must never be freed here.


# --- Probe handlers ----------------------------------------------------------

func _probe_no_args() -> void:
	probe_calls += 1
	probe_last_args = []


func _probe_float(value: float) -> void:
	probe_calls += 1
	probe_last_value = value
	probe_last_args = [value]


func _probe_string(message: String) -> void:
	probe_calls += 1
	probe_last_value = message
	probe_last_args = [message]


func _probe_old() -> void:
	# Distinctive marker: the old implementation must never be called.
	probe_calls += 100


func _probe_new() -> void:
	probe_calls += 1


# --- Tests -------------------------------------------------------------------

func _test_normal_calls() -> void:
	print("-- normal calls")

	# set_time_scale("scale: float") with a float argument
	Engine.time_scale = 1.0
	_web_commands.commandCallback(["set_time_scale", 2.5])
	_check(Engine.time_scale == 2.5, "set_time_scale applies the float argument")

	# A numeric string is converted to the declared float type
	_web_commands.commandCallback(["set_time_scale", "0.5"])
	_check(Engine.time_scale == 0.5, "set_time_scale converts a numeric string to float")
	Engine.time_scale = 1.0

	# print_rich("message: String") with a string argument
	var rich_result = _web_commands._validate_arguments(
		"print_rich", ["message: String"], ["hello world"])
	_check(rich_result["ok"], "print_rich accepts a string argument")
	_check(rich_result["arguments"][0] == "hello world",
		"print_rich passes the string through to the handler")
	_web_commands.commandCallback(["print_rich", "hello world"])

	# Locally registered float command receives the converted value
	_web_commands.register_command(
		"probe_float", "Tests", _probe_float, "probe", ["value: float"])
	probe_calls = 0
	_web_commands.commandCallback(["probe_float", 42])
	_check(probe_calls == 1, "float probe command is called once")
	_check(probe_last_value is float and probe_last_value == 42.0,
		"int argument is converted and passed as float to the handler")

	# Locally registered String command converts a number
	_web_commands.register_command(
		"probe_string", "Tests", _probe_string, "probe", ["message: String"])
	probe_calls = 0
	_web_commands.commandCallback(["probe_string", 7])
	_check(probe_calls == 1, "string probe command is called once")
	_check(probe_last_value is String and probe_last_value == "7",
		"int argument is converted and passed as String to the handler")

	# A command without declared params called without arguments still works
	_web_commands.register_command(
		"probe_no_params", "Tests", _probe_no_args, "probe")
	probe_calls = 0
	_web_commands.commandCallback(["probe_no_params"])
	_check(probe_calls == 1, "parameterless command runs with no arguments")

	# String-only input (as sent by the browser console) still works
	probe_calls = 0
	_web_commands.commandCallback("probe_no_params")
	_check(probe_calls == 1, "parameterless command runs from a string-only callback")


func _test_too_few_arguments() -> void:
	print("-- too few arguments")

	probe_calls = 0
	_web_commands.commandCallback(["set_time_scale"])
	_check(probe_calls == 0, "set_time_scale handler is not called when an argument is missing")
	_check(Engine.time_scale == 1.0, "time scale stays unchanged after missing-argument call")

	probe_calls = 0
	_web_commands.commandCallback(["probe_float"])
	_check(probe_calls == 0, "float probe handler is not called when an argument is missing")

	# The error message must name the command, the expected usage and the args
	var message = _capture_validation_error(["set_time_scale"])
	_check(message.contains("set_time_scale"), "arity error names the command")
	_check(message.contains("scale: float"), "arity error shows the expected usage")
	_check(message.begins_with("Invalid call to command 'set_time_scale'"),
		"arity error has the readable Invalid-call prefix")
	_check(message.contains("Received:"), "arity error reports the received arguments section")


func _test_unconvertible_argument() -> void:
	print("-- unconvertible argument")

	# An array cannot be converted to float
	probe_calls = 0
	_web_commands.commandCallback(["set_time_scale", [1, 2, 3]])
	_check(probe_calls == 0, "handler is not called when the float argument cannot be converted")
	_check(Engine.time_scale == 1.0, "time scale is unchanged after a failed conversion")

	# A non-numeric string cannot be converted to float
	probe_calls = 0
	_web_commands.commandCallback(["probe_float", "not-a-number"])
	_check(probe_calls == 0, "float probe handler is not called for a non-numeric string")

	var message = _capture_validation_error(["probe_float", "not-a-number"])
	_check(message.contains("probe_float"), "type error names the command")
	_check(message.contains("float"), "type error mentions the declared type")
	_check(message.contains("not-a-number"), "type error shows the received argument")

	# A null value cannot be converted to float
	probe_calls = 0
	_web_commands.commandCallback(["probe_float", null])
	_check(probe_calls == 0, "float probe handler is not called for a null argument")

	# Complex objects cannot be converted to String
	probe_calls = 0
	_web_commands.commandCallback(["probe_string", ["nested"]])
	_check(probe_calls == 0, "string probe handler is not called for an array argument")


func _test_too_many_arguments() -> void:
	print("-- too many arguments")

	# Command with one declared parameter receives two
	probe_calls = 0
	_web_commands.commandCallback(["probe_float", 1.0, 2.0])
	_check(probe_calls == 0, "handler is not called when extra arguments are passed")

	# Command without declared parameters receives an extra argument
	probe_calls = 0
	_web_commands.commandCallback(["probe_no_params", "unexpected"])
	_check(probe_calls == 0, "parameterless handler is not called when an extra argument is passed")

	var message = _capture_validation_error(["probe_no_params", "unexpected"])
	_check(message.contains("probe_no_params"), "extra-argument error names the command")
	_check(message.contains("expected 0"), "extra-argument error states the expected count")
	_check(message.contains("unexpected"), "extra-argument error shows the received argument")


func _test_duplicate_registration() -> void:
	print("-- duplicate registration")

	_web_commands.register_command(
		"probe_duplicate", "Tests", _probe_old, "old implementation")
	_web_commands.register_command(
		"probe_duplicate", "Tests", _probe_new, "new implementation")

	# Every command appears exactly once in the sorted structure
	var occurrences = 0
	for command_name in _web_commands._sorted_commands["Tests"]:
		if command_name == "probe_duplicate":
			occurrences += 1
	_check(occurrences == 1, "duplicate command appears once in the sorted structure")

	# help() must not list the command twice and shows the new definition
	var help_text = _web_commands.get_help_text()
	var first_index = help_text.find("probe_duplicate")
	_check(first_index != -1, "duplicate command is listed in help")
	_check(help_text.find("probe_duplicate", first_index + 1) == -1,
		"help lists the duplicate command only once")
	_check(help_text.contains("new implementation"), "help shows the new description")
	_check(not help_text.contains("old implementation"), "help no longer shows the old description")

	# A call must reach the new implementation, not the old one
	probe_calls = 0
	_web_commands.commandCallback(["probe_duplicate"])
	_check(probe_calls == 1, "call after re-registration reaches the new implementation")

	# Re-registering into a different category still leaves a single entry
	_web_commands.register_command(
		"probe_duplicate", "OtherTests", _probe_new, "moved implementation")
	var total_occurrences = 0
	for category in _web_commands._sorted_commands:
		total_occurrences += _web_commands._sorted_commands[category].count("probe_duplicate")
	_check(total_occurrences == 1, "command moved between categories remains listed once")
	_check(not _web_commands._sorted_commands.has("Tests")
		or not _web_commands._sorted_commands["Tests"].has("probe_duplicate"),
		"old category no longer holds the moved command")
	_check(_web_commands._sorted_commands["OtherTests"].has("probe_duplicate"),
		"new category holds the moved command")


# --- Helpers -----------------------------------------------------------------

func _check(condition: bool, description: String) -> void:
	_checks_run += 1
	if condition:
		print("  [ok] " + description)
	else:
		_failures.append(description)
		print("  [FAIL] " + description)


# Invokes the validation helper the same way commandCallback does and returns
# the error text that would be pushed, without depending on console capture.
func _capture_validation_error(callback_args: Array) -> String:
	var command_name = str(callback_args[0]).to_lower()
	var command_args = callback_args.slice(1)
	var command = _web_commands._commands.get(command_name)
	if command == null:
		_failures.append("command is registered: " + command_name)
		print("  [FAIL] command is registered: " + command_name)
		return ""
	var result = _web_commands._validate_arguments(command_name, command.params, command_args)
	_check(not result["ok"], "validation rejects the call: " + command_name)
	return result["message"]
