-- CARTEMA — délai après réception étendu au marché (décision du 22/10/2026). Une carte reçue par
-- échange ou cadeau ne peut plus être mise en vente (prix fixe ou enchère) pendant
-- trade_cooldown_hours (72 h), comme elle ne peut déjà être ni échangée ni offerte. Les cartes
-- achetées au marché ne sont pas concernées (social_received_at n'est posé que par transfer_item).
-- Les annonces déjà en ligne restent en place.

create trigger listings_cooldown before insert on public.listings
  for each row execute function private.check_card_cooldown();
