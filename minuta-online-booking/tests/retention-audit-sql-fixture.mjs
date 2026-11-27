import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const readSql=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n');
export const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const org=id(100), owner=id(1), other=id(2);
export async function fixture(){
 const {PGlite}=await import(process.env.MINUTA_PGLITE_MODULE?pathToFileURL(process.env.MINUTA_PGLITE_MODULE).href:'@electric-sql/pglite');
 const db=new PGlite();
 await db.exec(`
 create role anon nologin;create role authenticated nologin;create role service_role nologin;
 create schema auth;create schema extensions;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table public.organizations(id uuid primary key,name text,public_slug text,status text default 'active');
 create table public.organization_memberships(organization_id uuid references public.organizations,user_id uuid references auth.users,role text,active boolean default true,primary key(organization_id,user_id));
 create table public.client_accounts(id uuid primary key);
 create table public.performer_profiles(id uuid primary key);
 create table public.bookings(id uuid primary key default gen_random_uuid(),organization_id uuid references public.organizations,client_account_id uuid references public.client_accounts,performer_id uuid references public.performer_profiles,client_name text,client_phone text,booking_date date,booking_time time,status text default 'confirmed',created_at timestamptz default now());
 create table public.booking_outcomes(booking_id uuid primary key references public.bookings,visit_status text);
 create index bookings_client_history_idx on public.bookings(client_account_id,booking_date desc,booking_time desc);
 create index bookings_organization_date_idx on public.bookings(organization_id,booking_date,booking_time);
 create function public.has_organization_role(p_org uuid,p_roles text[]) returns boolean language sql stable security definer as $$select exists(select 1 from public.organization_memberships where organization_id=p_org and user_id=auth.uid() and active and role=any(p_roles))$$;
 grant usage on schema public,auth to authenticated;
 insert into auth.users values('${owner}'),('${other}');
 insert into public.organizations values('${org}','Организация примера','retention-test','active');
 insert into public.organization_memberships values('${org}','${owner}','owner',true);
 `);
 await db.exec(readSql('supabase-migration-v83.sql'));
 const guard=readSql('supabase-migration-v100.sql').match(/create or replace function public\.require_minuta_retention_manager\(p_organization uuid\)[\s\S]*?end \$\$;/)?.[0];
 assert.ok(guard);await db.exec(guard);
 await db.query(`select set_config('request.jwt.claim.sub',$1,false)`,[owner]);
 await db.query(`select public.save_minuta_retention_settings($1,true,45,90,'Здравствуйте, {имя}! Запись в {организация}: {ссылка}')`,[org]);
 return db;
}
export async function addClient(db,n,days=60){
 const client=id(1000+n),booking=id(2000+n);
 await db.query('insert into public.client_accounts values($1)',[client]);
 await db.query(`insert into public.bookings(id,organization_id,client_account_id,client_name,client_phone,booking_date,booking_time) values($1,$2,$3,$4,'+79990000000',timezone('Europe/Samara',now())::date-$5::int,'12:00')`,[booking,org,client,'Вымышленный '+n,days]);
 await db.query(`insert into public.booking_outcomes values($1,'completed')`,[booking]);
 await db.query(`insert into public.client_marketing_consents(organization_id,client_account_id,status) values($1,$2,'granted')`,[org,client]);
 return client;
}
