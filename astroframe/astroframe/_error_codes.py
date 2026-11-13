"""ErrorEvent / ErrorMessage / AnnotationKey SSOT — astroframe 所有 logfmt event 标识符和错误消息模板。

PostgreSQL errcodes.txt 风格三层架构之定义层。
所有 LogfmtLogger event 名和静态 raise 消息的单一真实来源。

用法:
    from astroframe._error_codes import ErrorEvent, ErrorMessage, AnnotationKey
    log.warning(ErrorEvent.PLUGIN_SCANNER_READ_ERROR, path=..., error=...)
    raise PluginError(ErrorMessage.PLUGIN_MANIFEST_INVALID.message)
"""

from __future__ import annotations

from enum import Enum


class ErrorEvent(Enum):
    """LogfmtLogger event 标识符的 SSOT。直接传递成员，.code 由 logger 内部调用。"""

    @property
    def code(self) -> str:
        return str(self.value)

    # ── Capability ──
    CAPABILITY_DEPRECATED = "capability_deprecated"
    CAPABILITY_DEPRECATED_HARD = "capability_deprecated_hard"
    CAPABILITY_DEPRECATED_HARD_OPTED_IN = "capability_deprecated_hard_opted_in"
    CAPABILITY_REMOVED = "capability_removed"

    # ── Plugin discovery / loading ──
    PLUGIN_DEPENDENCY_CYCLE = "plugin_dependency_cycle"
    PLUGIN_DEPENDENCY_NOT_LOADED = "plugin_dependency_not_loaded"
    PLUGIN_DEPENDENCY_VERSION_MISMATCH = "plugin_dependency_version_mismatch"
    PLUGIN_DISCOVERY_DISABLED = "plugin_discovery_disabled"
    PLUGIN_DISTRIBUTION_NOT_FOUND = "plugin_distribution_not_found"
    PLUGIN_ENGINE_INCOMPATIBLE = "plugin_engine_incompatible"
    PLUGIN_ENTRY_POINTS_SCAN_FAILED = "plugin_entry_points_scan_failed"

    # ── Plugin global lifecycle ──
    PLUGIN_GLOBAL_BLOCKED_BY_SCANNER = "plugin_global_blocked_by_scanner"
    PLUGIN_GLOBAL_IMPORT_FAILED = "plugin_global_import_failed"
    PLUGIN_GLOBAL_ON_LOAD_FAILED = "plugin_global_on_load_failed"
    PLUGIN_GLOBAL_SCAN_FAILED = "plugin_global_scan_failed"

    # ── Plugin hash / signature ──
    PLUGIN_HASH_DISTRIBUTION_NOT_FOUND = "plugin_hash_distribution_not_found"
    PLUGIN_HASH_EDITABLE_INSTALL = "plugin_hash_editable_install"
    PLUGIN_HASH_EMPTY_FILE_LIST = "plugin_hash_empty_file_list"
    PLUGIN_HASH_FILE_UNREADABLE = "plugin_hash_file_unreadable"
    PLUGIN_HASH_NOT_DIRECTORY = "plugin_hash_not_directory"
    PLUGIN_HASH_SYMLINK_SKIPPED = "plugin_hash_symlink_skipped"
    PLUGIN_HASH_TOO_MANY_FILES = "plugin_hash_too_many_files"
    PLUGIN_HASH_WALK_ERROR = "plugin_hash_walk_error"

    # ── Plugin manifest / validation ──
    PLUGIN_IMPLEMENTS_INVALID = "plugin_implements_invalid"
    PLUGIN_MANIFEST_NOT_FOUND = "plugin_manifest_not_found"
    PLUGIN_MANIFEST_VERSION_FUTURE = "plugin_manifest_version_future"

    # ── Plugin registry ──
    PLUGIN_CHAIN_CYCLE = "plugin_chain_cycle"
    PLUGIN_REGISTRY_ACLOSE_FAILED = "plugin_registry_aclose_failed"
    PLUGIN_REGISTRY_REGISTERED = "plugin_registry_registered"
    PLUGIN_REGISTRY_SKIP = "plugin_registry_skip"
    PLUGIN_REGISTRY_UNREGISTERED = "plugin_registry_unregistered"

    # ── Plugin sandbox (S6-S20 security) ──
    PLUGIN_S6_DEPRECATED_SINCE_INVALID = "plugin_s6_deprecated_since_invalid"
    PLUGIN_S6_FIELD_TRUNCATED = "plugin_s6_field_truncated"
    PLUGIN_S6_REJECTED = "plugin_s6_rejected"
    PLUGIN_S6_TR36_STRIP = "plugin_s6_tr36_strip"
    PLUGIN_S7_IDENTITY_MISMATCH = "plugin_s7_identity_mismatch"
    PLUGIN_S20_REJECTED = "plugin_s20_rejected"

    # ── Sandbox runtime ──
    PLUGIN_SANDBOX_APPLY_FAILED = "plugin_sandbox_apply_failed"
    PLUGIN_SANDBOX_LANDLOCK_PATH_OPEN_FAILED = "plugin_sandbox_landlock_path_open_failed"
    PLUGIN_SANDBOX_LANDLOCK_RULE_FAILED = "plugin_sandbox_landlock_rule_failed"
    PLUGIN_SANDBOX_LAYER_ACTIVE = "plugin_sandbox_layer_active"
    PLUGIN_SANDBOX_LAYER_FAILED = "plugin_sandbox_layer_failed"
    PLUGIN_SANDBOX_RLIMIT_FAILED = "plugin_sandbox_rlimit_failed"
    PLUGIN_SANDBOX_SETUP_FAILED = "plugin_sandbox_setup_failed"
    PLUGIN_SANDBOX_TEARDOWN_FAILED = "plugin_sandbox_teardown_failed"

    # ── Audit ──
    PLUGIN_AUDIT_BLOCKED = "plugin_audit_blocked"
    PLUGIN_AUDIT_EVENT = "plugin_audit_event"
    PLUGIN_AUDIT_IMPORT = "plugin_audit_import"
    PLUGIN_DATA_EGRESS = "plugin_data_egress"
    PLUGIN_GLOBAL_UNDECLARED_PERMISSION = "plugin_global_undeclared_permission"
    PLUGIN_PERMISSION_DENIED = "plugin_permission_denied"
    PLUGIN_PERMISSION_GRANT = "plugin_permission_grant"
    PLUGIN_SANDBOX_CRASH = "plugin_sandbox_crash"
    PLUGIN_SUBPROCESS_STDERR = "plugin_subprocess_stderr"
    PLUGIN_TRUST_PENDING = "plugin_trust_pending"

    # ── Scanner ──
    PLUGIN_SCANNER_PKG_NOT_FOUND = "plugin_scanner_pkg_not_found"
    PLUGIN_SCANNER_READ_ERROR = "plugin_scanner_read_error"
    PLUGIN_SCANNER_SCANDIR_ERROR = "plugin_scanner_scandir_error"

    # ── Signature verification ──
    PLUGIN_SIG_HASH_CHANGED = "plugin_sig_hash_changed"
    PLUGIN_SIG_HASH_MATCH = "plugin_sig_hash_match"
    PLUGIN_SIG_HASH_UNAVAILABLE = "plugin_sig_hash_unavailable"
    PLUGIN_SIG_TOCTOU_DETECTED = "plugin_sig_toctou_detected"
    PLUGIN_SIG_UNEXPECTED_ERROR = "plugin_sig_unexpected_error"
    PLUGIN_SIG_VERIFIER_ENTRY_POINT_FAILED = "plugin_sig_verifier_entry_point_failed"
    PLUGIN_SIG_VERIFIER_NO_VERIFY_METHOD = "plugin_sig_verifier_no_verify_method"
    PLUGIN_SIG_VERIFIER_SCAN_FAILED = "plugin_sig_verifier_scan_failed"
    PLUGIN_SIGNATURE_INFRA_ERROR = "plugin_signature_infra_error"
    PLUGIN_SIGNATURE_REQUIRED = "plugin_signature_required"
    PLUGIN_SIGNATURE_REVERIFY_ERROR = "plugin_signature_reverify_error"
    PLUGIN_SIGNATURE_REVERIFY_FAILED = "plugin_signature_reverify_failed"
    PLUGIN_SIGNATURE_REVERIFY_PASSED = "plugin_signature_reverify_passed"
    PLUGIN_SIGNATURE_UNVERIFIED = "plugin_signature_unverified"
    PLUGIN_SIGNING_UNSIGNED_EXTRA_KEY = "plugin_signing_unsigned_extra_key"
    PLUGIN_SIGSTORE_REKOR_CHECK_ERROR = "plugin_sigstore_rekor_check_error"
    PLUGIN_SIGSTORE_UNKNOWN_API = "plugin_sigstore_unknown_api"
    PLUGIN_SIGSTORE_VERIFY_ERROR = "plugin_sigstore_verify_error"

    # ── State persistence ──
    PLUGIN_STATE_BAK_RECOVERED = "plugin_state_bak_recovered"
    PLUGIN_STATE_BAK_WRITE_FAILED = "plugin_state_bak_write_failed"
    PLUGIN_STATE_BAK_WRITEBACK_FAILED = "plugin_state_bak_writeback_failed"
    PLUGIN_STATE_CORRUPT = "plugin_state_corrupt"
    PLUGIN_STATE_DEFAULT_FALLBACK = "plugin_state_default_fallback"
    PLUGIN_STATE_DEFAULT_WRITE_FAILED = "plugin_state_default_write_failed"
    PLUGIN_STATE_OVERSIZE = "plugin_state_oversize"
    PLUGIN_STATE_PRIMARY_CORRUPT = "plugin_state_primary_corrupt"
    PLUGIN_STATE_RESTORE_FAILED = "plugin_state_restore_failed"
    PLUGIN_STATE_SAVE = "plugin_state_save"

    # ── Trust / version ──
    PLUGIN_TRUST_HASH_CHANGED_REVERIFY = "plugin_trust_hash_changed_reverify"
    PLUGIN_TRUST_VERSION_CHANGED = "plugin_trust_version_changed"
    PLUGIN_TRUST_VERSION_CHANGED_HASH_UNCHANGED = "plugin_trust_version_changed_hash_unchanged"
    PLUGIN_TRUST_VERSION_CHANGED_NO_HASH = "plugin_trust_version_changed_no_hash"

    # ── Zombie cleanup ──
    PLUGIN_ZOMBIE_CLEANUP_SKIPPED = "plugin_zombie_cleanup_skipped"
    PLUGIN_ZOMBIE_CONFIGS_CLEAN_FAILED = "plugin_zombie_configs_clean_failed"
    PLUGIN_ZOMBIE_CONFIGS_CLEANED = "plugin_zombie_configs_cleaned"
    PLUGIN_ZOMBIE_DISABLED_CLEAN_FAILED = "plugin_zombie_disabled_clean_failed"
    PLUGIN_ZOMBIE_DISABLED_CLEANED = "plugin_zombie_disabled_cleaned"
    PLUGIN_ZOMBIE_TRUSTED_CLEAN_FAILED = "plugin_zombie_trusted_clean_failed"
    PLUGIN_ZOMBIE_TRUSTED_CLEANED = "plugin_zombie_trusted_cleaned"


class ErrorMessage(Enum):
    """静态错误消息模板的 SSOT。使用 .message 获取字符串值。"""

    @property
    def message(self) -> str:
        return str(self.value)

    # ── Subprocess ──
    SUBPROCESS_NOT_STARTED = "subprocess not started"
    HANDSHAKE_TIMEOUT = "handshake timeout"
    SUBPROCESS_EXITED_DURING_HANDSHAKE = "subprocess exited during handshake"
    SETUP_TIMEOUT = "setup timeout"
    SUBPROCESS_EXITED_DURING_SETUP = "subprocess exited during setup"
    SUBPROCESS_NOT_RUNNING = "subprocess not running"
    PROCESS_TIMEOUT = "process timeout"
    SUBPROCESS_EXITED_UNEXPECTEDLY = "subprocess exited unexpectedly"

    # ── Manifest / signing validation ──
    SIGNING_MUST_BE_OBJECT_OR_NULL = "signing 必须是对象或 null"
    SIGNING_METHOD_REQUIRED = "signing.method 为必填字段"
    SIGSTORE_IDENTITY_REQUIRED = "signing.method='sigstore' 需要 'identity' 字段（OIDC Subject URI）"
    GPG_KEY_FINGERPRINT_REQUIRED = "signing.method='gpg' 需要 'key_fingerprint' 字段（40 字符 hex）"

    # ── Signature infrastructure ──
    SIGSTORE_NOT_INSTALLED = (
        "sigstore-python 未安装。签名验证需要 sigstore 支持。"
        "安装: pip install astroframe[sigstore]  或  pip install sigstore"
    )
    SIGSTORE_REKOR_UNREACHABLE = (
        "sigstore: 无法连接 Rekor 透明日志服务器——网络不可达。"
        "请检查网络连接后重试，或使用 GPG 签名（method: gpg）进行离线验证。"
    )
    GPG_CLI_NOT_FOUND = (
        "gpg CLI 未在 PATH 中找到。"
        "Debian/Ubuntu: apt install gnupg  |  macOS: brew install gnupg  |  "
        "Windows: winget install GnuPG.GnuPG"
    )
    GPG_VERIFICATION_TIMEOUT = "gpg verification timed out after 30s"


class AnnotationKey(Enum):
    """管道注解键的 SSOT。使用 .value 获取字符串值。

    astroframe 本身不涉及 pipeline 概念，此枚举为空占位——供未来扩展。
    """
