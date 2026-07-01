-- Backfill driver_profiles.iracing_customer_id from the league roster sheet.
-- Prerequisite: run supabase/driver_profiles_application_roster.sql first.
-- Run once in the Supabase SQL editor.

create temp table iracing_id_backfill (
  iracing_name text not null,
  iracing_customer_id text not null
);

insert into iracing_id_backfill (iracing_name, iracing_customer_id) values
  ('Aaron Bockover', '304136'),
  ('Agnello Marzuillo', '1364924'),
  ('Alex Menet', '1455272'),
  ('Amanda Sherman', '582065'),
  ('Austin Darbyshire', '235536'),
  ('Austin Edstrom', '276408'),
  ('Bill Harkins', '315521'),
  ('Billy Hensley', '233843'),
  ('Blake Decker', '288936'),
  ('Brad Lawson', '133542'),
  ('Brad Pitts', '207908'),
  ('Bradley D Wilson', '929583'),
  ('Brian Roush', '685390'),
  ('Brian Zimmerman3', '327558'),
  ('Bryan Dees', '257995'),
  ('Bryan Snare', '460463'),
  ('Caleb Elswick2', '636501'),
  ('Carter Phillips', '754321'),
  ('Chad Wilson', '129870'),
  ('Chris Berg', '173350'),
  ('Chris Carroll3', '307392'),
  ('Chris Evans3', '401793'),
  ('Chris Mackey3', '1253755'),
  ('Christian Ritchie', '603686'),
  ('Christopher Howell', '571613'),
  ('Christopher Lague', '202304'),
  ('Christopher Morse Jr', '390227'),
  ('Chuck Sweeting', '111941'),
  ('Cody Gibson', '142361'),
  ('Colby Jackson', '1014001'),
  ('Dalton Kilroe', '317726'),
  ('Daniel Rupeck', '319611'),
  ('Derek Paulson', '250165'),
  ('Dustin Ping', '162152'),
  ('Dylan Berg', '626617'),
  ('Dylan Eckard', '1497855'),
  ('Earl Hall', '44045'),
  ('Eddie Hagigh', '573653'),
  ('Fred Thompson', '36516'),
  ('Haiden Wheeler', '231085'),
  ('Hunter Lagunes', '690525'),
  ('Jacob Bell', '119444'),
  ('James Efaw', '30802'),
  ('James South', '76205'),
  ('Jamie-Le Dunning', '509977'),
  ('Jammey Walker', '96081'),
  ('Jason T Powell', '231799'),
  ('Jeffrey Reed', '729182'),
  ('Jess Hadley2', '337847'),
  ('Joey Creech', '929505'),
  ('Joey Neace', '139797'),
  ('John Perkins', '175138'),
  ('Jonathan Dominix', '436631'),
  ('Joseph Causey', '368826'),
  ('Juan Cobbs Jr', '922778'),
  ('Justin Levine', '244220'),
  ('Kenneth Dale Osbon', '18338'),
  ('Kevin Coburn', '336600'),
  ('Kevin Foster', '194401'),
  ('Kody Miller2', '1207664'),
  ('Kory Sherman', '325295'),
  ('Kyle Wellman', '314610'),
  ('Landon Cano', '926516'),
  ('Larry Bell', '307155'),
  ('Levi Allen', '108615'),
  ('Logan M Wilson', '856628'),
  ('Mark Arthur', '91227'),
  ('Matthew Kleinschmidt2', '269720'),
  ('Michael Boone2', '842668'),
  ('Michael Burthay', '462323'),
  ('Michael Kelly10', '778311'),
  ('Michael Taylor6', '69575'),
  ('Miguel Gomez-Gaudet', '1478479'),
  ('Mike Massengill', '303892'),
  ('Mitchell Snare', '579987'),
  ('Nicholas Moody', '1113130'),
  ('Nick Crawford', '64816'),
  ('Noah S. VanHoute', '202913'),
  ('Philip Vanvleet', '17572'),
  ('Preston Sparks', '536776'),
  ('Ray Rogers', '297067'),
  ('Reid Sanders', '792702'),
  ('Rick Thompson', '15836'),
  ('Robbie Good', '776395'),
  ('Ronnie Lane', '1225741'),
  ('Ryan Washeleski', '329874'),
  ('Samuel Baumgarten', '316539'),
  ('Samuel Lawson', '865300'),
  ('Scotty Stevens', '497305'),
  ('Talan Drake', '108255'),
  ('Tanner Marr', '437976'),
  ('Taylor Butcher-Benjamin', '297522'),
  ('Timothy Babcock', '474104'),
  ('Trevor Harmon2', '230095'),
  ('Ty Marasco', '330842'),
  ('Tyler Smith24', '637698'),
  ('William Bruton', '616089');

create temp table iracing_id_backfill_norm as
select
  m.iracing_name,
  m.iracing_customer_id,
  lower(regexp_replace(trim(m.iracing_name), '[^a-z0-9\s]', ' ', 'gi')) as norm_name,
  lower(
    regexp_replace(
      regexp_replace(trim(m.iracing_name), '[^a-z0-9\s]', ' ', 'gi'),
      '\s+',
      ' ',
      'g'
    )
  ) as norm_clean,
  lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(trim(m.iracing_name), '[^a-z0-9\s]', ' ', 'gi'),
        '\s+',
        ' ',
        'g'
      ),
      '\d+$',
      ''
    )
  ) as norm_stripped
from iracing_id_backfill m;

create temp table driver_profiles_norm as
select
  p.driver_id,
  p.iracing_name,
  p.display_name,
  p.iracing_customer_id as current_id,
  lower(regexp_replace(trim(coalesce(p.iracing_name, '')), '[^a-z0-9\s]', ' ', 'gi')) as norm_iracing,
  lower(regexp_replace(trim(coalesce(p.display_name, '')), '[^a-z0-9\s]', ' ', 'gi')) as norm_display,
  lower(
    regexp_replace(
      regexp_replace(trim(coalesce(p.iracing_name, p.display_name, '')), '[^a-z0-9\s]', ' ', 'gi'),
      '\s+',
      ' ',
      'g'
    )
  ) as norm_clean,
  lower(
    regexp_replace(
      regexp_replace(
        regexp_replace(trim(coalesce(p.iracing_name, p.display_name, '')), '[^a-z0-9\s]', ' ', 'gi'),
        '\s+',
        ' ',
        'g'
      ),
      '\d+$',
      ''
    )
  ) as norm_stripped
from driver_profiles p;

create temp table iracing_id_backfill_matches as
select distinct on (m.iracing_customer_id)
  p.driver_id,
  m.iracing_name as sheet_name,
  m.iracing_customer_id,
  p.iracing_name as profile_iracing_name,
  p.display_name as profile_display_name,
  p.current_id,
  case
    when p.norm_iracing = m.norm_clean then 'name_exact_iracing'
    when p.norm_display = m.norm_clean then 'name_exact_display'
    when p.norm_stripped = m.norm_stripped then 'name_stripped_digits'
    else 'name_fuzzy'
  end as match_method
from iracing_id_backfill_norm m
join driver_profiles_norm p
  on p.norm_iracing = m.norm_clean
  or p.norm_display = m.norm_clean
  or (
    p.norm_stripped = m.norm_stripped
    and length(p.norm_stripped) >= 5
  )
  or (
    p.norm_clean like m.norm_stripped || '%'
    and length(m.norm_stripped) >= 5
  )
  or (
    m.norm_clean like p.norm_stripped || '%'
    and length(p.norm_stripped) >= 5
  )
order by
  m.iracing_customer_id,
  case
    when p.norm_iracing = m.norm_clean then 0
    when p.norm_display = m.norm_clean then 1
    when p.norm_stripped = m.norm_stripped then 2
    else 3
  end,
  p.driver_id;

update driver_profiles p
set
  iracing_customer_id = m.iracing_customer_id,
  updated_at = now()
from iracing_id_backfill_matches m
where p.driver_id = m.driver_id
  and coalesce(p.iracing_customer_id, '') = ''
  and not exists (
    select 1
    from driver_profiles other
    where other.iracing_customer_id = m.iracing_customer_id
      and other.driver_id <> p.driver_id
  );

-- Review anything that did not update.
select
  m.iracing_name,
  m.iracing_customer_id,
  match.sheet_name,
  match.profile_iracing_name,
  match.profile_display_name,
  match.match_method,
  match.current_id,
  case
    when match.driver_id is null then 'no_profile_match'
    when coalesce(match.current_id, '') <> '' and match.current_id <> m.iracing_customer_id then 'profile_already_has_different_id'
    when exists (
      select 1
      from driver_profiles other
      where other.iracing_customer_id = m.iracing_customer_id
        and other.driver_id <> match.driver_id
    ) then 'customer_id_conflict'
    else 'updated_or_ready'
  end as status
from iracing_id_backfill m
left join iracing_id_backfill_matches match
  on match.iracing_customer_id = m.iracing_customer_id
order by status desc, m.iracing_name;
