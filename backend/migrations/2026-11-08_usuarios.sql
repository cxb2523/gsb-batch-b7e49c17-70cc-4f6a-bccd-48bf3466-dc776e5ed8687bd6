-- Perfiles y roles del panel. Las contraseñas y los tokens viven en Clerk, nunca en esta tabla.
-- Idempotente. Se aplica a mano: el backend no crea esta tabla al arrancar.
BEGIN;

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT,
    role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    -- Marca (ms) del último evento de Clerk aplicado: los eventos pueden llegar desordenados.
    clerk_event_at BIGINT NOT NULL DEFAULT 0,
    -- La cuenta se borró en Clerk; el perfil se conserva y puede reutilizarse si se reinvita el correo.
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS users_role ON users(role);
CREATE INDEX IF NOT EXISTS users_is_active ON users(is_active);

COMMIT;
