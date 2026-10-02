// Synthetic only: reusable empty prerequisites plus real v129/v132/v163 SQL.
import {readFileSync} from 'node:fs';
export const expenseSql=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8').replaceAll('\r\n','\n');
export const expenseFixtureIds={owner:'19300000-0000-4000-8000-000000000001',staff:'19300000-0000-4000-8000-000000000002',foreign:'19300000-0000-4000-8000-000000000003',
 org:'19300000-0000-4000-8000-000000000101',other:'19300000-0000-4000-8000-000000000102'};
export async function applyExpenseFixture(db){
 const ids=expenseFixtureIds,read=expenseSql;
 // Minimal external prerequisite skeleton; no fake v129/v132/v163 financial RPCs.
 // Empty unrelated commerce/payroll tables are necessary for the real v163 reader.
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema extensions;
 create function extensions.digest(value bytea,algorithm text) returns bytea language sql immutable as $$select case when algorithm='sha256' then sha256(value) end$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to authenticated,anon,service_role;
 create table auth.users(id uuid primary key);
 create table public.organizations(id uuid primary key,status text not null default 'active');
 create table public.organization_memberships(organization_id uuid references public.organizations(id),user_id uuid references auth.users(id),role text,active boolean,primary key(organization_id,user_id));
 create function public.has_organization_role(o uuid,r text[]) returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.organization_memberships where organization_id=o and user_id=auth.uid() and active and role=any(r))$$;
 create table public.performer_profiles(id uuid primary key,display_name text);
 create table public.services(id uuid primary key,name text);
 create table public.bookings(id uuid primary key,organization_id uuid,status text,payment_status text,deposit_amount_rub integer,booking_date date,booking_time time,performer_id uuid,service_id uuid);
 create table public.booking_outcomes(booking_id uuid primary key,visit_status text,payment_method text,amount_rub integer,calculated_amount_rub integer,completion_source text,updated_at timestamptz);
 create table public.payments(id uuid primary key,booking_id uuid,status text);
 create table public.payment_provider_attempts(id uuid primary key,organization_id uuid,booking_id uuid,captured_amount_minor bigint);
 create table public.locations(id uuid primary key,organization_id uuid,active boolean default true,timezone text,is_primary boolean default true);
 insert into auth.users values('${ids.owner}'),('${ids.staff}'),('${ids.foreign}');
 insert into public.performer_profiles values('${ids.owner}','Synthetic owner'),('${ids.staff}','Synthetic staff'),('${ids.foreign}','Synthetic foreign');
 insert into public.organizations values('${ids.org}','active'),('${ids.other}','active');
 insert into public.organization_memberships values('${ids.org}','${ids.owner}','owner',true),('${ids.org}','${ids.staff}','specialist',true),('${ids.other}','${ids.foreign}','owner',true);
 insert into public.locations values('19300000-0000-4000-8000-000000000201','${ids.org}',true,'Europe/Samara',true);`);
 await db.exec(read('supabase-migration-v129.sql'));
 await db.exec(read('supabase-migration-v132.sql'));
 await db.exec(`create table public.financial_debt_settlement_sources(id uuid,organization_id uuid,visit_transaction_id uuid,gross_minor bigint,commission_minor bigint);
 create table public.financial_payroll_payment_sources(id uuid,organization_id uuid,performer_id uuid);
 create table public.commercial_sales(id uuid,organization_id uuid,seller_id uuid);
 create table public.commercial_sale_lines(sale_id uuid,item_name text);
 create table public.commercial_sale_refunds(id uuid,organization_id uuid,sale_id uuid);
 create table public.organization_recurring_expenses(id uuid,organization_id uuid,name text);
 create table public.recurring_expense_occurrences(expense_source_id uuid,organization_id uuid,rule_id uuid);
 create function public.get_minuta_money_dashboard_v147(uuid,date,date) returns jsonb language plpgsql as $$begin raise exception 'unused_fixture_dependency';end$$;
 create function public.get_minuta_commerce_workspace_v151(uuid) returns jsonb language plpgsql as $$begin raise exception 'unused_fixture_dependency';end$$;
 create function public.sell_minuta_commercial_product_v151(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,numeric,bigint,bigint,text,uuid,uuid) returns jsonb language plpgsql as $$begin raise exception 'unused_fixture_dependency';end$$;
 create function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid) returns jsonb language plpgsql as $$begin raise exception 'unused_fixture_dependency';end$$;
 comment on function public.refund_minuta_commercial_sale_v147(uuid,uuid,numeric,bigint,text,uuid) is 'minuta_refund_safety_v148_proportional_rounding';`);
 await db.exec(read('supabase-migration-v163.sql'));
}
