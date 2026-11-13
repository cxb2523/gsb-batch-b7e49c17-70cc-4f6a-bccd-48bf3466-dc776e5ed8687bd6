"""ErrorEvent / ErrorMessage SSOT — astrocrawl 所有 logfmt event 标识符和错误消息模板。

PostgreSQL errcodes.txt 风格三层架构之定义层。
所有 LogfmtLogger event 名和静态 raise 消息的单一真实来源。

用法:
    from astrocrawl._error_codes import ErrorEvent, ErrorMessage
    log.warning(ErrorEvent.WORKER_CRASH, url=..., error=...)
    raise StartupError(ErrorMessage.GUI_MODE_REQUIRES_PYSIDE6.message)
"""

from __future__ import annotations

from enum import Enum


class ErrorEvent(Enum):
    """LogfmtLogger event 标识符 SSOT。直接传递成员，.code 由 logger 内部调用。

    新增 event:
    1. 在此枚举中添加成员
    2. 在代码中使用 ErrorEvent.NEW_MEMBER
    3. mypy 强制此模式——裸字符串 event 名被编译期拒绝
    """

    @property
    def code(self) -> str:
        return str(self.value)

    # ── Crawl lifecycle ──
    CRAWL_START = "crawl_start"
    CRAWL_STOP = "crawl_stop"
    CRAWL_PAUSE = "crawl_pause"
    CRAWL_RESUME = "crawl_resume"
    CRAWL_DONE = "crawl_done"
    CRAWL_ERROR = "crawl_error"

    # ── Worker ──
    WORKER_CRASH = "worker_crash"
    WORKER_DEATH = "worker_death"
    WORKER_STUCK = "worker_stuck"
    CRAWLER_WATCHDOG_TIMEOUT = "crawler_watchdog_timeout"
    PROCESSOR_ERROR = "processor_error"

    # ── Queue / retry / storage ──
    URL_PERMANENT_FAIL = "url_permanent_fail"
    URL_COMPLETE = "url_complete"
    URL_REQUEUE = "url_requeue"
    RETRY_EXHAUSTED = "retry_exhausted"
    RETRY_QUEUE_FULL = "retry_queue_full"
    IN_FLIGHT_PURGE = "in_flight_purge"
    CRASH_RECOVERY_REQUEUE = "crash_recovery_requeue"
    CRASH_RECOVERY_SKIP = "crash_recovery_skip"
    ORPHAN_PURGE = "orphan_purge"
    DB_ERROR = "db_error"
    DB_CLOSE_ERROR = "db_close_error"
    DB_BACKFILL_DOMAIN = "db_backfill_domain"
    BOUNDARY_LINKS_PROMOTED = "boundary_links_promoted"
    BOUNDARY_LINKS_SAVED = "boundary_links_saved"
    DEPTH_PURGE_FAILURES = "depth_purge_failures"
    DEPTH_PURGE_QUEUE = "depth_purge_queue"

    # ── Browser pool / slot / page ──
    BROWSERPOOL_START = "browserpool_start"
    BROWSERPOOL_DRAIN = "browserpool_drain"
    BROWSER_RESTART = "browser_restart"
    BROWSER_RESTART_DONE = "browser_restart_done"
    BROWSER_RESTART_FAILED = "browser_restart_failed"
    BROWSER_RETRY_RESTART = "browser_retry_restart"
    BROWSER_UNHEALTHY_RESTART = "browser_unhealthy_restart"
    PAGE_CREATE_EXHAUSTED = "page_create_exhausted"
    PAGE_CREATE_FAILED = "page_create_failed"
    SLOT_PARALLEL_CREATE_FAILED = "slot_parallel_create_failed"
    SLOT_CREATE_FAILED = "slot_create_failed"
    SLOT_CREATE_EXHAUSTED = "slot_create_exhausted"
    SCOPED_PATH_RESTORE_FAILED = "scoped_path_restore_failed"
    INJECT_SCRIPT_LOAD_FAILED = "inject_script_load_failed"
    PAGE_CLOSE_TIMEOUT = "page_close_timeout"
    PAGE_CLOSE_ERROR = "page_close_error"
    CONTEXT_CLOSE_TIMEOUT = "context_close_timeout"
    CONTEXT_CLOSE_ERROR = "context_close_error"
    CONTEXT_CREATE_FAILED = "context_create_failed"
    OLD_PAGE_POOL_CLOSE_ERROR = "old_page_pool_close_error"
    OLD_CONTEXT_CLOSE_ERROR = "old_context_close_error"
    PAGE_POOL_CLOSE_ERROR = "page_pool_close_error"
    COOKIE_FILE_INVALID = "cookie_file_invalid"
    COOKIE_ENTRIES_DROPPED = "cookie_entries_dropped"
    COOKIE_LOAD_FAILED = "cookie_load_failed"

    # ── Preview browser ──
    PREVIEW_BROWSER_READY = "preview_browser_ready"
    PREVIEW_BROWSER_STOPPED = "preview_browser_stopped"
    PREVIEW_BROWSER_CRASHED = "preview_browser_crashed"
    PREVIEW_PAGE_OPENED = "preview_page_opened"
    PREVIEW_PAGE_CLOSED = "preview_page_closed"
    PREVIEW_PAGE_CLOSED_BROWSER = "preview_page_closed_browser"
    PREVIEW_PAGE_OPEN_FAILED = "preview_page_open_failed"
    PREVIEW_OPEN_FAILED = "preview_open_failed"
    PREVIEW_ERROR = "preview_error"
    PREVIEW_PANEL_CREATE = "preview_panel_create"
    PREVIEW_PANEL_CLOSE = "preview_panel_close"
    PREVIEW_PANEL_REUSE = "preview_panel_reuse"
    PREVIEW_PANEL_REPLACE_ORPHAN = "preview_panel_replace_orphan"
    PREVIEW_SESSION_DISPOSED = "preview_session_disposed"

    # ── Rules: lifecycle / loader ──
    RULES_LOADED = "rules_loaded"
    RULES_RELOADED = "rules_reloaded"
    RULES_RELOADED_AFTER_SOURCE_UPDATE = "rules_reloaded_after_source_update"
    RULE_LOAD_FAILED = "rule_load_failed"
    RULE_RELOAD_FAILED = "rule_reload_failed"
    RULE_LOAD_ERROR = "rule_load_error"
    RULE_LOAD_INVALID = "rule_load_invalid"
    RULE_LOAD_DIR_FAILED = "rule_load_dir_failed"
    RULE_CONFLICT = "rule_conflict"
    RULE_DIR_PERMISSION_DENIED = "rule_dir_permission_denied"
    RULE_DIR_UNREADABLE = "rule_dir_unreadable"
    RULE_FILE_TOO_LARGE = "rule_file_too_large"
    RULE_JSON_DEPTH_EXCEEDED = "rule_json_depth_exceeded"
    RULE_LIMIT_EXCEEDED = "rule_limit_exceeded"
    GENERIC_RULE_LIMIT_EXCEEDED = "generic_rule_limit_exceeded"
    RULES_DIR_NOT_DIRECTORY = "rules_dir_not_directory"
    RULES_DIR_NOT_FOUND = "rules_dir_not_found"
    RULES_CACHE_SIZE_EXCEEDED = "rules_cache_size_exceeded"
    RULE_EXPORT_ERROR = "rule_export_error"
    TMP_CLEANUP = "tmp_cleanup"
    TMP_CLEANUP_DONE = "tmp_cleanup_done"

    # ── Rules: schema / match ──
    RULE_SCOPE_INFERRED = "rule_scope_inferred"
    RULE_TAG_INVALID_TYPE = "rule_tag_invalid_type"
    URL_PATTERN_MATCH_ERROR = "url_pattern_match_error"
    MATCH_NO_HOSTNAME = "match_no_hostname"
    TEST_URL_NO_NETLOC = "test_url_no_netloc"
    TEST_URL_NOT_HTTPS = "test_url_not_https"
    UNKNOWN_TRANSFORM_TYPE = "unknown_transform_type"

    # ── Rules: extraction / transform ──
    EXTRACT_HTML_VOID = "extract_html_void"
    EXTRACTION_POOL_PRESSURE = "extraction_pool_pressure"
    FIELD_EXTRACT_ERROR = "field_extract_error"
    FIELD_TEXT_TRUNCATED = "field_text_truncated"
    RULE_EXTRACT_TIMEOUT = "rule_extract_timeout"
    RULE_ALL_FIELDS_NULL = "rule_all_fields_null"
    RULE_SLOW = "rule_slow"
    SELECTOR_ERROR = "selector_error"
    UNSUPPORTED_CSS_PSEUDO = "unsupported_css_pseudo"
    TRANSFORM_JOIN_TRUNCATED = "transform_join_truncated"
    TRANSFORM_REGEX_ERROR = "transform_regex_error"
    TRANSFORM_REPLACE_AMPLIFIED = "transform_replace_amplified"
    TRANSFORM_REPLACE_OVERSIZE = "transform_replace_oversize"

    # ── Rules: HTML preprocess ──
    HTML_PREPROCESS_LXML_UNAVAILABLE = "html_preprocess_lxml_unavailable"
    HTML_PREPROCESS_PARSE_ERROR = "html_preprocess_parse_error"
    HTML_PREPROCESS_SERIALIZE_ERROR = "html_preprocess_serialize_error"
    HTML_PREPROCESS_TOO_LARGE = "html_preprocess_too_large"

    # ── Rules: source management ──
    SOURCE_ADDED = "source_added"
    SOURCE_MOVED = "source_moved"
    SOURCE_REMOVED = "source_removed"
    SOURCE_RECOVERED = "source_recovered"
    SOURCE_DEGRADED = "source_degraded"
    SOURCE_EMERGENCY_DISABLE = "source_emergency_disable"
    SOURCE_PROBING = "source_probing"
    SOURCE_ADD_FAILED = "source_add_failed"
    SOURCE_LOAD_FAILED = "source_load_failed"
    SOURCE_UPDATE_ERROR = "source_update_error"
    SOURCE_UPDATE_SKIP = "source_update_skip"
    SOURCE_UPDATE_BACKGROUND_ERROR = "source_update_background_error"
    SOURCE_CACHE_CLEANUP_FAILED = "source_cache_cleanup_failed"
    SOURCES_FILE_CORRUPT = "sources_file_corrupt"
    SOURCES_LOCK_ACQUIRE_FAILED = "sources_lock_acquire_failed"
    DNS_CHECK_FAILED = "dns_check_failed"
    MANIFEST_FETCH_FAILED = "manifest_fetch_failed"
    MANIFEST_SCHEMA_VERSION_SKIP = "manifest_schema_version_skip"
    RULE_DOWNLOADED = "rule_downloaded"
    RULE_DOWNLOAD_FAILED = "rule_download_failed"

    # ── Rules: state / template ──
    STATE_DEFAULT_PROTECTED = "state_default_protected"
    STATE_FILE_CORRUPT = "state_file_corrupt"
    STATE_FILE_OVERSIZED = "state_file_oversized"
    LOCK_ACQUIRE_FAILED = "lock_acquire_failed"
    TEMPLATE_LOAD_FAILED = "template_load_failed"

    # ── AI ──
    # gen_ai — OTel GenAI 语义约定 (ai/_observability.py)
    GEN_AI_CHAT_REQUEST = "gen_ai.chat.request"
    GEN_AI_CHAT_RESPONSE = "gen_ai.chat.response"
    GEN_AI_CHAT_ERROR = "gen_ai.chat.error"
    GEN_AI_CHAT_RETRY_EXHAUSTED = "gen_ai.chat.retry_exhausted"
    GEN_AI_EMBED_REQUEST = "gen_ai.embed.request"
    GEN_AI_EMBED_RESPONSE = "gen_ai.embed.response"
    GEN_AI_EMBED_ERROR = "gen_ai.embed.error"
    GEN_AI_EMBED_RETRY_EXHAUSTED = "gen_ai.embed.retry_exhausted"
    AI_RESPONSE_PARSE_FAILED = "ai_response_parse_failed"
    AI_GENERATE_EMPTY_SELECTORS = "ai_generate_empty_selectors"
    JSON_SCHEMA_DENIED = "json_schema_denied"
    OUTPUT_FORMAT_DEGRADED = "output_format_degraded"
    OUTPUT_FORMAT_DISABLED = "output_format_disabled"
    VALIDATION_PARSE_ERROR = "validation_parse_error"

    # ── Network: robots / sitemap / throttle ──
    ROBOTS_FETCH_FAILED = "robots_fetch_failed"
    ROBOTS_TXT_OVERSIZE = "robots_txt_oversize"
    SITEMAP_START = "sitemap_start"
    SITEMAP_DONE = "sitemap_done"
    SITEMAP_DONE_EMPTY = "sitemap_done_empty"
    SITEMAP_PARSE_ERROR = "sitemap_parse_error"
    SITEMAP_PARSE_FAILED = "sitemap_parse_failed"
    SITEMAP_ORIGIN_DONE = "sitemap_origin_done"
    SITEMAP_PER_ORIGIN_STATS_FAILED = "sitemap_per_origin_stats_failed"
    SITEMAP_ROBOTS_CACHE_MISSING = "sitemap_robots_cache_missing"
    SITEMAP_ROBOTS_ERROR = "sitemap_robots_error"
    SITEMAP_TASK_ERROR = "sitemap_task_error"
    DOMAIN_TRACKER_OVERFLOW = "domain_tracker_overflow"
    CRAWL_DELAY_OUT_OF_BOUNDS = "crawl_delay_out_of_bounds"

    # ── Proxy ──
    PROXY_DEAD = "proxy_dead"
    PROXY_CIRCUIT_OPEN = "proxy.circuit_open"
    PROXY_CIRCUIT_RECOVER = "proxy.circuit_recover"

    # ── Health / diagnostics ──
    HEALTH_ENDPOINT_START = "health_endpoint_start"
    HEALTH_ALERT = "health_alert"
    HEALTH_REPAIR = "health_repair"
    HEALTH_REPAIR_FAILED = "health_repair_failed"
    FATAL_DIAGNOSTICS_DUMP = "fatal_diagnostics_dump"
    SIGUSR1_INSTALLED = "sigusr1_installed"
    SIGUSR1_UNAVAILABLE = "sigusr1_unavailable"
    HTTP_HANDLER_ERROR = "http_handler_error"
    DIAG_PORT_UNAVAILABLE = "diag_port_unavailable"
    RESOURCE_SNAPSHOT = "resource_snapshot"

    # ── GUI / i18n ──
    APP_TRANSLATOR_LOADED = "app_translator_loaded"
    APP_TRANSLATOR_MISSING = "app_translator_missing"
    QT_TRANSLATOR_MISSING = "qt_translator_missing"
    GUI_TS_MISSING = "gui_ts_missing"
    GUI_TS_PARSE_FAILED = "gui_ts_parse_failed"

    # ── Config / preferences ──
    CONFIG_WARN = "config_warn"
    PREFERENCES_CORRUPT = "preferences_corrupt"
    PREFERENCES_MIGRATED = "preferences_migrated"
    PREFERENCES_OVERSIZE = "preferences_oversize"
    OLD_PATH_MEMORY_CORRUPT = "old_path_memory_corrupt"
    HASH_COMPAT = "hash_compat"

    # ── Resilience ──
    FUSE_OPEN = "fuse_open"
    FUSE_CALLBACK_ERROR = "fuse_callback_error"

    # ── Reporting / webhook ──
    REPORT_ERROR = "report_error"
    REPORT_SAVED = "report_saved"
    WEBHOOK_ERROR = "webhook_error"
    WEBHOOK_SENT = "webhook_sent"

    # ── Misc ──
    CLEANUP_TIMEOUT = "cleanup_timeout"
    TIMEOUT_BUDGET = "timeout_budget"
    TOKEN_COUNT_ERROR = "token_count_error"
    TIKTOKEN_UNAVAILABLE = "tiktoken_unavailable"


class ErrorMessage(Enum):
    """静态错误消息模板 SSOT。使用 .message 获取字符串值。

    仅包含纯字符串字面量——f-string 和动态消息不在此注册。
    新增消息:
    1. 在此枚举中添加成员
    2. 在 raise 语句中使用 ErrorMessage.MEMBER.message
    3. pre-commit Rule B 强制此模式
    """

    @property
    def message(self) -> str:
        return str(self.value)

    AI_HTML_CANNOT_BE_EMPTY = "HTML 不能为空"
    AI_JSON_SCHEMA_REQUIRES_SCHEMA_MODEL = "format='json_schema' 要求提供 schema_model"
    AI_SCHEMA_MODEL_MUST_BE_BASEMODEL = "schema_model 必须是 Pydantic BaseModel 子类"
    ANTHROPIC_SDK_NOT_INSTALLED = "Anthropic SDK not installed. Run: pip install anthropic"
    BROWSER_LAUNCH_FAILED = "Browser launch failed"
    BROWSER_LAUNCH_TIMEOUT = "Browser launch timeout (15s)"
    CANNOT_CREATE_ANY_BROWSER_CONTEXT = "无法创建任何浏览器上下文，爬虫终止"
    CONCURRENCY_POSITIVE = "并发数必须 > 0"
    CONFIG_YAML_REQUIRES_PYYAML = "需要 PyYAML 来加载 .yaml 配置文件: pip install pyyaml"
    CONTENT_HASH_SAMPLE_SIZE_MIN = "content_hash_sample_size 至少为 3"
    COOKIE_FILE_MUST_BE_JSON_ARRAY = "Cookie 文件应为 JSON 数组"
    DOMAIN_MAX_CONCURRENCY_POSITIVE = "域名最大并发必须 > 0"
    DOMAIN_MIN_DELAY_LTE_MAX = "domain_min_delay 不能大于 domain_max_delay"
    EVENT_LOOP_NOT_RUNNING = "event loop is not running"
    GOOGLE_GENAI_SDK_NOT_INSTALLED = "Google GenAI SDK not installed. Run: pip install google-genai"
    GOOGLE_RE2_NOT_INSTALLED = "google-re2 未正确安装。请执行: pip install google-re2\\n若编译安装失败，请确保已安装 build-essential 和 libre2-dev (Linux) 或 cmake (macOS/Windows)。"
    GUI_MODE_REQUIRES_PYSIDE6 = "GUI 模式需要 PySide6。请执行: pip install astrocrawl[gui]"
    LIMIT_NON_NEGATIVE = "限制值必须 >= 0"
    MAX_REQUEUE_NON_NEGATIVE = "max_requeue 必须 >= 0"
    MAX_RETRIES_MIN = "max_retries 必须 >= 1"
    MAX_TEXT_LENGTH_MIN = "max_text_length 必须 >= 100"
    NETWORK_IDLE_TIMEOUT_MIN = "network_idle_timeout 必须 >= 500ms"
    OUTPUT_BUFFER_SIZE_MIN = "output_buffer_size 必须 >= 4096"
    OUTPUT_FLUSH_INTERVAL_MIN = "output_flush_interval 必须 >= 1.0"
    PAGE_POOL_CLOSED = "PagePool 已关闭"
    PAGE_POOL_SIZE_POSITIVE = "页面池大小必须 > 0"
    PAGE_TIMEOUT_MIN = "page_timeout 必须 >= 1000ms"
    PLAYWRIGHT_CHROMIUM_NOT_INSTALLED = "Playwright Chromium 浏览器未安装，请运行: playwright install chromium"
    PLAYWRIGHT_PYTHON_NOT_INSTALLED = (
        "Playwright Python 包未正确安装，请运行: pip install playwright && playwright install chromium"
    )
    PREFERENCES_ROOT_MUST_BE_JSON_OBJECT = "root must be a JSON object"
    PREVIEW_BROWSER_NOT_READY = "PreviewBrowser 未就绪"
    PREVIEW_BROWSER_NOT_READY_EN = "browser is not ready"
    QUEUE_HARD_MAXSIZE_MIN = "queue_hard_maxsize 必须 >= 10"
    RATE_LIMIT_REACHED_DENIED = "速率限制已达到，请求被拒绝"
    RATE_LIMIT_REACHED_DENIED_CN = "并发限制已达到，请求被拒绝"
    RETRY_BACKOFF_BASE_POSITIVE = "retry_backoff_base 必须 > 0"
    ROBOTS_CACHE_TTL_NON_NEGATIVE = "robots_cache_ttl 必须 >= 0"
    RULES_FILE_MUST_BE_JSON_OBJECT = "规则文件必须是 JSON 对象"
    RULES_FILE_NO_VALID_DEFINITIONS = "文件不含有效的规则定义（缺少 name 字段）"
    RULES_MAX_GENERIC_NON_NEGATIVE = "rules_max_generic 必须 >= 0"
    RULE_ENABLED_MUST_BE_BOOLEAN = "enabled 必须是 boolean"
    RULE_ENTRY_MISSING_REQUIRED_FIELD = "rule_entry 缺少 download_url 或 name"
    RULE_FIELDS_MUST_BE_OBJECT = "fields 必须是对象"
    RULE_FIELD_NAME_REQUIRED = "字段名不能为空"
    RULE_MATCH_MUST_BE_OBJECT = "match 必须是对象"
    RULE_MUST_BE_JSON_OBJECT = "规则必须是 JSON 对象"
    RULE_NAME_REQUIRED = "name 不能为空"
    RULE_OPTIONS_MUST_BE_OBJECT = "options 必须是对象"
    SCOPED_PATH_NO_AVAILABLE_PROXY = "scoped_path: 无可用代理"
    SCOPED_PATH_NO_PROXY_SESSION = "scoped_path: ProxySession 未配置，无法切换到代理路径"
    SCOPE_ANY_REQUIRES_NO_DOMAINS = "any scope 要求 domains 为空"
    SCOPE_DOMAIN_ALL_REQUIRES_DOMAINS = "domain_all scope 要求 domains 非空"
    SCOPE_DOMAIN_PATTERN_REQUIRES_DOMAINS = "domain_pattern scope 要求 domains 非空"
    SCOPE_DOMAIN_PATTERN_REQUIRES_URL_PATTERN = "domain_pattern scope 要求 url_pattern 非空"
    SCOPE_GLOBAL_PATTERN_REQUIRES_NO_DOMAINS = "global_pattern scope 要求 domains 为空"
    SCOPE_GLOBAL_PATTERN_REQUIRES_URL_PATTERN = "global_pattern scope 要求 url_pattern 非空"
    SITEMAP_FETCH_CONCURRENCY_MIN = "sitemap_fetch_concurrency 必须 >= 1"
    SITEMAP_MAX_RECURSION_NON_NEGATIVE = "sitemap_max_recursion 必须 >= 0"
    SITEMAP_MAX_URLS_MIN = "sitemap_max_urls 必须 >= 1"
    STATE_DISABLED_NOT_LIST = "disabled 字段不是 list"
    STATE_ROOT_TYPE_NOT_DICT = "根类型不是 dict"
    THEME_MANAGER_NOT_INITIALIZED = "ThemeManager not initialized — call init_theme_manager() first"
    URL_MUST_NOT_CONTAIN_AUTH = "URL 不得包含认证信息"
    URL_NO_VALID_HOSTNAME = "URL 无有效 hostname"
    USER_AGENT_REQUIRED = "User-Agent 不能为空"
    VIEWPORT_POSITIVE = "视口宽高必须 > 0"


class AnnotationKey(Enum):
    """管道注解键 SSOT — 对标 Heritrix CrawlURI annotations。value 全部来自已有 SSOT 枚举。"""

    FETCH_ERROR = "fetch_error"  # value: FetchErrorCategory
    REQUEUE_FAILURE = "requeue_failure"  # value: EnqueueResult
    EXCEPTION = "exception"  # value: Exception.__class__.__name__
