-- v160: versioned service presets with private profession choices and atomic creation.
begin;
set local lock_timeout='10s';
set local statement_timeout='2min';
set local search_path=public,extensions,pg_catalog;

do $prerequisites$
begin
  if to_regclass('public.services') is null
     or to_regclass('public.performer_profiles') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null
     or to_regprocedure('extensions.gen_random_uuid()') is null then
    raise exception using errcode='55000',message='v160_service_presets_prerequisites_missing';
  end if;
  if exists(
    select 1 from (values
      ('id','uuid'),('performer_id','uuid'),('name','text'),
      ('duration_minutes','integer'),('price_rub','integer'),('active','boolean'),
      ('created_at','timestamp with time zone')
    ) expected(column_name,data_type)
    left join information_schema.columns actual
      on actual.table_schema='public' and actual.table_name='services'
      and actual.column_name=expected.column_name and actual.data_type=expected.data_type
    where actual.column_name is null
  ) then
    raise exception using errcode='55000',message='v160_services_contract_mismatch';
  end if;
end
$prerequisites$;

do $state_guard$
begin
  if to_regclass('public.minuta_professions_v160') is not null
     or to_regclass('public.minuta_service_presets_v160') is not null
     or to_regclass('public.minuta_performer_professions_v160') is not null
     or to_regclass('public.minuta_service_preset_requests_v160') is not null
     or to_regprocedure('public.minuta_normalize_service_name_v160(text)') is not null
     or to_regprocedure('public.prevent_duplicate_service_name_v160()') is not null
     or to_regprocedure('public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb)') is not null
     or to_regprocedure('public.get_provider_service_preset_catalog_v160(integer)') is not null
     or to_regprocedure('public.get_provider_service_preset_state_v160()') is not null
     or exists(select 1 from pg_trigger where tgname='services_prevent_duplicate_name_v160' and not tgisinternal)
     or to_regclass('public.services_normalized_name_v160_idx') is not null then
    raise exception using errcode='55000',message='v160_service_presets_state_not_absent';
  end if;
end
$state_guard$;

create function public.minuta_normalize_service_name_v160(value text)
returns text language sql immutable set search_path to '' as $$
  select lower(regexp_replace(
    btrim(translate(normalize(coalesce(value,''),NFKC),chr(160),' ')),
    '[[:space:]]+',' ','g'
  ));
$$;

create table public.minuta_professions_v160 (
  catalog_version integer not null check(catalog_version>0),
  locale text not null check(locale~'^[a-z]{2}-[A-Z]{2}$'),
  profession_id text not null check(profession_id~'^[a-z][a-z0-9_]{1,63}$'),
  label text not null check(char_length(btrim(label)) between 2 and 120),
  short_label text not null check(char_length(btrim(short_label)) between 2 and 80),
  sort_order integer not null check(sort_order>=0),
  active boolean not null default true,
  primary key(catalog_version,locale,profession_id),
  unique(catalog_version,locale,sort_order)
);

create table public.minuta_service_presets_v160 (
  catalog_version integer not null,
  locale text not null,
  preset_id text not null check(preset_id~'^[a-z][a-z0-9_]{1,95}$'),
  profession_id text not null,
  name text not null check(char_length(btrim(name)) between 2 and 120),
  category text not null check(char_length(btrim(category)) between 2 and 80),
  default_duration_minutes integer not null check(default_duration_minutes between 5 and 480),
  sort_order integer not null check(sort_order>=0),
  active boolean not null default true,
  primary key(catalog_version,locale,preset_id),
  unique(catalog_version,locale,profession_id,sort_order),
  foreign key(catalog_version,locale,profession_id)
    references public.minuta_professions_v160(catalog_version,locale,profession_id) on delete restrict
);

create table public.minuta_performer_professions_v160 (
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  profession_id text not null,
  catalog_version integer not null,
  locale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(performer_id,profession_id),
  foreign key(catalog_version,locale,profession_id)
    references public.minuta_professions_v160(catalog_version,locale,profession_id) on delete restrict
);

create table public.minuta_service_preset_requests_v160 (
  performer_id uuid not null references public.performer_profiles(id) on delete cascade,
  request_id uuid not null,
  catalog_version integer not null check(catalog_version>0),
  locale text not null,
  request_fingerprint text not null check(request_fingerprint~'^[0-9a-f]{64}$'),
  result jsonb not null check(jsonb_typeof(result)='object'),
  created_at timestamptz not null default now(),
  primary key(performer_id,request_id)
);

alter table public.minuta_professions_v160 enable row level security;
alter table public.minuta_professions_v160 force row level security;
alter table public.minuta_service_presets_v160 enable row level security;
alter table public.minuta_service_presets_v160 force row level security;
alter table public.minuta_performer_professions_v160 enable row level security;
alter table public.minuta_performer_professions_v160 force row level security;
alter table public.minuta_service_preset_requests_v160 enable row level security;
alter table public.minuta_service_preset_requests_v160 force row level security;

revoke all on table public.minuta_professions_v160 from public,anon,authenticated,service_role;
revoke all on table public.minuta_service_presets_v160 from public,anon,authenticated,service_role;
revoke all on table public.minuta_performer_professions_v160 from public,anon,authenticated,service_role;
revoke all on table public.minuta_service_preset_requests_v160 from public,anon,authenticated,service_role;

insert into public.minuta_professions_v160(
  catalog_version,locale,profession_id,label,short_label,sort_order,active
) values
  (1,'ru-RU','massage_therapist','Массажист','Массаж',0,true),
  (1,'ru-RU','nail_artist','Ногтевой мастер','Ногти',1,true),
  (1,'ru-RU','hair_stylist','Парикмахер / колорист','Волосы',2,true),
  (1,'ru-RU','barber','Барбер','Барбер',3,true),
  (1,'ru-RU','brow_artist','Бровист','Брови',4,true),
  (1,'ru-RU','lash_artist','Лэшмейкер','Ресницы',5,true),
  (1,'ru-RU','esthetician','Косметолог-эстетист','Уход за лицом',6,true),
  (1,'ru-RU','makeup_artist','Визажист','Макияж',7,true),
  (1,'ru-RU','depilation_artist','Мастер депиляции','Депиляция',8,true),
  (1,'ru-RU','tattoo_piercing_artist','Тату / пирсинг','Тату и пирсинг',9,true),
  (1,'ru-RU','spa_body_care','SPA / уход за телом','SPA',10,true),
  (1,'ru-RU','fitness_yoga_coach','Тренер / фитнес / йога','Фитнес и йога',11,true);

insert into public.minuta_service_presets_v160(
  catalog_version,locale,preset_id,profession_id,name,category,default_duration_minutes,sort_order,active
) values
  (1,'ru-RU','massage_full_body','massage_therapist','Массаж всего тела','Массаж',60,0,true),
  (1,'ru-RU','massage_back_neck_shoulders','massage_therapist','Массаж спины, шеи и плеч','Массаж',45,1,true),
  (1,'ru-RU','massage_relaxing','massage_therapist','Расслабляющий массаж','Массаж',60,2,true),
  (1,'ru-RU','massage_sports','massage_therapist','Спортивный массаж','Массаж',60,3,true),
  (1,'ru-RU','massage_lymphatic','massage_therapist','Лимфодренажный массаж','Массаж',60,4,true),
  (1,'ru-RU','massage_face','massage_therapist','Массаж лица','Массаж',30,5,true),
  (1,'ru-RU','massage_head','massage_therapist','Массаж головы','Массаж',30,6,true),
  (1,'ru-RU','nails_manicure_basic','nail_artist','Маникюр без покрытия','Маникюр',60,0,true),
  (1,'ru-RU','nails_manicure_gel','nail_artist','Маникюр с покрытием','Маникюр',120,1,true),
  (1,'ru-RU','nails_removal','nail_artist','Снятие покрытия','Маникюр',30,2,true),
  (1,'ru-RU','nails_strengthening','nail_artist','Укрепление ногтей','Маникюр',30,3,true),
  (1,'ru-RU','nails_extension','nail_artist','Наращивание ногтей','Маникюр',180,4,true),
  (1,'ru-RU','nails_extension_correction','nail_artist','Коррекция наращивания','Маникюр',120,5,true),
  (1,'ru-RU','nails_pedicure','nail_artist','Педикюр','Педикюр',90,6,true),
  (1,'ru-RU','hair_womens_cut','hair_stylist','Женская стрижка','Стрижки',60,0,true),
  (1,'ru-RU','hair_mens_cut','hair_stylist','Мужская стрижка','Стрижки',45,1,true),
  (1,'ru-RU','hair_styling','hair_stylist','Укладка','Укладка',60,2,true),
  (1,'ru-RU','hair_coloring','hair_stylist','Окрашивание','Окрашивание',180,3,true),
  (1,'ru-RU','hair_root_coloring','hair_stylist','Окрашивание корней','Окрашивание',120,4,true),
  (1,'ru-RU','hair_care','hair_stylist','Уход за волосами','Уход',60,5,true),
  (1,'ru-RU','hair_consultation','hair_stylist','Консультация','Консультация',30,6,true),
  (1,'ru-RU','barber_haircut','barber','Мужская стрижка','Стрижки',45,0,true),
  (1,'ru-RU','barber_beard','barber','Оформление бороды','Борода',30,1,true),
  (1,'ru-RU','barber_haircut_beard','barber','Стрижка + борода','Комплекс',75,2,true),
  (1,'ru-RU','barber_kids_cut','barber','Детская стрижка','Стрижки',45,3,true),
  (1,'ru-RU','barber_fade','barber','Фейд','Стрижки',45,4,true),
  (1,'ru-RU','barber_shave','barber','Бритьё головы или лица','Бритьё',45,5,true),
  (1,'ru-RU','barber_gray_blending','barber','Камуфляж седины','Окрашивание',45,6,true),
  (1,'ru-RU','brows_shaping','brow_artist','Коррекция формы бровей','Брови',30,0,true),
  (1,'ru-RU','brows_tinting','brow_artist','Окрашивание бровей','Брови',30,1,true),
  (1,'ru-RU','brows_shaping_tinting','brow_artist','Коррекция + окрашивание','Брови',45,2,true),
  (1,'ru-RU','brows_lamination','brow_artist','Ламинирование бровей','Брови',60,3,true),
  (1,'ru-RU','brows_lamination_tinting','brow_artist','Ламинирование + окрашивание','Брови',75,4,true),
  (1,'ru-RU','brows_consultation','brow_artist','Консультация','Консультация',20,5,true),
  (1,'ru-RU','lashes_classic','lash_artist','Классическое наращивание','Наращивание',120,0,true),
  (1,'ru-RU','lashes_hybrid','lash_artist','Лёгкий объём','Наращивание',150,1,true),
  (1,'ru-RU','lashes_volume','lash_artist','Объёмное наращивание','Наращивание',180,2,true),
  (1,'ru-RU','lashes_refill','lash_artist','Коррекция наращивания','Коррекция',120,3,true),
  (1,'ru-RU','lashes_removal','lash_artist','Снятие ресниц','Снятие',30,4,true),
  (1,'ru-RU','lashes_lamination','lash_artist','Ламинирование ресниц','Ламинирование',75,5,true),
  (1,'ru-RU','lashes_tinting','lash_artist','Окрашивание ресниц','Окрашивание',30,6,true),
  (1,'ru-RU','esthetician_consultation','esthetician','Консультация по уходу','Консультация',30,0,true),
  (1,'ru-RU','esthetician_basic_facial','esthetician','Базовый уход за лицом','Уход',60,1,true),
  (1,'ru-RU','esthetician_cleansing_facial','esthetician','Очищающий уход','Уход',75,2,true),
  (1,'ru-RU','esthetician_surface_peel','esthetician','Поверхностный пилинг','Уход',45,3,true),
  (1,'ru-RU','esthetician_face_massage','esthetician','Массаж лица','Уход',45,4,true),
  (1,'ru-RU','esthetician_express_care','esthetician','Экспресс-уход','Уход',30,5,true),
  (1,'ru-RU','esthetician_back_care','esthetician','Уход за спиной','Уход',60,6,true),
  (1,'ru-RU','makeup_natural','makeup_artist','Естественный макияж','Макияж',60,0,true),
  (1,'ru-RU','makeup_day','makeup_artist','Дневной макияж','Макияж',60,1,true),
  (1,'ru-RU','makeup_evening','makeup_artist','Вечерний макияж','Макияж',90,2,true),
  (1,'ru-RU','makeup_event','makeup_artist','Макияж для события','Макияж',90,3,true),
  (1,'ru-RU','makeup_bridal','makeup_artist','Свадебный макияж','Свадебный образ',120,4,true),
  (1,'ru-RU','makeup_bridal_trial','makeup_artist','Пробный свадебный макияж','Свадебный образ',120,5,true),
  (1,'ru-RU','makeup_consultation','makeup_artist','Консультация','Консультация',30,6,true),
  (1,'ru-RU','depilation_underarms','depilation_artist','Депиляция: подмышки','Зоны',20,0,true),
  (1,'ru-RU','depilation_lower_legs','depilation_artist','Депиляция: голени','Зоны',30,1,true),
  (1,'ru-RU','depilation_full_legs','depilation_artist','Депиляция: ноги полностью','Зоны',60,2,true),
  (1,'ru-RU','depilation_face_zone','depilation_artist','Депиляция: зона лица','Зоны',20,3,true),
  (1,'ru-RU','depilation_bikini','depilation_artist','Депиляция: бикини','Зоны',30,4,true),
  (1,'ru-RU','depilation_deep_bikini','depilation_artist','Депиляция: глубокое бикини','Зоны',45,5,true),
  (1,'ru-RU','depilation_combo','depilation_artist','Комплекс зон','Комплекс',90,6,true),
  (1,'ru-RU','tattoo_consultation','tattoo_piercing_artist','Консультация по тату','Тату',30,0,true),
  (1,'ru-RU','tattoo_session','tattoo_piercing_artist','Сеанс татуировки','Тату',180,1,true),
  (1,'ru-RU','tattoo_correction','tattoo_piercing_artist','Коррекция татуировки','Тату',90,2,true),
  (1,'ru-RU','piercing_consultation','tattoo_piercing_artist','Консультация по пирсингу','Пирсинг',20,3,true),
  (1,'ru-RU','piercing_ear','tattoo_piercing_artist','Пирсинг уха','Пирсинг',30,4,true),
  (1,'ru-RU','piercing_body','tattoo_piercing_artist','Пирсинг тела','Пирсинг',30,5,true),
  (1,'ru-RU','piercing_jewelry_change','tattoo_piercing_artist','Замена украшения','Пирсинг',20,6,true),
  (1,'ru-RU','spa_body_care','spa_body_care','Уход за телом','Уход за телом',60,0,true),
  (1,'ru-RU','spa_body_scrub','spa_body_care','Скрабирование тела','Уход за телом',45,1,true),
  (1,'ru-RU','spa_body_wrap','spa_body_care','Обёртывание','Уход за телом',60,2,true),
  (1,'ru-RU','spa_program','spa_body_care','SPA-программа','Программы',120,3,true),
  (1,'ru-RU','spa_scrub_massage','spa_body_care','Скрабирование + массаж','Программы',90,4,true),
  (1,'ru-RU','spa_foot_care','spa_body_care','SPA-уход для ног','Уход за телом',45,5,true),
  (1,'ru-RU','spa_back_care','spa_body_care','Уход за спиной','Уход за телом',60,6,true),
  (1,'ru-RU','fitness_personal','fitness_yoga_coach','Индивидуальная тренировка','Фитнес',60,0,true),
  (1,'ru-RU','fitness_group','fitness_yoga_coach','Групповая тренировка','Фитнес',60,1,true),
  (1,'ru-RU','fitness_intro','fitness_yoga_coach','Вводная тренировка','Фитнес',45,2,true),
  (1,'ru-RU','yoga_personal','fitness_yoga_coach','Индивидуальная йога','Йога',60,3,true),
  (1,'ru-RU','yoga_group','fitness_yoga_coach','Групповая йога','Йога',60,4,true),
  (1,'ru-RU','fitness_mobility','fitness_yoga_coach','Растяжка и мобильность','Практики',60,5,true),
  (1,'ru-RU','fitness_consultation','fitness_yoga_coach','Консультация','Консультация',30,6,true);

create index services_normalized_name_v160_idx
  on public.services(performer_id,public.minuta_normalize_service_name_v160(name));

create function public.prevent_duplicate_service_name_v160()
returns trigger language plpgsql security definer set search_path to '' as $$
declare v_name text:=public.minuta_normalize_service_name_v160(new.name);
begin
  if tg_op='UPDATE'
     and new.performer_id is not distinct from old.performer_id
     and v_name=public.minuta_normalize_service_name_v160(old.name) then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.performer_id::text||':service-name:'||v_name,160));
  if exists(
    select 1 from public.services service
    where service.performer_id=new.performer_id and service.id is distinct from new.id
      and public.minuta_normalize_service_name_v160(service.name)=v_name
  ) then
    raise exception using errcode='23505',message='duplicate_service_name';
  end if;
  return new;
end;
$$;

create trigger services_prevent_duplicate_name_v160
before insert or update of performer_id,name on public.services
for each row execute function public.prevent_duplicate_service_name_v160();

create function public.get_provider_service_preset_catalog_v160(p_catalog_version integer default null)
returns table(
  catalog_version integer,locale text,profession_id text,profession_label text,profession_short_label text,
  profession_sort_order integer,preset_id text,service_name text,category text,
  default_duration_minutes integer,preset_sort_order integer
) language sql stable security definer set search_path to '' as $$
  select profession.catalog_version,profession.locale,profession.profession_id,profession.label,profession.short_label,
    profession.sort_order,preset.preset_id,preset.name,preset.category,preset.default_duration_minutes,preset.sort_order
  from public.minuta_professions_v160 profession
  join public.minuta_service_presets_v160 preset using(catalog_version,locale,profession_id)
  where profession.locale='ru-RU' and profession.active and preset.active
    and profession.catalog_version=coalesce(p_catalog_version,(
      select max(candidate.catalog_version) from public.minuta_professions_v160 candidate
      where candidate.locale='ru-RU' and candidate.active
    ))
  order by profession.sort_order,preset.sort_order;
$$;

create function public.get_provider_service_preset_state_v160()
returns jsonb language plpgsql stable security definer set search_path to '' as $$
declare v_uid uuid:=auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  select jsonb_build_object(
    'catalog_version',max(choice.catalog_version),
    'locale',coalesce(max(choice.locale),'ru-RU'),
    'profession_ids',coalesce(jsonb_agg(choice.profession_id order by profession.sort_order),'[]'::jsonb)
  ) into v_result
  from public.minuta_performer_professions_v160 choice
  left join public.minuta_professions_v160 profession
    on profession.catalog_version=choice.catalog_version and profession.locale=choice.locale
    and profession.profession_id=choice.profession_id
  where choice.performer_id=v_uid;
  return v_result;
end;
$$;

create function public.create_provider_services_from_presets_v160(
  p_request uuid,p_catalog_version integer,p_professions text[],p_services jsonb
) returns jsonb language plpgsql volatile security definer set search_path to '' as $$
declare
  v_uid uuid:=auth.uid();
  v_locale constant text:='ru-RU';
  v_professions text[]:='{}'::text[];
  v_profession text;
  v_raw_profession text;
  v_validated jsonb:='[]'::jsonb;
  v_item jsonb;
  v_item_id text;
  v_preset_id text;
  v_preset_profession text;
  v_name text;
  v_normalized text;
  v_duration_numeric numeric;
  v_price_numeric numeric;
  v_duration integer;
  v_price integer;
  v_item_ids text[]:='{}'::text[];
  v_preset_ids text[]:='{}'::text[];
  v_names text[]:='{}'::text[];
  v_fingerprint text;
  v_existing_request public.minuta_service_preset_requests_v160%rowtype;
  v_service_id uuid;
  v_service_active boolean;
  v_results jsonb:='[]'::jsonb;
  v_result jsonb;
  v_created integer:=0;
  v_existing integer:=0;
begin
  if v_uid is null then raise exception using errcode='42501',message='authentication_required'; end if;
  if p_request is null then raise exception using errcode='22023',message='service_preset_request_required'; end if;
  if not exists(select 1 from public.performer_profiles profile where profile.id=v_uid) then
    raise exception using errcode='42501',message='provider_profile_required';
  end if;
  if p_catalog_version is null or p_catalog_version<=0 or not exists(
    select 1 from public.minuta_professions_v160 profession
    where profession.catalog_version=p_catalog_version and profession.locale=v_locale and profession.active
  ) then
    raise exception using errcode='22023',message='invalid_service_preset_catalog';
  end if;
  if coalesce(cardinality(p_professions),0)>32 then
    raise exception using errcode='22023',message='invalid_profession';
  end if;
  foreach v_raw_profession in array coalesce(p_professions,'{}'::text[]) loop
    v_profession:=btrim(coalesce(v_raw_profession,''));
    if v_profession='' or v_profession=any(v_professions) or not exists(
      select 1 from public.minuta_professions_v160 profession
      where profession.catalog_version=p_catalog_version and profession.locale=v_locale
        and profession.profession_id=v_profession and profession.active
    ) then
      raise exception using errcode='22023',message='invalid_profession';
    end if;
    v_professions:=array_append(v_professions,v_profession);
  end loop;
  select coalesce(array_agg(profession_value.value order by profession_value.value),'{}'::text[])
    into v_professions from unnest(v_professions) profession_value(value);

  if p_services is null or jsonb_typeof(p_services) is distinct from 'array' then
    raise exception using errcode='22023',message='invalid_service_payload';
  end if;
  if jsonb_array_length(p_services)>100 then
    raise exception using errcode='22023',message='invalid_service_payload';
  end if;
  for v_item in select value from jsonb_array_elements(p_services) loop
    if jsonb_typeof(v_item) is distinct from 'object' then
      raise exception using errcode='22023',message='invalid_service_payload';
    end if;
    if exists(
      select 1 from jsonb_object_keys(v_item) item_key(value)
      where item_key.value<>all(array['item_id','preset_id','name','duration_minutes','price_rub'])
    ) then
      raise exception using errcode='22023',message='invalid_service_payload';
    end if;
    if jsonb_typeof(v_item->'item_id') is distinct from 'string'
       or jsonb_typeof(v_item->'name') is distinct from 'string'
       or jsonb_typeof(v_item->'duration_minutes') is distinct from 'number'
       or jsonb_typeof(v_item->'price_rub') is distinct from 'number' then
      raise exception using errcode='22023',message='invalid_service_payload';
    end if;
    v_item_id:=btrim(v_item->>'item_id');
    v_name:=btrim(regexp_replace(translate(normalize(v_item->>'name',NFKC),chr(160),' '),'[[:space:]]+',' ','g'));
    v_normalized:=public.minuta_normalize_service_name_v160(v_name);
    v_duration_numeric:=(v_item->>'duration_minutes')::numeric;
    v_price_numeric:=(v_item->>'price_rub')::numeric;
    if v_item_id='' or char_length(v_item_id)>120 or v_item_id=any(v_item_ids)
       or char_length(v_name) not between 2 and 120
       or char_length(v_normalized) not between 2 and 120
       or v_normalized=any(v_names)
       or v_duration_numeric<>trunc(v_duration_numeric) or v_duration_numeric not between 5 and 480
       or v_price_numeric<>trunc(v_price_numeric) or v_price_numeric not between 0 and 1000000 then
      raise exception using errcode='22023',message=case when v_normalized=any(v_names) then 'duplicate_service_name' else 'invalid_service_payload' end;
    end if;
    if not (v_item ? 'preset_id') or jsonb_typeof(v_item->'preset_id')='null' then
      v_preset_id:=null;
    elsif jsonb_typeof(v_item->'preset_id')='string' then
      v_preset_id:=nullif(btrim(v_item->>'preset_id'),'');
      if v_preset_id is null then raise exception using errcode='22023',message='invalid_service_preset'; end if;
    else
      raise exception using errcode='22023',message='invalid_service_preset';
    end if;
    if v_preset_id is not null then
      if v_preset_id=any(v_preset_ids) then raise exception using errcode='22023',message='invalid_service_preset'; end if;
      select preset.profession_id into v_preset_profession
      from public.minuta_service_presets_v160 preset
      where preset.catalog_version=p_catalog_version and preset.locale=v_locale
        and preset.preset_id=v_preset_id and preset.active;
      if not found or not (v_preset_profession=any(v_professions)) then
        raise exception using errcode='22023',message='invalid_service_preset';
      end if;
      v_preset_ids:=array_append(v_preset_ids,v_preset_id);
    end if;
    v_duration:=v_duration_numeric::integer;
    v_price:=v_price_numeric::integer;
    v_item_ids:=array_append(v_item_ids,v_item_id);
    v_names:=array_append(v_names,v_normalized);
    v_validated:=v_validated||jsonb_build_array(jsonb_build_object(
      'item_id',v_item_id,'preset_id',v_preset_id,'name',v_name,
      'normalized_name',v_normalized,'duration_minutes',v_duration,'price_rub',v_price
    ));
  end loop;

  v_fingerprint:=encode(extensions.digest(convert_to(jsonb_build_object(
    'catalog_version',p_catalog_version,'locale',v_locale,
    'professions',to_jsonb(v_professions),'services',v_validated
  )::text,'UTF8'),'sha256'),'hex');
  -- Serialize all preset state changes for one provider, even when different
  -- request IDs arrive concurrently from separate tabs.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':service-preset-state',160));
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':service-preset-request:'||p_request::text,160));
  select * into v_existing_request from public.minuta_service_preset_requests_v160 request
  where request.performer_id=v_uid and request.request_id=p_request for update;
  if found then
    if v_existing_request.request_fingerprint<>v_fingerprint then
      raise exception using errcode='23505',message='service_preset_request_conflict';
    end if;
    return v_existing_request.result||jsonb_build_object('replayed',true);
  end if;

  for v_normalized in
    select item.value->>'normalized_name' from jsonb_array_elements(v_validated) item(value)
    order by item.value->>'normalized_name'
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_uid::text||':service-name:'||v_normalized,160));
  end loop;

  delete from public.minuta_performer_professions_v160 choice
  where choice.performer_id=v_uid and not (choice.profession_id=any(v_professions));
  insert into public.minuta_performer_professions_v160(
    performer_id,profession_id,catalog_version,locale
  ) select v_uid,profession_value.value,p_catalog_version,v_locale
    from unnest(v_professions) profession_value(value)
  on conflict(performer_id,profession_id) do update set
    catalog_version=excluded.catalog_version,locale=excluded.locale,updated_at=now();

  for v_item in select value from jsonb_array_elements(v_validated) loop
    v_service_id:=null;
    v_service_active:=null;
    select service.id,service.active into v_service_id,v_service_active
    from public.services service
    where service.performer_id=v_uid
      and public.minuta_normalize_service_name_v160(service.name)=v_item->>'normalized_name'
    order by service.created_at,service.id limit 1 for update;
    if found then
      v_existing:=v_existing+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'item_id',v_item->>'item_id','preset_id',v_item->'preset_id',
        'service_id',v_service_id,'status','already_exists','active',v_service_active
      ));
    else
      v_service_id:=extensions.gen_random_uuid();
      insert into public.services(id,performer_id,name,duration_minutes,price_rub,active)
      values(v_service_id,v_uid,v_item->>'name',(v_item->>'duration_minutes')::integer,(v_item->>'price_rub')::integer,true);
      v_created:=v_created+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'item_id',v_item->>'item_id','preset_id',v_item->'preset_id',
        'service_id',v_service_id,'status','created','active',true
      ));
    end if;
  end loop;

  v_result:=jsonb_build_object(
    'request_id',p_request,'catalog_version',p_catalog_version,'locale',v_locale,
    'profession_ids',to_jsonb(v_professions),'created_count',v_created,
    'existing_count',v_existing,'services',v_results,'replayed',false
  );
  insert into public.minuta_service_preset_requests_v160(
    performer_id,request_id,catalog_version,locale,request_fingerprint,result
  ) values(v_uid,p_request,p_catalog_version,v_locale,v_fingerprint,v_result);
  return v_result;
end;
$$;

revoke all on function public.minuta_normalize_service_name_v160(text) from public,anon,authenticated,service_role;
revoke all on function public.prevent_duplicate_service_name_v160() from public,anon,authenticated,service_role;
revoke all on function public.get_provider_service_preset_catalog_v160(integer) from public,anon,authenticated,service_role;
revoke all on function public.get_provider_service_preset_state_v160() from public,anon,authenticated,service_role;
revoke all on function public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb) from public,anon,authenticated,service_role;
grant execute on function public.get_provider_service_preset_catalog_v160(integer) to authenticated;
grant execute on function public.get_provider_service_preset_state_v160() to authenticated;
grant execute on function public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb) to authenticated;

alter function public.minuta_normalize_service_name_v160(text) owner to postgres;
alter function public.prevent_duplicate_service_name_v160() owner to postgres;
alter function public.get_provider_service_preset_catalog_v160(integer) owner to postgres;
alter function public.get_provider_service_preset_state_v160() owner to postgres;
alter function public.create_provider_services_from_presets_v160(uuid,integer,text[],jsonb) owner to postgres;
alter table public.minuta_professions_v160 owner to postgres;
alter table public.minuta_service_presets_v160 owner to postgres;
alter table public.minuta_performer_professions_v160 owner to postgres;
alter table public.minuta_service_preset_requests_v160 owner to postgres;

commit;
