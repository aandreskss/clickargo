-- 0022_portal_enum.sql
-- DEBE ejecutarse en una transacción separada ANTES de 0022_portal_role.sql.
-- PostgreSQL no permite usar un valor de enum nuevo en la misma transacción
-- donde se declara (error 55P04).

ALTER TYPE public.tenant_role ADD VALUE IF NOT EXISTS 'customer';
