-- Alinea una base existente con lo que el código declara al crear las tablas (reemplaza la del 28-10).
-- Idempotente: se puede ejecutar varias veces. Todo o nada: si un dato no cumple una regla, no cambia nada.
BEGIN;

DO $$
BEGIN
    -- detections: confianza entre 0 y 1 y timestamp no negativo.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'detections'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%confianza%') THEN
        ALTER TABLE detections ADD CONSTRAINT chk_detection_confianza CHECK (confianza >= 0 AND confianza <= 1);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'detections'::regclass AND contype = 'c'
                   AND pg_get_constraintdef(oid) LIKE '%"timestamp"%') THEN
        ALTER TABLE detections ADD CONSTRAINT chk_detection_timestamp CHECK ("timestamp" >= 0);
    END IF;

    -- alerts: una alerta por detección de apertura (INSERT ... ON CONFLICT DO NOTHING depende de esto).
    IF NOT EXISTS (SELECT 1 FROM pg_index i
                   JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
                   WHERE i.indrelid = 'alerts'::regclass AND i.indisunique AND i.indnatts = 1
                     AND a.attname = 'detection_id') THEN
        ALTER TABLE alerts ADD CONSTRAINT uq_alert_detection UNIQUE (detection_id);
    END IF;

    -- alerts: una sola alerta activa por sesión. En bases antiguas el índice existía sin UNIQUE.
    IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
               WHERE c.relname = 'active_session' AND NOT i.indisunique) THEN
        DROP INDEX active_session;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS active_session ON alerts(session_id) WHERE status = 'active';

-- Índices de las consultas reales (listados por fecha, con y sin cámara).
CREATE INDEX IF NOT EXISTS idx_detections_camera_fecha ON detections(camera, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_detections_fecha_hora ON detections(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_detections_session_id ON detections(session_id);
CREATE INDEX IF NOT EXISTS idx_alerts_camera_fecha ON alerts(camera, fecha_hora);
CREATE INDEX IF NOT EXISTS idx_alerts_fecha_hora ON alerts(fecha_hora);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);

-- Índices que ninguna consulta usa o que repiten otro (solo encarecen cada escritura).
DROP INDEX IF EXISTS idx_detections_camera;        -- cubierto por idx_detections_camera_fecha
DROP INDEX IF EXISTS idx_detections_timestamp;     -- timestamp es relativo a la sesión; nadie ordena por él
DROP INDEX IF EXISTS idx_alerts_timestamp_inicio;  -- ídem
DROP INDEX IF EXISTS idx_alerts_detection_id;      -- cubierto por la restricción UNIQUE

-- Alertas interrumpidas antes del 31-10: terminan en la última ventana guardada antes del corte. En un
-- window_gap la última guardada es la que llegó después del salto, así que se toma la anterior.
UPDATE alerts SET timestamp_fin = fin, duracion_segundos = fin - timestamp_inicio
FROM (
    SELECT a.id AS alert_id, CASE WHEN a.interruption_reason = 'window_gap' THEN
        (SELECT d."timestamp" FROM detections d WHERE d.session_id = a.session_id
            AND d.fecha_hora <= a.fecha_hora_fin AND d."timestamp" >= a.timestamp_inicio
            ORDER BY d.fecha_hora DESC OFFSET 1 LIMIT 1)
    ELSE
        (SELECT d."timestamp" FROM detections d WHERE d.session_id = a.session_id
            AND d.fecha_hora <= a.fecha_hora_fin AND d."timestamp" >= a.timestamp_inicio
            ORDER BY d.fecha_hora DESC LIMIT 1)
    END AS fin
    FROM alerts a WHERE a.status = 'interrupted' AND a.timestamp_fin IS NULL
) cortes
WHERE alerts.id = cortes.alert_id AND cortes.fin IS NOT NULL;

COMMIT;
