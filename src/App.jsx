-- Crée un Bethel individuel pour chacun des 5 Ministres Ordonnés sans adresse
-- confirmée, et les déplace du groupe provisoire partagé vers leur propre groupe.
do $$
declare
  personne record;
  nouveau_bethel_id uuid;
  prochain_numero integer;
  zone_placeholder uuid;
  campus_placeholder uuid;
begin
  select zone_id into zone_placeholder from data_zones where zone_name = 'Montreal Ville-Marie (Centre-ville)' limit 1;
  select campus_id into campus_placeholder from campuses where campus_code = 'MTL' limit 1;

  for personne in
    select member_id, first_name, last_name
    from members
    where role = 'Ministre Ordonné'
    and (bethel_id is null or bethel_id = (select bethel_id from bethels where hp_number = 'BETHEL-PROV-1'))
  loop
    select coalesce(max(cast(regexp_replace(hp_number, '\D', '', 'g') as integer)), 0) + 1
    into prochain_numero
    from bethels where hp_number like 'BETHEL-MTL-%';

    insert into bethels (hp_number, campus_id, zone_id, leader_name, leader_role, host_name, address, status)
    values (
      'BETHEL-MTL-' || prochain_numero, campus_placeholder, zone_placeholder,
      personne.first_name || ' ' || personne.last_name, 'Ministre Ordonné',
      personne.first_name || ' ' || personne.last_name, 'Adresse à confirmer', 'active'
    )
    returning bethel_id into nouveau_bethel_id;

    update members set bethel_id = nouveau_bethel_id where member_id = personne.member_id;

    raise notice '% % -> BETHEL-MTL-%', personne.first_name, personne.last_name, prochain_numero;
  end loop;
end $$;

-- Nettoie l'ancien groupe provisoire, maintenant vide
update bethels set status = 'inactive' where hp_number = 'BETHEL-PROV-1';
