-- CARTEMA — doléances : illustration jointe (22/10/2026). Une demande de personnage (ou une autre
-- doléance) peut joindre une image, déposée dans le bucket privé « submissions », dossier du joueur
-- (mêmes règles que les contributions). Elle n'est visible que par son auteur et l'admin, même si la
-- doléance devient publique. submit_suggestion reçoit p_image_path en dernier, avec une valeur par
-- défaut : l'appel à 3 paramètres du site déjà en ligne fonctionne toujours.

alter table public.suggestions add column image_path text check (image_path is null or length(image_path) <= 200);

drop function public.submit_suggestion(text, text, text);
create or replace function private.suggestion_json(p_s public.suggestions, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_s.id, 'category', p_s.category, 'title', p_s.title, 'body', p_s.body,
    'status', p_s.status, 'public', p_s.public, 'reply', p_s.reply,
    -- Image jointe : visible par l'auteur et l'admin seulement (bucket privé).
    'image_path', case when p_s.author_id = p_uid or private.is_admin(p_uid) then p_s.image_path end, 'created_at', p_s.created_at, 'replied_at', p_s.replied_at,
    'mine', p_s.author_id = p_uid,
    'author', (select handle from public.profiles where id = p_s.author_id),
    'votes', (select count(*) from public.suggestion_votes v where v.suggestion_id = p_s.id),
    'my_vote', exists (select 1 from public.suggestion_votes v where v.suggestion_id = p_s.id and v.voter_id = p_uid))
$$;

create function public.submit_suggestion(p_category text, p_title text, p_body text, p_image_path text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_title text := trim(coalesce(p_title, ''));
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
  v_admin uuid;
begin
  if p_category not in ('feature', 'card', 'bug', 'other') or length(v_title) < 3 or length(v_title) > 80
     or length(v_body) > 2000 then
    raise exception 'invalid_suggestion';
  end if;
  -- Image facultative : seulement dans le dossier du joueur (bucket privé « submissions »).
  if p_image_path is not null and (split_part(p_image_path, '/', 1) <> v_uid::text or p_image_path like '%..%'
                                   or length(p_image_path) > 200) then
    raise exception 'invalid_suggestion';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if (select count(*) from public.suggestions where author_id = v_uid and created_at > now() - interval '2 days'
        and private.game_day(created_at) = private.game_day(now())) >= 5 then
    raise exception 'suggestion_limit';
  end if;
  insert into public.suggestions (author_id, category, title, body, image_path) values (v_uid, p_category, v_title, v_body, p_image_path)
    returning id into v_id;
  select id into v_admin from public.profiles where role = 'admin' limit 1;
  perform private.notify(v_admin, 'suggestion_received', jsonb_build_object('title', v_title, 'category', p_category,
    'from', (select handle from public.profiles where id = v_uid)));
  return v_id;
end $$;

revoke execute on function public.submit_suggestion(text, text, text, text) from public, anon;
grant execute on function public.submit_suggestion(text, text, text, text) to authenticated;
