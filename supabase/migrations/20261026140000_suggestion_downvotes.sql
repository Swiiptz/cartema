-- CARTEMA — doléances : votes négatifs au choix de l'admin (demande du 26/10/2026). En rendant une doléance
-- publique, l'admin peut cocher « Autoriser les votes négatifs » (coupé par défaut). Les joueurs peuvent alors
-- voter contre, en plus du vote pour ; un seul vote par joueur, pour ou contre, modifiable ou retirable.
-- Si l'option est recoupée, les votes contre restent en base mais ne comptent plus et ne s'acceptent plus.
--  * suggestions.allow_downvotes ; suggestion_votes.value (1 pour, -1 contre ; les votes existants valent 1).
--  * suggestion_json : « votes » compte toujours les votes pour, « my_vote » reste le vote pour (le site déjà
--    en ligne continue de marcher) ; ajout de allow_downvotes, downvotes et my_downvote.
--  * get_suggestions : idées publiques classées par solde (pour moins contre), lu dans le JSON déjà calculé.
--  * vote_suggestion et admin_answer_suggestion reçoivent un paramètre en dernier, avec une valeur par défaut.

alter table public.suggestions add column allow_downvotes boolean not null default false;
comment on column public.suggestions.allow_downvotes is 'Les joueurs peuvent voter contre cette doléance publique.';
alter table public.suggestion_votes add column value smallint not null default 1 check (value in (1, -1));

create or replace function private.suggestion_json(p_s public.suggestions, p_uid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  -- Les votes sont comptés une seule fois pour la doléance.
  with v as (select count(*) filter (where value = 1) as up,
                    count(*) filter (where value = -1 and p_s.allow_downvotes) as down,
                    max(value) filter (where voter_id = p_uid) as mine
               from public.suggestion_votes where suggestion_id = p_s.id)
  select jsonb_build_object('id', p_s.id, 'category', p_s.category, 'title', p_s.title, 'body', p_s.body,
    'status', p_s.status, 'public', p_s.public, 'reply', p_s.reply,
    -- Image jointe : visible par l'auteur et l'admin seulement (bucket privé).
    'image_path', case when p_s.author_id = p_uid or private.is_admin(p_uid) then p_s.image_path end, 'created_at', p_s.created_at, 'replied_at', p_s.replied_at,
    'mine', p_s.author_id = p_uid,
    'author', (select handle from public.profiles where id = p_s.author_id),
    'allow_downvotes', p_s.allow_downvotes,
    'votes', v.up, 'downvotes', v.down,
    'my_vote', coalesce(v.mine = 1, false),
    'my_downvote', coalesce(v.mine = -1 and p_s.allow_downvotes, false))
  from v
$$;

-- Mes doléances, puis les idées publiques (meilleur solde d'abord).
create or replace function public.get_suggestions() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
begin
  return jsonb_build_object(
    'mine', coalesce((select jsonb_agg(private.suggestion_json(s, v_uid) order by s.created_at desc)
                        from (select * from public.suggestions where author_id = v_uid order by created_at desc limit 50) s), '[]'::jsonb),
    'public', coalesce((select jsonb_agg(x.j order by (x.j->>'votes')::int - (x.j->>'downvotes')::int desc, (x.j->>'votes')::int desc, x.created_at desc) from (
        select private.suggestion_json(s, v_uid) j, s.created_at
          from public.suggestions s where s.public order by s.created_at desc limit 100) x), '[]'::jsonb));
end $$;

-- p_on = false retire le vote ; sinon p_value vaut 1 (pour) ou -1 (contre, si l'admin l'autorise).
drop function public.vote_suggestion(uuid, boolean);
create function public.vote_suggestion(p_id uuid, p_on boolean default true, p_value int default 1) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := private.require_player();
  v_s public.suggestions;
begin
  if p_value is null or p_value not in (1, -1) then raise exception 'invalid_vote'; end if;
  select * into v_s from public.suggestions where id = p_id and public;
  if not found then raise exception 'not_found'; end if;
  if v_s.author_id = v_uid then raise exception 'own_suggestion'; end if;
  if p_on then
    if p_value = -1 and not v_s.allow_downvotes then raise exception 'downvotes_disabled'; end if;
    insert into public.suggestion_votes (suggestion_id, voter_id, value) values (p_id, v_uid, p_value)
      on conflict (suggestion_id, voter_id) do update set value = excluded.value
      where public.suggestion_votes.value is distinct from excluded.value;
  else
    delete from public.suggestion_votes where suggestion_id = p_id and voter_id = v_uid;
  end if;
  return p_on;
end $$;

-- p_allow_downvotes = null garde l'option telle quelle (appel à 5 paramètres du site déjà en ligne).
drop function public.admin_answer_suggestion(uuid, text, boolean, text, text);
create function public.admin_answer_suggestion(p_id uuid, p_status text, p_public boolean, p_reply text, p_reason text,
                                               p_allow_downvotes boolean default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_admin uuid := private.require_admin();
  v_reason text := private.require_reason(p_reason);
  v_before public.suggestions;
  v_after public.suggestions;
  v_reply text := nullif(trim(coalesce(p_reply, '')), '');
begin
  if p_status not in ('new', 'planned', 'done', 'declined') or length(v_reply) > 1000 then raise exception 'invalid_suggestion'; end if;
  select * into v_before from public.suggestions where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.suggestions set status = p_status, public = coalesce(p_public, public), reply = v_reply,
         allow_downvotes = coalesce(p_allow_downvotes, allow_downvotes),
         replied_at = case when v_reply is distinct from v_before.reply or p_status <> v_before.status then now() else replied_at end
   where id = p_id returning * into v_after;
  -- L'auteur est prévenu quand la réponse ou le statut change.
  if v_reply is distinct from v_before.reply or p_status <> v_before.status then
    perform private.notify(v_after.author_id, 'suggestion_answered',
      jsonb_build_object('id', p_id, 'title', v_after.title, 'status', p_status, 'public', v_after.public));
  end if;
  perform private.audit(v_admin, 'suggestion_answer', p_id, v_reason, to_jsonb(v_before), to_jsonb(v_after));
end $$;

revoke execute on function public.vote_suggestion(uuid, boolean, int),
  public.admin_answer_suggestion(uuid, text, boolean, text, text, boolean) from public, anon;
grant execute on function public.vote_suggestion(uuid, boolean, int),
  public.admin_answer_suggestion(uuid, text, boolean, text, text, boolean) to authenticated;
