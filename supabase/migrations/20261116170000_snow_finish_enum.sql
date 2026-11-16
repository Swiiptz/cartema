-- CARTEMA — finition Neige (16/11/2026) : nouvelle valeur de finition, seule dans sa migration
-- (une valeur d'enum ajoutée ne peut pas servir dans la même transaction). Le reste suit dans 20261116170100_snow_finish.

alter type public.finish add value if not exists 'Neige' after 'Sanglante';
