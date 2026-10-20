-- Édition d'ESSAI pour vérifier la boucle booster sur un projet de développement.
-- Personnages fictifs et explicitement nommés « Essai » : ce n'est pas le catalogue réel.
-- Ne pas exécuter en production. Pour la retirer : update public.editions set packs_enabled=false,
-- album_published=false, archived_at=now() where prefix='ESSAI';
do $$
declare
  v_edition uuid;
  v_rarity public.rarity;
  v_n integer := 0;
begin
  if exists (select 1 from public.editions where prefix = 'ESSAI') then
    raise notice 'Édition ESSAI déjà présente';
    return;
  end if;
  insert into public.editions (name, prefix, album_published) values ('Édition d''essai', 'ESSAI', true)
    returning id into v_edition;
  foreach v_rarity in array enum_range(null::public.rarity) loop
    v_n := v_n + 1;
    insert into public.characters (edition_id, number, name, role_title, rarity, status)
      values (v_edition, v_n, 'Essai ' || v_rarity::text, 'Carte de test', v_rarity, 'published');
  end loop;
  update public.editions set packs_enabled = true where id = v_edition;
end $$;
select e.prefix, e.packs_enabled, count(c.*) as cartes
from public.editions e join public.characters c on c.edition_id = e.id
where e.prefix = 'ESSAI' group by e.prefix, e.packs_enabled;
