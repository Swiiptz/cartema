-- CARTEMA — limite d'échanges durcie et Très rares moins fréquentes (décisions de Swiiptz, 25/10/2026).
--  * Limite quotidienne d'échanges : deux trous bouchés.
--    1. Deux acceptations au même instant voyaient chacune le même compte et passaient toutes les deux :
--       les contrôles d'un même joueur sont maintenant faits l'un après l'autre (verrou consultatif par joueur,
--       pris dans l'ordre des identifiants).
--    2. Les propositions en attente ne comptaient pas : on pouvait proposer plus d'échanges qu'il n'en restait.
--       À la proposition, échanges conclus aujourd'hui + propositions en attente du proposant doivent rester
--       sous la limite. L'acceptation reste le contrôle qui fait foi (échanges conclus aujourd'hui).
--  * Table de tirage : nouvelle version, 5e carte Rare 67 % (au lieu de 55), Très rare 25 % (au lieu de 37) ;
--    Épique, Légendaire et Mythique inchangées. Les Très rares s'empilaient (prix au marché sous la valeur de
--    recyclage). Les ouvertures déjà faites gardent leur version.

create or replace function private.trades_check_daily() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := private.daily_limit('trade_daily_limit');
  v_first uuid := least(new.proposer_id, new.recipient_id);
  v_second uuid := greatest(new.proposer_id, new.recipient_id);
begin
  if v_limit > 0 and (tg_op = 'INSERT' or (new.status = 'accepted' and old.status <> 'accepted')) then
    -- Un joueur à la fois : deux acceptations simultanées ne voient plus le même compte.
    perform pg_advisory_xact_lock(hashtextextended('trade_limit:' || v_first::text, 0));
    perform pg_advisory_xact_lock(hashtextextended('trade_limit:' || v_second::text, 0));
    if private.trades_today(new.proposer_id) >= v_limit or private.trades_today(new.recipient_id) >= v_limit then
      raise exception 'trade_daily_limit' using detail = v_limit::text;
    end if;
    -- À la proposition : les propositions en attente du proposant comptent aussi.
    if tg_op = 'INSERT' and private.trades_today(new.proposer_id)
         + (select count(*)::int from public.trades t
             where t.proposer_id = new.proposer_id and t.status = 'pending' and t.expires_at > now()) >= v_limit then
      raise exception 'trade_daily_limit' using detail = v_limit::text;
    end if;
  end if;
  return new;
end $$;

update public.pack_rulesets set active = false where active;
insert into public.pack_rulesets (version, slots, finishes, unique_odds, notes, active)
  select r.version + 1,
         jsonb_set(r.slots, '{4}', '[{"value": "Rare", "weight": 67000}, {"value": "Très rare", "weight": 25000},
                                     {"value": "Épique", "weight": 6000}, {"value": "Légendaire", "weight": 1900},
                                     {"value": "Mythique", "weight": 100}]'::jsonb),
         r.finishes, r.unique_odds,
         'Très rares moins fréquentes (25/10) : 5e carte Rare 67 %, Très rare 25 %.', true
    from public.pack_rulesets r
   where r.version = (select max(version) from public.pack_rulesets);
