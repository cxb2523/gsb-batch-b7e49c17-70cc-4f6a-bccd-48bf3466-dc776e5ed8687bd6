<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { getClerk, getSessionToken, signOutAndRedirect } from '../lib/auth/clerk-client.js';
  import AlertsView from '../lib/presentation/components/alerts/AlertsView.svelte';
  import AlertDetailDialog from '../lib/presentation/components/alerts/AlertDetailDialog.svelte';
  import NavIcon from '../lib/presentation/components/ui/NavIcon.svelte';
  import {
    hasVideoSignal,
    isSourceReceiving,
    MONITOR_POLL_INTERVAL_MS,
    sourceStatusLabel as monitoringStatusLabel
  } from '../lib/presentation/monitoring/source-status.js';

  type ViewId = 'overview' | 'monitor' | 'cameras' | 'detections' | 'alerts' | 'service';
  type LogLevel = 'all' | 'INFO' | 'WARNING' | 'ERROR' | 'DEBUG' | 'CRITICAL';
  interface Camera { id: string; number?: number; name: string; url: string; streamPath?: string; registeredAt: string; active?: boolean; }
  interface Detection { id?: string; camera?: string; fecha_hora?: string; created_at?: string; clase?: string; class_name?: string; confianza?: number; processing_ms?: number; status?: string; }
  interface Alert extends Detection { timestamp_inicio?: string; timestamp_fin?: string; fecha_hora_fin?: string; duracion_segundos?: number; interruption_reason?: string; threshold?: number; }
  interface AlertListResponse { items?: Alert[]; total?: number; limit?: number; offset?: number; }
  interface ClipResponse { status?: 'recording' | 'ready' | 'partial' | 'missing'; url?: string | null; duration_seconds?: number | null; }
  interface LatestResult extends Detection { processing_ms?: number; anomaly_score?: number; alert?: { incident?: boolean; closing?: boolean; }; }
  interface InferenceSource { status?: string; worker_id?: string | null; status_age_seconds?: number | null; frames_received?: number; windows_processed?: number; last_frame_age_seconds?: number | null; latest_result?: LatestResult; }
  interface InferenceResponse { available: boolean; source: InferenceSource | null; latestDetection?: Detection | null; detections?: Detection[]; alerts?: Alert[]; error?: string; }
  interface DashboardResponse { available: boolean; sources?: Record<string, InferenceSource>; alerts?: Alert[]; error?: string; }
  interface DetectionListResponse { items?: Detection[]; total?: number | null; }
  interface DetectionSummary { date?: string; total?: number; anomalies?: number; by_class?: Record<string, number>; by_camera?: Record<string, number>; by_hour?: Array<{ hour: number; total: number; anomalies?: number }>; }
  interface ServiceLog { id?: string; fecha_hora?: string; camera?: string | null; event_type?: string; level?: string; message?: string; processing_ms?: number | null; inference_ms?: number | null; session_id?: string | null; window_id?: string | null; detection_id?: string | null; }
  interface CameraListResponse { cameras?: Camera[]; }
  interface RegisterCameraResponse { camera: Camera; inference?: { available?: boolean; error?: string }; }
  interface DeleteCameraResponse { warning?: string | null; }
  interface ServiceLogsResponse { logs?: ServiceLog[]; total?: number; }
  interface ErrorPayload { error?: string; }
  interface AuthProfile { id: string; clerk_user_id: string; email: string; display_name?: string | null; role: 'admin' | 'operator'; is_active: boolean; }

  const DEFAULT_URL = '';
  // Historiales por sesión: evita consultas repetidas al cambiar de vista.
  const OPERATIONAL_CACHE_TTL_MS = 30_000;
  const ALERTS_CACHE_PREFIX = 'sentrix-events-cache:';
  const DETECTIONS_CACHE_PREFIX = 'sentrix-detections-cache:';
  const DASHBOARD_DETECTIONS_CACHE_KEY = 'sentrix-dashboard-detections-summary-v2';
  const menu: Array<{ id: ViewId; label: string; icon: 'overview' | 'monitor' | 'camera' | 'detections' | 'alerts' | 'logs' }> = [
    { id: 'overview', label: 'Resumen general', icon: 'overview' },
    { id: 'monitor', label: 'Monitoreo en vivo', icon: 'monitor' },
    { id: 'cameras', label: 'Cámaras', icon: 'camera' },
    { id: 'detections', label: 'Detecciones', icon: 'detections' },
    { id: 'alerts', label: 'Eventos y alertas', icon: 'alerts' },
    { id: 'service', label: 'Registros del servicio', icon: 'logs' }
  ];
  let view = $state<ViewId>('overview');
  let modal = $state(false);
  let editingCamera = $state<Camera | null>(null);
  let cameras = $state<Camera[]>([]);
  let selectedId = $state('');
  let inference = $state<InferenceResponse | null>(null);
  let inferenceByCamera = $state<Record<string, InferenceResponse>>({});
  let playbackReadyByCamera = $state<Record<string, boolean>>({});
  let loading = $state(true);
  let connecting = $state(true);
  let busy = $state(false);
  let error = $state('');
  let notice = $state('');
  let name = $state('Logitech C922');
  let url = $state(DEFAULT_URL);
  let formError = $state('');
  let authProfile = $state<AuthProfile | null>(null);
  let authBlocked = $state('');
  let authReady = $state(false);
  let showPlayer = $state(true);
  let monitorExpanded = $state(false);
  let monitorPage = $state(1);
  const MONITOR_PAGE_SIZE = 4;
  let lastRefresh = $state<Date | null>(null);
  let query = $state('');
  let actionFilter = $state('all');
  let since = $state('');
  let until = $state('');
  let detectionPage = $state(1);
  const DETECTION_PAGE_SIZE = 10;
  let detectionResults = $state<Detection[]>([]);
  let dashboardDetections = $state<Detection[]>([]);
  let dashboardSummary = $state<DetectionSummary | null>(null);
  let dashboardDetectionTotal = $state<number | null>(null);
  let dashboardAnalyticsLastRefresh = $state<Date | null>(null);
  let detectionTotal = $state<number | null>(null);
  let detectionsLoading = $state(false);
  let serviceLogs = $state<ServiceLog[]>([]);
  let serviceLogsLoading = $state(false);
  let serviceLogsError = $state('');
  let serviceLogsLastRefresh = $state<Date | null>(null);
  let allAlerts = $state<Alert[]>([]);
  let activeAlertsSummary = $state<Alert[]>([]);
  let alertsLoading = $state(false);
  let alertsError = $state('');
  let alertPage = $state(1);
  const ALERT_PAGE_SIZE = 8;
  let alertTotal = $state<number | null>(null);
  let selectedAlert = $state<Alert | null>(null);
  let clip = $state<ClipResponse | null>(null);
  let clipLoading = $state(false);
  let clipError = $state('');
  let clipPollTimer: ReturnType<typeof setTimeout> | null = null;
  let logLevel = $state<LogLevel>('all');
  let logCamera = $state('all');
  let logQuery = $state('');
  let logPage = $state(1);
  const LOG_PAGE_SIZE = 5;
  let dialogElement = $state<HTMLDivElement | null>(null);
  let openerElement: HTMLElement | null = null;
  let accessibilityOpen = $state(false);
  let mobileNavigationOpen = $state(false);
  let highContrast = $state(false);
  let reducedMotion = $state(false);
  let textSize = $state<'normal' | 'large' | 'xlarge'>('normal');
  let dyslexiaMode = $state(false);
  let letterSpacing = $state(false);
  let alignedText = $state(false);

  let camera = $derived(cameras.find((item) => item.id === selectedId) ?? cameras[0] ?? null);
  let source = $derived(inference?.source ?? null);
  let detections = $derived(inference?.detections ?? (inference?.latestDetection ? [inference.latestDetection] : []));
  let latest = $derived(inference?.latestDetection ?? null);
  let alerts = $derived(allAlerts);
  let aiConnected = $derived(inference?.available === true);
  let aiReceiving = $derived(aiConnected && isSourceReceiving(source));
  let sourceAvailable = $derived(aiConnected && hasVideoSignal(source));
  let selectedPlaybackReady = $derived(camera ? playbackReadyByCamera[camera.id] === true : false);
  let isAdmin = $derived(authProfile?.role === 'admin');
  let filteredDetections = $derived(detectionResults.filter((d) => {
    const cls = (d.clase ?? d.class_name ?? '').toLowerCase();
    const date = d.fecha_hora ?? d.created_at ?? '';
    return (actionFilter === 'all' || cls === actionFilter) &&
      (!since || date.slice(0, 10) >= since) && (!until || date.slice(0, 10) <= until) &&
      (!query || cls.includes(query.toLowerCase()));
  }).sort((left, right) => {
    const leftTime = new Date(left.fecha_hora ?? left.created_at ?? 0).getTime();
    const rightTime = new Date(right.fecha_hora ?? right.created_at ?? 0).getTime();
    return rightTime - leftTime;
  }));
  let detectionPageCount = $derived(Math.max(1, Math.ceil((detectionTotal ?? filteredDetections.length) / DETECTION_PAGE_SIZE)));
  let currentDetectionPage = $derived(Math.min(detectionPage, detectionPageCount));
  let paginatedDetections = $derived(filteredDetections);
  let filteredServiceLogs = $derived(serviceLogs.filter((log) => {
    const level = String(log.level ?? '').toUpperCase();
    const cameraId = String(log.camera ?? '');
    const text = `${log.event_type ?? ''} ${log.message ?? ''} ${log.session_id ?? ''} ${log.window_id ?? ''}`.toLowerCase();
    return (logLevel === 'all' || level === logLevel) &&
      (logCamera === 'all' || cameraId === logCamera) &&
      (!logQuery || text.includes(logQuery.toLowerCase()));
  }));
  let logPageCount = $derived(Math.max(1, Math.ceil(filteredServiceLogs.length / LOG_PAGE_SIZE)));
  let currentLogPage = $derived(Math.min(logPage, logPageCount));
  let paginatedServiceLogs = $derived(filteredServiceLogs.slice((currentLogPage - 1) * LOG_PAGE_SIZE, currentLogPage * LOG_PAGE_SIZE));
  let processingTimes = $derived(filteredServiceLogs.map((log) => Number(log.processing_ms)).filter((value) => Number.isFinite(value) && value >= 0));
  let averageProcessingMs = $derived(processingTimes.length ? processingTimes.reduce((sum, value) => sum + value, 0) / processingTimes.length : null);
  let minimumProcessingMs = $derived(processingTimes.length ? Math.min(...processingTimes) : null);
  let maximumProcessingMs = $derived(processingTimes.length ? Math.max(...processingTimes) : null);
  let latestProcessingMs = $derived(source?.latest_result?.processing_ms ?? latest?.processing_ms ?? null);
  let liveAnomalyScore = $derived(source?.latest_result?.anomaly_score ?? null);
  let liveIncident = $derived(source?.latest_result?.alert?.incident === true);
  let liveClosing = $derived(source?.latest_result?.alert?.closing === true);
  let activeCameraCount = $derived(cameras.filter((item) => {
    const result = inferenceByCamera[item.id];
    return result?.available === true && isSourceReceiving(result.source);
  }).length);
  let activeTransmissionCount = $derived(cameras.filter((item) => {
    const result = inferenceByCamera[item.id];
    return result?.available === true && hasVideoSignal(result.source);
  }).length);
  let overviewDetections = $derived(Object.entries(inferenceByCamera).flatMap(([cameraId, result]) => {
    const items = result.detections?.length ? result.detections : result.latestDetection ? [result.latestDetection] : [];
    return items.map((item) => ({ ...item, camera: item.camera ?? cameraId }));
  }));
  let overviewAlerts = $derived(Object.entries(inferenceByCamera).flatMap(([cameraId, result]) =>
    (result.alerts ?? []).map((item) => ({ ...item, camera: item.camera ?? cameraId }))
  ));
  let recentOverviewDetections = $derived(cameras.flatMap((item) => {
    const result = inferenceByCamera[item.id];
    const detection = result?.source?.latest_result ?? result?.latestDetection ?? null;
    return detection ? [{ ...detection, camera: detection.camera ?? item.id }] : [];
  }).sort((left, right) => {
    const leftTime = new Date(left.fecha_hora ?? left.created_at ?? 0).getTime();
    const rightTime = new Date(right.fecha_hora ?? right.created_at ?? 0).getTime();
    return rightTime - leftTime;
  }).slice(0, 6));
  let todayKey = $derived(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()));
  let todayDetections = $derived(overviewDetections.filter((d) => {
    const value = d.fecha_hora ?? d.created_at;
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(date) === todayKey;
  }));
  let activeAlerts = $derived(activeAlertsSummary.filter((alert) => String(alert.status ?? '').toLowerCase() === 'active'));
  let cameraCoverage = $derived(cameras.length ? Math.round((activeTransmissionCount / cameras.length) * 100) : 0);
  let attentionCameras = $derived(cameras.filter((item) => !cameraIsOnline(item.id)));
  let detectionDistribution = $derived.by(() => {
    return Object.entries(dashboardSummary?.by_class ?? {})
      .filter(([name]) => name.toLowerCase() !== 'normal')
      .map(([name, count]) => [labelClass(name), Number(count) || 0] as [string, number])
      .filter(([, count]) => count > 0)
      .sort((left, right) => right[1] - left[1]).slice(0, 5);
  });
  let distributionTotal = $derived(detectionDistribution.reduce((sum, [, count]) => sum + count, 0));
  let distributionGradient = $derived.by(() => {
    const colors = ['#1477db', '#12a9cf', '#3472bd', '#efaa43', '#72869b'];
    if (!distributionTotal) return '#dce7f0 0 100%';
    let offset = 0;
    return detectionDistribution.map(([, count], index) => {
      const next = offset + (count / distributionTotal) * 100;
      const segment = `${colors[index]} ${offset}% ${next}%`;
      offset = next;
      return segment;
    }).join(', ');
  });
  let hourlyActivity = $derived.by(() => Array.from({ length: 24 }, (_, hour) => {
    const entry = dashboardSummary?.by_hour?.find((item) => Number(item.hour) === hour);
    return { hour, count: Number(entry?.anomalies ?? entry?.total ?? 0) || 0 };
  }));
  let hourlyMaximum = $derived(Math.max(1, ...hourlyActivity.map((item) => item.count)));
  let alertPageCount = $derived(Math.max(1, Math.ceil((alertTotal ?? allAlerts.length) / ALERT_PAGE_SIZE)));
  let currentAlertPage = $derived(Math.min(alertPage, alertPageCount));
  let monitorPageCount = $derived(Math.max(1, Math.ceil(cameras.length / MONITOR_PAGE_SIZE)));
  let currentMonitorPage = $derived(Math.min(monitorPage, monitorPageCount));
  let paginatedMonitorCameras = $derived(cameras.slice((currentMonitorPage - 1) * MONITOR_PAGE_SIZE, currentMonitorPage * MONITOR_PAGE_SIZE));

  function errorMessage(value: unknown): string { return value instanceof Error ? value.message : String(value); }
  function peruDateKey(value: string | undefined) {
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(date) : '';
  }
  function peruHour(value: string | undefined) {
    const date = value ? new Date(value) : null;
    if (!date || Number.isNaN(date.getTime())) return -1;
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: '2-digit', hourCycle: 'h23' }).format(date));
  }
  async function getJSON<T>(path: string, options?: RequestInit): Promise<T> {
    const headers = new Headers(options?.headers);
    const token = await getSessionToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(path, { ...options, headers });
    const data = await response.json().catch(() => ({})) as T & ErrorPayload;
    if (response.status === 401) {
      // El token de Clerk ya no es aceptado por la API. Al cerrar la sesión
      // antes de redirigir se evita el ciclo / -> /sign-in -> /.
      await signOutAndRedirect();
      throw new Error('Tu sesión expiró. Inicia sesión nuevamente.');
    }
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  }
  function readOperationalCache<T>(key: string): T | null {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const entry = JSON.parse(raw) as { savedAt?: number; value?: T };
      if (!Number.isFinite(entry.savedAt) || Date.now() - Number(entry.savedAt) > OPERATIONAL_CACHE_TTL_MS) {
        sessionStorage.removeItem(key);
        return null;
      }
      return entry.value ?? null;
    } catch { return null; }
  }
  function writeOperationalCache<T>(key: string, value: T) {
    try { sessionStorage.setItem(key, JSON.stringify({ savedAt: Date.now(), value })); } catch { /* El cache es opcional. */ }
  }
  function clearOperationalCache() {
    try {
      for (let index = 1; index <= alertPageCount; index += 1) sessionStorage.removeItem(`${ALERTS_CACHE_PREFIX}${index}`);
      for (let index = 1; index <= detectionPageCount; index += 1) sessionStorage.removeItem(`${DETECTIONS_CACHE_PREFIX}${index}`);
      sessionStorage.removeItem(DASHBOARD_DETECTIONS_CACHE_KEY);
    } catch { /* El cache es opcional. */ }
  }
  async function loadCamera() {
    try {
      cameras = (await getJSON<CameraListResponse>('/api/camera')).cameras ?? [];
      if (!cameras.some((item) => item.id === selectedId)) selectedId = cameras[0]?.id ?? '';
    }
    catch (e) { error = errorMessage(e); }
    finally { loading = false; }
  }
  async function refreshInference(cameraId = camera?.id) {
    await refreshAllInference();
  }
  async function refreshAllInference() {
    connecting = lastRefresh === null;
    try {
      const snapshot = await getJSON<DashboardResponse>('/api/monitoring');
      const next: Record<string, InferenceResponse> = {};
      for (const item of cameras) {
        const source = snapshot.sources?.[item.id] ?? null;
        const latestDetection = source?.latest_result as Detection | undefined;
        next[item.id] = { available: snapshot.available, source, latestDetection, detections: latestDetection ? [{ ...latestDetection, camera: item.id }] : [], alerts: [] };
      }
      inferenceByCamera = next;
      activeAlertsSummary = (snapshot.alerts ?? []).map(normalizeAlertTiming);
    } catch (e) {
      inferenceByCamera = Object.fromEntries(cameras.map((item) => [item.id, { available: false, source: null, alerts: [], detections: [], error: errorMessage(e) }]));
      activeAlertsSummary = [];
    } finally {
      connecting = false;
      lastRefresh = new Date();
    }
    inference = selectedId ? inferenceByCamera[selectedId] ?? null : null;
  }
  async function refreshDetections(options: { force?: boolean } = {}) {
    const cacheKey = `${DETECTIONS_CACHE_PREFIX}${detectionPage}`;
    if (!options.force) {
      const cached = readOperationalCache<DetectionListResponse>(cacheKey);
      if (cached) {
        detectionResults = cached.items ?? [];
        detectionTotal = cached.total ?? null;
        return;
      }
    }
    detectionsLoading = true;
    try {
      const offset = (detectionPage - 1) * DETECTION_PAGE_SIZE;
      const data = await getJSON<DetectionListResponse>(`/api/detections?limit=${DETECTION_PAGE_SIZE}&offset=${offset}`);
      detectionResults = data.items ?? []; detectionTotal = data.total ?? null;
      writeOperationalCache(cacheKey, data);
    } catch { detectionResults = []; detectionTotal = 0; }
    finally { detectionsLoading = false; }
  }
  async function loadDashboardAnalytics(options: { force?: boolean } = {}) {
    const cached = options.force ? null : readOperationalCache<DetectionSummary>(DASHBOARD_DETECTIONS_CACHE_KEY);
    if (cached) { dashboardSummary = cached; dashboardDetectionTotal = Number(cached.total) || 0; return; }
    try {
      const data = await getJSON<DetectionSummary>(`/api/detections/summary?date=${encodeURIComponent(todayKey)}`);
      dashboardSummary = data;
      dashboardDetectionTotal = Number(data.total) || 0;
      writeOperationalCache(DASHBOARD_DETECTIONS_CACHE_KEY, data);
    } catch { dashboardSummary = null; dashboardDetections = []; dashboardDetectionTotal = null; }
    finally { dashboardAnalyticsLastRefresh = new Date(); }
  }
  async function refreshServiceLogs() {
    serviceLogsLoading = true;
    serviceLogsError = '';
    try {
      const data = await getJSON<ServiceLogsResponse>('/api/service-logs?limit=200');
      serviceLogs = data.logs ?? [];
      serviceLogsLastRefresh = new Date();
    } catch (e) {
      serviceLogs = [];
      serviceLogsError = errorMessage(e);
    } finally {
      serviceLogsLoading = false;
    }
  }
  async function refreshAlerts(options: { force?: boolean } = {}) {
    const cacheKey = `${ALERTS_CACHE_PREFIX}${alertPage}`;
    if (!options.force) {
      const cached = readOperationalCache<AlertListResponse>(cacheKey);
      if (cached) {
        allAlerts = (cached.items ?? []).map(normalizeAlertTiming);
        alertTotal = cached.total ?? null;
        return;
      }
    }
    alertsLoading = true; alertsError = '';
    try {
      const offset = (alertPage - 1) * ALERT_PAGE_SIZE;
      const data = await getJSON<AlertListResponse>(`/api/alerts?limit=${ALERT_PAGE_SIZE}&offset=${offset}`);
      allAlerts = (data.items ?? []).map(normalizeAlertTiming);
      alertTotal = data.total ?? null;
      writeOperationalCache(cacheKey, data);
    } catch (e) {
      allAlerts = []; alertTotal = 0;
      alertsError = errorMessage(e);
    } finally { alertsLoading = false; }
  }
  function stopClipPolling() {
    if (clipPollTimer !== null) clearTimeout(clipPollTimer);
    clipPollTimer = null;
  }
  async function loadClip(alertId: string) {
    try {
      clip = await getJSON<ClipResponse>(`/api/alerts/${encodeURIComponent(alertId)}/clip`);
      if (clip.status === 'recording') {
        stopClipPolling();
        clipPollTimer = setTimeout(() => {
          if (selectedAlert?.id === alertId) loadClip(alertId);
        }, 5_000);
      }
    } catch (e) { clipError = errorMessage(e); }
  }
  async function showAlertDetail(alert: Alert) {
    stopClipPolling(); selectedAlert = alert; clip = null; clipError = ''; clipLoading = true;
    try {
      const detail = alert.id ? await getJSON<Alert>(`/api/alerts/${encodeURIComponent(alert.id)}`) : alert;
      selectedAlert = normalizeAlertTiming(detail);
      if (detail.id) await loadClip(detail.id);
      else clip = { status: 'missing', url: null };
    } catch (e) { clipError = errorMessage(e); }
    finally { clipLoading = false; }
  }
  function closeAlertDetail() { stopClipPolling(); selectedAlert = null; clip = null; clipError = ''; }
  onMount(() => {
    let mounted = true;
    let fetching = false;
    const params = new URLSearchParams(window.location.search);
    const requestedView = params.get('view');
    if (menu.some((item) => item.id === requestedView)) view = requestedView as ViewId;
    if (params.get('modal') === 'camera') modal = true;
    try {
      const saved = JSON.parse(localStorage.getItem('sentrix-accessibility') ?? '{}');
      highContrast = saved.highContrast === true;
      reducedMotion = saved.reducedMotion === true;
      textSize = ['normal', 'large', 'xlarge'].includes(saved.textSize) ? saved.textSize : 'normal';
      dyslexiaMode = saved.dyslexiaMode === true;
      // Conserva la preferencia anterior durante la transición de nombre.
      letterSpacing = saved.letterSpacing === true || saved.lineSpacing === true;
      alignedText = saved.alignedText === true;
    } catch { /* Las preferencias son opcionales. */ }
    const boot = async () => {
      try {
        const clerk = await getClerk();
        if (!clerk) { authBlocked = 'El acceso seguro aún no está configurado. Configura PUBLIC_CLERK_PUBLISHABLE_KEY.'; loading = false; return; }
        if (!clerk.user) { window.location.replace('/sign-in'); return; }
        try { authProfile = await getJSON<AuthProfile>('/api/auth/me'); }
        catch (reason) { authBlocked = errorMessage(reason); loading = false; return; }
        authReady = true;
        await loadCamera();
        if (!mounted) return;
        refreshAllInference();
        loadDashboardAnalytics();
        if (view === 'service') refreshServiceLogs();
        if (view === 'detections') refreshDetections();
      } catch (reason) {
        if (!mounted) return;
        authBlocked = `No se pudo inicializar el acceso seguro. ${errorMessage(reason)}`;
        loading = false;
      }
    };
    void boot();
    const timer = setInterval(async () => {
      if (!mounted || !cameras.length || fetching) return;
      fetching = true;
      try {
        await refreshAllInference();
        const analyticsExpired = !dashboardAnalyticsLastRefresh || Date.now() - dashboardAnalyticsLastRefresh.getTime() >= 30_000;
        if (view === 'overview' && analyticsExpired) await loadDashboardAnalytics({ force: true });
      } finally { fetching = false; }
    }, MONITOR_POLL_INTERVAL_MS);
    return () => { mounted = false; clearInterval(timer); };
  });
  function clearFeedback() { notice = ''; error = ''; formError = ''; }
  function validateCameraForm() {
    const cleanName = name.trim();
    const cleanUrl = url.trim().replace(/\/+$/, '');
    if (!cleanName) return 'Ingresa el nombre de la cámara.';
    if (cleanName.length > 100) return 'El nombre debe tener como máximo 100 caracteres.';
    try { if (new URL(cleanUrl).protocol !== 'https:') return 'La dirección debe utilizar HTTPS.'; }
    catch { return 'Ingresa una dirección HTTPS válida.'; }
    const duplicate = cameras.find((item) => item.id !== editingCamera?.id && item.url.trim().replace(/\/+$/, '').toLowerCase() === cleanUrl.toLowerCase());
    if (duplicate) return `Esta transmisión ya está vinculada a ${cameraLabel(duplicate)}.`;
    name = cleanName; url = cleanUrl;
    return '';
  }
  async function registerCamera(event: SubmitEvent) {
    event.preventDefault(); clearFeedback(); formError = validateCameraForm();
    if (formError) return;
    busy = true;
    try {
      const parsedUrl = new URL(url.trim());
      if (parsedUrl.protocol !== 'https:') throw new Error('La dirección de la cámara debe utilizar HTTPS. Ejemplo: https://servidor/camera01/');
      if (editingCamera) {
        const data = await getJSON<RegisterCameraResponse>(`/api/camera?id=${encodeURIComponent(editingCamera.id)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url })
        });
        cameras = cameras.map((item) => item.id === editingCamera?.id ? data.camera : item);
        clearOperationalCache();
        selectedId = data.camera.id;
        notice = data.inference?.available === false ? 'Cámara actualizada, pero no se pudo reiniciar el análisis.' : 'Cámara actualizada y análisis reiniciado.';
        if (data.inference?.error) error = data.inference.error;
      } else {
        const data = await getJSON<RegisterCameraResponse>('/api/camera', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, url })
        });
        cameras = [...cameras, data.camera];
        clearOperationalCache();
        selectedId = data.camera.id;
        notice = data.inference?.available ? 'Cámara registrada. Se solicitó el inicio del análisis.' : 'Cámara registrada. La inferencia no respondió; puedes reintentarla.';
        if (data.inference?.error) error = data.inference.error;
      }
      modal = false; view = 'cameras'; showPlayer = true;
      const updatedId = editingCamera?.id ?? selectedId;
      editingCamera = null; name = ''; url = '';
      await refreshInference(updatedId);
    } catch (e) { formError = errorMessage(e); }
    finally { busy = false; }
  }
  async function activateInference(target: Camera | null = camera) {
    if (!target) return;
    selectedId = target.id;
    clearFeedback(); busy = true;
    try {
      await getJSON<unknown>('/api/camera/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: target.id }) });
      notice = 'Solicitud enviada al servidor de inferencia.';
      await refreshInference(target.id);
    } catch (e) { error = errorMessage(e); }
    finally { busy = false; }
  }
  async function deleteCamera(target: Camera) {
    if (!isAdmin) { error = 'No tienes permisos para eliminar cámaras.'; return; }
    if (!confirm(`¿Detener el análisis y eliminar ${target.id}?`)) return;
    clearFeedback(); busy = true;
    try {
      const result = await getJSON<DeleteCameraResponse>(`/api/camera?id=${encodeURIComponent(target.id)}`, { method: 'DELETE' });
      cameras = cameras.filter((item) => item.id !== target.id);
      clearOperationalCache();
      selectedId = cameras[0]?.id ?? '';
      const remainingInference = { ...inferenceByCamera };
      delete remainingInference[target.id];
      inferenceByCamera = remainingInference;
      inference = selectedId ? remainingInference[selectedId] ?? null : null;
      showPlayer = cameras.length > 0;
      notice = result.warning ?? 'Se eliminó la cámara y se solicitó detener la inferencia.';
      view = 'cameras';
      if (selectedId) await refreshInference(selectedId);
    } catch (e) { error = errorMessage(e); }
    finally { busy = false; }
  }
  function toDate(value: unknown): Date | null {
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (value === null || value === undefined || value === '') return null;
    const numeric = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()) ? Number(value) : NaN;
    const date = Number.isFinite(numeric)
      ? new Date(Math.abs(numeric) < 100_000_000_000 ? numeric * 1_000 : numeric)
      : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  function validEventDate(value: unknown): string | null {
    const date = toDate(value);
    return date && date.getUTCFullYear() >= 2020 ? date.toISOString() : null;
  }
  function normalizeAlertTiming(alert: Alert): Alert {
    const start = validEventDate(alert.timestamp_inicio) ?? validEventDate(alert.fecha_hora) ?? validEventDate(alert.created_at);
    const end = validEventDate(alert.timestamp_fin) ?? validEventDate(alert.fecha_hora_fin);
    return { ...alert, timestamp_inicio: start ?? undefined, timestamp_fin: end ?? undefined };
  }
  function fmtDate(value: unknown) {
    const d = toDate(value);
    return d ? d.toLocaleString('es-PE', { timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'medium' }) : '—';
  }
  function fmtTime(value: unknown) {
    const d = toDate(value);
    return d ? d.toLocaleTimeString('es-PE', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : '—';
  }
  function recentDateLabel(value: unknown) {
    const date = toDate(value);
    if (!date) return 'Sin fecha';
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(date);
    return day === today ? fmtTime(value) : fmtDate(value);
  }
  function confidence(value: unknown) {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : '—';
  }
  function duration(value: unknown) {
    const seconds = Number(value);
    if (!Number.isFinite(seconds) || seconds < 0) return '—';
    const minutes = Math.floor(seconds / 60);
    const rest = Math.round(seconds % 60);
    return minutes ? `${minutes} min ${rest} s` : `${rest} s`;
  }
  function statusLabel(value: unknown) {
    return ({ active: 'Activo', closed: 'Cerrado', interrupted: 'Interrumpido', recording: 'Grabando', ready: 'Listo', partial: 'Parcial', missing: 'No disponible' } as Record<string, string>)[String(value).toLowerCase()] ?? String(value || 'Registrado');
  }
  function sourceStatusLabel(item: InferenceSource | null | undefined, available = true) {
    return monitoringStatusLabel(item, available);
  }
  function monitorStatusLabel(cameraId: string) {
    const result = inferenceByCamera[cameraId];
    if (playbackReadyByCamera[cameraId] && isPending(result?.source)) return 'Video disponible · esperando IA';
    return sourceStatusLabel(result?.source, result?.available);
  }
  function markPlaybackReady(cameraId: string) {
    playbackReadyByCamera = { ...playbackReadyByCamera, [cameraId]: true };
  }
  function sourceWorkerLabel(item: InferenceSource | null | undefined) {
    if (!item?.worker_id) return '';
    const age = Number(item.status_age_seconds);
    return `Worker: ${item.worker_id}${Number.isFinite(age) ? ` · hace ${Math.round(age)} s` : ''}`;
  }
  function isPending(item: InferenceSource | null | undefined) { return String(item?.status ?? '').toLowerCase() === 'pending'; }
  function labelClass(value: unknown) {
    return String(value || 'Sin clasificación').replaceAll('_', ' ');
  }
  function cameraLabel(value: Camera | null | undefined) {
    return value?.number ? `Cámara ${value.number}` : value?.id ?? '—';
  }
  function latestFor(cameraId: string): Detection | null {
    const result = inferenceByCamera[cameraId];
    return result?.latestDetection ?? result?.detections?.[0] ?? null;
  }
  function cameraIsOnline(cameraId: string): boolean {
    const result = inferenceByCamera[cameraId];
    const itemSource = result?.source;
    return result?.available === true && hasVideoSignal(itemSource);
  }
  function go(id: ViewId) { view = id; clearFeedback(); if (id === 'overview') loadDashboardAnalytics(); if (id === 'monitor') { monitorExpanded = false; monitorPage = 1; } if (id === 'service') refreshServiceLogs(); if (id === 'alerts') { alertPage = 1; refreshAlerts(); } if (id === 'detections') { detectionPage = 1; refreshDetections(); } }
  async function showRegistration(event?: MouseEvent) {
    openerElement = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearFeedback(); editingCamera = null; name = ''; url = ''; modal = true;
    await tick();
    dialogElement?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
  }
  async function showEditCamera(item: Camera, event?: MouseEvent) {
    openerElement = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement instanceof HTMLElement ? document.activeElement : null;
    clearFeedback(); editingCamera = item; name = item.name; url = item.url; modal = true;
    await tick();
    dialogElement?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus();
  }
  function closeRegistration() {
    modal = false; editingCamera = null;
    tick().then(() => openerElement?.focus());
  }
  function saveAccessibilityPreferences() {
    localStorage.setItem('sentrix-accessibility', JSON.stringify({ highContrast, reducedMotion, textSize, dyslexiaMode, letterSpacing, alignedText }));
  }
  function setTextSize(value: 'normal' | 'large' | 'xlarge') { textSize = value; saveAccessibilityPreferences(); }
  function resetAccessibilityPreferences() {
    highContrast = false; reducedMotion = false; textSize = 'normal'; dyslexiaMode = false; letterSpacing = false; alignedText = false; saveAccessibilityPreferences();
  }  function handleDialogKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') { event.preventDefault(); closeRegistration(); return; }
    if (event.key !== 'Tab' || !dialogElement) return;
    const focusable = [...dialogElement.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => !element.hidden);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
  async function selectCamera(target: Camera, destination: ViewId = 'monitor') {
    selectedId = target.id; inference = inferenceByCamera[target.id] ?? null; view = destination; showPlayer = true; monitorExpanded = destination === 'monitor';
    await refreshInference(target.id);
  }
  async function expandCamera(target: Camera) {
    await selectCamera(target, 'monitor');
    monitorExpanded = true;
  }
  async function leaveBlockedSession() {
    try { await signOutAndRedirect(); }
    catch { window.location.assign('/sign-in'); }
  }
</script>

<svelte:head>
  <title>SentriX — Centro de monitoreo</title>
  <meta name="description" content="Monitoreo, detecciones y alertas de cámaras con MediaMTX y FastAPI" />
</svelte:head>
{#if authBlocked}
  <main class="auth-gate"><section><img src="/sentrix-logo-192.png" alt="SentriX" /><h1>Acceso no disponible</h1><p>{authBlocked}</p><button type="button" onclick={leaveBlockedSession}>Cerrar sesión e intentar de nuevo</button></section></main>
{:else if !authReady}
  <main class="auth-gate" aria-live="polite"><section><img src="/sentrix-logo-192.png" alt="SentriX" /><h1>Verificando sesión</h1><p>Comprobando acceso seguro al panel…</p></section></main>
{:else}
<a class="skip-link" href="#main-content">Saltar al contenido principal</a>

<div class="shell" class:a11y-high-contrast={highContrast} class:a11y-reduced-motion={reducedMotion} class:a11y-text-large={textSize === 'large'} class:a11y-text-xlarge={textSize === 'xlarge'} class:a11y-dyslexia={dyslexiaMode} class:a11y-letter-spacing={letterSpacing} class:a11y-aligned-text={alignedText}>
  <aside class="sidebar" class:mobile-open={mobileNavigationOpen} aria-label="Panel lateral">
    <a class="brand" href="/" aria-label="SentriX: ir al resumen general" onclick={(e) => { e.preventDefault(); go('overview'); }}>
      <span class="brand-emblem"><img src="/sentrix-logo-192.png" alt="" /></span>
      <span class="brand-lockup"><strong>Sentri<span>X</span></strong><small>Sistema de vigilancia inteligente</small></span>
    </a>
    <div class="menu-label">ESPACIO DE TRABAJO</div>
    <nav aria-label="Navegación principal">
      {#each menu as item}
        <button type="button" class:current={view === item.id} aria-current={view === item.id ? 'page' : undefined} aria-label={item.label} title={item.label} onclick={() => { mobileNavigationOpen = false; go(item.id); }}>
          <span class="nav-icon" aria-hidden="true"><NavIcon kind={item.icon} /></span><span>{item.label}</span>
        </button>
      {/each}
    </nav>
    <div class="side-bottom">
      <div class="system-state" role="status" aria-label={`Servicio de inferencia: ${aiConnected ? 'en línea' : 'no disponible'}`}><span class:live={aiConnected} class="led" aria-hidden="true"></span><div><strong>Servicio de inferencia</strong><small>{aiConnected ? 'En línea' : 'No disponible'}</small></div></div>
      <p>Prototipo académico · múltiples cámaras</p>
    </div>
  </aside>

  <div class="workspace">
    <header class="topbar">
      <button class="mobile-nav-toggle" type="button" aria-label="Abrir menú de navegación" aria-expanded={mobileNavigationOpen} onclick={() => mobileNavigationOpen = !mobileNavigationOpen}><span aria-hidden="true">☰</span></button>
      <div class="breadcrumb">OPERACIONES <span>/</span> <strong>{menu.find((m) => m.id === view)?.label}</strong></div>
      <div class="topbar-right"><button class="accessibility-trigger" type="button" aria-expanded={accessibilityOpen} aria-controls="accessibility-panel" onclick={() => accessibilityOpen = !accessibilityOpen}><span class="accessibility-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="21"/><circle class="person-head" cx="24" cy="13" r="3.4"/><path d="M13 20.5c4.5 2.6 17.5 2.6 22 0M24 17v12m0 0-8 9m8-9 8 9"/></svg></span><span>Accesibilidad</span></button>{#if isAdmin}<a class="user-admin-link" href="/users">Usuarios</a>{/if}<span class="avatar" aria-label={authProfile?.display_name ?? 'Usuario'}>{authProfile?.display_name?.slice(0, 2).toUpperCase() ?? 'OP'}</span><span class="operator">{authProfile?.display_name && authProfile.display_name !== 'Operador' ? authProfile.display_name : authProfile?.role === 'admin' ? 'Administrador' : 'Operador'}</span><button class="sign-out" type="button" onclick={signOutAndRedirect}>Salir</button></div>
    </header>
    {#if accessibilityOpen}
      <aside id="accessibility-panel" class="accessibility-panel" aria-label="Menú de accesibilidad">
        <div class="accessibility-panel-head"><div><p class="a11y-kicker">SENTRIX</p><h2>Menú de accesibilidad</h2></div><button type="button" class="a11y-close" aria-label="Cerrar menú de accesibilidad" onclick={() => accessibilityOpen = false}>×</button></div>
        <p class="a11y-intro">Ajustes de lectura y navegación. Se guardan solo en este navegador.</p>
        <div class="a11y-grid">
          <button type="button" class:active={highContrast} aria-pressed={highContrast} aria-label="{highContrast ? 'Desactivar' : 'Activar'} contraste reforzado en todo el panel" onclick={() => { highContrast = !highContrast; saveAccessibilityPreferences(); }}><span aria-hidden="true">◐</span><strong>Contraste reforzado</strong><small>Todo el panel</small></button>
          <button type="button" class:active={textSize !== 'normal'} aria-pressed={textSize !== 'normal'} onclick={() => setTextSize(textSize === 'normal' ? 'large' : textSize === 'large' ? 'xlarge' : 'normal')}><span aria-hidden="true">Tᵀ</span><strong>Agrandar texto</strong><small>{textSize === 'normal' ? 'Normal' : textSize === 'large' ? 'Grande' : 'Muy grande'}</small></button>
          <button type="button" class:active={letterSpacing} aria-pressed={letterSpacing} onclick={() => { letterSpacing = !letterSpacing; saveAccessibilityPreferences(); }}><span aria-hidden="true">↔</span><strong>Separar letras</strong><small>Mejora la lectura</small></button>
          <button type="button" class:active={dyslexiaMode} aria-pressed={dyslexiaMode} onclick={() => { dyslexiaMode = !dyslexiaMode; saveAccessibilityPreferences(); }}><span aria-hidden="true">Dƒ</span><strong>Lectura para dislexia</strong><small>Tipografía y ritmo legibles</small></button>
          <button type="button" class:active={alignedText} aria-pressed={alignedText} onclick={() => { alignedText = !alignedText; saveAccessibilityPreferences(); }}><span aria-hidden="true">☰</span><strong>Alinear lectura</strong><small>Texto a la izquierda</small></button>
          <button type="button" class:active={reducedMotion} aria-pressed={reducedMotion} onclick={() => { reducedMotion = !reducedMotion; saveAccessibilityPreferences(); }}><span aria-hidden="true">◌</span><strong>Reducir movimiento</strong><small>Sin transiciones visuales</small></button>
        </div>
        <div class="a11y-reader-note"><strong>Lectores de pantalla</strong><p>Compatible con NVDA, Narrador de Windows, VoiceOver y TalkBack. Activa el lector desde tu dispositivo.</p></div>
        <button type="button" class="a11y-reset" onclick={resetAccessibilityPreferences}><span aria-hidden="true">↻</span> Restablecer configuraciones</button>
      </aside>
    {/if}
    <main id="main-content" tabindex="-1">
      <p class="sr-only" role="status" aria-live="polite">Vista actual: {menu.find((m) => m.id === view)?.label}</p>
      {#if view !== 'alerts'}
      <div class="page-head">
        <div>
          <div class="eyebrow">SISTEMA DE VIGILANCIA INTELIGENTE</div>
          <h1>{menu.find((m) => m.id === view)?.label}</h1>
          <p class="subtitle">{view === 'overview' ? 'Una vista clara del estado de tu operación.' : view === 'monitor' ? (monitorExpanded ? 'Detalle de la fuente seleccionada y estado de su análisis.' : 'Vista simultánea de todas las fuentes de video registradas.') : view === 'cameras' ? 'Registro y control de las fuentes de video.' : view === 'detections' ? 'Clasificaciones producidas por el servidor de inferencia.' : 'Estado técnico de las conexiones y el procesamiento.'}</p>
        </div>
        {#if view === 'cameras'}<button class="btn primary" onclick={showRegistration} disabled={loading}>+ Agregar cámara</button>
        {:else if view === 'monitor'}
          {#if monitorExpanded}<button class="btn secondary" onclick={() => monitorExpanded = false}>← Ver todas las cámaras</button>
          {:else}<span class="demo-badge">Vista simultánea</span>{/if}
        {:else}<button class="btn secondary" onclick={() => refreshAllInference()} disabled={!cameras.length}>↻ Actualizar</button>{/if}
      </div>
      {/if}

      {#if error}<div class="banner error" role="alert"><strong>Atención</strong><span>{error}</span><button aria-label="Cerrar aviso" onclick={() => error = ''}>×</button></div>{/if}
      {#if notice}<div class="banner success" role="status"><strong>Operación completada</strong><span>{notice}</span><button aria-label="Cerrar aviso" onclick={() => notice = ''}>×</button></div>{/if}
      {#if loading || connecting}<div class="banner connecting" role="status"><strong>Conectando con el servidor…</strong><span>La primera conexión a Render puede tardar hasta un minuto si el servicio estaba inactivo.</span></div>{/if}

      {#if view === 'overview'}
        <div class="overview-stats">
          <button class="overview-stat" onclick={() => go('cameras')}><span class="stat-icon cameras" aria-hidden="true"><NavIcon kind="camera" /></span><span>Cámaras registradas</span><div><strong>{cameras.length}</strong><i aria-hidden="true">↗</i></div><small>{activeCameraCount} en análisis actualmente</small><div class="stat-note">Ver cámaras →</div></button>
          <button class="overview-stat" onclick={() => go('monitor')}><span class="stat-icon signal" aria-hidden="true">◉</span><span>Señal disponible</span><div><strong>{activeTransmissionCount}</strong><i aria-hidden="true">↗</i></div><small>{cameraCoverage}% de cobertura operativa</small><div class="stat-note">Ver monitoreo →</div></button>
          <button class="overview-stat" onclick={() => go('detections')}><span class="stat-icon detections" aria-hidden="true">⌁</span><span>Detecciones registradas</span><div><strong>{dashboardDetectionTotal ?? 0}</strong><i aria-hidden="true">↗</i></div><small>{dashboardDetectionTotal === null ? 'No fue posible consultar el resumen de hoy' : 'Detecciones recibidas hoy · horario de Lima'}</small><div class="stat-note">Ver historial completo →</div></button>
          <button class="overview-stat alert-card" onclick={() => go('alerts')}><span class="stat-icon alerts" aria-hidden="true">!</span><span>Alertas por revisar</span><div><strong>{activeAlerts.length}</strong><i aria-hidden="true">!</i></div><small>{activeAlerts.length ? 'Requieren revisión del operador' : 'No hay incidentes activos'}</small><div class="stat-note">Ir a eventos →</div></button>
        </div>

        <section class="surface attention-panel overview-priority">
          <div class="overview-section-head"><div><h2>Atención prioritaria</h2><p>Eventos activos y fuentes que requieren revisión.</p></div><button class="text-btn" onclick={() => go(activeAlerts.length ? 'alerts' : 'cameras')}>Ver todo →</button></div>
          {#if activeAlerts.length}
            <div class="attention-list">{#each activeAlerts.slice(0, 3) as alert, index (alert.id ?? `${alert.camera}-${index}`)}<button onclick={() => go('alerts')}><span class="attention-mark">!</span><span><strong>{labelClass(alert.clase)}</strong><small>{alert.camera ?? 'Cámara no identificada'} · {fmtTime(alert.timestamp_inicio ?? alert.fecha_hora)}</small></span><span class="attention-chevron">→</span></button>{/each}</div>
          {:else if attentionCameras.length}
            <div class="attention-list">{#each attentionCameras.slice(0, 3) as item (item.id)}<button onclick={() => { selectedId = item.id; go('monitor'); }}><span class="attention-mark muted">◌</span><span><strong>{cameraLabel(item)}</strong><small>{sourceStatusLabel(inferenceByCamera[item.id]?.source, inferenceByCamera[item.id]?.available)}</small></span><span class="attention-chevron">→</span></button>{/each}</div>
          {:else}<div class="attention-empty"><span aria-hidden="true">✓</span><strong>Todo en orden</strong><p>No hay alertas activas ni cámaras sin señal.</p></div>{/if}
        </section>

        <div class="overview-workspace">
          <section class="surface recent-activity">
            <div class="overview-section-head"><div><h2>Actividad reciente</h2><p>Último resultado recibido por cada fuente.</p></div><button class="btn secondary" onclick={() => go('detections')}>Ver detecciones →</button></div>
            <div class="activity-list">
              {#each recentOverviewDetections as detection, index (detection.id ?? `${detection.fecha_hora}-${index}`)}
                <button class="activity-row" onclick={() => go('detections')}><time>{recentDateLabel(detection.fecha_hora ?? detection.created_at)}</time><span class="activity-symbol" aria-hidden="true">⌁</span><span><strong>{labelClass(detection.clase ?? detection.class_name)}</strong><small>{detection.camera ?? 'Cámara no identificada'}</small></span><em>{confidence(detection.confianza)}</em></button>
              {:else}<div class="overview-empty">Aún no hay resultados recientes. Cuando una fuente procese video, aparecerá aquí.</div>{/each}
            </div>
          </section>
          <div class="overview-analytics">
            <section class="surface distribution-card">
              <div class="overview-section-head"><div><h2>Detecciones por tipo</h2><p>Incidencias detectadas hoy · sin clasificaciones normales</p></div><button class="text-btn" onclick={() => go('detections')}>Ver →</button></div>
              {#if distributionTotal}
                <div class="distribution-content"><div class="donut" style={`background:conic-gradient(${distributionGradient})`}><div><strong>{distributionTotal}</strong><span>registros</span></div></div><div class="distribution-legend">{#each detectionDistribution as [type, count], index (type)}<div><i class={`legend-${index}`}></i><span>{type}</span><strong>{count}</strong></div>{/each}</div></div>
              {:else}<div class="chart-empty">Aún no hay incidencias de hoy para clasificar.</div>{/if}
            </section>
            <section class="surface hourly-card">
              <div class="overview-section-head"><div><h2>Actividad por hora</h2><p>Incidencias por hora · horario de Lima</p></div><button class="text-btn" onclick={() => go('detections')}>Ver →</button></div>
              {#if dashboardSummary}<div class="hour-chart" aria-label="Actividad de incidencias por hora">{#each hourlyActivity as item (item.hour)}<div class="hour-bar"><span title={`${item.hour}:00 — ${item.count} incidencias`} style={`height:${Math.max(4, (item.count / hourlyMaximum) * 100)}%`}></span>{#if item.hour % 3 === 0}<small>{String(item.hour).padStart(2, '0')}</small>{/if}</div>{/each}</div>{:else}<div class="chart-empty">Aún no hay detecciones de hoy para graficar.</div>{/if}
            </section>
          </div>
        </div>

        <div class="overview-bottom">
          <section class="surface system-overview">
            <h2>Estado del sistema</h2>
            <div class="system-overview-list">
              <div><span>Motor de inferencia</span><strong class:offline={!aiConnected}><i></i>{aiConnected ? 'En línea' : 'No disponible'}</strong></div>
              <div><span>Fuentes de video</span><strong class:offline={!activeTransmissionCount && cameras.length > 0}><i></i>{activeTransmissionCount} de {cameras.length} disponibles</strong></div>
              <div><span>Procesamiento de video</span><strong class:offline={!activeCameraCount && cameras.length > 0}><i></i>{activeCameraCount} de {cameras.length} en análisis</strong></div>
              <div><span>Actualización del panel</span><strong class:offline={!lastRefresh}><i></i>{lastRefresh ? 'Conectada' : 'Pendiente'}</strong></div>
            </div>
          </section>
        </div>

      {:else if view === 'cameras'}
        <section class="surface table-surface">
          <div class="section-title"><div><h2>Inventario de cámaras</h2><p>Fuentes registradas en este entorno</p></div><span class="pill neutral">{cameras.length ? `${cameras.length} ${cameras.length === 1 ? 'registro' : 'registros'}` : 'Sin registros'}</span></div>
          {#if loading}<div class="empty" role="status" aria-live="polite">Cargando cámaras...</div>
          {:else if !cameras.length}<div class="empty"><span class="placeholder-icon">▣</span><h3>Aún no hay cámaras</h3><p>Registra una transmisión para habilitar el monitor.</p><button class="btn primary" onclick={showRegistration}>Agregar cámara</button></div>
          {:else}
            <div class="table-scroll"><table class="camera-table"><caption class="sr-only">Inventario de cámaras registradas</caption><thead><tr><th scope="col">Cámara</th><th scope="col">Conexión</th><th scope="col">Estado de IA</th><th scope="col">Acciones</th></tr></thead>
              <tbody>{#each cameras as item (item.id)}<tr><td><div class="camera-identity"><span aria-hidden="true">▣</span><div><strong>{cameraLabel(item)}</strong><small>{item.name}</small></div></div></td><td><span class="connection-badge"><i></i> MediaMTX · WebRTC</span><small class="camera-path">/{item.streamPath ?? item.id}</small></td><td><span class:positive={cameraIsOnline(item.id)} class:waiting={isPending(inferenceByCamera[item.id]?.source)} class="pill camera-status"><i></i>{sourceStatusLabel(inferenceByCamera[item.id]?.source, inferenceByCamera[item.id]?.available)}</span>{#if sourceWorkerLabel(inferenceByCamera[item.id]?.source)}<small>{sourceWorkerLabel(inferenceByCamera[item.id]?.source)}</small>{/if}</td><td><div class="table-actions icon-actions"><button class="text-btn monitor-action icon-btn" onclick={() => selectCamera(item)} disabled={busy} aria-label={`Ver monitor de ${cameraLabel(item)}`} title="Ver monitor">◉</button><button class="text-btn icon-btn" onclick={(event) => showEditCamera(item, event)} disabled={busy} aria-label={`Editar ${cameraLabel(item)}`} title="Editar cámara">✎</button><button class="text-btn icon-btn" onclick={() => activateInference(item)} disabled={busy} aria-label={`Reintentar IA en ${cameraLabel(item)}`} title="Reintentar IA">↻</button>{#if isAdmin}<button class="text-btn destructive icon-btn" onclick={() => deleteCamera(item)} disabled={busy} aria-label={`Eliminar ${cameraLabel(item)}`} title="Eliminar cámara">×</button>{/if}</div></td></tr>{/each}</tbody>
            </table></div>
          {/if}
        </section>

      {:else if view === 'monitor'}
        {#if !camera}<div class="surface empty"><span class="placeholder-icon">▣</span><h3>Registra una cámara para empezar</h3><p>El reproductor aparecerá aquí una vez registrada una fuente.</p><button class="btn primary" onclick={() => { go('cameras'); showRegistration(); }}>Registrar cámara</button></div>
        {:else if !monitorExpanded}
          <div class="camera-wall">
            {#each paginatedMonitorCameras as item (item.id)}
              <section class="surface camera-tile">
                <div class="camera-tile-head"><h2>{cameraLabel(item)}</h2><span class:positive={cameraIsOnline(item.id) || playbackReadyByCamera[item.id]} class:waiting={isPending(inferenceByCamera[item.id]?.source) && !playbackReadyByCamera[item.id]} class="pill">{monitorStatusLabel(item.id)}</span></div>
                <div class="tile-stream">
                  <iframe src={item.url} title={`Video de ${item.name}`} onload={() => markPlaybackReady(item.id)} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
                  <span class="source-mark" aria-hidden="true">SOURCE&nbsp;&nbsp;/&nbsp;&nbsp;CCTV</span>
                </div>
                <div class="camera-tile-foot">
                  <span class="tile-detection">{latestFor(item.id) ? `${labelClass(latestFor(item.id)?.clase ?? latestFor(item.id)?.class_name)} · ${confidence(latestFor(item.id)?.confianza)}` : 'Esperando predicción'}</span>
                  <button class="btn secondary" onclick={() => expandCamera(item)}>Ampliar</button>
                </div>
              </section>
            {/each}
          </div>
          {#if cameras.length > MONITOR_PAGE_SIZE}
            <nav class="pagination-bar monitor-pagination" aria-label="Paginación de cámaras del monitor">
              <span>Mostrando {(currentMonitorPage - 1) * MONITOR_PAGE_SIZE + 1}–{Math.min(currentMonitorPage * MONITOR_PAGE_SIZE, cameras.length)} de {cameras.length} cámaras</span>
              <div><button class="text-btn" onclick={() => monitorPage = Math.max(1, currentMonitorPage - 1)} disabled={currentMonitorPage === 1}>← Anterior</button><strong>Página {currentMonitorPage} de {monitorPageCount}</strong><button class="text-btn" onclick={() => monitorPage = Math.min(monitorPageCount, currentMonitorPage + 1)} disabled={currentMonitorPage === monitorPageCount}>Siguiente →</button></div>
            </nav>
          {/if}
        {:else}
          <div class="monitor-grid">
            <section class="surface stream-surface">
              <div class="section-title"><div><h2>{cameraLabel(camera)}</h2></div><div class="stream-actions"><button class="text-btn" onclick={() => showPlayer = !showPlayer}>{showPlayer ? 'Ocultar' : 'Mostrar'}</button><a class="external" href={camera.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir transmisión original de ${camera.name} en una nueva ventana`}>Abrir original ↗</a></div></div>
              <div class="stream">
                {#if showPlayer}{#key camera.id}<iframe src={camera.url} title={`Video de ${camera.name}`} onload={() => markPlaybackReady(camera.id)} allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>{/key}
                {:else}<div class="stream-paused"><span>◉</span><strong>Reproductor oculto</strong><p>La inferencia continúa en el servidor mientras esté activa.</p></div>{/if}
              </div>
              <div class="stream-footer"><span><span class="led live"></span> Fuente registrada</span><span>La reproducción se conecta directamente a AWS</span></div>
            </section>
            <div class="monitor-aside">
              <section class="surface"><div class="section-title"><div><h2>Estado del análisis</h2></div><span class:positive={aiReceiving} class="pill">{aiReceiving ? 'Analizando' : aiConnected ? 'Conectada' : 'No disponible'}</span></div>
                <div class="metric-list"><div><span>Estado técnico del receptor</span><strong>{source?.status ?? '—'}</strong></div><div><span>Estado del incidente</span><strong class:positive={liveIncident} class:offline={!liveIncident && !liveClosing} class:waiting={liveClosing}><i></i>{liveClosing ? 'Finalizando…' : liveIncident ? 'Incidente activo' : 'Sin incidente'}</strong></div><div><span>Puntaje de anomalía VadCLIP</span><strong>{liveAnomalyScore == null ? '—' : confidence(liveAnomalyScore)}</strong></div><div><span>Fotogramas recibidos</span><strong>{source?.frames_received ?? '—'}</strong></div><div><span>Último procesamiento</span><strong>{latestProcessingMs == null ? '—' : `${Number(latestProcessingMs).toFixed(2)} ms`}</strong></div><div><span>Último fotograma</span><strong>{source?.last_frame_age_seconds == null ? '—' : `${source.last_frame_age_seconds} s`}</strong></div></div>
                <button class="btn secondary full" onclick={() => activateInference()} disabled={busy}>{busy ? 'Solicitando...' : 'Activar / reintentar análisis'}</button>
              </section>
              <section class="surface"><div class="section-title"><div><h2>Clasificación en vivo</h2></div><span class:positive={liveIncident} class:waiting={liveClosing} class="pill">{liveClosing ? 'Finalizando…' : liveIncident ? 'Incidente activo' : 'Sin incidente'}</span></div>
                {#if liveIncident && latest}<div class="prediction-label">{labelClass(latest.clase)}</div><div class="prediction-confidence"><span>Confianza VideoMAE <strong>{confidence(latest.confianza)}</strong></span><span>Anomalía VadCLIP <strong>{liveAnomalyScore == null ? '—' : confidence(liveAnomalyScore)}</strong></span></div><div class="tiny">{fmtDate(latest.fecha_hora)}</div>
                {:else}<div class="placeholder compact"><span class="placeholder-icon">◎</span><strong>{liveClosing ? 'Finalizando incidente…' : 'Sin incidente activo'}</strong><p>Anomalía VadCLIP: <strong>{liveAnomalyScore == null ? '—' : confidence(liveAnomalyScore)}</strong></p></div>{/if}
              </section>
            </div>
          </div>
        {/if}

      {:else if view === 'detections'}
        <section class="surface">
          <div class="section-title"><div><h2>Historial de detecciones</h2><p>Resultados paginados desde FastAPI; no se descargan durante el monitoreo.</p></div><span class="pill neutral">{detectionTotal ?? filteredDetections.length} resultados</span></div>
          <div class="filters"><label>Buscar acción<input placeholder="Buscar clasificación" bind:value={query} oninput={() => detectionPage = 1}/></label><label>Acción estimada<select bind:value={actionFilter} onchange={() => detectionPage = 1}><option value="all">Todas las acciones</option><option value="normal">Normal</option><option value="hurto">Hurto</option><option value="robo">Robo</option><option value="agresion_fisica">Agresión física</option><option value="vandalismo">Vandalismo</option></select></label><label>Desde<input type="date" bind:value={since} onchange={() => detectionPage = 1}/></label><label>Hasta<input type="date" bind:value={until} onchange={() => detectionPage = 1}/></label></div>
          <div class="table-scroll"><table><caption class="sr-only">Historial de detecciones</caption><thead><tr><th scope="col">Fecha y hora</th><th scope="col">Cámara</th><th scope="col">Acción estimada</th><th scope="col">Confianza</th></tr></thead><tbody>
            {#each paginatedDetections as detection, i (detection.id ?? `${detection.camera}-${detection.fecha_hora}-${i}`)}<tr><td>{fmtDate(detection.fecha_hora)}</td><td>{detection.camera ?? '—'}</td><td><strong>{labelClass(detection.clase)}</strong></td><td>{confidence(detection.confianza)}</td></tr>
            {:else}<tr><td colspan="4" class="table-empty">{detectionsLoading ? 'Consultando detecciones…' : aiConnected ? 'No hay detecciones para los filtros seleccionados.' : 'Sin registros disponibles. Verifica la conexión con FastAPI.'}</td></tr>{/each}
          </tbody></table></div>
          {#if filteredDetections.length > 0}
            <nav class="pagination-bar detection-pagination" aria-label="Paginación de detecciones">
              <span>Mostrando {(currentDetectionPage - 1) * DETECTION_PAGE_SIZE + 1}–{Math.min((currentDetectionPage - 1) * DETECTION_PAGE_SIZE + filteredDetections.length, detectionTotal ?? filteredDetections.length)} de {detectionTotal ?? filteredDetections.length} detecciones</span>
              <div><button class="text-btn" onclick={() => { detectionPage = Math.max(1, currentDetectionPage - 1); refreshDetections(); }} disabled={currentDetectionPage === 1}>← Anterior</button><strong>Página {currentDetectionPage} de {detectionPageCount}</strong><button class="text-btn" onclick={() => { detectionPage = Math.min(detectionPageCount, currentDetectionPage + 1); refreshDetections(); }} disabled={currentDetectionPage === detectionPageCount}>Siguiente →</button></div>
            </nav>
          {/if}
          <p class="footnote">Las detecciones de todas las cámaras se organizan en páginas de {DETECTION_PAGE_SIZE} registros.</p>
        </section>

      {:else if view === 'alerts'}
        <AlertsView {alerts} {cameras} loading={alertsLoading} error={alertsError} onRefresh={() => refreshAlerts({ force: true })} onDetail={showAlertDetail} page={currentAlertPage} pageCount={alertPageCount} total={alertTotal ?? alerts.length} onPageChange={(page: number) => { alertPage = page; refreshAlerts(); }} formatDate={fmtDate} {duration} {confidence} {labelClass} {statusLabel} />

      {:else if view === 'service'}
        <div class="stats performance-stats"><div class="stat"><small>Tiempo promedio</small><strong class="stat-word">{averageProcessingMs == null ? '—' : `${averageProcessingMs.toFixed(2)} ms`}</strong><span>{processingTimes.length} ejecuciones con tiempo registrado</span></div><div class="stat"><small>Tiempo mínimo</small><strong class="stat-word">{minimumProcessingMs == null ? '—' : `${minimumProcessingMs.toFixed(2)} ms`}</strong><span>Menor tiempo de los filtros actuales</span></div><div class="stat"><small>Tiempo máximo</small><strong class="stat-word">{maximumProcessingMs == null ? '—' : `${maximumProcessingMs.toFixed(2)} ms`}</strong><span>Mayor tiempo de los filtros actuales</span></div><div class="stat"><small>Errores registrados</small><strong>{filteredServiceLogs.filter((log) => String(log.level).toUpperCase() === 'ERROR').length}</strong><span>{filteredServiceLogs.length} registros visibles</span></div></div>
        <section class="surface table-surface">
          <div class="section-title"><div><h2>Historial técnico de inferencia</h2><p>Ejecuciones, errores, eventos y tiempos guardados por el servicio</p></div><button class="btn secondary" onclick={refreshServiceLogs} disabled={serviceLogsLoading}>{serviceLogsLoading ? 'Consultando...' : '↻ Actualizar'}</button></div>
          <div class="log-filters">
            <label>Buscar<input placeholder="Evento, mensaje, sesión o ventana" bind:value={logQuery} oninput={() => logPage = 1}/></label>
            <label>Nivel<select bind:value={logLevel} onchange={() => logPage = 1}><option value="all">Todos los niveles</option><option value="INFO">INFO</option><option value="WARNING">WARNING</option><option value="ERROR">ERROR</option><option value="DEBUG">DEBUG</option><option value="CRITICAL">CRITICAL</option></select></label>
            <label>Cámara<select bind:value={logCamera} onchange={() => logPage = 1}><option value="all">Todas las cámaras</option>{#each [...new Set(serviceLogs.map((log) => log.camera).filter(Boolean))] as cameraId}<option value={cameraId}>{cameraId}</option>{/each}</select></label>
          </div>
          {#if serviceLogsError}<div class="banner error logs-error"><strong>No se pudieron consultar los logs</strong><span>{serviceLogsError}</span></div>{/if}
          <div class="table-scroll"><table class="logs-table"><caption class="sr-only">Historial técnico de inferencia</caption><thead><tr><th scope="col">Fecha y hora</th><th scope="col">Nivel</th><th scope="col">Cámara</th><th scope="col">Tipo de evento</th><th scope="col">Rendimiento</th><th scope="col">Mensaje</th></tr></thead><tbody>
            {#each paginatedServiceLogs as log, i (log.id ?? `${log.fecha_hora}-${i}`)}<tr><td class="log-time">{fmtDate(log.fecha_hora)}</td><td><span class:error-level={String(log.level).toUpperCase() === 'ERROR'} class:warning-level={String(log.level).toUpperCase() === 'WARNING'} class="log-level">{log.level ?? '—'}</span></td><td>{log.camera ?? '—'}</td><td><strong>{log.event_type ?? '—'}</strong>{#if log.session_id}<small>Sesión: {log.session_id}</small>{/if}{#if log.window_id}<small>Ventana: {log.window_id}</small>{/if}</td><td class="log-performance"><span>Proc. <strong>{log.processing_ms == null ? '—' : `${Number(log.processing_ms).toFixed(2)} ms`}</strong></span><span>IA <strong>{log.inference_ms == null ? '—' : `${Number(log.inference_ms).toFixed(2)} ms`}</strong></span></td><td class="log-message">{log.message ?? '—'}{#if log.detection_id}<small>Detección: {log.detection_id}</small>{/if}</td></tr>
            {:else}<tr><td colspan="6" class="table-empty">{serviceLogsLoading ? 'Consultando registros...' : serviceLogsError ? 'El servicio no está disponible. Usa “Actualizar” cuando FastAPI vuelva a responder.' : 'No hay registros en inference_logs para los filtros seleccionados.'}</td></tr>{/each}
          </tbody></table></div>
          {#if filteredServiceLogs.length > 0}
            <nav class="pagination-bar" aria-label="Paginación de registros técnicos">
              <span>Mostrando {(currentLogPage - 1) * LOG_PAGE_SIZE + 1}–{Math.min(currentLogPage * LOG_PAGE_SIZE, filteredServiceLogs.length)} de {filteredServiceLogs.length} registros</span>
              <div><button class="text-btn" onclick={() => logPage = Math.max(1, currentLogPage - 1)} disabled={currentLogPage === 1}>← Anterior</button><strong>Página {currentLogPage} de {logPageCount}</strong><button class="text-btn" onclick={() => logPage = Math.min(logPageCount, currentLogPage + 1)} disabled={currentLogPage === logPageCount}>Siguiente →</button></div>
            </nav>
          {/if}
          <p class="footnote logs-note">Esta vista presenta únicamente datos de <code>inference_logs</code>. Las detecciones y alertas permanecen almacenadas y consultadas por separado.</p>
        </section>
      {/if}
    </main>
    <footer>SentriX <span>·</span> Centro de monitoreo <span class="footer-right">Prototipo de integración · MediaMTX + FastAPI</span></footer>
  </div>
</div>

{#if selectedAlert}
  <AlertDetailDialog alert={selectedAlert} {clip} loading={clipLoading} error={clipError} onClose={closeAlertDetail} formatDate={fmtDate} {duration} {labelClass} {statusLabel} />
{/if}
{/if}

{#if modal}
  <div class="modal-overlay" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) closeRegistration(); }}>
    <div class="dialog" bind:this={dialogElement} role="dialog" tabindex="-1" aria-modal="true" aria-labelledby="modal-title" aria-describedby="modal-description" onkeydown={handleDialogKeydown}>
      <div class="dialog-top"><div><div class="eyebrow">CONFIGURACIÓN DE FUENTE</div><h2 id="modal-title">{editingCamera ? 'Editar cámara' : 'Registrar cámara'}</h2><p id="modal-description">{editingCamera ? 'Actualiza el nombre o la transmisión vinculada.' : 'Vincula una transmisión existente de MediaMTX.'}</p></div><button class="close" type="button" aria-label="Cerrar" onclick={closeRegistration}>×</button></div>
      <form onsubmit={registerCamera} novalidate>
        <label for="name">Nombre de la cámara <span>*</span></label><input id="name" data-dialog-initial-focus required maxlength="100" bind:value={name} placeholder="Ej. Cámara de entrada" />
        <label for="url">Dirección WebRTC segura <span>*</span></label><input id="url" type="url" required pattern="https://.*" title="La dirección debe comenzar con https://" bind:value={url} placeholder="https://servidor/camera01/" />
        <p class="form-help">Por seguridad, solo se permiten direcciones que comiencen con <strong>https://</strong>.</p>
        {#if formError}<p class="form-error" role="alert">{formError}</p>{/if}
        <div class="info-note"><strong>Transmisión existente</strong><p>{editingCamera ? 'Si cambias la ruta, reinicia el análisis desde el inventario para aplicar la nueva fuente.' : 'La cámara debe estar publicando antes de registrarla. Si la ruta ya está registrada, SentriX asignará automáticamente un identificador diferente al nuevo registro.'}</p></div>
        <div class="modal-actions"><button type="button" class="btn secondary" onclick={closeRegistration} disabled={busy}>Cancelar</button><button type="submit" class="btn primary" disabled={busy}>{busy ? (editingCamera ? 'Aplicando cambios...' : 'Registrando...') : editingCamera ? 'Guardar cambios' : 'Registrar y activar IA'}</button></div>
      </form>
    </div>
  </div>
{/if}

<style>
  :global(*){box-sizing:border-box}
  :global(body){margin:0;background:#f5f7fb;color:#172a45;font-family:Inter,'Segoe UI',system-ui,sans-serif;font-size:14px}
  :global(button),:global(input),:global(select){font:inherit}
  :global(button){cursor:pointer}
  .auth-gate{min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(135deg,#edf5fb,#f8fbff)}.auth-gate section{width:min(100%,420px);padding:38px;border:1px solid #d9e5ef;border-radius:16px;background:#fff;box-shadow:0 16px 45px #143b641a;text-align:center}.auth-gate img{width:70px;height:70px;object-fit:contain}.auth-gate h1{margin:18px 0 8px;color:#0b315e;font-size:25px}.auth-gate p{color:#52708c;line-height:1.6}.auth-gate button{margin-top:10px;padding:10px 14px;border:0;border-radius:7px;background:#075dad;color:#fff;font-weight:750}
  .shell{min-height:100vh;display:flex}
  .sidebar{width:247px;flex-shrink:0;background:#0e2545;color:#eaf2fc;display:flex;flex-direction:column;min-height:100vh;position:sticky;top:0;height:100vh}
  .brand{display:flex;align-items:center;gap:11px;padding:28px 25px 26px;color:inherit;text-decoration:none;border-bottom:1px solid #294261}
  .brand strong{font-size:23px;font-weight:800;letter-spacing:-.8px;display:block;line-height:1.1}
  .brand small{display:block;color:#9fb9d3;font-size:10px;letter-spacing:.25px;margin-top:5px}
  .menu-label{font-weight:700;letter-spacing:1.8px;color:#7898bd;font-size:10px;padding:31px 24px 12px}
  nav{display:flex;flex-direction:column;gap:4px;padding:0 12px}
  nav button{display:flex;align-items:center;gap:12px;padding:13px 15px;width:100%;background:transparent;color:#adc3db;text-align:left;border:1px solid transparent;border-radius:8px;font-weight:560;font-size:13px}
  nav button:hover{background:#183758;color:white}
  nav button.current{background:#1d4c80;color:#fff;border-color:#2a6499;box-shadow:inset 3px 0 #45b6e5}
  .nav-icon{font-size:17px;width:22px;text-align:center;color:#8db8dd}
  nav button.current .nav-icon{color:#b7e7ff}
  .side-bottom{margin-top:auto;padding:20px 18px 24px;border-top:1px solid #294261}
  .system-state{display:flex;align-items:flex-start;gap:10px;padding:12px 9px;background:#173453;border-radius:9px}
  .system-state strong,.system-state small{display:block}.system-state strong{font-size:11px}.system-state small{color:#a3bbd1;font-size:10px;margin-top:5px;line-height:1.4}
  .side-bottom p{color:#718fac;font-size:10px;margin:17px 0 0 3px}
  .led{display:inline-block;flex-shrink:0;width:8px;height:8px;background:#8493a5;border-radius:50%;margin-top:3px}.led.live{background:#2eb99b;box-shadow:0 0 0 3px #2eb99b25}
  .workspace{flex:1;min-width:0;display:flex;flex-direction:column}
  .topbar{height:76px;padding:0 44px;background:white;border-bottom:1px solid #e6ebf2;display:flex;align-items:center;justify-content:space-between;gap:14px}
  .breadcrumb{color:#8392a6;letter-spacing:1.1px;font-size:10px;font-weight:750}.breadcrumb span{margin:0 11px;color:#c9d2df}.breadcrumb strong{color:#2f455f;letter-spacing:0;font-size:12px;font-weight:600}
  .topbar-right{display:flex;align-items:center;gap:12px}.avatar{width:33px;height:33px;border-radius:50%;background:#d9e6f4;color:#2b5279;display:grid;place-items:center;font-size:11px;font-weight:800}.operator{font-size:12px;color:#506780}.user-admin-link,.sign-out{border:1px solid #d4e1ec;border-radius:7px;background:#fff;color:#245c8c;padding:7px 9px;font-size:11px;font-weight:750;text-decoration:none}.sign-out{cursor:pointer}.user-admin-link:hover,.sign-out:hover{background:#eef6fc}
  main{max-width:1390px;width:100%;margin:0 auto;padding:46px 48px 68px;flex:1}
  .page-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:27px}.eyebrow{color:#6991ae;font-weight:800;letter-spacing:1.5px;font-size:10px}.page-head h1{margin:10px 0 7px;font-size:31px;letter-spacing:-.8px;line-height:1.2;font-weight:750}.subtitle{color:#7c8da2;margin:0;line-height:1.6;font-size:13px}
  .btn{border-radius:7px;padding:10px 15px;border:1px solid transparent;font-weight:650;font-size:12px;white-space:nowrap;transition:background .15s}.btn.primary{background:#1557a1;color:#fff}.btn.primary:hover{background:#0d447f}.btn.secondary{border-color:#d3deea;color:#2c4a6a;background:#fff}.btn.secondary:hover{background:#f1f6fa}.btn:disabled{opacity:.5;cursor:not-allowed}.btn.full{width:100%;margin-top:17px}
  .surface,.stat{background:#fff;border:1px solid #e1e8f0;border-radius:10px;box-shadow:0 3px 14px #122c4a06}.surface{padding:25px}.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin-bottom:22px}.stat{min-height:155px;padding:24px;display:flex;flex-direction:column;justify-content:space-between}.stat small{color:#75869b;font-size:12px;font-weight:600}.stat strong{font-size:34px;letter-spacing:-.5px;color:#133c69;font-variant-numeric:tabular-nums}.stat .stat-word{font-size:20px;letter-spacing:-.3px}.stat span{font-size:11px;color:#91a0b2}
  .section-title{display:flex;align-items:start;justify-content:space-between;gap:14px;margin-bottom:21px}.section-title h2{font-size:16px;margin:0;color:#1d3654;font-weight:750}.section-title p{font-size:12px;color:#8997a8;margin:6px 0 0}.pill{display:inline-flex;align-items:center;border-radius:5px;font-size:11px;font-weight:700;background:#fff4e8;color:#ac6a22;padding:6px 9px;white-space:nowrap}.pill.positive{background:#e5f6ef;color:#22835e}.pill.neutral{background:#eff3f8;color:#697f96}.pill.waiting{background:#fff4de;color:#916000}
  .placeholder,.empty{text-align:center;padding:43px 22px;color:#788ca3}.placeholder p,.empty p{font-size:12px;line-height:1.65;max-width:340px;margin:9px auto 18px}.placeholder-icon{font-size:32px;color:#9caec2;display:block;margin-bottom:10px}.placeholder.compact{padding:22px 5px}.tiny{font-size:11px;color:#8799ab}
  .table-surface{padding:0}.table-surface .section-title{padding:24px 25px 0}.table-scroll{width:100%;overflow:auto}table{width:100%;border-collapse:collapse;text-align:left;font-size:12px}thead{background:#f6f8fb;color:#71849c;font-size:11px}th{padding:15px 19px;font-weight:750;white-space:nowrap}td{padding:19px;border-top:1px solid #edf1f6;color:#5c7289;vertical-align:middle}td strong{display:block;color:#25405d;font-weight:700}td small{display:block;color:#879bb0;margin-top:5px}.source-type{font-size:11px}.table-actions{display:flex;flex-wrap:wrap;gap:5px}.text-btn{border:1px solid #dce6ef;background:white;border-radius:5px;color:#215681;font-size:11px;font-weight:650;padding:7px 9px}.text-btn:hover{background:#eef6ff}.text-btn.destructive{color:#b64d55;border-color:#f2d7da}.text-btn:disabled{opacity:.5}.table-empty{text-align:center;color:#95a2b3;padding:45px 15px}.empty{padding:65px 20px}.empty h3{margin:0;color:#2c4966;font-size:16px}
  .camera-table{min-width:940px}.camera-table thead{background:#eff5fb;color:#365875}.camera-table th{padding:14px 18px}.camera-table td{padding:17px 18px}.camera-table tbody tr{transition:background .15s}.camera-table tbody tr:hover{background:#f9fcff}.camera-identity{display:flex;align-items:center;gap:11px;min-width:180px}.camera-identity>span{display:grid;place-items:center;width:35px;height:35px;border-radius:9px;background:#e5f1fc;color:#1574c7;font-size:17px}.camera-identity strong{color:#173e68;font-size:13px}.camera-identity small{margin-top:3px;text-transform:capitalize}.connection-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;background:#edf5fb;color:#3d6d94;font-size:10px;font-weight:750}.connection-badge i{width:6px;height:6px;border-radius:50%;background:#1ba489}.camera-path{margin:5px 0 0 2px!important;color:#8ca0b4!important;font-size:10px!important}.camera-status{gap:6px;background:#fff3e5;color:#a7601c}.camera-status i{width:6px;height:6px;border-radius:50%;background:currentColor}.camera-status.positive{background:#e6f6ef;color:#158166}.camera-status.waiting{background:#fff5df;color:#986513}.registration-date{color:#617b93;font-size:11px;font-variant-numeric:tabular-nums}.monitor-action{border-color:#92bfe4;background:#eef7ff;color:#0865ae}.monitor-action:hover{background:#dfeffc}.camera-table .table-actions{flex-wrap:nowrap}.camera-table .text-btn{white-space:nowrap}
  .camera-table{min-width:940px}.camera-table thead{background:#eff5fb;color:#365875}.camera-table th{padding:14px 18px}.camera-table td{padding:17px 18px}.camera-table tbody tr{transition:background .15s}.camera-table tbody tr:hover{background:#f9fcff}.camera-identity{display:flex;align-items:center;gap:11px;min-width:180px}.camera-identity>span{display:grid;place-items:center;width:35px;height:35px;border-radius:9px;background:#e5f1fc;color:#1574c7;font-size:17px}.camera-identity strong{color:#173e68;font-size:13px}.camera-identity small{margin-top:3px;text-transform:capitalize}.connection-badge{display:inline-flex;align-items:center;gap:6px;padding:6px 8px;border-radius:6px;background:#edf5fb;color:#3d6d94;font-size:10px;font-weight:750}.connection-badge i{width:6px;height:6px;border-radius:50%;background:#1ba489}.camera-path{margin:5px 0 0 2px!important;color:#8ca0b4!important;font-size:10px!important}.camera-status{gap:6px;background:#fff3e5;color:#a7601c}.camera-status i{width:6px;height:6px;border-radius:50%;background:currentColor}.camera-status.positive{background:#e6f6ef;color:#158166}.camera-status.waiting{background:#fff5df;color:#986513}.registration-date{color:#617b93;font-size:11px;font-variant-numeric:tabular-nums}.monitor-action{border-color:#92bfe4;background:#eef7ff;color:#0865ae}.monitor-action:hover{background:#dfeffc}.camera-table .table-actions{flex-wrap:nowrap}.camera-table .text-btn{white-space:nowrap}.icon-actions{gap:7px}.camera-table .icon-btn{display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:7px;font-size:16px;line-height:1}.camera-table .icon-btn.destructive{font-size:20px;font-weight:500}
  .monitor-grid{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(270px,.82fr);align-items:start;gap:21px}.monitor-aside{display:flex;flex-direction:column;gap:20px}.stream-surface{padding:20px}.stream{background:#061326;aspect-ratio:16/9;border-radius:7px;overflow:hidden}.stream iframe{width:100%;height:100%;border:0;display:block}.stream-paused{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#b6cce0}.stream-paused span{font-size:50px;color:#4e7ea5}.stream-paused p{font-size:12px;text-align:center;padding:0 20px}.stream-footer{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:16px;color:#7c91a5;font-size:11px}.stream-footer>span{display:flex;align-items:center;gap:7px}.stream-footer .led{margin:0}.external{font-size:11px;color:#21609a;text-decoration:none;white-space:nowrap}.metric-list{display:flex;flex-direction:column}.metric-list>div{border-bottom:1px solid #eef1f5;padding:12px 0;display:flex;justify-content:space-between;gap:10px}.metric-list span{font-size:11px;color:#8596a9}.metric-list strong{font-size:12px;color:#32516c;text-align:right}.metric-list strong i{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%;background:currentColor}.metric-list strong.positive{color:#08705f}.metric-list strong.offline{color:#a65255}.metric-list strong.waiting{color:#a26a17}.prediction-label{font-size:24px;font-weight:800;text-transform:capitalize;margin-top:24px;color:#1c557e}.prediction-confidence{display:flex;justify-content:space-between;gap:10px;padding:16px 0;color:#71879d;font-size:12px}.prediction-confidence>span{display:flex;flex-direction:column;gap:5px}.prediction-confidence strong{color:#1f8b68}
  .camera-wall{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:26px}.camera-tile{padding:17px 17px 18px;border-radius:13px}.camera-tile-head,.camera-tile-foot{display:flex;align-items:center;justify-content:space-between;gap:16px}.camera-tile-head{padding:3px 6px 17px}.camera-tile-head h2{margin:0;color:var(--sx-ink);font-size:17px}.camera-tile-head .pill{background:#edf3f8;color:#56708b}.camera-tile-head .pill.positive{background:#e5f6ef;color:#168267}
  .tile-stream{position:relative;aspect-ratio:16/9;background:#0d2a43;border-radius:9px;overflow:hidden}.tile-stream iframe{width:100%;height:100%;border:0;display:block}.source-mark{position:absolute;left:18px;top:15px;color:#71b0d4;font-size:9px;letter-spacing:1.5px;pointer-events:none;text-shadow:0 1px 2px #071a2c}
  .camera-tile-foot{padding:15px 4px 1px}.tile-detection{padding-left:10px;border-left:3px solid #e9ad43;color:#58738f;font-size:12px}.camera-tile-foot .btn{padding:9px 14px;font-size:12px}.stream-actions{display:flex;align-items:center;gap:12px}
  .filters{display:grid;grid-template-columns:1.2fr 1fr 1fr 1fr;gap:13px;margin-bottom:22px}.filters label{display:flex;flex-direction:column;gap:9px;color:#415d78;font-size:11px;font-weight:700}.filters input,.filters select,.dialog input{width:100%;min-width:0;padding:11px 12px;border:1px solid #d7e1ec;border-radius:6px;background:#fff;color:#23415e;font-size:12px;outline:none}.filters input:focus,.filters select:focus,.dialog input:focus{border-color:#377ab4;box-shadow:0 0 0 3px #9bd5ff3d}.footnote{font-size:11px;color:#8b9aac;line-height:1.6;margin:18px 0 0}
  .banner{display:flex;align-items:center;gap:12px;padding:13px 16px;margin-bottom:21px;border:1px solid #eed9ce;border-radius:7px;font-size:12px;background:#fff7f2;color:#8c5038;overflow-wrap:anywhere}.banner strong{flex-shrink:0}.banner span{flex:1}.banner button{border:0;background:transparent;font-size:21px;color:inherit;margin-left:auto}.banner.success{border-color:#cbe9d9;background:#f1fbf6;color:#2e7255}.banner.connecting{border-color:#c8dff1;background:#f0f7fd;color:#275f8e}
  footer{padding:19px 48px;background:#fff;border-top:1px solid #e6edf4;color:#95a4b4;font-size:10px}footer span{margin:0 7px}.footer-right{float:right}
  .modal-overlay{position:fixed;inset:0;background:#0b1c32a8;display:flex;justify-content:center;align-items:center;padding:18px;z-index:50}.dialog{background:white;width:100%;max-width:530px;border-radius:12px;padding:28px;box-shadow:0 25px 85px #07182f55;max-height:95vh;overflow:auto}.dialog-top{display:flex;justify-content:space-between;gap:15px}.dialog h2{font-size:24px;margin:8px 0}.dialog p{color:#8396aa;font-size:12px;margin:0 0 25px}.close{align-self:start;background:none;border:0;color:#8193a5;font-size:28px}.dialog form{display:flex;flex-direction:column;gap:9px}.dialog label{font-size:12px;color:#294760;font-weight:700;margin-top:10px}.dialog label span{color:#c34e56}.dialog input{font-size:13px;padding:12px}.dialog .form-help{margin:0;color:#657f99;font-size:11px;line-height:1.5}.info-note{background:#eff6fe;border:1px solid #d9e8f7;border-radius:7px;padding:15px;margin-top:14px}.info-note strong{font-size:12px;color:#265c90}.info-note p{margin:6px 0 0;line-height:1.6;color:#527394}.modal-actions{display:flex;justify-content:end;gap:9px;margin-top:19px}
  @media(max-width:1200px){main{padding:35px 26px 55px}.topbar{padding:0 26px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.monitor-grid{grid-template-columns:1fr}.monitor-aside{display:grid;grid-template-columns:1fr 1fr}.filters{grid-template-columns:repeat(2,minmax(0,1fr))}}
  @media(max-width:1050px){.sidebar{width:72px}.brand{padding:20px 14px;justify-content:center}.brand>span:nth-child(2),.menu-label,.nav-icon+span,.side-bottom{display:none}nav{padding:20px 8px}nav button{justify-content:center;padding:13px 9px}.nav-icon{font-size:21px}.topbar{height:64px}.operator{display:none}}
  @media(max-width:580px){.sidebar{width:58px}.brand{padding:14px 7px}.page-head{align-items:start;flex-direction:column}.page-head h1{font-size:25px}.stats{grid-template-columns:1fr 1fr}.stat{padding:16px;min-height:125px}.stat strong{font-size:27px}.stat .stat-word{font-size:15px}.monitor-aside{grid-template-columns:1fr}.filters{grid-template-columns:1fr}.stream-footer{flex-direction:column;align-items:start}main{padding:25px 13px}.surface{padding:17px}.topbar{padding:0 13px}.breadcrumb{font-size:8px}footer{padding:14px}.footer-right{display:none}.dialog{padding:20px}}

  /* Identidad visual SentriX: solo presentación, sin cambios de comportamiento. */
  :global(:root){--sx-navy:#06275a;--sx-navy-deep:#041b43;--sx-blue:#075fd3;--sx-blue-hover:#064da9;--sx-cyan:#12d7f2;--sx-canvas:#f3f6fe;--sx-ink:#092650;--sx-muted:#6d829c;--sx-line:#d9e4f1}
  :global(body){background:var(--sx-canvas);color:var(--sx-ink)}
  .sidebar{background:linear-gradient(180deg,var(--sx-navy) 0%,var(--sx-navy-deep) 100%);color:#eaf5ff;padding-top:76px}
  .brand{position:fixed;z-index:20;inset:0 auto auto 0;width:247px;height:76px;padding:6px 18px;background:#fff;border-right:0;border-bottom:1px solid #edf2f7;overflow:hidden}
  .brand-emblem{display:block;position:relative;width:53px;height:57px;overflow:hidden;flex:0 0 53px}
  .brand-emblem img{position:absolute;display:block;width:96px;height:96px;max-width:none;left:-21px;top:-7px}
  .brand-lockup{display:block;min-width:0}.brand .brand-lockup strong{display:block;color:var(--sx-navy);font-size:21px;font-weight:850;line-height:1;letter-spacing:-.7px}.brand .brand-lockup strong span{color:var(--sx-blue)}.brand .brand-lockup small{display:block;color:#54718f;font-size:6px;line-height:1.2;letter-spacing:.12px;margin-top:5px;white-space:nowrap}
  .menu-label{color:#8eb5df;padding-top:27px}
  nav button{color:#b9d0e8;font-weight:600;border-radius:7px}
  nav button:hover{background:#0a3977;color:#fff}
  nav button.current{background:#0c4d9a;color:#fff;border-color:#1b65b7;box-shadow:inset 3px 0 var(--sx-cyan)}
  .nav-icon{color:#a9cdeb}nav button.current .nav-icon{color:var(--sx-cyan)}
  .side-bottom{border-top-color:#204574}.system-state{background:#0b376d}
  .topbar{position:sticky;top:0;z-index:15;flex-shrink:0;background:#fff;border-bottom-color:#e2e9f2;justify-content:flex-end}.breadcrumb{display:none}
  main{padding-top:38px}.page-head h1{margin-top:0;color:var(--sx-ink);font-size:30px}.page-head .eyebrow{display:none}.subtitle{color:var(--sx-muted)}
  .btn{font-weight:700;transition:background .15s,box-shadow .15s,transform .15s}
  .btn.primary{background:var(--sx-blue);box-shadow:0 4px 10px #075fd31f}.btn.primary:hover{background:var(--sx-blue-hover);transform:translateY(-1px)}.btn:disabled{transform:none}
  .btn.secondary{border-color:#cddbea;color:#174b80}.btn.secondary:hover{background:#eef5ff;border-color:#a9c5e2}
  .surface,.stat{border-color:var(--sx-line);border-radius:9px;box-shadow:0 3px 12px #06275a08}.stat strong,.section-title h2{color:var(--sx-ink)}
  .pill.neutral{background:#edf3f9;color:#54708e}
  thead{background:#f2f6fb;color:#5c7694}td{border-top-color:#e7eef6;color:#526b84}td strong{color:#173c66}
  .text-btn{border-color:#d3e0ed;color:#0758a8;font-weight:700}.text-btn:hover{background:#eaf4ff;border-color:#a9c9e8}.text-btn.destructive{color:#c54652;border-color:#f0cbd0}
  .filters input,.filters select,.dialog input{border-color:#ccdaea;color:#173b61}.filters input:focus,.filters select:focus,.dialog input:focus{border-color:var(--sx-blue);box-shadow:0 0 0 3px #12d7f224}
  .info-note{background:#eef6ff;border-color:#d0e4f8}.info-note strong{color:#0758a8}
  .log-filters{display:grid;grid-template-columns:2fr 1fr 1fr;gap:13px;padding:0 25px 18px}.log-filters label{display:flex;flex-direction:column;gap:7px;color:#415d78;font-size:11px;font-weight:700}.log-filters input,.log-filters select{width:100%;min-width:0;padding:9px 11px;border:1px solid #ccdaea;border-radius:6px;background:#fff;color:#173b61;font-size:12px;outline:none}.log-filters input:focus,.log-filters select:focus{border-color:var(--sx-blue);box-shadow:0 0 0 3px #12d7f224}.logs-error{margin:0 25px 20px}.logs-table{min-width:940px;table-layout:fixed}.logs-table th{padding:13px 20px;background:#f0f5fb;color:#335775;letter-spacing:.1px}.logs-table td{padding:14px 20px;color:#4e6c88}.logs-table tbody tr{transition:background .15s}.logs-table tbody tr:hover{background:#f8fbfe}.logs-table th:nth-child(1){width:17%}.logs-table th:nth-child(2){width:8%}.logs-table th:nth-child(3){width:9%}.logs-table th:nth-child(4){width:16%}.logs-table th:nth-child(5){width:16%}.logs-table th:nth-child(6){width:34%}.log-time{font-variant-numeric:tabular-nums;white-space:nowrap}.log-level{display:inline-flex;padding:5px 8px;border-radius:5px;background:#e8f5ef;color:#267454;font-size:10px;font-weight:800}.log-level.warning-level{background:#fff3df;color:#a55e13}.log-level.error-level{background:#fff0f1;color:#bd3f4b}.log-performance{display:flex;flex-direction:column;gap:4px;color:#7890a6;font-size:10px}.log-performance span{display:flex;justify-content:space-between;gap:9px}.log-performance strong{display:inline;color:#2e587b;font-size:11px;font-variant-numeric:tabular-nums}.log-message{white-space:normal;line-height:1.45}.log-message small{margin-top:3px}.logs-note{padding:0 25px 16px}.logs-note code{color:#0758a8;background:#eef6ff;padding:2px 5px;border-radius:4px}
  .pagination-bar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding:14px 16px;border:1px solid #dfe8f1;border-radius:8px;background:#f8fbfe;color:#617b93;font-size:11px}.pagination-bar>div{display:flex;align-items:center;gap:10px}.pagination-bar strong{min-width:94px;text-align:center;color:#294d6d;font-size:11px;white-space:nowrap}.pagination-bar .text-btn{padding:8px 11px;border-radius:6px;background:#fff}.pagination-bar .text-btn:disabled{cursor:not-allowed;background:#f1f4f7;color:#9aaaba;border-color:#e2e8ee}.table-surface .pagination-bar{margin:0 25px 16px}.detection-pagination{margin:18px 0 0}

  /* Resumen general: presentación inspirada en el tablero operativo. */
  .demo-badge{align-self:flex-start;padding:10px 13px;border:1px solid #d5e1ec;border-radius:6px;background:#eef3f8;color:#506d89;font-size:12px}
  .overview-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;margin-bottom:24px}
  .overview-stat{position:relative;min-height:205px;padding:21px;background:#fff;border:1px solid var(--sx-line);border-radius:13px;box-shadow:0 3px 12px #06275a08;text-align:left;color:var(--sx-ink);overflow:hidden}
  .overview-stat:hover{border-color:#b8cde2;box-shadow:0 8px 24px #06275a0d}.overview-stat>span:not(.stat-icon){display:block;color:#45637e;font-size:12px;font-weight:750;margin:12px 0 10px}.stat-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:#e7f0fd;color:#1470d1;font-size:19px}.stat-icon.signal{background:#e5f7f2;color:#108b76}.stat-icon.detections{background:#e8f4fd;color:#1988c5}.stat-icon.alerts{background:#fff0e7;color:#c77737;font-weight:850}.overview-stat>div:not(.stat-note){display:flex;align-items:center;justify-content:space-between}.overview-stat strong{font-size:35px;line-height:1;font-weight:780;letter-spacing:-1px}.overview-stat>div>i{display:grid;place-items:center;width:31px;height:31px;border-radius:8px;background:#eef5fb;color:#3f759f;font-size:15px;font-style:normal}.overview-stat small{display:block;min-height:28px;margin-top:9px;color:#768da4;font-size:10px;line-height:1.35}.stat-note{margin-top:13px;color:#2b6da9;font-size:10px;font-weight:750}.overview-stat.alert-card strong{color:#a86528}
  .overview-workspace{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:22px;margin-bottom:25px}.recent-activity,.attention-panel,.distribution-card,.hourly-card{padding:24px;border-radius:13px}.overview-analytics{display:grid;gap:22px;align-content:start}.overview-section-head{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:18px}.overview-section-head h2,.system-overview h2{margin:0;color:var(--sx-ink);font-size:16px}.overview-section-head p{margin:5px 0 0;color:#71879d;font-size:11px}.overview-section-head .btn{padding:9px 12px;font-size:11px}.activity-list{display:flex;flex-direction:column}.activity-row{display:grid;grid-template-columns:55px 33px minmax(0,1fr) auto;align-items:center;gap:11px;width:100%;padding:12px 5px;border:0;border-top:1px solid #eaf0f5;background:transparent;text-align:left}.activity-row:first-child{border-top:0}.activity-row:hover{background:#f7fbff}.activity-row time{color:#678097;font-size:11px;font-variant-numeric:tabular-nums}.activity-symbol{display:grid;place-items:center;width:29px;height:29px;border-radius:8px;background:#e8f4fd;color:#2087c0;font-size:16px}.activity-row strong,.activity-row small{display:block}.activity-row strong{color:#254d74;font-size:12px;text-transform:capitalize}.activity-row small{margin-top:3px;color:#7890a6;font-size:10px}.activity-row em{color:#14856e;font-size:11px;font-style:normal;font-weight:800}.overview-empty{text-align:center;color:#8194a8!important;padding:38px!important}.distribution-content{display:flex;align-items:center;gap:24px;min-height:148px}.donut{position:relative;display:grid;place-items:center;flex:0 0 132px;width:132px;height:132px;border-radius:50%}.donut:before{content:"";position:absolute;inset:24px;border-radius:50%;background:#fff}.donut>div{position:relative;text-align:center}.donut strong,.donut span{display:block}.donut strong{color:#183e66;font-size:26px;letter-spacing:-1px}.donut span{margin-top:2px;color:#7890a6;font-size:9px}.distribution-legend{display:grid;flex:1;gap:8px}.distribution-legend>div{display:grid;grid-template-columns:9px minmax(0,1fr) auto;gap:7px;align-items:center;color:#607a93;font-size:10px}.distribution-legend i{width:8px;height:8px;border-radius:50%;background:#1477db}.distribution-legend i.legend-1{background:#12a9cf}.distribution-legend i.legend-2{background:#3472bd}.distribution-legend i.legend-3{background:#efaa43}.distribution-legend i.legend-4{background:#72869b}.distribution-legend strong{color:#315674;font-size:11px}.hour-chart{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));align-items:end;gap:4px;height:115px;padding:7px 2px 20px;border-bottom:1px solid #dce7f0}.hour-bar{position:relative;display:flex;align-items:end;height:100%}.hour-bar span{display:block;width:100%;min-height:3px;border-radius:3px 3px 0 0;background:linear-gradient(180deg,#43a7f2,#1477db)}.hour-bar small{position:absolute;top:calc(100% + 5px);left:50%;color:#7890a6;font-size:8px;transform:translateX(-50%)}.chart-empty{display:grid;place-items:center;min-height:138px;border:1px dashed #d7e2ec;border-radius:8px;color:#758ba1;font-size:11px;text-align:center;padding:15px}.attention-list{display:flex;flex-direction:column}.attention-list button{display:grid;grid-template-columns:30px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;padding:12px 0;border:0;border-top:1px solid #eaf0f5;background:transparent;text-align:left}.attention-list button:first-child{border-top:0}.attention-list button:hover strong{color:#0870c4}.attention-mark{display:grid;place-items:center;width:27px;height:27px;border-radius:8px;background:#fff0e8;color:#c97636;font-size:14px;font-weight:850}.attention-mark.muted{background:#edf3f8;color:#748ca2}.attention-list strong,.attention-list small{display:block}.attention-list strong{color:#294e71;font-size:11px;text-transform:capitalize}.attention-list small{overflow:hidden;margin-top:3px;color:#7890a6;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.attention-chevron{color:#6b8aa3;font-size:14px}.attention-empty{text-align:center;padding:24px 5px;color:#71879d}.attention-empty>span{display:grid;place-items:center;width:38px;height:38px;margin:0 auto 9px;border-radius:50%;background:#e6f7f1;color:#10866f;font-size:19px;font-weight:800}.attention-empty strong{display:block;color:#275373;font-size:13px}.attention-empty p{margin:5px 0 0;font-size:11px;line-height:1.45}
  .overview-priority{margin:0 0 25px;padding:20px 24px}.overview-bottom{display:grid;grid-template-columns:1fr;gap:26px}.overview-bottom>.surface{border-radius:13px;padding:30px}
  .system-overview-list{margin-top:26px}.system-overview-list>div{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:17px 0;border-bottom:1px solid #e7edf3;font-size:14px}.system-overview-list>div:last-child{border-bottom:0}
  .system-overview-list strong{display:flex;align-items:center;gap:10px;color:#08705f;font-size:13px}.system-overview-list strong i{width:7px;height:7px;border-radius:50%;background:currentColor}.system-overview-list strong.offline{color:#a65255}

  @media(max-width:1200px){.overview-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.camera-wall{gap:18px}}
  @media(max-width:1050px){.brand{width:72px;padding:8px;justify-content:center}.brand-emblem{width:52px;height:58px;flex-basis:52px}.brand-emblem img{width:96px;height:96px;left:-22px;top:-6px}.brand-lockup{display:none}}
  @media(max-width:900px){.camera-wall{grid-template-columns:1fr}.overview-workspace,.overview-bottom{grid-template-columns:1fr}.recent-activity{padding:20px}}
  @media(max-width:580px){.brand{width:58px;padding:7px}.brand-emblem{width:44px;height:50px;flex-basis:44px}.brand-emblem img{width:82px;height:82px;left:-19px;top:-5px}.log-filters{grid-template-columns:1fr;padding:0 17px 18px}.logs-error{margin:0 17px 18px}.logs-note{padding:0 17px 18px}.pagination-bar{align-items:flex-start;flex-direction:column;padding:13px}.pagination-bar>div{width:100%;justify-content:space-between;gap:6px}.table-surface .pagination-bar{margin:0 17px 16px}.overview-stats{grid-template-columns:1fr}.overview-stat{min-height:130px}.overview-section-head{align-items:flex-start;flex-direction:column}.overview-bottom>.surface{padding:22px}.system-overview-list>div{align-items:flex-start;flex-direction:column;gap:8px}.demo-badge{margin-top:4px}.camera-tile{padding:12px}.camera-tile-foot{align-items:flex-start}.stream-actions{gap:7px}}
/* Accesibilidad: foco visible y navegación por teclado (WCAG 2.2 AA). */
.skip-link { position: fixed; top: 12px; left: 16px; z-index: 1000; transform: translateY(-180%); padding: 10px 14px; border-radius: 8px; background: var(--sx-navy, #082957); color: #fff; font-weight: 700; transition: transform 160ms ease; }
.skip-link:focus { transform: translateY(0); }
:global(:focus-visible) { outline: 3px solid var(--sx-cyan, #00b8e6); outline-offset: 3px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
  /* Preferencias del usuario: reducción de movimiento y contraste reforzado. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; scroll-behavior: auto !important; transition-duration: 0.01ms !important; }
  }
  @media (prefers-contrast: more) {
    :global(body) { background: #fff; color: #000; }
    .surface, .stat, .overview-stat, .btn, .text-btn, .filters input, .filters select, .dialog input { border-color: currentColor; }
    .btn.primary, .overview-alert-button { background: #003f8f; color: #fff; }
    .pill, .pill.neutral { border: 1px solid currentColor; }
  }
  .btn, .text-btn, .close, nav button { min-height: 24px; min-width: 24px; }
  /* Panel visible de preferencias de accesibilidad. */
  .accessibility-trigger{display:inline-flex;align-items:center;gap:8px;min-height:38px;padding:5px 10px 5px 6px;border:1px solid #a9c5e2;border-radius:20px;color:#174b80;background:#fff;font-weight:750;font-size:12px}.accessibility-trigger:hover,.accessibility-trigger[aria-expanded="true"]{background:#eaf4ff;border-color:#075fd3}.accessibility-mark{width:27px;height:27px;display:grid;place-items:center;border-radius:50%;background:#075fd3}.accessibility-mark svg{width:24px;height:24px;fill:none;stroke:#fff;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}.accessibility-mark svg>circle:first-child{fill:#075fd3;stroke:#12d7f2}.accessibility-mark .person-head{fill:#fff;stroke:none}
  .accessibility-panel{position:fixed;z-index:70;top:0;right:0;width:min(430px,100vw);height:100dvh;overflow:auto;padding:0 18px 22px;background:#f1f4f8;color:#092650;box-shadow:-18px 0 44px #041b4352}.accessibility-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 -18px 16px;padding:21px 20px 18px;background:linear-gradient(135deg,#06275a,#075fd3);color:#fff}.a11y-kicker{margin:0 0 4px!important;color:#9fe9f7!important;font-size:10px!important;font-weight:800!important;letter-spacing:1.5px}.accessibility-panel h2{margin:0;font-size:21px;line-height:1.15}.a11y-close{width:44px;height:44px;border:2px solid #b9eafa;border-radius:50%;background:#0b4ead;color:#fff;font-size:33px;line-height:1}.a11y-intro{margin:0 3px 15px;color:#46627e;font-size:13px;line-height:1.45}.a11y-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.a11y-grid button{min-height:132px;padding:14px 10px;border:2px solid transparent;border-radius:13px;background:#fff;color:#092650;box-shadow:0 2px 7px #06275a10;font-weight:750;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:9px;text-align:center}.a11y-grid button>span{font-size:35px;line-height:1;font-family:Arial,sans-serif}.a11y-grid button strong{font-size:14px;line-height:1.15}.a11y-grid button small{color:#54718f;font-size:11px}.a11y-grid button:hover,.a11y-grid button.active{border-color:#075fd3;background:#f7fbff}.a11y-grid button.active{box-shadow:inset 0 0 0 1px #12d7f2}.a11y-reader-note{margin:15px 0;padding:13px 14px;border:1px solid #badce8;border-radius:10px;background:#e8f7fa}.a11y-reader-note strong{font-size:14px}.a11y-reader-note p{margin:5px 0 0;color:#365b70;font-size:12px;line-height:1.45}.a11y-reset{width:100%;min-height:48px;border:0;border-radius:10px;background:#075fd3;color:#fff;font-size:14px;font-weight:800}.a11y-reset span{font-size:22px;vertical-align:-2px;margin-right:6px}
  /* Estos ajustes afectan el contenido completo del panel, no solo el menú. */
  .shell.a11y-high-contrast{filter:contrast(1.4) saturate(.9)}.shell.a11y-high-contrast .surface,.shell.a11y-high-contrast .stat,.shell.a11y-high-contrast .overview-stat,.shell.a11y-high-contrast table,.shell.a11y-high-contrast .dialog{border-color:#000;box-shadow:none}.shell.a11y-high-contrast .sidebar{background:#000}.shell.a11y-high-contrast .btn.primary,.shell.a11y-high-contrast .overview-alert-button{background:#002f6b;color:#fff}.shell.a11y-reduced-motion *{animation:none!important;transition:none!important;scroll-behavior:auto!important}.shell.a11y-text-large{zoom:1.15}.shell.a11y-text-xlarge{zoom:1.3}.shell.a11y-dyslexia{font-family:Verdana,Arial,sans-serif;letter-spacing:.025em;word-spacing:.1em}.shell.a11y-dyslexia :is(p,td,.subtitle,.footnote,.tiny){line-height:1.8!important}.shell.a11y-letter-spacing :is(p,td,th,.subtitle,.footnote,.tiny,.banner,.form-help){letter-spacing:.08em!important;word-spacing:.12em}.shell.a11y-aligned-text :is(p,td,th,.subtitle,.footnote,.tiny,.banner,.form-help){text-align:left!important;text-wrap:pretty}.shell.a11y-aligned-text :is(.event-card,.activity-row,.attention-list button,.metric-list>div){justify-items:start;text-align:left}
  @media(max-width:580px){.accessibility-trigger{font-size:0;padding:5px}.accessibility-trigger>span:last-child{display:none}.accessibility-panel{width:100vw}.shell.a11y-text-large,.shell.a11y-text-xlarge{zoom:1}}
  /* Correcciones Lighthouse: contraste AA para texto secundario sobre fondos claros. */
  .subtitle,.placeholder,.empty,.footnote,.tiny,.section-title p,.stat span,.table-empty,.overview-empty,.pagination-bar,.dialog p { color:#4a6178; }
  thead,.pagination-bar strong { color:#38546f; }
  .pill.neutral,.camera-tile-head .pill { color:#38546f; }
  .side-bottom p { color:#d3e2f0; }
  footer { color:#4a6178; }
  .source-mark { color:#b9e7ff; }
  .stream-footer,.metric-list span,.prediction-confidence { color:#526b84; }
  .mobile-nav-toggle{display:none;place-items:center;width:44px;height:44px;padding:0;border:1px solid #cddbea;border-radius:8px;background:#fff;color:#174b80;font-size:22px}
  /* Densidad y legibilidad del resumen: texto secundario AA y controles táctiles. */
  .overview-stat small,.overview-section-head p,.activity-row time,.activity-row small,.distribution-legend>div,.donut span,.hour-bar small,.chart-empty,.attention-list small,.attention-empty{color:#52677d;font-size:12px}
  .stat-note{font-size:12px}.overview-section-head .btn,.text-btn{min-height:44px}.overview-empty{padding:24px!important;color:#52677d!important}.activity-row{grid-template-columns:130px 33px minmax(0,1fr) auto}.activity-row strong,.attention-list strong{font-size:13px}.activity-row em{font-size:12px}.attention-list button{min-height:44px}
  @media(max-width:580px){.overview-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.overview-stat{min-height:164px;padding:16px}.overview-stat strong{font-size:29px}.activity-row{grid-template-columns:76px 30px minmax(0,1fr);gap:8px}.activity-row em{display:none}.activity-row time{font-size:10px}}
  @media(max-width:700px){.sidebar{display:none;position:fixed;z-index:80;inset:0 auto 0 0;width:min(280px,82vw);height:100dvh;padding-top:76px;box-shadow:16px 0 38px #041b4370}.sidebar.mobile-open{display:flex}.brand{position:absolute;width:100%}.mobile-nav-toggle{display:grid}.topbar{justify-content:space-between}.topbar-right{gap:7px}.topbar-right .operator{display:none}.topbar-right .avatar{display:none}.accessibility-trigger{margin-left:auto}main{padding-left:16px;padding-right:16px}}
  .filters label,.log-filters label { color:#294b6a; }
  .overview-stat>span { color:#4a6178; }
  .overview-empty { color:#4a6178 !important; }
  /* Logo: mostrar el emblema completo sin el recorte heredado del recurso grande. */
  .brand-emblem { width:52px; height:52px; flex:0 0 52px; overflow:visible; }
  .brand-emblem img { position:static; width:52px; height:52px; max-width:100%; object-fit:contain; }
  /* Encabezados consistentes para inventario, detecciones y registros. */
  thead,.camera-table thead{background:linear-gradient(90deg,#103662,#1e5b95);color:#fff}
  th,.camera-table th,.logs-table th{padding-top:13px;padding-bottom:13px;color:#fff;font-size:10px;font-weight:800;letter-spacing:.45px;text-transform:uppercase}
  @media(max-width:1050px){.brand-emblem{width:48px;height:48px;flex-basis:48px}.brand-emblem img{width:48px;height:48px}}
  @media(max-width:580px){.brand-emblem{width:42px;height:42px;flex-basis:42px}.brand-emblem img{width:42px;height:42px}}
  .form-error{margin:4px 0 0;padding:10px 12px;border:1px solid #efc9cb;border-radius:6px;background:#fff3f3;color:#a33f48;font-size:12px;font-weight:650}
  /* Encabezado del historial técnico: evita el blanco sobre gris de la regla heredada. */
  table.logs-table thead{background:linear-gradient(90deg,#082b60,#1469ac)}
  table.logs-table th{background:transparent!important;color:#fff!important;border:0;font-weight:800}
</style>

